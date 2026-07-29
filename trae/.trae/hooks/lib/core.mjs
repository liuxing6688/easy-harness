/**
 * 门禁域：core — 路径常量、IO、process.md、配置、Markdown 解析、R20 工作流模式、
 * normalizePath、阻塞/分派计划基础判定、stdin/allow/deny/ask 输出。
 *
 * 被几乎所有门禁 Hook 间接依赖；修改 IO/编码（R30）或 frontmatter 解析时务必跑
 * `gate-selftest` + `gate-scenarios`。域对照见 ./README.md。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roleProgressStats } from './role-path.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** hooks/ directory (state marker files live here, not under lib/) */
export const HOOKS_DIR = path.resolve(__dirname, '..');
export const PROJECT_ROOT = path.resolve(HOOKS_DIR, '../..');
export const DEFAULT_PROCESS_MD = path.join(PROJECT_ROOT, 'docs/process/process.md');
export const HARNESS_CONFIG = path.join(PROJECT_ROOT, '.trae/harness.config.json');
export const HARNESS_STATE = path.join(PROJECT_ROOT, '.trae/harness-state.json');
export const DEFAULT_GATED_ARTIFACTS = path.join(PROJECT_ROOT, 'docs/design/gated-artifacts.json');
export const TOOLCHAIN_APPROVAL_MARKER = path.join(
  HOOKS_DIR,
  '.toolchain-install-approved.json',
);
export const ROOT_CONVERSATION_STATE = path.join(
  HOOKS_DIR,
  '.root-conversation-id.json',
);
/** R5：最近经 Task 派发的角色 slug 列表（供角色↔路径匹配；见 recordDispatchedRole） */
export const DISPATCHED_ROLES_STATE = path.join(
  HOOKS_DIR,
  '.dispatched-roles.json',
);

/** R17：对账证据文件目录（相对项目根） */
export const RECON_EVIDENCE_DIR = 'test-results/recon';
export const RECON_EVIDENCE_PATH_RE = /test-results\/recon\/[A-Za-z0-9._-]+\.json/;

/**
 * **R30**：门禁输入编码鲁棒性。
 * 全部门禁判据都以「读得懂 process.md / 成果物 / JSON 产物」为前提，历史实现一律用
 * `fs.readFileSync(p, 'utf8')`：一旦宿主写出 UTF-8 BOM（Windows 记事本、
 * `Set-Content -Encoding UTF8`）或 UTF-16LE（PowerShell 5.1 的 `>` / `Out-File` 默认编码），
 * frontmatter 正则 `^---` 即失配、`JSON.parse` 即抛错，`cancelled` / `blocking` /
 * `workflow_mode` 等标志会**静默丢失**（实测：一个 BOM 就能解冻 R10 的不可逆冻结）。
 * 故所有门禁读盘统一走本模块的 `readTextFileSafe` / `readJsonFileSafe`。
 */
export function decodeTextBuffer(buf) {
  if (!buf || buf.length === 0) return '';
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8');
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return swap16ToString(buf.slice(2));
  }
  // 无 BOM 的 UTF-16 探测：ASCII 字符在 UTF-16 下有一半字节为 0x00，且落在固定奇偶位置。
  // 判据用「优势比」而非「另一侧必须为 0」——中日韩文本里 U+xx00 形式的字符
  // （如「一」U+4E00）会在另一侧也贡献 0x00，若要求严格为 0 会漏判整份文件。
  // 合法 UTF-8 文本几乎不含 0x00，故先用总量门槛排除普通 UTF-8。
  const probe = Math.min(buf.length, 512);
  let nulEven = 0;
  let nulOdd = 0;
  for (let i = 0; i < probe; i += 1) {
    if (buf[i] !== 0x00) continue;
    if (i % 2 === 0) nulEven += 1;
    else nulOdd += 1;
  }
  if (probe >= 4 && nulEven + nulOdd > probe / 8) {
    if (nulOdd >= nulEven * 4) return buf.toString('utf16le');
    if (nulEven >= nulOdd * 4) return swap16ToString(buf);
  }
  return buf.toString('utf8');
}

function swap16ToString(buf) {
  try {
    const even = buf.length % 2 === 0 ? Buffer.from(buf) : Buffer.from(buf.slice(0, buf.length - 1));
    even.swap16();
    return even.toString('utf16le');
  } catch {
    return buf.toString('utf8');
  }
}

