/**
 * 门禁域：paths — R10 取消冻结、源码/Shell/工具链路径门禁、assertDevGateOrDeny、
 * R28 Shell 写文件意图分类、R29 门禁自治资产分类与裁决。
 *
 * 主要消费方：gate-dev-workflow / gate-dev-shell / gate-toolchain-install。
 * 域对照见 ./README.md。
 */
import path from 'node:path';
import {
  createHash } from 'node:crypto';
import {
  PROJECT_ROOT,
  TOOLCHAIN_APPROVAL_MARKER,
  readJsonFileSafe,
  readProcessMd,
  readProcessMdAtPath,
  parseProcessFrontmatter,
  getWorkflowMode,
  hasValidDispatchPlan,
  isProcessBlocked,
  deny,
  ask,
  allow,
  output,
  loadHarnessConfig,
  getMergedGatedPaths,
  getMergedDotCursorExemptPatterns,
  getMergedShellPatterns,
  getToolchainInstallPatterns,
  CODE_EXTENSIONS,
  normalizePath
} from './core.mjs';
import { checkIterationArtifacts, checkHotfixDesign } from './iteration.mjs';

// ---------------------------------------------------------------------------
// R10：流程终止（不可逆取消）
// ---------------------------------------------------------------------------

/** 是否为 process.md 路径（任意 Greenfield/Feature 均匹配，与「当前活跃指针」无关） */
export function isProcessFilePath(filePath) {
  const p = normalizePath(filePath);
  if (!p) return false;
  return /(^|\/)docs\/(.+\/)?process\/process\.md$/.test(p);
}

/** 目标 process.md 自身（读取磁盘当前内容，而非活跃指针）是否已被标记为不可逆取消 */
export function isCancelledProcessFile(filePath) {
  if (!isProcessFilePath(filePath)) return false;
  const content = readProcessMdAtPath(filePath);
  if (!content) return false;
  const fm = parseProcessFrontmatter(content);
  return fm.cancelled === true;
}

/** 当前活跃流程是否已被取消（用于 shell / stop 门禁） */
export function isActiveProcessCancelled() {
  const content = readProcessMd();
  if (!content) return false;
  const fm = parseProcessFrontmatter(content);
  return fm.cancelled === true;
}

/**
 * 源码/受门禁 Shell 的统一放行前置：R10 cancelled → docs-only 禁写 → 分派计划 → R3 → R9(hotfix) → blocking。
 * 任一不满足即 `deny` 并退出进程；全部通过则静默返回（由调用方继续 allow）。
 */
export function assertDevGateOrDeny() {
  const content = readProcessMd();
  const mode = getWorkflowMode(content);

  if (content && isActiveProcessCancelled()) {
    deny(
      '流程门禁：当前活跃流程已被用户取消终止（不可逆），禁止再对其进行任何开发/初始化操作。',
      'AGENTS.md R10：该 process.md 已标记 cancelled: true，永久冻结，无法恢复。如需继续工作，须发起新的流程/迭代（新的 process.md），不得尝试绕过或清除取消标记。',
    );
  }

  if (mode === 'docs-only') {
    deny(
      '流程门禁：当前为 docs-only 模式，禁止写入源码与构建产物。',
      'AGENTS.md 轻量模式 docs-only：仅允许修改 docs/**/*.md。请切换 workflow_mode 或走完整开发流程。',
    );
  }

  if (!hasValidDispatchPlan(content)) {
    deny(
      '流程门禁：尚未完成项目经理开发分派。须先在 process.md 写入「## 当前分派计划」与「## 待派发角色列表」，再通过 development-engineer 子 agent 开发。',
      'AGENTS.md：禁止在无分派计划时写入受保护源码路径或执行项目初始化/依赖安装命令。请先调用 project-manager 完成分派；若开发已在执行，须保持「## 当前分派计划」有效。',
    );
  }

  const r3 = checkIterationArtifacts(content);
  if (!r3.ok) {
    deny(
      `流程门禁（R3）：本次迭代缺少必需成果物或未被 process.md 引用：${(r3.missing ?? []).join('、')}`,
      'AGENTS.md R3：非 hotfix/docs-only 迭代进入开发前须校验四件成果物（requirement-spec.md、requirement-list.md、detail-design-spec.md、develop-task-list.md）存在且被 process.md 引用。',
    );
  }

  if (mode === 'hotfix') {
    const r9 = checkHotfixDesign(content);
    if (!r9.ok) {
      deny(
        '流程门禁（R9）：hotfix 前置校验未通过，detail-design-spec.md 不存在。',
        'AGENTS.md R9：hotfix 进入开发前须校验设计存在性；缺失须先由 system-architect 补最小热修设计微任务，禁止 PM/顶层代理代写设计。',
      );
    }
  }

  if (isProcessBlocked(content)) {
    deny(
      '流程门禁：process.md 处于阻塞状态，须等待用户确认后再继续开发。',
      'AGENTS.md：阻塞状态下禁止继续开发相关操作。',
    );
  }
}

