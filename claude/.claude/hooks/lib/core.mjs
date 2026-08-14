/**
 * 门禁域：core — 路径常量、IO、process.md、配置、Markdown 解析、R20 工作流模式、
 * normalizePath、阻塞/分派计划基础判定、stdin/allow/deny/ask 输出。
 *
 * 被几乎所有门禁 Hook 间接依赖；修改 IO/编码（R30）或 frontmatter 解析时务必跑
 * `gate-selftest` + `gate-scenarios`。域对照见 ./README.md。
 *
 * **Claude Code 适配说明** (2026-08-06):
 * - 路径常量从 `.claude` 改为 `.claude`
 * - dotCursorExemptPatterns → dotClaudeExemptPatterns
 * - getMergedDotCursorExemptPatterns → getMergedDotClaudeExemptPatterns
 * - 其他逻辑保持不变，与 Cursor 版本完全兼容
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { roleProgressStats } from './role-path.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** hooks/ directory (state marker files live here, not under lib/) */
export const HOOKS_DIR = path.resolve(__dirname, '..');
export const PROJECT_ROOT = path.resolve(HOOKS_DIR, '../..');
export const DEFAULT_PROCESS_MD = path.join(PROJECT_ROOT, 'docs/process/process.md');
export const HARNESS_CONFIG = path.join(PROJECT_ROOT, '.claude/harness.config.json');
export const HARNESS_STATE = path.join(PROJECT_ROOT, '.claude/harness-state.json');
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
/**
 * **R35**：门禁异常事件旁路台账（只由 Hook 进程写入；R29 `runtime-marker`）。
 * 见 `recordGateExceptionLedgerEntry` / `findCorroboratedGateExceptionEvent`。
 */