/** 读文本文件（BOM/UTF-16 安全）；不存在或不可读时返回 null */
export function readTextFileSafe(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    return decodeTextBuffer(fs.readFileSync(absPath));
  } catch {
    return null;
  }
}

/** 读 JSON 文件（BOM/UTF-16 安全）；不存在或解析失败时返回 null */
export function readJsonFileSafe(absPath) {
  const text = readTextFileSafe(absPath);
  if (text === null) return null;
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

export const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw', '.go', '.rs', '.java', '.kt', '.kts',
  '.cs', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.hh',
  '.rb', '.php', '.swift', '.scala', '.sc', '.vue', '.svelte',
  '.sql', '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.bat', '.cmd',
  '.html', '.css', '.scss', '.sass', '.less', '.json', '.yaml', '.yml',
  '.toml', '.xml', '.gradle', '.dart', '.lua', '.r',
  // 函数式 / JVM / BEAM / 其他跨栈语言
  '.ex', '.exs', '.erl', '.hrl', '.clj', '.cljs', '.cljc', '.edn',
  '.hs', '.ml', '.mli', '.fs', '.fsx', '.fsi', '.jl',
  '.zig', '.nim', '.groovy', '.pl', '.pm', '.vb',
]);

// R6：.trae/scripts|agents|hooks 三目录纳入机制门禁；其余 .trae/** 默认放行，
// 但可被 dotTraeExemptPatterns 精确豁免其中的非治理产物（如 .toolchain-install-approved.json）。
const DEFAULT_DOTCURSOR_EXEMPT_PATTERNS = [
  '.trae/templates/**',
  '.trae/rules/**',
  '.trae/harness-state.json',
  '.trae/hooks.json',
  '.trae/harness.config.json',
  '.trae/hooks/.toolchain-install-approved.json',
  '.trae/hooks/.root-conversation-id.json',
  '.trae/hooks/.dispatched-roles.json',
];

/**
 * **R6 加强**：扩展名默认门禁的豁免目录。
 * 历史实现只用 `sourceDirs` 白名单认定源码，导致 `Sources/`（SwiftPM）、`myapp/`（Python 包）、
 * `MyApp/`（.NET）、`functions/`（Serverless）、`R/`、根目录 `main.py` 等主流布局完全不受门禁
 * ——与「跨技术栈通用」的定位矛盾。现改为「代码扩展名默认受门禁」，仅在下列依赖/产物/
 * 工具目录下豁免（这些目录的内容由包管理器与构建器生成，不是人写的成果物）。
 */
const DEFAULT_EXTENSION_GATE_EXEMPT_DIRS = [
  'node_modules', 'dist', 'build', 'out', 'target', 'coverage', 'vendor',
  '.venv', 'venv', 'env', '__pycache__', '.tox', '.mypy_cache', '.pytest_cache',
  '.next', '.nuxt', '.svelte-kit', '.output', '.turbo', '.parcel-cache',
  'test-results', 'playwright-report', '.git', '.idea', '.vs', 'tmp', 'temp',
  'bin', 'obj', 'Pods', '.gradle', '.dart_tool',
];

