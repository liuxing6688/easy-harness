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
  getActiveProcessPath,
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
  getMergedDotClaudeExemptPatterns,
  getMergedShellPatterns,
  getToolchainInstallPatterns,
  CODE_EXTENSIONS,
  normalizePath
} from './core.mjs';
import {
  checkIterationArtifacts,
  checkHotfixDesign,
  checkSingleTaskPreconditions,
} from './iteration.mjs';
import { checkHotfixP0Impact } from './design.mjs';

// ---------------------------------------------------------------------------
// R10：流程终止（不可逆取消）
// ---------------------------------------------------------------------------

/** 是否为 process.md 路径（任意 Greenfield/Feature 均匹配，与「当前活跃指针」无关） */
export function isProcessFilePath(filePath) {
  const p = normalizePath(filePath);
  if (!p) return false;
  return /(^|\/)docs\/(.+\/)?process\/process\.md$/.test(p);
}

/**
 * docs 子树下的**文档类角色成果物**（需求 / 设计 / 质量 / 测试），纯正则、无依赖。
 *
 * 与 `isGatedDevPath` 互补且**必须成对使用**：本函数管文档，后者管源码，而 docs 下的
 * `.md` 在 `isGatedDevPath` 里恰好返回 `false`（是允许扩展名）。
 *
 * F-01（2026-08-11 审核修复）：`classifyShellWriteIntent` 历史上只按
 * `isGatedDevPath || isHarnessStatePath || isGatedArtifactsConfigPath` 收集 targets，
 * 于是 `echo … > docs/design/detail-design-spec.md` 解析出的 targets 为空，
 * Shell 通道的角色↔路径判据（R28/R5）**整条静默失效**——任何角色都能用重定向改写
 * 别人的成果物，而同一路径经 Write 工具则会被拒。本函数即两个通道的共用判据来源
 * （`role-path.mjs` 的 `isGatedRoleArtifactPath` 亦委派至此，避免两处正则漂移）。
 */
export function isGatedDocArtifactPath(filePath) {
  const p = normalizePath(filePath);
  if (!p) return false;
  return /(^|\/)docs\/(.+\/)?(requirement|design|quality|test)\/.+\.(md|mdx|txt)$/.test(p);
}

/**
 * 是否为**当前活跃**的那一份 process.md（与 `isProcessFilePath` 的区别：后者匹配任意
 * feature 目录下的 `process/process.md`，含历史流程文件）。
 *
 * 供 **R36** 修复通道使用：判定期异常时开的口子必须只对「正在用的那份流程文件」开，
 * 否则 `docs/archived-2020/process/process.md` 这类任意历史路径也能触发例外。
 * 活跃指针本身解析失败时返回 `false`（宁可不给例外，由调用方决定兜底口径）。
 */
export function isActiveProcessFilePath(filePath) {
  if (!isProcessFilePath(filePath)) return false;
  try {
    return normalizePath(filePath) === normalizePath(getActiveProcessPath());
  } catch {
    return false;
  }
}

/**
 * **R36**：解析本次写入调用可享受「流程文件修复例外」的路径集（空数组 = 不给例外）。
 *
 * 2026-07-30 复核复现的绕过：历史实现是 `filePaths.filter(isProcessFilePath)`，而
 * `filePaths` 里混着从**写入内容**里解析出来的 ApplyPatch 目标路径。于是
 * `Write { path: 'src/app.ts', content: '*** Update File: docs/process/process.md\n…' }`
 * 就能凭空造出一个「修复路径」，再叠加「只要 repairPaths 非空就对整次调用放行」，
 * 判定期异常一旦被触发（`gated-artifacts.json` 写个类型非法的收紧字段即可），
 * 任意源码写入都能过。三处各自都不算漏洞，叠起来是一条完整通路。
 *
 * 故收窄为三个同时成立的条件：
 * 1. 只认**直接路径字段**（`path` / `file_path` …）——从内容里解析出来的路径由代理
 *    完全掌控，不能作为放行依据；ApplyPatch 因此拿不到例外（修流程文件请用 Write 类工具）。
 * 2. 只认**活跃** process.md（`isActiveProcessFilePath`）。
 * 3. 本次调用涉及的**全部**路径都必须是它——混写一律不给例外，杜绝「夹带」。
 *
 * 另限定工具类型：`Delete` 不在其列（异常态下允许删流程文件毫无必要，只增风险）。
 *
 * @param {{ toolName?: string, directPaths?: string[], allPaths?: string[] }} params
 * @returns {string[]} 规范化后的放行路径；空数组表示按 fail-closed 正常拒绝
 */