export const GATE_EXCEPTION_LEDGER = path.join(
  HOOKS_DIR,
  '.gate-exception-ledger.json',
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

// R6：.claude/scripts|agents|hooks 三目录纳入机制门禁；其余 .claude/** 默认放行，
// 但可被 dotClaudeExemptPatterns 精确豁免其中的非治理产物（如 .toolchain-install-approved.json）。
// 注意：`.claude/rules/**` 曾在此豁免（理由「仅为提醒」）。规则层经 Claude Code 官方
// `.claude/rules/` 机制真正注入上下文后该理由不成立，已改由 `classifyHarnessSelfGovernedPath`
// 归 `gate-config`（R29，2026-08-14）；此处不再列出，避免留下「rules 属可自由改写」的信号。
const DEFAULT_DOTCLAUDE_EXEMPT_PATTERNS = [
  '.claude/templates/**',
  '.claude/harness-state.json',
  '.claude/hooks/hooks.json',
  '.claude/harness.config.json',
  '.claude/hooks/.toolchain-install-approved.json',
  '.claude/hooks/.root-conversation-id.json',
  '.claude/hooks/.dispatched-roles.json',
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
    dotClaudeExemptPatterns: DEFAULT_DOTCLAUDE_EXEMPT_PATTERNS,
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
  // **R32**：生产启动冒烟。`command` 留空表示按 gated-artifacts / package.json 探测；
  // `maxAgeHours` 控制冒烟结果的新鲜度上限，防止一次通过后长期复用。
  te: {
    startupSmoke: {
      maxAgeHours: 24,
    },
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
  // **R34**：证据产物执行证明。`enforce: false` 为用户级逃生开关（见 execproof.mjs）。
  execProof: {
    enforce: true,
    keyTtlMinutes: 15,
    historyPerKind: 8,
  },
  // **R36**：判定期异常的处置策略。`deny` = fail-closed（默认）；`allow` = 回退到历史
  // fail-open 行为。这是**放松型**旋钮，故只认 harness.config.json（R29 锁定，仅用户可改）。
  gateException: {
    onJudgmentError: 'deny',
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
 * PreToolUse 裁决输出（官方契约，见 https://code.claude.com/docs/en/hooks）：
 *   { hookSpecificOutput: { hookEventName: 'PreToolUse',
 *                           permissionDecision: 'allow'|'deny'|'ask'|'defer',
 *                           permissionDecisionReason, additionalContext } } + exit 0
 *
 * 为什么裁决翻译放在 lib 而非各 Hook 入口：`assertDevGateOrDeny` 等判据在 paths.mjs 内部
 * 直接调用 deny() 并 process.exit(0)（8 处），Hook 入口的 emit 包装**拦不到**这些出口。
 * 只有在这三个发射器上翻译，才能让「重写版无覆盖」的自发射路径一并纳入官方契约。
 *
 * 字段映射：userMessage → permissionDecisionReason（给用户看的结论）
 *          agentMessage → additionalContext（给模型看的整改指引）
 *
 * 注意：这三个发射器**只服务 PreToolUse 通道**。Stop 通道用顶层 decision:'block' + reason，
 * 且按 R36 断言「stop 通道不得输出 permission 字段」，故不得复用本组函数。
 */
function emitPreToolUse(permissionDecision, userMessage, agentMessage) {
  const hookSpecificOutput = {
    hookEventName: 'PreToolUse',
    permissionDecision,
  };
  if (userMessage !== undefined) hookSpecificOutput.permissionDecisionReason = userMessage;
  if (agentMessage !== undefined) hookSpecificOutput.additionalContext = agentMessage;
  output({ hookSpecificOutput });
  process.exit(0);
}

export function allow() {
  emitPreToolUse('allow');
}

export function deny(userMessage, agentMessage) {
  emitPreToolUse('deny', userMessage, agentMessage);
}

export function ask(userMessage, agentMessage) {
  emitPreToolUse('ask', userMessage, agentMessage);
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
    _configCache.te = { ...DEFAULT_CONFIG.te, ...parsed.te };
    _configCache.te.startupSmoke = {
      ...DEFAULT_CONFIG.te.startupSmoke,
      ...parsed.te?.startupSmoke,
    };
    _configCache.identity = { ...DEFAULT_CONFIG.identity, ...parsed.identity };
    _configCache.rollback = { ...DEFAULT_CONFIG.rollback, ...parsed.rollback };
    _configCache.execProof = { ...DEFAULT_CONFIG.execProof, ...parsed.execProof };
    _configCache.gateException = { ...DEFAULT_CONFIG.gateException, ...parsed.gateException };
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
    // **R29 加强**：`extensionGateExemptDirs` 只取 harness.config.json（R29 锁定、须用户
    // 本人编辑），**不再**合并 gated-artifacts.json 的 `extraExtensionGateExemptDirs`。
    // 该字段是纯粹的「放松型」旋钮：写入 `["src"]` 即可让 R6 代码扩展名门禁对整个 src/
    // 失效，而 gated-artifacts.json 由 SA（被约束方）书写。上方 extra* 各项都是
    // 「收紧型」（只增加受门禁范围），故保留合并；放松型一律回收到用户手中（R12）。
    extensionGateExemptDirs: [
      ...(config.gatedPaths.extensionGateExemptDirs ?? DEFAULT_EXTENSION_GATE_EXEMPT_DIRS),
    ],
  };
}

/** **R5 加强**：顶层会话 id 基准的 TTL（毫秒） */
export function getIdentityBaselineTtlMs() {
  const hours = loadHarnessConfig().identity?.baselineTtlHours;
  const n = Number(hours);
  return Number.isFinite(n) && n > 0 ? n * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
}

/**
 * **R36**：判定期异常是否 fail-closed。
 *
 * §8.4 长期披露一个已知缺陷：入口脚本自行 `try/catch` 并以退出码 0 输出合法
 * `{"permission":"allow"}`，属「Hook 成功」，故 `hooks.json` 里的 `failClosed: true`
 * **永远不会被平台触发**——判定期异常的最终语义完全由脚本自己的 fail-open 决定。
 * 后果是：**任何能让判定逻辑抛异常的 `process.md` 都能打开门禁**，而 `process.md`
 * 恰由被约束方书写。§8.4 自己写出了修法（区分 lib 加载失败与判定期异常）但未实施。
 *
 * 本函数即该修法的开关：默认 `deny`（判定期异常 fail-closed），
 * `harness.config.json → gateException.onJudgmentError: "allow"` 可回退到历史行为。
 * 该文件受 R29 锁定，代理改不了，只有用户能在门禁自身出 bug 时解锁。
 *
 * @returns {{ failClosed: boolean, mode: 'deny'|'allow' }}
 */
export function getGateExceptionPolicy() {
  const mode = loadHarnessConfig().gateException?.onJudgmentError;
  const normalized = mode === 'allow' ? 'allow' : 'deny';
  return { failClosed: normalized === 'deny', mode: normalized };
}

/**
 * **R36**：按通道生成判定期异常的裁决（各 Hook 入口共用，避免四份近似文案漂移）。
 *
 * 裁决按通道选取「最小可用的收紧语义」——目标是不静默放行，同时不把项目锁死：
 *   - `write`：`deny`；但对活跃 `process.md` 保留**修复通道**放行。判定期异常最常见的
 *     成因就是 process.md 结构损坏，而修它必须能写它；一并拒绝会造成代理无法自愈、
 *     只能人工编辑的死局。该例外是刻意保留的残留缺口，记在 §8.7 边界表里。
 *   - `shell`：`deny`（修 process.md 应走 Write 通道，那边已有例外，此处再开只增绕过面）。
 *   - `task`：`deny`（PM 仍可继续维护 process.md，代价最小）。
 *   - `toolchain`：`ask`。该 Hook 的正常拦截语义本就是 ask；用 deny 会把一台缺工具链的
 *     机器彻底锁死，而 ask 已经能达到「不静默放行」的目的。
 *   - `stop`：`followup`（stop 通道没有 deny 语义，「收紧」即等于不放行收尾）。
 *
 * @param {{ hook: string, context: string, err: unknown, channel: 'write'|'shell'|'task'|'toolchain'|'stop', repairPaths?: string[] }} params
 * @returns {{ verdict: 'allow'|'deny'|'ask'|'followup', output: object }}
 */
export function buildGateExceptionVerdict({ hook, context, err, channel, repairPaths = [] }) {
  const brief = String(err?.message ?? err).slice(0, 200);
  const common =
    'CLAUDE.md R36 / mechanical-gates.md §8.4：判定期异常不再静默放行（历史实现在此 fail-open，' +
    '等于「能让判定逻辑抛异常就能打开门禁」，而判定输入 process.md 恰由被约束方书写）。' +
    '请先修复导致异常的输入——最常见是活跃 process.md 结构损坏（frontmatter / 章节标题 / 表格被破坏），' +
    '并核查其「## 门禁异常事件」新增行。若确认是门禁自身缺陷，须把结论呈现给用户，' +
    '由**用户本人**在 `.claude/harness.config.json` 设 `gateException.onJudgmentError: "allow"` ' +
    '临时恢复 fail-open（该文件受 R29 锁定，代理不得修改）。';

  if (channel === 'write' && repairPaths.length > 0) {
    return { verdict: 'allow', output: { permission: 'allow' }, repairPaths };
  }
  if (channel === 'stop') {
    return {
      verdict: 'followup',
      output: {
        followup_message:
          `【流程门禁】（R36 判定期异常）stop 门禁在计算流程状态时抛出异常（${context}：${brief}），` +
          '无法判定流程是否闭环，故**不放行**本次收尾。' +
          '请调用 project-manager 核查 stderr 与 process.md「## 门禁异常事件」新增行并修正；' +
          '若确认是门禁自身缺陷，用 AskUserQuestion 请用户决策并按 R35 在「## 阻塞原因」与「## 用户确认记录」留痕。' +
          '确需恢复旧的 fail-open 行为时，须由**用户本人**在 `.claude/harness.config.json` 设 `gateException.onJudgmentError: "allow"`。',
      },
    };
  }
  if (channel === 'toolchain') {
    return {
      verdict: 'ask',
      output: {
        permission: 'ask',
        user_message: `工具链安装门禁（R36 判定期异常）：门禁在判定本次命令时抛出异常（${context}：${brief}），无法确定是否为需要授权的系统级安装命令，故转为请你确认。`,
        agent_message: `${common} 若这确实是系统级工具链安装命令，请先按流程询问用户安装路径再重试。`,
      },
    };
  }
  const subject =
    channel === 'shell'
      ? '本次 Shell 命令'
      : channel === 'task'
        ? '本次角色派发的前置条件'
        : '本次写入';
  const extra =
    channel === 'write'
      ? ' 对活跃 process.md 本身的写入仍被放行，可由 project-manager 直接修复。'
      : channel === 'task'
        ? ' project-manager 对 process.md 的写入不受本次拒绝影响。'
        : ' 修 process.md 请改用 Write 类工具（该通道保留了修复例外）。';
  return {
    verdict: 'deny',
    output: {
      permission: 'deny',
      user_message: `流程门禁（R36 判定期异常）：门禁在判定${subject}时抛出异常（${context}：${brief}），无法确定是否合规，故按 fail-closed 拒绝。（Hook：${hook}）`,
      agent_message: `${common}${extra}`,
    },
  };
}

/** **R32**：生产启动冒烟结果的新鲜度上限（小时） */
export function getStartupSmokeMaxAgeHours() {
  const n = Number(loadHarnessConfig().te?.startupSmoke?.maxAgeHours);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

export function getMergedDotClaudeExemptPatterns() {
  const config = loadHarnessConfig();
  return config.gatedPaths.dotClaudeExemptPatterns ?? DEFAULT_DOTCLAUDE_EXEMPT_PATTERNS;
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

/**
 * 章节标题允许的编号前缀（如 `## 6. 隐性需求确认记录`、`## 3.4、界面与交互期望`）。
 *
 * 历史实现要求 `##` 后紧跟标题文字，导致出厂模板 `requirement-spec.md` 的
 * `## 6. 隐性需求确认记录` 永远解析不到——需求分析师照模板填写也过不了 R19，
 * 且 Hook 报出的是「缺少真实数据行」这一指向错误的理由。自测夹具用的是自拼的
 * 无编号标题，故 394 条回归全绿也抓不到。
 *
 * 放宽的只是「如何定位章节」，章节内容判据（表头、枚举、追溯、数据行非空等）
 * 完全不变，故不构成 R12 意义上的放松。
 */
const SECTION_NUMBER_PREFIX = String.raw`(?:\d+(?:\.\d+)*\s*[.、)]?\s*)?`;

/**
 * 轮次前缀（如 `## 第二轮需求覆盖矩阵`、`## 第 3 次审核结论`）。
 *
 * **F-11**：`design-problem-list.md` 的 `## 审核结论` 带「审核轮次」列，规约本就预期同一文件
 * 承载多轮审核，但历史 `extractSection` 只取**第一个**同名章节：增量轮次若按「另起新章节」
 * 组织（自然写法），R18 判据看不见新轮次的矩阵 → 一律拒派 DE；反向更严重——`## 审核问题表`
 * 的 12 维校验同样只读第一节，等于**第二轮起「审核证据充分性」自动降级为「第一轮曾经充分」**。
 * 故这里把「第 N 轮」类前缀纳入定位，并由 extractSectionAll 聚合全部同类章节。
 */
const SECTION_ROUND_PREFIX = String.raw`(?:第[^\n#|]{0,8}?[轮次]\s*)?`;

/**
 * 提取**全部**匹配 `## 标题` 章节的正文（容忍编号前缀与「第 N 轮」前缀、忽略标题行余下文字）。
 *
 * 章节之间以空行拼接：`parseMarkdownTables` 按空行断表，若直接相连，后一节的表头行会被
 * 当成前一节表格的数据行，列语义整体错位。
 */
export function extractSectionAll(content, title) {
  if (!content || typeof content !== 'string') return [];
  const re = new RegExp(
    `(?:^|\\n)##\\s*${SECTION_NUMBER_PREFIX}${SECTION_ROUND_PREFIX}${title}[^\\n]*(?:\\n|$)([\\s\\S]*?)(?=\\n##\\s|$)`,
    'g',
  );
  const bodies = [];
  for (const m of content.matchAll(re)) bodies.push(m[1] ?? '');
  return bodies;
}

/**
 * 提取指定 `## 标题` 章节正文（容忍编号前缀；标题须位于行首，不匹配正文中的 `##`）。
 *
 * **F-11 起改为聚合全部同名/同类（含「第 N 轮」前缀）章节**——判据只可加强不可放松（R12）：
 * 聚合后旧轮次的行仍在，新轮次的行也进入判据视野，「多写一节就绕过校验」这条路被封掉。
 * 章节完全不存在时仍返回 `null`（缺章节判据不变）。
 */
export function extractSection(content, title) {
  const bodies = extractSectionAll(content, title);
  if (bodies.length === 0) return null;
  return bodies.join('\n\n');
}

/**
 * **R30 / F-10**：markdown 表格行 → 单元格数组（唯一权威切分器）。
 *
 * 历史实现一律 `line.split('|').slice(1, -1)`：GFM 里单元格内的竖线**必须**写成 `\|`
 * （例如需求描述 `status=all\|active\|done` 是唯一正确写法），裸切会把它当列分隔符，
 * 该行列数变多、**后续列整体右移**。实测后果：`parseRequirementP0Ids` 从 `cells[4]` 取
 * 优先级时取到 `"done"`，`/^P0$/i` 失配 → 一条如实标注 P0 的需求**静默**退出 E2E 必测集合
 * （`gatePassed: true`、签名有效、零提示）；R18 覆盖矩阵、R14 接口映射、`## 增量范围`
 * 增量范围五维声明同理受影响。
 *
 * 故所有表格判据统一走本函数：先按「未被反斜杠转义的 `|`」切分，再把 `\|` 还原为 `|`
 * （单元格文本回到人写的原意），并去掉首尾空壳列。
 *
 * **运行器侧另有一份同语义实现**（`.claude/scripts/e2e-run-lib.mjs#splitTableRow`，刻意与
 * `hooks/lib/**` 解耦）。两处口径必须一致；该义务已由 `selftest/r30-table-escape.mjs` 的
 * 「F-10 一致性」用例机械化（同一批交叉生成语料逐字比对），改本函数务必同步另一份。
 */
export function splitTableRow(line) {
  const raw = String(line ?? '').trim();
  if (!raw) return [];
  const cells = [];
  let cur = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '\\' && raw[i + 1] === '|') {
      cur += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  // 规范表格行以 `|` 起止，故首尾各有一个空壳元素；容忍缺尾竖线的写法。
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

/** 分隔行判定（`| --- | :--: |`）；与 splitTableRow 同源，供各判据统一使用 */
export function isTableSeparatorLine(line) {
  return /^\|[\s|:-]+\|?$/.test(String(line ?? '').trim());
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
    if (isTableSeparatorLine(t)) continue; // 分隔行 | --- | --- |
    tableRows.push(t);
  }
  // 第一条为表头，其余为数据行
  for (let i = 1; i < tableRows.length; i++) {
    const cells = splitTableRow(tableRows[i]);
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
    if (line.startsWith('|') && isTableSeparatorLine(next)) {
      const headers = splitTableRow(line);
      let j = i + 2;
      const rows = [];
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        const cells = splitTableRow(lines[j]);
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

/**
 * `## 阻塞原因` 正文里属于**模板/占位**、不构成实质阻塞理由的写法。
 * 出厂模板正文是裸「无」加两行引用块说明；此外常见占位是「—」「-」「待补」「TBD」等。
 */
const BLOCKING_PLACEHOLDER_RE = /^(无|—|-|n\/a|na|待补|待填|待定|tbd|todo|\(.*\)|（.*）)$/i;

/**
 * `## 阻塞原因` 是否含**实质**内容（非模板、非占位）。
 * 引用块（`>` 开头，出厂模板的使用说明）与空行一律不计入。
 */
export function hasSubstantiveBlockingReason(content) {
  const body = extractSection(content ?? '', '阻塞原因');
  if (!body) return false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('>')) continue;
    // 去掉列表符号与「阻塞原因：」前缀后判断剩余文本是否为占位
    const text = line
      .replace(/^[-*+]\s*/, '')
      .replace(/^阻塞原因\s*[:：]\s*/, '')
      .trim();
    if (!text || BLOCKING_PLACEHOLDER_RE.test(text)) continue;
    // 去标点空白后须有实质字数，防「……」「??」之类过关
    if (text.replace(/[\s\p{P}\p{S}]/gu, '').length >= 4) return true;
  }
  return false;
}

/**
 * 解析「## 门禁异常事件」里尚未处理的行（§8.4 `recordFailOpenEvent` 写入的格式）。
 * @returns {{ ts: string, hook: string, context: string, summary: string }[]}
 */
/**
 * 收集章节内**未被 `parseMarkdownTables` 归入任何表**的 `|` 数据行（F-25 鲁棒化）。
 *
 * 场景：写入侧把数据行插到了表头/分隔行之后的空行**之后**，于是它既不接分隔行、
 * 也不与表头连续，`parseMarkdownTables` 按空行断表后整段丢弃（且它自己不带分隔行，
 * 不会被识别成新表）。此函数只捞这类孤立行，不改变任何字段级判据。
 * @param {string} body 章节正文
 * @param {{headers:string[],rows:string[][]}[]} tables 已解析出的表
 * @returns {string[][]}
 */
function collectOrphanTableRows(body, tables) {
  const claimed = new Set();
  for (const table of tables) {
    claimed.add(table.headers.join(''));
    for (const row of table.rows) claimed.add(row.join(''));
  }
  const orphans = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    if (isTableSeparatorLine(line)) continue; // 分隔行
    const cells = splitTableRow(line);
    if (cells.length === 0) continue;
    if (claimed.has(cells.join(''))) continue;
    orphans.push(cells);
  }
  return orphans;
}

/**
 * 解析「## 门禁异常事件」的**全部**数据行（含已处理），供两个方向的判据复用：
 * 正向（表格行 → 台账，R35 释放）取其中「待处理」子集；
 * 反向（台账 → 表格行，F-22 审计对账）须看全部行，否则把一条事件标成「已处理」
 * 就等于让它从对账视野里消失。
 * @returns {{ ts: string, hook: string, context: string, summary: string, status: string }[]}
 */
function collectGateExceptionRows(content) {
  const body = extractSection(content ?? '', '门禁异常事件');
  if (!body) return [];
  const rows = [];
  // R35 双向鲁棒化（F-25）：本节的数据行**可能与表头被空行隔开**（历史 fail-open 写入即如此），
  // 而 parseMarkdownTables 按空行断表，会把这些行整段丢弃。这里把「本节内所有 `|` 行」
  // 都当作候选数据行，表头一律取本节首个真实表头 —— 否则门禁自己写的事件在解析侧凭空消失，
  // R35 的「机器起源」释放分支恒不可达。判据本身（处理状态/指纹）不放宽。
  const tables = parseMarkdownTables(body);
  const headers = tables.find((t) => t.headers.some((h) => /时间|hook/i.test(h)))?.headers ?? null;
  const orphanRows = headers ? collectOrphanTableRows(body, tables) : [];
  const scanTargets = orphanRows.length > 0 ? [...tables, { headers, rows: orphanRows }] : tables;
  for (const table of scanTargets) {
    const idxOf = (re) => table.headers.findIndex((h) => re.test(h));
    const tsIdx = idxOf(/时间/);
    const hookIdx = idxOf(/hook/i);
    const contextIdx = idxOf(/上下文/);
    const summaryIdx = idxOf(/异常摘要/);
    const statusIdx = idxOf(/处理状态/);
    for (const row of table.rows) {
      if (!row.some((c) => (c ?? '').trim())) continue;
      if (hookIdx >= 0 && !(row[hookIdx] ?? '').trim()) continue;
      rows.push({
        ts: tsIdx >= 0 ? (row[tsIdx] ?? '').trim() : '',
        hook: hookIdx >= 0 ? (row[hookIdx] ?? '').trim() : '',
        context: contextIdx >= 0 ? (row[contextIdx] ?? '').trim() : '',
        summary: summaryIdx >= 0 ? (row[summaryIdx] ?? '').trim() : '',
        status: statusIdx >= 0 ? (row[statusIdx] ?? '').trim() : '',
      });
    }
  }
  return rows;
}

function parsePendingGateExceptionRows(content) {
  return collectGateExceptionRows(content).filter(
    (r) => !/已处理|已关闭|已解决/.test(r.status),
  );
}

/** 是否存在**声称**由 Hook 写入、尚未处理的门禁异常事件行（不校验出处，见下方台账判据） */
export function hasPendingGateExceptionEvent(content) {
  return parsePendingGateExceptionRows(content).length > 0;
}

/** 门禁异常事件行 → 台账指纹（时间戳 + Hook + 上下文 + 异常摘要） */
export function gateExceptionEventDigest({ ts, hook, context, summary } = {}) {
  return createHash('sha256')
    .update([ts ?? '', hook ?? '', context ?? '', summary ?? ''].join('\n'), 'utf8')
    .digest('hex')
    .slice(0, 32);
}

/** 读取 R35 旁路台账；缺失/损坏时返回空台账（不抛，见 §8.8 防死锁） */
export function readGateExceptionLedger() {
  const data = readJsonFileSafe(GATE_EXCEPTION_LEDGER);
  if (!data || typeof data !== 'object' || !Array.isArray(data.entries)) {
    return { version: 1, entries: [] };
  }
  return { version: 1, entries: data.entries };
}

const GATE_EXCEPTION_LEDGER_MAX = 50;

/**
 * **R35**：把一条门禁异常事件登记到旁路台账。**只应由 `recordFailOpenEvent` 调用。**
 *
 * 台账文件受 R29 `runtime-marker` 保护（写文件与 Shell 两条通道均 deny），
 * 因此代理无法凭空造出一条与 `process.md` 表格行对得上的台账记录。
 */
export function recordGateExceptionLedgerEntry({ ts, hook, context, summary } = {}) {
  try {
    const ledger = readGateExceptionLedger();
    ledger.entries.push({
      digest: gateExceptionEventDigest({ ts, hook, context, summary }),
      ts: ts ?? '',
      hook: hook ?? '',
      context: context ?? '',
      // F-22 反向对账（台账 → 表格行）须能界定「这条事件该出现在哪份 process.md 里」。
      // 台账是全局单文件、跨流程累积，不记归属就只能拿全部历史条目去比对当前流程，
      // 任何一次迭代切换都会凭空造出一堆无解的孤儿条目（把审计面做成死锁）。
      processPath: normalizePath(getActiveProcessPath()),
      recordedAt: new Date().toISOString(),
    });
    ledger.entries = ledger.entries.slice(-GATE_EXCEPTION_LEDGER_MAX);
    fs.mkdirSync(path.dirname(GATE_EXCEPTION_LEDGER), { recursive: true });
    fs.writeFileSync(GATE_EXCEPTION_LEDGER, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
    return { ok: true };
  } catch (err) {
    // 登记失败不阻断 fail-open 落盘；代价是这次阻塞走不了「机器起源」分支，
    // 须由 PM 按人类起源双证据补齐（收紧方向，符合 R12）。
    process.stderr.write(
      `[recordGateExceptionLedgerEntry] failed: ${err?.message ?? err}\n`,
    );
    return { ok: false, reason: 'write-failed' };
  }
}

/**
 * **R35**：找出一条**有台账出处、且尚未用于释放过**的门禁异常事件。
 *
 * 2026-07-30 复核复现的问题：机器起源分支原本只看 `process.md` 里有没有一行「待处理」，
 * 而该章节正由被约束方（PM）书写——代理自己补一行表格即可解除 stop 门禁的全部推进判据，
 * 比它要补强的「实质阻塞原因 + 用户决策留痕」双证据分支还便宜。注释里写的
 * 「不是代理自述，本身即为可信依据」在实现上并不成立。
 *
 * 现要求两侧对上：`process.md` 的行 + Hook 独占写入的旁路台账里同指纹的条目。
 * 并且每条台账条目只能释放**一次**（`releasedAt`），避免把一条真实发生过的历史异常
 * 反复抄回表格里当永久免死金牌。
 *
 * @returns {{ ok: boolean, digest?: string, reason?: string }}
 */
export function findCorroboratedGateExceptionEvent(content) {
  const rows = parsePendingGateExceptionRows(content);
  if (rows.length === 0) return { ok: false, reason: 'no-pending-event' };
  const entries = readGateExceptionLedger().entries;
  for (const row of rows) {
    const digest = gateExceptionEventDigest(row);
    const entry = entries.find((e) => e?.digest === digest);
    if (!entry) continue;
    if (entry.releasedAt) continue;
    return { ok: true, digest };
  }
  return { ok: false, reason: entries.length === 0 ? 'no-ledger-entry' : 'event-not-corroborated' };
}

/**
 * **R35**：把一条台账条目标记为「已用于释放 stop 门禁」（一次性）。
 * 由 `gate-stop-workflow` 在按机器起源放行时调用；写失败只记 stderr。
 */
export function consumeGateExceptionRelease(digest) {
  if (!digest) return { ok: false, reason: 'no-digest' };
  try {
    const ledger = readGateExceptionLedger();
    const entry = ledger.entries.find((e) => e?.digest === digest);
    if (!entry) return { ok: false, reason: 'not-found' };
    if (entry.releasedAt) return { ok: true, reason: 'already-released' };
    entry.releasedAt = new Date().toISOString();
    fs.writeFileSync(GATE_EXCEPTION_LEDGER, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
    return { ok: true };
  } catch (err) {
    process.stderr.write(`[consumeGateExceptionRelease] failed: ${err?.message ?? err}\n`);
    return { ok: false, reason: 'write-failed' };
  }
}

/**
 * **R35 / F-22 反向对账**：台账里属于当前活跃流程、却在 `## 门禁异常事件` 找不到
 * 对应行的条目（孤儿条目）。
 *
 * 背景：stop 侧原本只做「表格行 → 台账」单向校验（防伪造），于是**删行**这一侧完全无人负责：
 * 把 Hook 自己写的异常行从 `process.md` 抹掉，一条真实发生过的 fail-open 事件就彻底消失，
 * 审计面归零。台账受 R29 `runtime-marker` 保护（代理写不了、删不了），故它是这条对账的可信一侧。
 *
 * 只统计**本流程**（`processPath` 匹配）且**未被用于释放过**（`releasedAt` 为空）的条目：
 * - 跨流程/历史迭代的条目不算孤儿——台账是全局累积文件，否则每次切迭代都凭空死锁；
 * - 已释放的条目其事件已被处置完毕，行被后续整理掉属正常，不再追究；
 * - 早于台账加 `processPath` 字段的历史条目（无该字段）一律不算孤儿，避免升级即误报。
 *
 * @returns {{ digest: string, ts: string, hook: string, context: string }[]}
 */
export function findOrphanGateExceptionLedgerEntries(content) {
  const rows = collectGateExceptionRows(content);
  const rowDigests = new Set(rows.map((r) => gateExceptionEventDigest(r)));
  const active = normalizePath(getActiveProcessPath());
  return readGateExceptionLedger()
    .entries.filter((e) => e && typeof e.digest === 'string')
    .filter((e) => typeof e.processPath === 'string' && e.processPath === active)
    .filter((e) => !e.releasedAt)
    .filter((e) => !rowDigests.has(e.digest))
    .map((e) => ({
      digest: e.digest,
      ts: e.ts ?? '',
      hook: e.hook ?? '',
      context: e.context ?? '',
    }));
}

/**
 * **F-22**：stop 侧的台账 → 表格行反向核对判据。孤儿条目须被追究——门禁自己写过的
 * fail-open 事件不得被静默抹掉。处置方向是**把行补回**（台账里有时间/Hook/上下文足以复原
 * 除摘要外的全部字段；摘要须与原文一致才能对上指纹，故正确做法是从 git 历史/备份恢复该行，
 * 而非猜一个摘要），或由用户裁定该事件确已处置完毕。
 */
export function checkGateExceptionLedgerReconciled(content) {
  const orphans = findOrphanGateExceptionLedgerEntries(content);
  if (orphans.length === 0) return { ok: true, reason: 'reconciled' };
  const detail = orphans
    .map((o) => `${o.ts || '(无时间)'} / ${o.hook || '(无 Hook)'} / ${o.context || '(无上下文)'}`)
    .join('；');
  return {
    ok: false,
    reason: 'gate-exception-ledger-orphan',
    orphans,
    message:
      `R35/F-22：门禁旁路台账中有 ${orphans.length} 条属于当前流程、尚未处置的门禁异常事件，` +
      `但 process.md「## 门禁异常事件」里找不到对应行：${detail}。` +
      '台账由 Hook 独占写入（R29 runtime-marker，代理不可写不可删），故这意味着该事件行被从 process.md 删掉或改写过——' +
      '一次真实发生过的 fail-open 被抹掉，审计面归零。请由项目经理据台账把事件行**原样**恢复到「## 门禁异常事件」' +
      '（摘要须与门禁原始写入完全一致才能对上指纹，应从版本历史恢复，不得另编一段摘要），' +
      '并在处置完成后把该行「处理状态」标为「已处理」。若确认该事件已处置完毕、无需保留行，须由用户本人裁定并留痕。',
  };
}

/** 用户决策留痕：`## 用户确认记录` 中与阻塞/待决相关、且体现「问过用户」的行 */
export function hasBlockingDecisionTrace(content) {
  const body = extractSection(content ?? '', '用户确认记录');
  if (!body) return false;
  const topicRe = /阻塞|blocking|待决|待用户|暂停|挂起|决策/i;
  // `askuserquestion` 是 Claude Code 的确认工具名，§8.8 R35 的声明层一直把它列为可接受表态；
  // 实现原先只认 Cursor 时代的 `askquestion`，而**后者不是前者的子串**（AskUser+Question），
  // 于是纯英文留痕行会被判为「没问过用户」。属 R12「文档声明强于实现 ⇒ 补实现」，非放松。
  // 保留 `askquestion`：接入方可能是从 Cursor 版迁移过来的仓库，撤销既有可接受形态才是放松。
  const stanceRe = /askuserquestion|askquestion|用户|确认|决策|选择|答复|回复|裁决/i;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(line)) continue;
    if (/确认项/.test(line) && /时间/.test(line) && /用户原话/.test(line)) continue;
    if (topicRe.test(line) && stanceRe.test(line)) return true;
  }
  return false;
}

/**
 * **R35**：`blocking: true` 释放 stop 门禁前须有配套证据。
 *
 * ## 为什么需要这条
 *
 * `gate-stop-workflow` 的判据链最前面有一个无条件放行分支：`blocking: true` 即当轮放行。
 * §8.7 把 stop 门禁的强度上限归结为 `loop_limit: 3`，但实际上代理不必硬扛三轮——
 * 让项目经理写一行 `blocking: true` 就当轮解除了全部催促。更微妙的是 **R31** 回退上限
 * 注入的 followup **本身就在指示代理去写这一行**。于是「测试/E2E/lint 是否做完」这条
 * 主要靠 stop 门禁施压的约束，释放成本是一行 frontmatter，而不是三个回合。
 *
 * ## 判据（二者之一即放行）
 *
 * 1. **机器起源**：`## 门禁异常事件` 有未处理行，**且**该行在 Hook 独占写入的旁路台账
 *    （`GATE_EXCEPTION_LEDGER`，R29 `runtime-marker`）里有同指纹、未被用过的条目
 *    ⇒ 确实是 Hook 自己写的（`recordFailOpenEvent`），不是代理自述；
 * 2. **人类起源**：`## 阻塞原因` 有实质内容（非模板「无」/占位） **且**
 *    `## 用户确认记录` 有一行阻塞/待决相关的用户决策留痕。
 *
 * 两者都不满足 ⇒ 视为「无依据自述阻塞」，stop 门禁**不放行**，改为注入 followup
 * 要求补齐证据或解除阻塞。
 *
 * ## 为什么机器起源要查台账（2026-07-30 复核修正）
 *
 * 该分支原本只看 `process.md` 里有没有一行「待处理」，而这一章节恰由被约束方（PM）
 * 书写：代理自补一行表格即可解除 stop 门禁的全部推进判据，比它本该补强的双证据分支
 * **更便宜**——等于把「一行 frontmatter 静默收尾」换成了「一行 frontmatter + 一行表格」。
 * 现改为与旁路台账对指纹，且每条台账条目只能释放一次。
 *
 * ## 能力边界
 *
 * 与 §8.7 边界 1 同源：人类起源的两项证据仍由 PM 书写，本判据只证明
 * 「阻塞这件事被写清楚了、并声称问过用户」，不证明真的问过。它消除的是
 * 「一行 `blocking: true` 直接静默收尾」这条零成本路径。
 */
export function checkBlockingReleaseEvidence(content) {
  const machineOrigin = findCorroboratedGateExceptionEvent(content);
  if (machineOrigin.ok) {
    return { ok: true, reason: 'gate-exception-originated', digest: machineOrigin.digest };
  }
  const substantive = hasSubstantiveBlockingReason(content);
  const trace = hasBlockingDecisionTrace(content);
  if (substantive && trace) return { ok: true, reason: 'evidenced' };
  const forged = machineOrigin.reason === 'event-not-corroborated'
    || machineOrigin.reason === 'no-ledger-entry';
  const missing = [
    ...(forged
      ? ['「## 门禁异常事件」的未处理行在门禁旁路台账中查无出处（或已被用于释放过一次），不能作为机器起源依据']
      : []),
    ...(substantive ? [] : ['「## 阻塞原因」缺少实质内容（仍为出厂「无」或占位文本）']),
    ...(trace ? [] : ['「## 用户确认记录」缺少阻塞/待决相关的用户决策留痕行']),
  ];
  return {
    ok: false,
    reason: substantive ? 'blocking-missing-decision-trace' : 'blocking-missing-reason',
    missing,
    message:
      `R35：frontmatter 已置 \`blocking: true\`，但缺少配套证据——${missing.join('；')}。` +
      '阻塞是 stop 门禁的释放阀，不得凭一行 frontmatter 就静默收尾。请由项目经理二者都补齐：' +
      '①在「## 阻塞原因」写明具体阻塞原因 / 待决事项 / 已产出成果物；' +
      '②用 AskUserQuestion 请用户就该阻塞做决策，并在「## 用户确认记录」补一行留痕' +
      '（确认项含「阻塞」或「待决」，摘要含「用户」「确认」「决策」等表明用户已表态的内容）。' +
      '若实际并未阻塞，请把 `blocking` 改回 `false`、「## 阻塞原因」改回裸「无」，并继续推进流程。',
  };
}

/** 轻量模式（须 R20 用户确认后才生效） */
export const LITE_WORKFLOW_MODES = Object.freeze(['hotfix', 'docs-only', 'single-task']);

/**
 * **F-09 / F-17**：当前迭代轮次（frontmatter `iterationRound`，缺省 1）。
 *
 * 背景：`workflow-modes.md` 规定 hotfix / single-task「沿用当前活跃 process.md」，而
 * `## 用户确认记录` / `## 进度列表` / `## 增量范围` 都是**单表累积**结构、没有轮次维度。
 * 实测后果：第二轮起「上一轮的确认行与上一轮的审核结论足以为本轮背书」——同一套门禁
 * 越往后越松。故引入显式轮次标识，让「本轮证据」可机械判定。
 *
 * 缺省 1 是刻意的：单轮项目（绝大多数）无须填这个字段，判据与历史完全一致；
 * 只有 PM 把轮次推进到 ≥2 时，才开始要求本轮自己的确认行与审核结论行（只加强，不放松）。
 */
export function getIterationRound(content) {
  const fm = parseProcessFrontmatter(content ?? '');
  const n = Number.parseInt(String(fm.iterationRound ?? '1').trim(), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * **F-09 / F-17**：文本是否带指向 `round` 的轮次标识（`轮次 2` / `第2轮` / `R2轮` / `round 2`）。
 * 只认「轮次语义 + 数字」的组合，避免把需求编号 `R-002`、时间 `2026` 之类误判为轮次标识。
 */
export function mentionsIterationRound(text, round) {
  const t = String(text ?? '');
  const n = String(round);
  return new RegExp(
    `(?:第\\s*${n}\\s*[轮次]|[轮次]\\s*[:：]?\\s*${n}(?![0-9])|\\bround\\s*[:：]?\\s*${n}(?![0-9]))`,
    'i',
  ).test(t);
}

/** frontmatter 声明的原始 `workflow_mode`（未做 R20 确认校验） */
export function getDeclaredWorkflowMode(content) {
  const fm = parseProcessFrontmatter(content ?? '');
  return fm.workflow_mode ?? 'full';
}

/**
 * R20：轻量模式是否已在「## 用户确认记录」留机读确认行。
 * 行须含「工作流模式确认」（或 `workflow_mode 确认`），且含与声明模式匹配的意图词。
 * 仅校验结构关键词，不校验 AskUserQuestion 语义真实性。
 *
 * **F-17（轮次时效性）**：`iterationRound ≥ 2` 时，确认行还须带本轮轮次标识
 * （`轮次 2` / `第2轮` / `round 2`）。历史实现只要求「存在一行含意图词」，于是连续两次
 * hotfix 时**上一轮的确认行直接放行本轮**——用户从未为本轮的模式选择表过态。
 * 单轮项目（默认 `iterationRound: 1`）判据与历史逐字一致。
 */
export function hasLiteModeConfirmation(content, mode) {
  const m = mode ?? getDeclaredWorkflowMode(content);
  if (!LITE_WORKFLOW_MODES.includes(m)) return true;
  const round = getIterationRound(content);
  const body = extractSection(content ?? '', '用户确认记录');
  if (!body) return false;
  const modePatterns = {
    hotfix: /hotfix|热修复|热修|修\s*bug/i,
    'docs-only': /docs-only|只改文档|仅改文档|仅文档/i,
    // R37 起 `single-task` 的定位是「增量迭代」，故意图词一并纳入增量类说法；
    // 旧词（单任务/小改动）保留，避免既有项目的确认行失效（R12：不得因改口径回退门禁）。
    'single-task': /single-task|单任务|小改动|增量迭代|增量/i,
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
    if (!/工作流模式确认|workflow_mode\s*确认/i.test(t) || !modeRe.test(t)) continue;
    if (round >= 2 && !mentionsIterationRound(t, round)) continue; // F-17：旧轮次确认行不为本轮背书
    return true;
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
  const round = getIterationRound(md);
  return {
    ok: false,
    reason: 'lite-mode-unconfirmed',
    message: `R20：workflow_mode=${declared} 须经 AskUserQuestion 用户确认，并在 ## 用户确认记录 留「工作流模式确认」行（含 ${declared} 或对应人话意图${round >= 2 ? `，且须标注本轮轮次「第${round}轮」——上一轮的确认行不为本轮背书（F-17）` : ''}），方可享受轻量路径；未确认前按 full 处理，或改回 workflow_mode: full。`,
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