const DEFAULT_CONFIG = {
  gatedPaths: {
    sourceDirs: ['src', 'src-tauri', 'app', 'cmd', 'lib', 'internal', 'pkg', 'tests', 'test', '__tests__'],
    buildManifests: ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml'],
    testConfigs: ['vitest.config.ts', 'jest.config.js', 'pytest.ini'],
    rootPatterns: ['Dockerfile*', 'docker-compose*.yml', 'docker-compose*.yaml', '.env*', '.github/**'],
    docsAllowedExtensions: ['.md', '.mdx', '.txt'],
    dotTraeExemptPatterns: DEFAULT_DOTCURSOR_EXEMPT_PATTERNS,
    extensionGateExemptDirs: DEFAULT_EXTENSION_GATE_EXEMPT_DIRS,
  },
  gatedShellPatterns: [
    '\\bnpm\\s+create\\b',
    '\\bnpm\\s+install\\b',
    '\\bcargo\\s+init\\b',
    'create-tauri-app',
    '\\bdotnet\\s+new\\b',
    '\\bgo\\s+mod\\s+init\\b',
  ],
  toolchain: {
    approvalTtlMinutes: 60,
    installPatterns: [
      '\\bwinget\\s+install\\b',
      'rustup-init',
      '\\bchoco\\s+install\\b',
      '\\bscoop\\s+install\\b',
      '\\bbrew\\s+install\\b',
      '\\bapt(-get)?\\s+install\\b',
      '\\byum\\s+install\\b',
      '\\bdnf\\s+install\\b',
      'VisualStudio\\.\\*BuildTools',
      'VisualStudio\\.BuildTools',
      'vs_buildtools',
      'Microsoft\\.VisualStudio\\.',
    ],
  },
  qe: {
    commands: {},
  },
  // **R5 加强**：顶层会话 id 基准的有效期。基准一旦写入历史实现永不覆盖，
  // 遗留/污染值会使顶层代写拦截永久静默失效（实测可复现），故加 TTL 自愈。
  identity: {
    baselineTtlHours: 12,
  },
  // **R31**：同一对象累计回退超过该次数即由 stop 门禁要求 PM 阻塞并请用户决策。
  rollback: {
    limit: 3,
  },
};

export const ROLE_ALIASES = {
  '开发工程师': ['开发工程师', 'development-engineer'],
  // 现行缩写 QE
  '质量工程师': ['质量工程师', 'quality-engineer', 'QE'],
  '测试工程师': ['测试工程师', 'test-engineer'],
};

/** 角色显示名 / 别名 → 规范 slug（R5 角色↔路径匹配用） */
export const ROLE_SLUG_BY_ALIAS = {
  'project-manager': 'project-manager',
  项目经理: 'project-manager',
  'requirements-analyst': 'requirements-analyst',
  需求分析师: 'requirements-analyst',
  'system-architect': 'system-architect',
  系统架构师: 'system-architect',
  'requirement-reviewer': 'requirement-reviewer',
  需求评审专家: 'requirement-reviewer',
  'development-engineer': 'development-engineer',
  开发工程师: 'development-engineer',
  'quality-engineer': 'quality-engineer',
  质量工程师: 'quality-engineer',
  QE: 'quality-engineer',
  'test-engineer': 'test-engineer',
  测试工程师: 'test-engineer',
};

export function normalizeRoleSlug(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  if (ROLE_SLUG_BY_ALIAS[t]) return ROLE_SLUG_BY_ALIAS[t];
  const lower = t.toLowerCase();
  for (const [alias, slug] of Object.entries(ROLE_SLUG_BY_ALIAS)) {
    if (alias.toLowerCase() === lower) return slug;
  }
  return null;
}

let _configCache = null;
let _gatedArtifactsCache = null;
let _gatedArtifactsCachePath = null;

export function readStdinJsonAsync(timeoutMs = 5000) {
  if (process.stdin.isTTY) {
    return Promise.resolve({});
  }

  return new Promise((resolve) => {
    let data = '';
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onEnd);
      try {
        process.stdin.pause();
      } catch {
        /* ignore */
      }
      resolve(value);
    };

    const timer = setTimeout(() => {
      try {
        finish(data.trim() ? JSON.parse(data) : {});
      } catch {
        finish({});
      }
    }, timeoutMs);

    const onData = (chunk) => {
      data += chunk;
    };
    const onEnd = () => {
      try {
        finish(data.trim() ? JSON.parse(data) : {});
      } catch {
        finish({});
      }
    };

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onEnd);
    process.stdin.resume();
  });
}

/** @deprecated Prefer readStdinJsonAsync in hook entry scripts */
export function readStdinJson() {
  if (process.stdin.isTTY) return {};
  try {
    const chunks = [];
    let chunk;
    process.stdin.setEncoding('utf8');
    while ((chunk = process.stdin.read()) !== null) {
      chunks.push(chunk);
    }
    const raw = chunks.join('');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function output(result) {
  process.stdout.write(JSON.stringify(result));
}

/**
 * Trae PreToolUse stdout 契约（https://docs.trae.cn/ide_hook-configuration-reference）：
 * { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow'|'deny'|'ask',
 *   permissionDecisionReason: string, additionalContext: string } }
 * 仅 PreToolUse 钩子调用本组函数；Stop 钩子直接用 output() 输出 {}/{{decision:'block',reason}}。
 */
export function allow() {
  output({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } });
  process.exit(0);
}

export function deny(userMessage, agentMessage) {
  output({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: userMessage,
      additionalContext: agentMessage,
    },
  });
  process.exit(0);
}