export const GATE_REPAIR_TOOLS = Object.freeze(['write', 'strreplace', 'editnotebook']);

export function resolveGateRepairPaths({ toolName, directPaths = [], allPaths = [] } = {}) {
  const tool = String(toolName ?? '').toLowerCase().replace(/[_\s-]/g, '');
  if (!GATE_REPAIR_TOOLS.includes(tool)) return [];
  if (directPaths.length === 0) return [];
  const candidates = [...directPaths, ...allPaths];
  if (!candidates.every((p) => isActiveProcessFilePath(p))) return [];
  return [...new Set(directPaths.map((p) => normalizePath(p)))];
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
 *
 * **判据分两层（2026-08-11 审核修复 F-18/F-19）**：
 * - **通用前置**（R10 cancelled / `docs-only` 禁写 / R3 四件成果物 / blocking）：对**全部**受门禁
 *   开发路径成立，含 `e2e/**`；
 * - **DE 专属前置**（`## 当前分派计划` / R37 增量前置 / R9 hotfix 前置）：只对「须由 DE 分派后
 *   才能动」的路径成立，`e2e/**` 按 `includeDeSpecific: false` 跳过。
 *
 * 历史实现只有一个整体函数，而两处调用点都以
 * `filePaths.some(p => isGatedDevPath(p) && !isE2eTestPath(p))` 为条件——`e2e/**` 被整体排除，
 * 于是**六条判据一起被跳过**：实测 `docs-only` 档位下任何角色都能写 `e2e/specs/*.spec.js`，
 * `cancelled: true`（R10 声明「永久冻结、不得绕过」）与 `blocking: true` 在 `e2e/**` 上同样不成立。
 * 那行排除本身有正当理由（e2e 期望 TE，不应要求 DE 分派计划），但「不要求分派计划」被误做成了
 * 「跳过整条前置链」——两件事在此拆开。参数化而非拆成两个函数，是为了让 DE 路径的**判定顺序与
 * 文案逐字不变**（多条同时不满足时报出的仍是历史上那一条）。
 *
 * @param {{ includeDeSpecific?: boolean }} [opts]
 */
export function assertDevGateOrDeny({ includeDeSpecific = true } = {}) {
  const content = readProcessMd();
  const mode = getWorkflowMode(content);

  if (content && isActiveProcessCancelled()) {
    deny(
      '流程门禁：当前活跃流程已被用户取消终止（不可逆），禁止再对其进行任何开发/初始化操作。',
      'CLAUDE.md R10：该 process.md 已标记 cancelled: true，永久冻结，无法恢复。如需继续工作，须发起新的流程/迭代（新的 process.md），不得尝试绕过或清除取消标记。',
    );
  }

  if (mode === 'docs-only') {
    deny(
      '流程门禁：当前为 docs-only 模式，禁止写入源码与构建产物。',
      // F-20（2026-08-11 审核修复）：文案原写「仅允许修改 docs/**/*.md」，是白名单口径；
      // 而实现是黑名单（命中受门禁开发路径才拒），于是根级 README.md / notes.txt / .gitignore
      // 这类非源码文本实际放行——声明与实现口径不一。按 R12 不得反向削减保护范围，
      // 故保留实现（这些路径确非产品源码，改它们不破坏 docs-only 的实质意图），改齐文案。
      'CLAUDE.md 轻量模式 docs-only：禁止写入源码与构建产物（含 e2e/**）；文档与仓库元文件可改。请切换 workflow_mode 或走完整开发流程。',
    );
  }

  // DE 专属：`e2e/**` 期望 test-engineer，TE 的批次/最终测试通道不经「开发分派计划」，
  // 故跳过本条（角色合法性仍由 checkRolePathPermission 的 R23 判据负责）。
  if (includeDeSpecific && !hasValidDispatchPlan(content)) {
    deny(
      '流程门禁：尚未完成项目经理开发分派。须先在 process.md 写入「## 当前分派计划」与「## 待派发角色列表」，再通过 development-engineer 子 agent 开发。',
      'CLAUDE.md：禁止在无分派计划时写入受保护源码路径或执行项目初始化/依赖安装命令。请先调用 project-manager 完成分派；若开发已在执行，须保持「## 当前分派计划」有效。',
    );
  }

  const r3 = checkIterationArtifacts(content);
  if (!r3.ok) {
    deny(
      `流程门禁（R3）：本次迭代缺少必需成果物或未被 process.md 引用：${(r3.missing ?? []).join('、')}`,
      'CLAUDE.md R3：非 hotfix/docs-only 迭代进入开发前须校验四件成果物（requirement-spec.md、requirement-list.md、detail-design-spec.md、develop-task-list.md）存在且被 process.md 引用。',
    );
  }

  // R37：single-task 增量档前置。与 R9 的写入期校验同理（见下方注释）——历史上 R9 只在 Task
  // 发起期校验，导致「DE Task 被拒、但已在 DE 上下文里的写入照样放行」，故此处同步补齐纵深防御。
  if (includeDeSpecific && mode === 'single-task') {
    const r37 = checkSingleTaskPreconditions(content);
    if (!r37.ok) {
      deny(
        `流程门禁（R37 增量迭代档）：${r37.message ?? r37.reason}`,
        `CLAUDE.md R37 / workflow-modes.md：${r37.message ?? r37.reason}`,
      );
    }
  }

  if (includeDeSpecific && mode === 'hotfix') {
    const r9 = checkHotfixDesign(content);
    if (!r9.ok) {
      deny(
        '流程门禁（R9）：hotfix 前置校验未通过，detail-design-spec.md 不存在。',
        'CLAUDE.md R9：hotfix 进入开发前须校验设计存在性；缺失须先由 system-architect 补最小热修设计微任务，禁止 PM/顶层代理代写设计。',
      );
    }
    // R9 第 3 条（最小影响澄清）历史上只在 Task 发起期校验（checkRoleDispatchGate），
    // 写入期缺失 ⇒ 「DE Task 被拒、但已在 DE 上下文里的写入照样放行」。补齐为纵深防御。
    const p0 = checkHotfixP0Impact(content);
    if (!p0.ok) {
      deny(
        `流程门禁（R9）：hotfix 最小影响澄清未完成——${p0.message ?? p0.reason}`,
        'CLAUDE.md R9 / gate-chain.md：hotfix 进入开发前须由项目经理向用户核验 P0 影响面并落盘（frontmatter hotfix_p0_impact 与「hotfix影响面」确认行），不得由开发工程师自行推断后直接改码。',
      );
    }
  }

  if (isProcessBlocked(content)) {
    deny(
      '流程门禁：process.md 处于阻塞状态，须等待用户确认后再继续开发。',
      'CLAUDE.md：阻塞状态下禁止继续开发相关操作。',
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
 * R6：`.claude/` 下是否为受机制门禁保护的治理/工程化基建路径。
 * 白名单豁免（模板、rules、运行时状态、hooks/config 注册文件、工具链批准标记）之外，
 * `scripts|agents|hooks` 三目录一律纳入门禁；其余未命名子目录默认不纳入（与 R6 声明范围一致）。
 */
function isGatedDotCursorPath(p) {
  const exempt = getMergedDotClaudeExemptPatterns();
  if (exempt.some((pattern) => globPatternMatches(p, pattern))) return false;
  return /^\.claude\/(scripts|agents|hooks)(\/|$)/.test(p);
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

/**
 * 架构师声明的项目级门禁配置 `docs/[{feature}/]design/gated-artifacts.json`。
 *
 * 它是**门禁强度旋钮**：`extra*` 收紧项、各门禁的 `{gate}Applicability: "n/a"`
 * 豁免第一要素、`productionStartupCommand`（R32 解析优先级）都在其中。历史实现
 * 把它整体排除在门禁之外（`isGatedDevPath` 直接 return false，且不在角色成果物
 * 判据内），等于**任何角色、任何阶段都能改写门禁配置**——R29 精心锁死了
 * `harness.config.json`，却放开了与之 merge 的另一半。
 *
 * 现纳入角色门禁：期望角色 `system-architect`（与「架构师维护该文件」的规约一致），
 * 但仍不走 DE 分派计划 / R3 / R9（避免 SA 在开发前产出它时死锁）。
 */
export function isGatedArtifactsConfigPath(filePath) {
  const p = normalizePath(filePath);
  if (!p) return false;
  return /(^|\/)docs\/(.+\/)?design\/gated-artifacts\.json$/.test(p);
}

/** 是否为受门禁约束的开发产物路径 */
export function isGatedDevPath(filePath) {
  const p = normalizePath(filePath);
  if (!p) return false;

  if (p.includes('node_modules/')) return false;

  // TE 可写路径纳入角色门禁（expectedRolesForPath → test-engineer）
  if (isE2eTestPath(p)) return true;

  if (p.startsWith('.claude/')) {
    return isGatedDotCursorPath(p);
  }

  // 架构师配置文件：docs/[{feature}/]design/gated-artifacts.json 不走 DE 源码门禁
  // （它是门禁配置而非源码，若要求 DE 分派计划会与「架构师须在开发前产出该文件」互相矛盾），
  // 但**不等于不受门禁**——它已纳入角色门禁，期望角色为 system-architect
  // （见 isGatedArtifactsConfigPath / role-path.mjs expectedRolesForPath）。
  if (isGatedArtifactsConfigPath(p)) return false;

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
  // 注意：`.claude/`、`docs/`、`e2e/` 已在上方各自分支返回，不受本规则影响。
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
 * 历史实现把 `.claude/hooks.json`、`.claude/harness.config.json` 与三个运行时标记
 * 全部放进 `dotClaudeExemptPatterns`，等于「被约束方可以自由改写约束自身」——实测可
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
  '.claude/hooks/.root-conversation-id.json',
  '.claude/hooks/.dispatched-roles.json',
  // **R34**：执行证明台账（公钥 + nonce）。可写等于可自签任意 test-results 产物。
  '.claude/hooks/.exec-proof-ledger.json',
  // **R35**：门禁异常事件旁路台账。可写等于可给自己伪造的「机器起源阻塞」补出处，
  // 从而用一行表格解除 stop 门禁的全部推进判据。
  '.claude/hooks/.gate-exception-ledger.json',
]);

/**
 * **R34**：执行证明私钥交接目录。目录下文件名含随机 nonce，故用前缀匹配而非白名单。
 * 代理写入该目录等于自签执行证明；删除等于把「私钥未被消费」这一作废条件抹掉。
 */
const EXEC_PROOF_PENDING_PREFIX = '.claude/hooks/.exec-proof-pending';

export const HARNESS_APPROVAL_MARKERS = Object.freeze([
  '.claude/hooks/.toolchain-install-approved.json',
]);

export const HARNESS_GATE_CONFIG_PATHS = Object.freeze([
  '.claude/harness.config.json',
  // 历史 Hook 注册表路径。Claude Code 实际注册在 .claude/settings.json，此条保留
  // 是因为 R12 只可加强不可放松：接入方仓库里可能仍有这份文件，撤销保护即是放松。
  '.claude/hooks.json',
  '.claude/hooks/hooks.json',
  // Claude Code 的 Hook 注册表。摘掉任一条注册即令对应门禁整体消失，
  // 强度远高于 harness.config.json 里的任何旋钮。
  '.claude/settings.json',
  '.claude/settings.local.json',
  'agents.md',
  'claude.md',  // normalizePath 会将 CLAUDE.md 转换为小写
]);

/**
 * **R29 加强（F-21）**：门禁**代码**与运行器同属自治资产，不只是配置文本。
 *
 * 问题：历史清单只锁 `harness.config.json` / `hooks.json` / spec 文本，于是
 * `.claude/hooks/**`（判据本体）、`.claude/scripts/*-run*.mjs`（产出机读证据的运行器）、
 * `.claude/agents/*.md`（角色强制约束，按 §2 规则 4 优先于任何 prompt）全部只受
 * 「角色↔路径」约束——而 CLAUDE.md §5.1 明文把 harness 基建授权给 development-engineer。
 * 合起来的后果：DE 在合法分派下即可改写 `lint-run.mjs` 让它恒写 `gatePassed: true`，
 * 或直接改 `execproof.mjs` 的验签逻辑；产物随后由**真实**私钥签名，R34 验签通过，
 * stop 门禁看到的是一份「合法签名背书的假结果」。锁配置而不锁代码，等于给 R12 留了后门。
 *
 * 判据：门禁代码、运行器、角色约束文本一律 `gate-config`（deny），与配置同源裁决。
 * DE 确需维护 harness 基建时，走「呈现 diff → 用户本人落盘」通道；**这不是能力缺失，
 * 而是刻意把「调整门禁自身」保留给人类**（同 §8.7 边界）。
 */
const HARNESS_GATE_CODE_PATTERNS = Object.freeze([
  // 门禁判据本体（Hook 入口 + lib/** 全域）
  /^\.claude\/hooks\/[^/]+\.mjs$/,
  /^\.claude\/hooks\/lib\/.+$/,
  // 机读证据运行器与其库：e2e-run / lint-run / static-scan-run / startup-smoke /
  // exec-proof / tool-availability 等，凡 *-run*.mjs 与 *-lib.mjs 皆在内
  /^\.claude\/scripts\/[^/]*-run[^/]*\.mjs$/,
  /^\.claude\/scripts\/[^/]*-lib\.mjs$/,
  /^\.claude\/scripts\/gate-[^/]+\.mjs$/,
  /^\.claude\/scripts\/(?:exec-proof|tool-availability|startup-smoke)[^/]*\.mjs$/,
  // 角色强制约束（§2 规则 4：优先于顶层/PM 下发的 prompt）
  /^\.claude\/agents\/[^/]+\.md$/,
  // 门禁自测与场景回归：改写它们等于把「门禁是否仍然生效」的唯一验证面抹掉
  /^\.claude\/scripts\/tests\/.+$/,
]);

export function classifyHarnessSelfGovernedPath(filePath) {
  const p = normalizePath(filePath);
  if (!p) return null;
  if (HARNESS_RUNTIME_MARKERS.includes(p)) return 'runtime-marker';
  if (p === EXEC_PROOF_PENDING_PREFIX || p.startsWith(`${EXEC_PROOF_PENDING_PREFIX}/`)) {
    return 'runtime-marker';
  }
  if (HARNESS_APPROVAL_MARKERS.includes(p)) return 'approval-marker';
  if (HARNESS_GATE_CONFIG_PATHS.includes(p)) return 'gate-config';
  // 说明权威（叙述 SSOT）：改动等价于调整门禁口径，须人工审阅
  if (/^\.claude\/harness\/spec\/.+\.md$/.test(p)) return 'gate-config';
  // 规则层（2026-08-14）：`.claude/rules/*.md` 由 Claude Code 官方规则机制自动注入上下文
  // ——无 `paths` 的规则随会话常驻，带 `paths` 的规则在读到匹配文件时注入。它与 CLAUDE.md
  // 同属「写给代理看的强制文本」，改写它等于改写代理收到的约束本身（例如把「禁止手工编辑
  // test-results」删成「必要时可手工补字段」），强度等同改 CLAUDE.md。历史上该目录在
  // `dotClaudeExemptPatterns` 里被整体豁免（理由是「仅为提醒」），在规则真正生效后该理由
  // 不再成立，故按 R12 只可加强的方向收回豁免，归 gate-config（须用户本人落盘）。
  if (/^\.claude\/rules\/.+\.md$/.test(p)) return 'gate-config';
  // R29 加强（F-21）：门禁代码 / 运行器 / 角色约束
  if (HARNESS_GATE_CODE_PATTERNS.some((re) => re.test(p))) return 'gate-code';
  return null;
}

/** `.claude/harness-state.json`：决定所有门禁读哪一份 process.md，归项目经理维护 */
export function isHarnessStatePath(filePath) {
  return normalizePath(filePath) === '.claude/harness-state.json';
}

/**
 * **F-23（2026-08-11 审核修复）**：机读证据目录 `test-results/**`。
 *
 * R15/R16/R17/R32 与批次/最终 E2E 五项硬门禁的判据全部是读这里的产物，
 * 但历史实现只防「伪造产物内容」（R34 验签），未防「把产物删掉」：实测
 * `rm -rf test-results` 以 QE 身份 **ALLOW**，且 `.gitignore` 已排除该目录，
 * 删除不留 git 痕迹。删后各 `check*Gate` 只报「产物缺失」——与「从未跑过」
 * 无从区分，等价于把已交卷的轮次静默回滚重来（R12 视角下是放松）。
 *
 * 注意保护面**只能是删除**：`test-results/**` 必须对运行器开放写入（见
 * `execproof.mjs` §「必须豁免写门禁，这是设计前提」），否则运行器无法落盘产物。
 * 故本判据不进 `targets`（那会连写入一起拦），而是配合 `SHELL_DELETE_RE`
 * 单独构成 `deletesEvidence` 出口。
 */
export function isEvidenceArtifactPath(filePath) {
  const p = normalizePath(filePath);
  if (!p) return false;
  return p === 'test-results' || p.startsWith('test-results/');
}

/**
 * F-23：删除/搬移语义。命中且目标落在证据目录或活跃流程指针上即 deny。
 *
 * 只收「会让文件消失」的动词：`rm`/`del`/`Remove-Item`/`rmdir`、`mv`（搬走等于删除）、
 * `truncate`/`shred`（清空等于删除）、`git clean -f`。不含 `cp`/`tee` 等纯写入动词。
 */
const SHELL_DELETE_RE =
  /\b(?:rm|rmdir|unlink|del|erase|mv|move|truncate|shred)\s|\b(?:remove-item|ri|rd|move-item|clear-content)\b|\bgit\s+clean\s+-[a-z]*f/i;

/** R29 分级 → Hook 裁决语义与提示文案（三类均为 deny，理由与解法不同） */
export function harnessSelfGovernedVerdict(kind, p) {
  if (kind === 'runtime-marker') {
    return {
      permission: 'deny',
      userMessage: `流程门禁（R29）：「${p}」是 Hook 运行时状态标记，只能由门禁进程自身写入，禁止由代理写入或修改。`,
      agentMessage:
        'CLAUDE.md R29：伪造 R5 运行时标记等于自签角色身份/顶层身份，属绕过门禁。请通过正常的 Agent 派发流程让 Hook 自行落盘，不得手工创建或编辑该文件。',
    };
  }
  if (kind === 'approval-marker') {
    return {
      permission: 'deny',
      userMessage: `工具链授权门禁（R29）：「${p}」是「用户已批准安装」的凭证，禁止由代理创建或修改（否则等于自签授权）。`,
      agentMessage:
        'CLAUDE.md R29：授权凭证不得自签。直接执行该安装命令即可——`gate-toolchain-install` 会在 `PreToolUse`（`Bash|PowerShell`）上以 `ask` 请用户批准。如用户希望在一段时间内批量预授权，须由**用户本人**创建该凭证文件（含 userConfirmed、有效时间戳与对应 commandHash）。',
    };
  }
  if (kind === 'gate-code') {
    return {
      permission: 'deny',
      userMessage: `门禁自治门禁（R29 加强）：「${p}」是门禁判据本体 / 机读证据运行器 / 角色强制约束，改动它等价于改写门禁自身的判定结果，禁止由代理写入（含 development-engineer）。`,
      agentMessage:
        'CLAUDE.md R12/R29：锁配置而不锁代码等于给 R12 留后门——改写运行器即可产出「恒 gatePassed」的产物，' +
        '而该产物随后会被 R34 用真实私钥签名，stop 门禁将看到一份「合法签名背书的假结果」。' +
        'CLAUDE.md §5.1 授权 DE 维护 harness 基建，但「调整门禁自身」这一层刻意保留给人类：' +
        '请把拟改内容以完整 diff + 变更理由呈现给用户，由**用户本人**落盘；' +
        '若属加强门禁（R12 允许方向），同样须用户落盘并在 `.claude/harness/spec/**` 留痕。',
    };
  }
  return {
    permission: 'deny',
    userMessage: `门禁自治门禁（R29）：「${p}」属门禁强度配置/权威文本，改动会直接影响全部机械门禁的强度，禁止由代理写入。`,
    agentMessage:
      'CLAUDE.md R12/R29：门禁配置与权威文本只可加强、不可放松，且「是否放宽」不能由被约束方自行决定。请把拟改内容以 diff/说明形式呈现给用户，由**用户本人**编辑该文件；禁止以「临时放宽」「便于通过」为由绕道修改（含改 qe.commands、sourceDirs、扫描阈值、摘除 Hook 注册）。',
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
    // F-26（2026-08-11 审核修复）：已知「第三方 CLI 原地改写」。历史正则只枚举了
    // `sed -i`，于是同类命令换个名字即可绕过——实测 `perl -pi`、`yq -i`、`json -I`、
    // `npm pkg set`、`npm version`、`ex -sc wq`、`replace-in-file` 全部 ALLOW，
    // 其中 `npx json -I -f docs/design/gated-artifacts.json` 可单方面取得 R22 双钥
    // 之一（Write 通道该文件期望角色为 SA）。枚举法无法穷尽（§8.5 已披露），
    // 故本行只负责抬高成本，真正的兜底是下方 GATED_PATH_ARG 的路径敏感判据。
    String.raw`\bperl\b[^|;&]*\s-[a-z]*i[a-z]*\b[^|;&]*\be\b|\bperl\s+-[a-z]*p?i`,
    String.raw`\b(?:yq|xq|tomlq|dasel|sponge)\b[^|;&]*\s-i\b`,
    String.raw`\bjson\b[^|;&]*\s-I\b`,
    String.raw`\bnpm\s+(?:pkg\s+(?:set|delete)|version)\b`,
    String.raw`\b(?:ex|vi|vim|nvim)\b[^|;&]*\s-[a-z]*c\b`,
    String.raw`\breplace-in-file\b`,
    String.raw`\b(?:crudini|git\s+config|npm\s+config\s+set|yarn\s+config\s+set|pnpm\s+config\s+set)\b`,
  ].join('|'),
  'i',
);

/**
 * F-26 兜底（路径敏感，2026-08-11 审核修复）：受门禁路径 / 门禁自治资产
 * **出现在任何 Shell 命令的参数里**即需裁决，不再要求先命中命令名黑名单。
 *
 * 理由：`SHELL_MUTATION_RE` 是命令黑名单，天然漏「同类命令换个名字」。而门禁真正
 * 在意的不是「用了哪个工具」，是「哪个文件可能被改」。本判据把口径反过来：只要命令行里
 * 提到了受门禁路径，就走正常的角色↔路径裁决；读命令（`cat`/`type`/`grep` 等）另有
 * 白名单豁免，避免把「看一眼文件」也拦成写入。
 */
const SHELL_READONLY_CMD_RE =
  /^\s*(?:sudo\s+)?(?:cat|type|bat|less|more|head|tail|grep|rg|ag|find|fd|ls|dir|wc|diff|stat|file|md5sum|sha\d+sum|get-content|select-string|get-childitem|test-path|node\s+--check|jq|git\s+(?:diff|log|show|status|blame|ls-files))\b/i;

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

/**
 * 框架自带运行器：只写 test-results/ 受控产物，不纳入 R28 判定。
 * `startup-smoke-run` 曾遗漏（历史缺口，不影响判定但与 R34 kind 识别口径不一致），已补齐。
 */
const HARNESS_RUNNER_PATH_RE =
  /\.claude[\/\\]scripts[\/\\](?:e2e-run|lint-run|static-scan-run|startup-smoke-run|qe-run|bootstrap-docs|gate-selftest|gate-scenarios)\.mjs\b/i;

/**
 * **R28 加强（F-21 同源）**：豁免的是「**调用**运行器」，不是「命令里**出现**运行器路径」。
 *
 * 历史实现只匹配路径，于是 `Set-Content .claude/scripts/lint-run.mjs -Value x` 会命中豁免并
 * `return empty` —— 早退发生在 R29 归类之前，改写运行器的 Shell 命令 100% 放行，
 * 而 Write 通道的同一改写被 deny。同一操作两条通道判据相反，正是 §5.16 要消除的失效模式。
 * 现要求运行器路径前必须是解释器/包管理器调用形式，否则按普通写文件命令继续判定。
 */
const HARNESS_RUNNER_RE = new RegExp(
  String.raw`(?:^|[|;&]|\&\&)\s*(?:[A-Za-z]:)?[^|;&]*?\b(?:node|npx|bun|deno|pnpm|yarn|npm)\b[^|;&]*?` +
    HARNESS_RUNNER_PATH_RE.source,
  'i',
);

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
  const empty = {
    mutates: false, targets: [], selfGoverned: [], opaqueWrite: false, opaqueWorktree: false,
    deletesEvidence: [],
  };
  if (!command || typeof command !== 'string') return empty;
  if (HARNESS_RUNNER_RE.test(command)) return empty;

  const inlineEval = INLINE_EVAL_RE.test(command) && INLINE_WRITE_TOKEN_RE.test(command);
  const vcsCheckout = VCS_CHECKOUT_PATHS_RE.test(command);
  const vcsOpaque = VCS_WORKTREE_MUTATION_RE.test(command);
  const parsedCandidates = extractShellPathCandidates(command);

  // F-26 路径敏感兜底：命令名黑名单没命中，但命令行里提到了受门禁路径 / 门禁自治资产时，
  // 仍按「可能改写」裁决（纯读命令按白名单豁免）。这条把 R28 从「枚举写文件命令」
  // 转为「路径出现即裁决」，覆盖 `json -I`、`replace-in-file` 这类未来才出现的同类工具。
  const mentionsGated = parsedCandidates.some(
    (candidate) =>
      classifyHarnessSelfGovernedPath(candidate) ||
      isGatedDevPath(candidate) ||
      isGatedDocArtifactPath(candidate) ||
      isProcessFilePath(candidate) ||
      isHarnessStatePath(candidate) ||
      isGatedArtifactsConfigPath(candidate),
  );
  const pathSensitive = mentionsGated && !SHELL_READONLY_CMD_RE.test(command);

  // F-26：`npm pkg set` / `npm version` / `npm config set` 的目标是隐含的（package.json /
  // .npmrc 不出现在命令行里），若不补出来就会落进「mutates 但 targets 为空」的缝里被放行。
  const implicitTargets = [];
  if (/\bnpm\s+(?:pkg\s+(?:set|delete)|version)\b/i.test(command)) implicitTargets.push('package.json');
  if (/\b(?:npm|yarn|pnpm)\s+config\s+set\b/i.test(command)) implicitTargets.push('.npmrc');

  // F-23：证据目录的**删除**语义。`test-results/**` 对写入必须开放（运行器要落盘），
  // 故不能进 targets；单独收成 deletesEvidence 出口交由 Hook deny。
  // 注意：`extractShellPathCandidates` 只召回「含分隔符或带扩展名」的片段，**裸目录名**
  // `test-results` 不在其中——而 `rm -rf test-results` 恰恰是删掉全部证据的最短命令。
  // 故此处额外按裸 token 补一遍根目录，否则最危险的一条会从缝里漏过。
  const deletesEvidence = SHELL_DELETE_RE.test(command)
    ? [
        ...new Set(
          [
            ...parsedCandidates.filter((c) => isEvidenceArtifactPath(c)),
            ...(/(?:^|[\s"'/\\])test-results(?:[\s"'/\\]|$)/i.test(command) ? ['test-results'] : []),
          ].map((c) => normalizePath(c)),
        ),
      ]
    : [];

  const mutates =
    SHELL_MUTATION_RE.test(command) ||
    inlineEval ||
    vcsCheckout ||
    vcsOpaque ||
    pathSensitive ||
    deletesEvidence.length > 0;
  if (!mutates) return empty;

  const candidates = [...parsedCandidates, ...implicitTargets];
  const targets = [];
  const selfGoverned = [];
  for (const candidate of candidates) {
    const kind = classifyHarnessSelfGovernedPath(candidate);
    if (kind) {
      selfGoverned.push({ path: normalizePath(candidate), kind });
      continue;
    }
    if (
      isGatedDevPath(candidate) ||
      // F-01：docs 下的文档成果物必须收进 targets，否则 Shell 重定向改写
      // detail-design-spec.md 一类文件时角色↔路径判据整条失效（Write 通道会拒、
      // Shell 通道却放行）。process.md 由 isProcessFilePath 覆盖（R10 另有冻结判据）。
      isGatedDocArtifactPath(candidate) ||
      isProcessFilePath(candidate) ||
      isHarnessStatePath(candidate) ||
      isGatedArtifactsConfigPath(candidate)
    ) {
      targets.push(candidate);
    }
  }

  return {
    mutates: true,
    targets,
    selfGoverned,
    deletesEvidence,
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