function basenameMatches(p, names) {
  const base = p.split('/').pop() ?? '';
  return names.some((name) => {
    if (name.includes('*')) {
      const re = new RegExp(`^${name.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`, 'i');
      return re.test(base);
    }
    return base === name.toLowerCase();
  });
}

function globPatternMatches(p, pattern) {
  const normalized = pattern.toLowerCase().replace(/\\/g, '/');
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  const re = new RegExp(`^${escaped}$`, 'i');
  return re.test(p);
}

function isCodeExtension(ext) {
  return CODE_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * R6：`.cursor/` 下是否为受机制门禁保护的治理/工程化基建路径。
 * 白名单豁免（模板、rules、运行时状态、hooks/config 注册文件、工具链批准标记）之外，
 * `scripts|agents|hooks` 三目录一律纳入门禁；其余未命名子目录默认不纳入（与 R6 声明范围一致）。
 */
function isGatedDotCursorPath(p) {
  const exempt = getMergedDotCursorExemptPatterns();
  if (exempt.some((pattern) => globPatternMatches(p, pattern))) return false;
  return /^\.cursor\/(scripts|agents|hooks)(\/|$)/.test(p);
}

/**
 * 是否为 E2E 测试树路径（`e2e/**`）。（**R23**）
 * 纳入 `isGatedDevPath` 机械门禁，但期望角色为 test-engineer（见 role-path.mjs），
 * 且不走 DE 分派计划门禁（与 docs 测试成果物同构）。
 */
export function isE2eTestPath(filePath) {
  const p = normalizePath(filePath);
  if (!p) return false;
  return p === 'e2e' || p.startsWith('e2e/');
}

/** 是否为受门禁约束的开发产物路径 */
export function isGatedDevPath(filePath) {
  const p = normalizePath(filePath);
  if (!p) return false;

  if (p.includes('node_modules/')) return false;

  // TE 可写路径纳入角色门禁（expectedRolesForPath → test-engineer）
  if (isE2eTestPath(p)) return true;

  if (p.startsWith('.cursor/')) {
    return isGatedDotCursorPath(p);
  }

  // 架构师配置文件：docs/[{feature}/]design/gated-artifacts.json 需允许写入
  // （它是门禁配置而非源码，否则与「架构师必须产出该文件」相互矛盾）
  if (/(^|\/)docs\/(.+\/)?design\/gated-artifacts\.json$/.test(p)) return false;

  const gated = getMergedGatedPaths();

  // docs/ 下仅允许 markdown 等文档扩展名，禁止源码文件
  if (p.startsWith('docs/')) {
    const ext = path.posix.extname(p).toLowerCase();
    if (!ext) return false;
    const allowed = gated.docsAllowedExtensions.map((e) => e.toLowerCase());
    if (allowed.includes(ext)) return false;
    if (isCodeExtension(ext)) return true;
    // 其他非文档扩展名在 docs 下也拦截
    return true;
  }

  for (const dir of gated.sourceDirs) {
    const d = dir.toLowerCase().replace(/\\/g, '/');
    if (p === d || p.startsWith(`${d}/`)) return true;
  }

  if (basenameMatches(p, gated.buildManifests.map((n) => n.toLowerCase()))) {
    if (!p.includes('node_modules')) return true;
  }

  if (basenameMatches(p, gated.testConfigs.map((n) => n.toLowerCase()))) {
    return true;
  }

  if ((gated.rootPatterns ?? []).some((pattern) => globPatternMatches(p, pattern))) {
    return true;
  }

  // 根目录或子目录 Cargo.toml（Rust 工作区）
  if (p === 'cargo.toml' || p.endsWith('/cargo.toml')) return true;

  // **R6 加强**：代码扩展名默认受门禁（白名单 → 黑名单）。
  // 仅靠 sourceDirs 目录名白名单会漏掉大量主流布局（SwiftPM `Sources/`、Python 根包
  // `myapp/`、.NET `MyApp/`、Serverless `functions/`、`R/`、根目录 `main.py` 等），
  // 使「跨技术栈通用」名不副实。改为：凡代码扩展名一律受门禁，除非位于依赖/构建
  // 产物等豁免目录（见 gatedPaths.extensionGateExemptDirs）。
  // 注意：`.cursor/`、`docs/`、`e2e/` 已在上方各自分支返回，不受本规则影响。
  if (isCodeExtensionGated(p, gated)) return true;

  return false;
}

/** 代码扩展名默认门禁判定（**R6 加强**）：命中豁免目录则不纳入 */
function isCodeExtensionGated(p, gated) {
  const ext = path.posix.extname(p).toLowerCase();
  if (!ext || !isCodeExtension(ext)) return false;
  const exempt = (gated.extensionGateExemptDirs ?? []).map((d) =>
    d.toLowerCase().replace(/\\/g, '/'),
  );
  const segments = p.split('/').slice(0, -1);
  if (segments.some((seg) => exempt.includes(seg))) return false;
  return true;
}

/**
 * **R29**：门禁自治资产分类。
 *
 * 历史实现把 `.cursor/hooks.json`、`.cursor/harness.config.json` 与三个运行时标记
 * 全部放进 `dotCursorExemptPatterns`，等于「被约束方可以自由改写约束自身」——实测可
 * 一步完成：伪造 `.dispatched-roles.json` 即获得任意角色身份；自写
 * `.toolchain-install-approved.json` 即自签工具链安装授权；清空 `harness.config.json`
 * 的 `sourceDirs` 或把 `qe.commands.lint` 设为 `exit 0` 即令 R6/R15 空转。
 * 这使 R12「只可加强，不可放松」失去机械基础（B 层能被 A 层管辖对象改写）。
 *
 * 分级（三类的**裁决同为 deny**，但阻塞理由与解法不同，故仍分类以给出准确提示）：
 * - `runtime-marker`：只应由 Hook 进程自身写入，代理写入即等于自签身份；
 * - `approval-marker`：代表「用户已批准」的凭证，代理写入即等于自签授权；
 * - `gate-config`：门禁强度旋钮与权威文本，改动等于调整门禁本身。
 *
 * **为什么一律 deny 而不是 ask**：Cursor 官方文档明确说明 `preToolUse` 的
 * `permission: "ask"` 「accepted by the schema but not enforced today」——即写文件通道上
 * 返回 `ask` 不会弹出用户批准，行为未定义。若在此处依赖 `ask`，保护会**静默退化**，
 * 正是本次审核要消除的失效模式。故统一用平台确实强制的 `deny`，把「是否放宽门禁」
 * 交回人类：由用户直接编辑这些文件（代理可以给出 diff 建议供用户粘贴）。
 */
export const HARNESS_RUNTIME_MARKERS = Object.freeze([
  '.cursor/hooks/.root-conversation-id.json',
  '.cursor/hooks/.dispatched-roles.json',
]);

export const HARNESS_APPROVAL_MARKERS = Object.freeze([
  '.cursor/hooks/.toolchain-install-approved.json',
]);

export const HARNESS_GATE_CONFIG_PATHS = Object.freeze([
  '.cursor/hooks.json',
  '.cursor/harness.config.json',
  'agents.md',
]);

export function classifyHarnessSelfGovernedPath(filePath) {
  const p = normalizePath(filePath);
  if (!p) return null;
  if (HARNESS_RUNTIME_MARKERS.includes(p)) return 'runtime-marker';
  if (HARNESS_APPROVAL_MARKERS.includes(p)) return 'approval-marker';
  if (HARNESS_GATE_CONFIG_PATHS.includes(p)) return 'gate-config';
  // 说明权威（叙述 SSOT）：改动等价于调整门禁口径，须人工审阅
  if (/^\.cursor\/harness\/spec\/.+\.md$/.test(p)) return 'gate-config';
  return null;
}

/** `.cursor/harness-state.json`：决定所有门禁读哪一份 process.md，归项目经理维护 */
export function isHarnessStatePath(filePath) {
  return normalizePath(filePath) === '.cursor/harness-state.json';
}

/** R29 分级 → Hook 裁决语义与提示文案（三类均为 deny，理由与解法不同） */
export function harnessSelfGovernedVerdict(kind, p) {
  if (kind === 'runtime-marker') {
    return {
      permission: 'deny',
      userMessage: `流程门禁（R29）：「${p}」是 Hook 运行时状态标记，只能由门禁进程自身写入，禁止由代理写入或修改。`,
      agentMessage:
        'AGENTS.md R29：伪造 R5 运行时标记等于自签角色身份/顶层身份，属绕过门禁。请通过正常的 Task 派发流程让 Hook 自行落盘，不得手工创建或编辑该文件。',
    };
  }
  if (kind === 'approval-marker') {
    return {
      permission: 'deny',
      userMessage: `工具链授权门禁（R29）：「${p}」是「用户已批准安装」的凭证，禁止由代理创建或修改（否则等于自签授权）。`,
      agentMessage:
        'AGENTS.md R29：授权凭证不得自签。直接执行该安装命令即可——`gate-toolchain-install` 会在 `beforeShellExecution` 上以 `ask` 请用户批准（该通道的 ask 确实生效）。如用户希望在一段时间内批量预授权，须由**用户本人**创建该凭证文件（含 userConfirmed、有效时间戳与对应 commandHash）。',
    };
  }
  return {
    permission: 'deny',
    userMessage: `门禁自治门禁（R29）：「${p}」属门禁强度配置/权威文本，改动会直接影响全部机械门禁的强度，禁止由代理写入。`,
    agentMessage:
      'AGENTS.md R12/R29：门禁配置与权威文本只可加强、不可放松，且「是否放宽」不能由被约束方自行决定。请把拟改内容以 diff/说明形式呈现给用户，由**用户本人**编辑该文件；禁止以「临时放宽」「便于通过」为由绕道修改（含改 qe.commands、sourceDirs、扫描阈值、摘除 Hook 注册）。',
  };
}

// ---------------------------------------------------------------------------
// R28：Shell 侧写文件门禁
// ---------------------------------------------------------------------------

/**
 * **R28**：Shell 通道的写文件门禁。
 *
 * 历史实现中 `gate-dev-shell` 只匹配 `gatedShellPatterns`（包管理 / 脚手架命令），
 * 未命中即立刻 `allow()` 早退——连 R5 身份判定都在其后。结果是 R5/R3/R9/R21/R23
 * 全部只覆盖 Write 类工具：实测 `Set-Content src/app.ts`、`echo x > src/app.ts`、
 * `node -e "...writeFileSync..."`、`cp`、`git apply`、`rm -rf src/` 等 11 类写文件命令
 * 100% 放行，§5.16「Hook 拒绝的调用不得改用其他工具绕过」纯靠自觉。
 *
 * 本函数把 Shell 命令分类为：
 * - `targets`：能解析出的、受门禁保护的目标路径 → 交由与 Write 完全相同的判据裁决；
 * - `opaqueWrite`：内联解释器且含写文件语义，但无法解析目标 → deny（改用 Write 工具，
 *   以便门禁可裁决）；
 * - `opaqueWorktree`：`git apply` 等可任意改写工作树但目标不可静态判定 → ask（交人判断）。
 *
 * 能力边界：正则「尽力而为」，无法穷尽所有写文件手段（与 §8.4 既有声明一致）；
 * 目标是把「随手绕过」的成本从 0 提高到「必须刻意构造」，而非做到不可绕过。
 */
const SHELL_MUTATION_RE = new RegExp(
  [
    // 重定向（排除 2>&1 之类的 fd 复制）
    String.raw`(?:^|[^0-9>&])>>?\s*[^\s|&;<>]`,
    // PowerShell 写/改文件 cmdlet
    String.raw`\b(?:set-content|add-content|out-file|new-item|copy-item|move-item|remove-item|rename-item|tee-object|export-csv|expand-archive)\b`,
    // POSIX 写/改文件
    String.raw`\b(?:cp|mv|rm|ln|install|truncate|shred|tee|patch)\s`,
    String.raw`\bdd\s+[^|;&]*\bof=`,
    String.raw`\bsed\s+[^|;&]*-i\b`,
    // 解压 / 下载落盘
    String.raw`\btar\s+[^|;&]*-[a-z]*x`,
    String.raw`\b(?:unzip|7z\s+x|gunzip|bunzip2)\b`,
    String.raw`\bcurl\b[^|;&]*\s(?:-o|-O|--output)\b`,
    String.raw`\bwget\b[^|;&]*\s-O\b`,
    String.raw`\b(?:invoke-webrequest|iwr)\b[^|;&]*-outfile\b`,
  ].join('|'),
  'i',
);

/** 可任意改写工作树、但目标无法静态判定的 VCS 命令 */
const VCS_WORKTREE_MUTATION_RE =
  /\bgit\s+(?:apply|am|restore|stash\s+(?:pop|apply)|reset\s+--hard|clean\s+-[a-z]*f|revert|cherry-pick|rebase|merge|pull)\b/i;

/** `git checkout <ref> -- <path>` / `git checkout .`：目标可解析 */
const VCS_CHECKOUT_PATHS_RE = /\bgit\s+(?:checkout|restore)\b[^|;&]*(?:--\s+\S|\s\.\s*$)/i;

/** 内联解释器（可执行任意代码，含写文件） */
const INLINE_EVAL_RE =
  /\b(?:node|deno|bun|python3?|ruby|perl|php|pwsh|powershell)\b[^|;&]*?\s-(?:e|c|r|-eval|-command|-encodedcommand)\b/i;

/** 内联代码中出现的写文件语义标记 */
const INLINE_WRITE_TOKEN_RE =
  /(?:writefilesync|appendfilesync|createwritestream|fs\.write|fs\.rm|fs\.unlink|\.write\s*\(|open\s*\([^)]*['"][wa]|shutil\.|os\.remove|os\.unlink|rmtree|set-content|out-file|remove-item|file_put_contents)/i;

/** 框架自带运行器：只写 test-results/ 受控产物，不纳入 R28 判定 */
const HARNESS_RUNNER_RE =
  /\.cursor[\/\\]scripts[\/\\](?:e2e-run|lint-run|static-scan-run|qe-run|bootstrap-docs|gate-selftest|gate-scenarios)\.mjs\b/i;

function stripQuotes(token) {
  return String(token ?? '').replace(/^['"]|['"]$/g, '');
}

/** 从 Shell 命令中提取候选文件路径（宽召回，后续再用门禁判定过滤） */
export function extractShellPathCandidates(command) {
  const out = new Set();
  if (!command) return [];

  for (const m of command.matchAll(/"([^"]{1,300})"|'([^']{1,300})'/g)) {
    const v = (m[1] ?? m[2]).trim();
    if (v) out.add(v);
  }
  for (const m of command.matchAll(/>>?\s*("[^"]+"|'[^']+'|[^\s|&;<>]+)/g)) {
    const v = stripQuotes(m[1]).trim();
    if (v) out.add(v);
  }
  // 「路径形状」扫描：上面的引号提取无法处理嵌套引号
  // （如 `python -c "open('src/app.py','w')"` 中外层双引号会吞掉内层字面量），
  // 故再单独捞一遍形如 a/b.ext 的片段。宽召回无害——后续会按门禁判定过滤。
  for (const m of command.matchAll(
    /[A-Za-z0-9_.\-]*(?:[/\\][A-Za-z0-9_.\-]+)+/g,
  )) {
    const v = m[0].trim();
    if (v) out.add(v);
  }
  for (const raw of command.split(/[\s|;&]+/)) {
    let t = stripQuotes(raw).trim();
    if (!t) continue;
    // -Path:src/a.ts / --output=src/a.ts 形式
    const kv = t.match(/^-{1,2}[A-Za-z][A-Za-z-]*[:=](.+)$/);
    if (kv) t = stripQuotes(kv[1]);
    if (!t || t.startsWith('-')) continue;
    if (/[/\\]/.test(t) || /\.[A-Za-z0-9]{1,6}$/.test(t)) out.add(t);
  }

  return [...out]
    .map((t) => t.replace(/^\.[/\\]/, '').trim())
    .filter((t) => t && !/^https?:/i.test(t));
}

export function classifyShellWriteIntent(command) {
  const empty = { mutates: false, targets: [], selfGoverned: [], opaqueWrite: false, opaqueWorktree: false };
  if (!command || typeof command !== 'string') return empty;
  if (HARNESS_RUNNER_RE.test(command)) return empty;

  const inlineEval = INLINE_EVAL_RE.test(command) && INLINE_WRITE_TOKEN_RE.test(command);
  const vcsCheckout = VCS_CHECKOUT_PATHS_RE.test(command);
  const vcsOpaque = VCS_WORKTREE_MUTATION_RE.test(command);
  const mutates = SHELL_MUTATION_RE.test(command) || inlineEval || vcsCheckout || vcsOpaque;
  if (!mutates) return empty;

  const candidates = extractShellPathCandidates(command);
  const targets = [];
  const selfGoverned = [];
  for (const candidate of candidates) {
    const kind = classifyHarnessSelfGovernedPath(candidate);
    if (kind) {
      selfGoverned.push({ path: normalizePath(candidate), kind });
      continue;
    }
    if (isGatedDevPath(candidate) || isHarnessStatePath(candidate)) targets.push(candidate);
  }

  return {
    mutates: true,
    targets,
    selfGoverned,
    // 目标不可判定的写文件：内联解释器一律 deny（应改用 Write 工具让门禁裁决）
    opaqueWrite: inlineEval && targets.length === 0 && selfGoverned.length === 0,
    // 目标不可判定的工作树改写：交人类判断
    opaqueWorktree: vcsOpaque && !vcsCheckout && targets.length === 0 && selfGoverned.length === 0,
  };
}

/** 是否为受门禁约束的 Shell 命令 */
export function isGatedShellCommand(command) {
  if (!command) return false;
  const patterns = getMergedShellPatterns();
  return patterns.some((re) => re.test(command));
}

/** 是否为系统级工具链安装命令（须先询问用户安装路径） */
export function isToolchainInstallCommand(command) {
  if (!command) return false;
  const patterns = getToolchainInstallPatterns();
  return patterns.some((re) => re.test(command));
}

function hashCommand(command) {
  return createHash('sha256').update(command.trim()).digest('hex').slice(0, 16);
}

/**
 * 用户是否已通过标记文件授权工具链安装（含 TTL）。
 *
 * **R29 加强**：`commandHash` 由「可选」改为「必需」。历史实现中，一份不含
 * `commandHash` 的 `{ userConfirmed: true }` 标记可放行**任意**系统级安装命令
 * （实测同一标记同时放行 `winget install` 与 `apt-get install`），且该标记本身
 * 可由代理自行写入——等于安装授权可被自签且无限泛用。现要求凭证与本次命令
 * 一一绑定；标记文件的创建本身也已纳入 R29「approval-marker → ask」人工批准。
 */
export function hasToolchainInstallApproval(command) {
  const data = readJsonFileSafe(TOOLCHAIN_APPROVAL_MARKER);
  if (!data || typeof data !== 'object') return false;

  const config = loadHarnessConfig();
  const ttl = config.toolchain?.approvalTtlMinutes ?? 60;

  if (data.expiresAt) {
    if (new Date(data.expiresAt) < new Date()) return false;
  } else if (data.approvedAt) {
    const approved = new Date(data.approvedAt);
    const expires = new Date(approved.getTime() + ttl * 60 * 1000);
    if (expires < new Date()) return false;
  } else {
    return false;
  }

  if (data.userConfirmed !== true) return false;
  if (!command || typeof data.commandHash !== 'string' || !data.commandHash) return false;
  return data.commandHash === hashCommand(command);
}

export function hashCommandForApproval(command) {
  return hashCommand(command);
}