export function ask(userMessage, agentMessage) {
  output({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: userMessage,
      additionalContext: agentMessage,
    },
  });
  process.exit(0);
}

export function readProcessMd() {
  // R30：BOM / UTF-16 安全读取，避免编码差异使 cancelled/blocking 等标志静默丢失
  return readTextFileSafe(getActiveProcessPath());
}

/** 读取任意（非当前活跃指针）process.md 路径的内容，供 R10 冻结检查使用 */
export function readProcessMdAtPath(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  return readTextFileSafe(abs);
}

export function resolveWorkspacePath(candidate, fallback) {
  if (!candidate || typeof candidate !== 'string') return fallback;
  const resolved = path.resolve(PROJECT_ROOT, candidate);
  const relative = path.relative(PROJECT_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return fallback;
  return resolved;
}

export function getActiveProcessPath() {
  if (process.env.HARNESS_PROCESS_PATH) {
    return resolveWorkspacePath(process.env.HARNESS_PROCESS_PATH, DEFAULT_PROCESS_MD);
  }

  if (fs.existsSync(HARNESS_STATE)) {
    try {
      const state = readJsonFileSafe(HARNESS_STATE) ?? {};
      if (state.activeProcessPath) {
        return resolveWorkspacePath(state.activeProcessPath, DEFAULT_PROCESS_MD);
      }
      if (state.activeFeature) {
        return resolveWorkspacePath(
          `docs/${state.activeFeature}/process/process.md`,
          DEFAULT_PROCESS_MD,
        );
      }
    } catch {
      /* fall through */
    }
  }

  return DEFAULT_PROCESS_MD;
}

/** 活跃 process.md 所在的 docs 子树根目录（如 docs/ 或 docs/{feature}/） */
export function getActiveDocsBase() {
  const processPath = normalizePath(getActiveProcessPath());
  const base = processPath.replace(/\/process\/process\.md$/, '');
  return path.join(PROJECT_ROOT, base);
}

export function getActiveGatedArtifactsPath() {
  if (process.env.HARNESS_GATED_ARTIFACTS_PATH) {
    return resolveWorkspacePath(process.env.HARNESS_GATED_ARTIFACTS_PATH, DEFAULT_GATED_ARTIFACTS);
  }

  const processPath = normalizePath(getActiveProcessPath());
  const featureMatch = processPath.match(/^docs\/(.+)\/process\/process\.md$/);
  if (featureMatch) {
    return path.join(PROJECT_ROOT, 'docs', featureMatch[1], 'design/gated-artifacts.json');
  }

  return DEFAULT_GATED_ARTIFACTS;
}

/** 简易解析 process.md YAML frontmatter（仅支持扁平 key: value） */
export function parseProcessFrontmatter(content) {
  if (!content) return {};
  // R30：内容可能来自非 readTextFileSafe 的调用方（测试夹具 / 上游拼接），
  // 这里再剥一次 BOM，确保 `^---` 不会被前导 U+FEFF 顶开导致 frontmatter 整体失配。
  const normalized = content.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const result = {};
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const kv = trimmed.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    let value = raw.trim();
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (value === 'null' || value === '') value = null;
    else if (value === '[]') value = [];
    else if (value === '{}') value = {};
    else if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
    result[key] = value;
  }
  return result;
}

export function loadHarnessConfig() {
  if (_configCache) return _configCache;
  const parsed = readJsonFileSafe(HARNESS_CONFIG);
  if (parsed && typeof parsed === 'object') {
    _configCache = { ...DEFAULT_CONFIG, ...parsed };
    _configCache.gatedPaths = { ...DEFAULT_CONFIG.gatedPaths, ...parsed.gatedPaths };
    _configCache.qe = { ...DEFAULT_CONFIG.qe, ...parsed.qe };
    _configCache.identity = { ...DEFAULT_CONFIG.identity, ...parsed.identity };
    _configCache.rollback = { ...DEFAULT_CONFIG.rollback, ...parsed.rollback };
    return _configCache;
  }
  _configCache = DEFAULT_CONFIG;
  return _configCache;
}

export function loadGatedArtifacts() {
  const gatedArtifactsPath = getActiveGatedArtifactsPath();
  if (_gatedArtifactsCache && _gatedArtifactsCachePath === gatedArtifactsPath) {
    return _gatedArtifactsCache;
  }
  const parsed = readJsonFileSafe(gatedArtifactsPath);
  if (parsed && typeof parsed === 'object') {
    _gatedArtifactsCache = parsed;
    _gatedArtifactsCachePath = gatedArtifactsPath;
    return _gatedArtifactsCache;
  }
  _gatedArtifactsCache = {};
  _gatedArtifactsCachePath = gatedArtifactsPath;
  return _gatedArtifactsCache;
}

export function getMergedGatedPaths() {
  const config = loadHarnessConfig();
  const extra = loadGatedArtifacts();
  return {
    sourceDirs: [
      ...config.gatedPaths.sourceDirs,
      ...(extra.extraSourceDirs ?? []),
    ],
    buildManifests: [
      ...config.gatedPaths.buildManifests,
      ...(extra.extraBuildManifests ?? []),
    ],
    testConfigs: [
      ...config.gatedPaths.testConfigs,
      ...(extra.extraTestConfigs ?? []),
    ],
    rootPatterns: [
      ...(config.gatedPaths.rootPatterns ?? []),
      ...(extra.extraRootPatterns ?? []),
    ],
    docsAllowedExtensions: config.gatedPaths.docsAllowedExtensions ?? ['.md', '.mdx', '.txt'],
    extensionGateExemptDirs: [
      ...(config.gatedPaths.extensionGateExemptDirs ?? DEFAULT_EXTENSION_GATE_EXEMPT_DIRS),
      ...(extra.extraExtensionGateExemptDirs ?? []),
    ],
  };
}

/** **R5 加强**：顶层会话 id 基准的 TTL（毫秒） */
export function getIdentityBaselineTtlMs() {
  const hours = loadHarnessConfig().identity?.baselineTtlHours;
  const n = Number(hours);
  return Number.isFinite(n) && n > 0 ? n * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
}

export function getMergeddotTraeExemptPatterns() {
  const config = loadHarnessConfig();
  return config.gatedPaths.dotTraeExemptPatterns ?? DEFAULT_DOTCURSOR_EXEMPT_PATTERNS;
}

export function getMergedShellPatterns() {
  const config = loadHarnessConfig();
  const extra = loadGatedArtifacts();
  const patterns = [
    ...(config.gatedShellPatterns ?? []),
    ...(extra.extraShellPatterns ?? []),
  ];
  return patterns.map((p) => new RegExp(p, 'i'));
}

export function getToolchainInstallPatterns() {
  const config = loadHarnessConfig();
  return (config.toolchain?.installPatterns ?? DEFAULT_CONFIG.toolchain.installPatterns)
    .map((p) => new RegExp(p, 'i'));
}

/** 提取指定 `## 标题` 章节正文 */
export function extractSection(content, title) {
  const re = new RegExp(`##\\s*${title}\\s*([\\s\\S]*?)(?=\\n##\\s|$)`);
  const m = content.match(re);
  return m ? m[1] : null;
}

/**
 * 章节内的 markdown 表格是否含**真实数据行**（排除表头、分隔行与全空占位行）。
 * 用于区分「模板空表」与「项目经理已填入的实际分派」。
 */
export function sectionHasDataRow(content, title) {
  const body = extractSection(content, title);
  if (!body) return false;
  const tableRows = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue; // 分隔行 | --- | --- |
    tableRows.push(t);
  }
  // 第一条为表头，其余为数据行
  for (let i = 1; i < tableRows.length; i++) {
    const cells = tableRows[i].split('|').slice(1, -1).map((c) => c.trim());
    if (cells.some((c) => c.length > 0)) return true;
  }
  return false;
}

/** 通用 markdown 表格解析：返回 [{ headers: string[], rows: string[][] }] */
export function parseMarkdownTables(content) {
  if (!content) return [];
  const lines = content.split('\n');
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const next = lines[i + 1]?.trim() ?? '';
    if (line.startsWith('|') && /^\|[\s|:-]+\|?$/.test(next)) {
      const headers = line.split('|').slice(1, -1).map((s) => s.trim());
      let j = i + 2;
      const rows = [];
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        const cells = lines[j].split('|').slice(1, -1).map((s) => s.trim());
        rows.push(cells);
        j += 1;
      }
      tables.push({ headers, rows });
      i = j;
    } else {
      i += 1;
    }
  }
  return tables;
}

/**
 * 是否存在表格化的「未解决问题」行：表头含「是否存在」与「是否解决」两列，
 * 且某行「是否存在」=是 且「是否解决」≠是。用于 design-problem-list.md / quality-report.md。
 */
export function hasUnresolvedIssues(content) {
  const tables = parseMarkdownTables(content);
  for (const table of tables) {
    const existIdx = table.headers.findIndex((h) => /是否存在/.test(h));
    const resolvedIdx = table.headers.findIndex((h) => /是否解决/.test(h));
    if (existIdx === -1 || resolvedIdx === -1) continue;
    for (const row of table.rows) {
      const exists = (row[existIdx] ?? '').trim();
      const resolved = (row[resolvedIdx] ?? '').trim();
      if (/^是$/.test(exists) && !/^是$/.test(resolved)) return true;
    }
  }
  return false;
}

/**
 * **R31**：`## 回退计数` 机读。
 * `rollback.md` 原本声称开发回退由「stop Hook 与 `## 回退计数` 双重约束」，但历史实现中
 * `gate-stop-workflow` 从不读取该章节，回退上限纯靠项目经理自觉——属文档强于实现，
 * 按 R12 须补齐实现而非削弱文档。本函数解析模板中的
 * `| 对象类型 | 对象编号 | 回退次数 |` 表，供 stop 门禁在超限时注入 followup。
 */
export const DEFAULT_ROLLBACK_LIMIT = 3;

export function getRollbackLimit() {
  const n = Number(loadHarnessConfig().rollback?.limit);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ROLLBACK_LIMIT;
}

export function parseRollbackCounts(content) {
  const body = extractSection(content ?? '', '回退计数');
  if (!body) return [];
  const out = [];
  for (const table of parseMarkdownTables(body)) {
    const countIdx = table.headers.findIndex((h) => /回退次数|次数/.test(h));
    if (countIdx === -1) continue;
    const typeIdx = table.headers.findIndex((h) => /对象类型/.test(h));
    const idIdx = table.headers.findIndex((h) => /对象编号/.test(h));
    for (const row of table.rows) {
      const matched = String(row[countIdx] ?? '').match(/\d+/);
      if (!matched) continue;
      const count = Number(matched[0]);
      if (!Number.isFinite(count)) continue;
      const label =
        [row[typeIdx] ?? '', row[idIdx] ?? '']
          .map((s) => String(s).trim())
          .filter(Boolean)
          .join(' ') || '(未标注对象)';
      out.push({ label, count });
    }
  }
  return out;
}

/** 回退次数是否已超上限（> limit）；超限须由 PM 标 blocking 并请用户决策 */
export function checkRollbackLimit(content, limit = getRollbackLimit()) {
  const exceeded = parseRollbackCounts(content).filter((r) => r.count > limit);
  if (exceeded.length === 0) return { ok: true, reason: 'within-limit', exceeded: [], limit };
  return {
    ok: false,
    reason: 'rollback-limit-exceeded',
    exceeded,
    limit,
    message: `R31：${exceeded
      .map((r) => `${r.label} 已回退 ${r.count} 次`)
      .join('；')}，均超过上限 ${limit} 次。`,
  };
}

/** 是否存在有效分派计划（开发阶段写代码的前置条件） */
export function hasValidDispatchPlan(content) {
  if (!content) return false;
  if (getWorkflowMode(content) === 'docs-only') return false;
  // 仅有空模板标题不算有效；须项目经理填入真实分派行
  if (!sectionHasDataRow(content, '当前分派计划')) return false;
  if (sectionHasDataRow(content, '待派发角色列表')) return true;
  // 开发工程师已开始执行后，PM 可能已消费待派发列表；继续依据当前分派计划放行。
  if (roleProgressStats(content, '开发工程师').inProgress > 0) return true;
  return false;
}

/** process.md 是否处于阻塞状态 */
export function isProcessBlocked(content) {
  if (!content) return false;
  const fm = parseProcessFrontmatter(content);
  if (fm.blocking === true) return true;
  if (/\|\s*阻塞\s*\|/.test(content)) return true;
  const blockSection = content.match(/## 阻塞原因\s*([\s\S]*?)(?=\n## |\n$|$)/);
  if (blockSection && blockSection[1].trim().length > 0) {
    const body = blockSection[1].trim();
    if (body !== '—' && body !== '-' && !/^无$/m.test(body)) return true;
  }
  return false;
}

/** 轻量模式（须 R20 用户确认后才生效） */
export const LITE_WORKFLOW_MODES = Object.freeze(['hotfix', 'docs-only', 'single-task']);

/** frontmatter 声明的原始 `workflow_mode`（未做 R20 确认校验） */
export function getDeclaredWorkflowMode(content) {
  const fm = parseProcessFrontmatter(content ?? '');
  return fm.workflow_mode ?? 'full';
}

/**
 * R20：轻量模式是否已在「## 用户确认记录」留机读确认行。
 * 行须含「工作流模式确认」（或 `workflow_mode 确认`），且含与声明模式匹配的意图词。
 * 仅校验结构关键词，不校验 AskUserQuestion 语义真实性。
 */
export function hasLiteModeConfirmation(content, mode) {
  const m = mode ?? getDeclaredWorkflowMode(content);
  if (!LITE_WORKFLOW_MODES.includes(m)) return true;
  const body = extractSection(content ?? '', '用户确认记录');
  if (!body) return false;
  const modePatterns = {
    hotfix: /hotfix|热修复|热修|修\s*bug/i,
    'docs-only': /docs-only|只改文档|仅改文档|仅文档/i,
    'single-task': /single-task|单任务|小改动/i,
  };
  const modeRe = modePatterns[m];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (
      /确认项|时间|用户原话/.test(t) &&
      /\|.*\|.*\|/.test(t) &&
      !/工作流模式确认|workflow_mode\s*确认/i.test(t)
    ) {
      continue;
    }
    if (/工作流模式确认|workflow_mode\s*确认/i.test(t) && modeRe.test(t)) return true;
  }
  return false;
}

/**
 * R20：声明为轻量模式时须有用户确认留痕；`full` / 未声明 → 通过。
 */
export function checkLiteModeConfirmed(content) {
  const md = content ?? readProcessMd() ?? '';
  const declared = getDeclaredWorkflowMode(md);
  if (!LITE_WORKFLOW_MODES.includes(declared)) {
    return { ok: true, reason: 'not-lite' };
  }
  if (hasLiteModeConfirmation(md, declared)) {
    return { ok: true, reason: 'confirmed' };
  }
  return {
    ok: false,
    reason: 'lite-mode-unconfirmed',
    message: `R20：workflow_mode=${declared} 须经用户确认（PM 须在返回结果中标注「需要用户确认：[工作流模式]」由顶层 Agent 用 \`AskUserQuestion\` 代为确认；Trae 适配：PM 为 Subagent，不含 \`AskUserQuestion\` 工具），并在 ## 用户确认记录 留「工作流模式确认」行（含 ${declared} 或对应人话意图），方可享受轻量路径；未确认前按 full 处理，或改回 workflow_mode: full。`,
  };
}

/**
 * 生效中的工作流模式（R20）：轻量模式仅在用户确认留痕后生效；未确认的 lite 声明 fail-safe 为 `full`。
 */
export function getWorkflowMode(content) {
  const declared = getDeclaredWorkflowMode(content);
  if (LITE_WORKFLOW_MODES.includes(declared) && !hasLiteModeConfirmation(content, declared)) {
    return 'full';
  }
  return declared;
}

/** 将路径规范化为正斜杠小写，便于匹配 */
export function normalizePath(filePath) {
  if (!filePath) return '';
  let p = filePath.replace(/\\/g, '/').toLowerCase();
  const root = PROJECT_ROOT.replace(/\\/g, '/').toLowerCase();
  if (p.startsWith(root)) p = p.slice(root.length);
  if (p.startsWith('/')) p = p.slice(1);
  return p;
}
