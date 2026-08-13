#!/usr/bin/env node
/**
 * PreToolUse 门禁（Write / Edit / NotebookEdit）——薄适配器 + auto 模式加固。
 *
 * 本文件是**唯一生效**的写文件门禁入口（`.claude/settings.json` → PreToolUse `Write|Edit`），
 * 同时也是 `gate-scenarios.mjs` 的 `hook: 'write'` 目标（见 `_harness.mjs` 的 HOOK_FILES）。
 * 生效路径与被测路径合一，故场景计数即真实覆盖。
 *
 * 职责边界（照搬 cursor/.cursor/hooks/gate-dev-workflow.mjs，只翻译 I/O 契约）：
 *   - **判据一律来自** `./workflow-gate-lib.mjs`（实现按域拆在 `./lib/`）。本文件不得自带
 *     任何判据实现——历史骨架版曾以 `isGatedDevPath(){return true}` 等桩函数「简化示例」，
 *     使生效门禁既拒绝一切顶层写入又对其余写入全部盖章放行，且不被任何回归覆盖。
 *   - 本文件只做三件事：解析工具入参里的写入目标、按序调用判据、把裁决翻译成官方契约。
 *
 * 判定顺序（命中即 deny；说明权威见 harness/spec/mechanical-gates.md §8.1）：
 *   R10 cancelled → R29 自治资产 → R5 身份基准告警 → R5 顶层调用者
 *   → R5 角色↔路径 →（仅源码路径，排除 e2e）分派计划 + R3/R9/阻塞 → allow
 *
 * I/O 契约翻译（Cursor → Claude Code，见 https://code.claude.com/docs/en/hooks）：
 *   - 裁决出口：`hookSpecificOutput.permissionDecision`（allow/deny/ask）+
 *     `permissionDecisionReason`，退出码 0。lib 的 `allow/deny/ask` 已统一输出该形状，
 *     故 lib 内部自裁决（如 `assertDevGateOrDeny`）与本文件出口形状一致。
 *   - **沉默不等于放行**：exit 0 且无输出＝无裁决、走正常权限流，故 fail-closed 须显式 deny。
 *   - 调用者身份：Cursor 用 `conversation_id`（每个子代理各自一份）；Claude Code 的
 *     `session_id` 在子代理间**共享**，不能用作判别，`agent_id` 则**仅在子代理内出现**。
 *     故取 `agent_id ?? conversation_id ?? session_id`：子代理内取到 agent_id（≠ 顶层基准）
 *     自然放行；顶层调用取到 session_id，正是 gate-subagent-track 落盘的基准值。
 *
 * auto 模式加固（permission-mode-guard.mjs，R1 风险）：
 *   `permission_mode: 'auto'` 会自动批准 ask，使「须用户确认」的门禁静默退化。故本文件所有
 *   自有出口都经 `hardenDecisionForAutoMode` 过一遍：critical/high 的 ask 升级为 deny，
 *   deny 附加模式提示。非 auto 模式下该函数是恒等透传，不影响既有判定。
 *
 * 自锁防护（§8.4 / R36）：**lib 加载失败** fail-open 放行（门禁整体损坏时不锁死项目）；
 * **判定期异常**默认 fail-closed → deny，仅当本次调用整体就是对活跃 `process.md` 的直接
 * 写入时才走修复通道例外（`resolveGateRepairPaths`），避免留下只能手工编辑的死局。
 */

import fs from 'fs';
import path from 'path';

import {
  isAutoPermissionMode,
  hardenDecisionForAutoMode,
  assessCriticality,
} from './lib/permission-mode-guard.mjs';

const HOOK_NAME = 'gate-dev-workflow-enhanced';

/**
 * 官方 PreToolUse 裁决出口。
 * @param {'allow'|'deny'|'ask'} decision
 * @param {string} [reason] 给用户看的裁决理由 → permissionDecisionReason
 * @param {string} [additionalContext] 给模型看的下一步指引 → additionalContext
 */
function emit(decision, reason, additionalContext) {
  const hookSpecificOutput = {
    hookEventName: 'PreToolUse',
    permissionDecision: decision,
  };
  if (reason) hookSpecificOutput.permissionDecisionReason = reason;
  if (additionalContext) hookSpecificOutput.additionalContext = additionalContext;
  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
  process.exit(0);
}

/**
 * 经 auto 模式加固后再出口。ruleId 决定严重程度（assessCriticality）。
 * @param {object} hookInput
 * @param {'allow'|'deny'|'ask'} decision
 * @param {string} reason
 * @param {string} [agentMessage] 判据给出的「怎么做」，与 guard 提示合并进 additionalContext
 * @param {string|null} [ruleId]
 */
function emitHardened(hookInput, decision, reason, agentMessage, ruleId = null) {
  const hardened = hardenDecisionForAutoMode(
    hookInput,
    decision,
    reason,
    assessCriticality(ruleId, null),
  );
  // 判据文案优先在前：场景断言的 mustInclude 片段大多出自判据，guard 提示是附加说明。
  const context = [agentMessage, hardened.additionalContext].filter(Boolean).join('\n\n');
  emit(hardened.decision, hardened.reason, context || undefined);
}

/**
 * 门禁自锁逃生：lib 加载失败等「门禁自身坏了」的场景 fail-open 放行。
 * @param {string} context
 * @param {unknown} err
 * @param {object} [lib]
 */
function failOpenAllow(context, err, lib) {
  process.stderr.write(`[${HOOK_NAME}] fail-open (${context}): ${err?.message ?? err}\n`);
  try {
    lib?.recordFailOpenEvent?.(HOOK_NAME, context, err);
  } catch {
    /* 落盘失败不影响 fail-open 放行 */
  }
  emit('allow');
}

/**
 * R36：判定期异常 fail-closed。裁决形状由 lib 的 buildGateExceptionVerdict 决定
 * （write 通道在 repairPaths 非空时例外放行，防「代理无法自愈」死局）。
 * @param {string} context
 * @param {unknown} err
 * @param {object} lib
 * @param {string[]} repairPaths
 */
function failClosedDeny(context, err, lib, repairPaths = []) {
  process.stderr.write(`[${HOOK_NAME}] fail-closed (${context}): ${err?.message ?? err}\n`);
  try {
    lib?.recordFailOpenEvent?.(HOOK_NAME, context, err);
  } catch {
    /* 落盘失败不影响本次判定 */
  }
  const { verdict, output } = lib.buildGateExceptionVerdict({
    hook: HOOK_NAME,
    context,
    err,
    channel: 'write',
    repairPaths,
  });
  if (verdict === 'allow') {
    process.stderr.write(
      `[${HOOK_NAME}] fail-closed 例外放行（流程文件修复通道）：${repairPaths.join(', ')}\n`,
    );
  }
  // buildGateExceptionVerdict 返回的 output 是**历史契约形状**
  // （{permission, user_message, agent_message}）——gate-selftest 的 R36 用例正是
  // 按该形状断言（`output.permission === 'deny'`），故 lib 侧必须保持不变。
  // 官方契约的翻译只在本 Hook 的出口边界做：verdict → permissionDecision，
  // user_message → permissionDecisionReason，agent_message → additionalContext。
  // 注意此处刻意不过 guard：本函数已在异常处置路径上，guard 读 hookInput.permission_mode，
  // 而「输入解析失败」恰是常见成因，再引入一次取值风险会把 fail-closed 变成崩溃。
  const decision = verdict === 'allow' ? 'allow' : verdict === 'ask' ? 'ask' : 'deny';
  emit(decision, output?.user_message, output?.agent_message);
}

/**
 * 从 ApplyPatch 文本中提取 `*** Add|Update|Delete File:` 目标路径。
 * @param {unknown} text
 * @returns {string[]}
 */
function extractPatchPaths(text) {
  if (typeof text !== 'string') return [];
  const paths = [];
  const re = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
  let match;
  while ((match = re.exec(text)) !== null) {
    paths.push(match[1].trim());
  }
  return paths;
}

/**
 * 直接路径字段（工具参数明写的写入目标）。
 *
 * 与内容里解析出来的路径分开返回：前者是平台交给 Hook 的事实，后者是代理可以随手编造的
 * 文本。收紧判据两者都看，**放松判据**（R36 修复例外）只认前者。
 * @param {unknown} value
 * @returns {string[]}
 */
function extractDirectToolPaths(value) {
  if (!value || typeof value === 'string') return [];
  const directFields = ['file_path', 'path', 'target_file', 'notebook_path', 'target_notebook'];
  const paths = [];
  for (const field of directFields) {
    if (typeof value[field] === 'string') paths.push(value[field]);
  }
  return paths;
}

/**
 * 从嵌套的 patch/diff/content 文本中解析出的写入目标。
 * @param {unknown} value
 * @returns {string[]}
 */
function extractContentToolPaths(value) {
  if (!value) return [];
  if (typeof value === 'string') return extractPatchPaths(value);
  const paths = [];
  for (const field of ['patch', 'diff', 'content', 'input', 'new_string']) {
    paths.push(...extractPatchPaths(value[field]));
  }
  return paths;
}

/**
 * auto 模式使用审计。失败不影响判定。
 * @param {object} hook
 * @param {object} [lib]
 */
function logAutoModeUsage(hook, lib) {
  try {
    const root = lib?.PROJECT_ROOT ?? process.cwd();
    const logPath = path.join(root, '.claude/harness-state/auto-mode-audit.jsonl');
    const entry = {
      timestamp: new Date().toISOString(),
      hook: HOOK_NAME,
      sessionId: hook.session_id,
      agentId: hook.agent_id,
      toolName: hook.tool_name,
      targetPath: hook.tool_input?.file_path,
    };
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    // 审计写入失败只写 stderr（stdout 被裁决契约独占，混入非 JSON 会污染裁决）
    process.stderr.write(`[${HOOK_NAME}] audit log failed: ${err?.message ?? err}\n`);
  }
}

async function main() {
  let lib;
  try {
    lib = await import('./workflow-gate-lib.mjs');
  } catch (err) {
    failOpenAllow('lib-load', err);
    return;
  }

  const {
    assertDevGateOrDeny,
    checkRolePathPermission,
    classifyHarnessSelfGovernedPath,
    harnessSelfGovernedVerdict,
    inspectIdentityBaseline,
    isCancelledProcessFile,
    isGatedDevPath,
    isE2eTestPath,
    isGatedRoleArtifactPath,
    isRootConversationCaller,
    normalizePath,
    readStdinJsonAsync,
    recordIdentityBaselineNotice,
  } = lib;

  // R36：判定期异常的兜底例外——须在 try 之外声明，异常时才拿得到。
  let repairPaths = [];

  try {
    const input = await readStdinJsonAsync();
    const toolInput = input.tool_input ?? input.arguments ?? {};

    if (isAutoPermissionMode(input)) logAutoModeUsage(input, lib);

    const directPaths = extractDirectToolPaths(toolInput);
    const filePaths = [...directPaths, ...extractContentToolPaths(toolInput)];
    try {
      repairPaths = lib.resolveGateRepairPaths({
        toolName: input.tool_name ?? input.toolName,
        directPaths,
        allPaths: filePaths,
      });
    } catch {
      /* 路径判定本身失败时不给例外，走正常 fail-closed */
    }

    // 无写入目标（如仅改内容而工具未给路径）：无判据可用，交回正常权限流。
    if (filePaths.length === 0) emit('allow');

    // R10：已取消（不可逆）的 process.md 一律冻结，优先于其余判定。
    for (const filePath of filePaths) {
      if (isCancelledProcessFile(filePath)) {
        emitHardened(
          input,
          'deny',
          '流程门禁（R10）：该 process.md 已被用户取消终止（不可逆），禁止任何后续写入/修改/删除。',
          'CLAUDE.md R10：cancelled: true 的 process.md 永久冻结，任何角色（含 project-manager）均不得再修改。如需继续工作，请发起新的流程/迭代（新的 process.md）。',
          'R10',
        );
      }
    }

    // R29：门禁自治资产优先于其余判定——运行时标记、授权凭证与门禁配置/权威文本
    // 一律禁止由代理写入。这些路径刻意不在 isGatedDevPath 之内，故须在 gatedPaths
    // 过滤之前单独裁决。此处不用 ask：auto 模式会自动批准 ask，保护会静默退化。
    for (const filePath of filePaths) {
      const kind = classifyHarnessSelfGovernedPath(filePath);
      if (!kind) continue;
      const verdict = harnessSelfGovernedVerdict(kind, normalizePath(filePath));
      emitHardened(input, 'deny', verdict.userMessage, verdict.agentMessage, 'R29');
    }

    // 仅对受门禁路径继续；其余路径直接放行（避免无关写入触发 R5/分派计划）。
    const gatedPaths = filePaths.filter(
      (filePath) => isGatedDevPath(filePath) || isGatedRoleArtifactPath(filePath),
    );
    if (gatedPaths.length === 0) emit('allow');

    // 调用者身份：见文件头「I/O 契约翻译」。agent_id 仅在子代理内出现，故优先。
    const callerId = input?.agent_id ?? input?.conversation_id ?? input?.session_id;

    // R5 加强：身份判据降级时不再静默——写 stderr 告警并在 process.md 留一次性非阻塞提醒。
    const baseline = inspectIdentityBaseline(callerId);
    if (!baseline.healthy) {
      process.stderr.write(
        `[${HOOK_NAME}] R5 identity degraded (${baseline.reason}): 顶层代写拦截本次不生效，仅靠文字约束兜底\n`,
      );
      if (baseline.shouldNotify) {
        try {
          recordIdentityBaselineNotice(baseline.reason);
        } catch {
          /* 提醒写入失败不影响本次判定 */
        }
      }
    }

    // R5：顶层代理亲自写受门禁路径（源码或角色文档成果物）一律拒绝。
    if (isRootConversationCaller(callerId)) {
      emitHardened(
        input,
        'deny',
        '流程门禁（R5，机械化补强）：检测到本次写入由顶层代理直接发起（调用者身份与顶层会话一致），而非通过 Agent 派发的子代理。受门禁路径必须由对应子 agent 在 Agent 调用内执行。',
        'CLAUDE.md §5.1（R5）：顶层代理不得代行子角色职责，禁止直接编写受门禁路径。请先经项目经理分派，再以 Agent 工具发起对应子 agent 完成该写入。',
        'R5',
      );
    }

    // R5：角色↔路径匹配（含 docs 成果物；源码须 DE 活跃）。
    // F-01（2026-08-11 审核修复）：传入调用者角色——payload 的 agent_type 在子代理上下文里可用，
    // 历史实现从未消费，导致判据退化为「期望角色在活跃并集里即放行」而对文档成果物实际失效。
    const callerRole = input?.agent_type ?? input?.agentType ?? null;
    for (const filePath of gatedPaths) {
      const roleCheck = checkRolePathPermission(filePath, { callerRole });
      if (!roleCheck.ok) {
        const detail = roleCheck.message ?? roleCheck.reason;
        emitHardened(
          input,
          'deny',
          `流程门禁（R5，角色路径）：${detail}`,
          `CLAUDE.md §5.1（R5）：${detail}。请确认 process.md 分派/进度中的活跃角色与写入路径匹配，并由对应子 agent 执行。`,
          'R21',
        );
      }
    }

    // 受门禁开发路径的流程前置。命中时 assertDevGateOrDeny 内部自行 deny 并退出（形状同源）。
    //
    // 分两层（2026-08-11 审核修复 F-18/F-19）：`e2e/**` 期望 TE、不经 DE 开发分派，故只跳过
    // **DE 专属**前置（分派计划 / R37 增量前置 / R9 hotfix 前置）；R10 取消冻结、docs-only
    // 禁写源码、R3 四件成果物、blocking 属**通用**前置，对 e2e 同样成立。历史实现把两层
    // 合成一个判断，导致 e2e/** 上 R10「永久冻结」与 blocking 双双失效。
    const gatedDevPaths = filePaths.filter((filePath) => isGatedDevPath(filePath));
    if (gatedDevPaths.length > 0) {
      assertDevGateOrDeny({
        includeDeSpecific: gatedDevPaths.some((filePath) => !isE2eTestPath(filePath)),
      });
    }

    emit('allow');
  } catch (err) {
    // R36：判定期异常默认 fail-closed；lib 加载失败仍走上方 failOpenAllow。
    if (lib.getGateExceptionPolicy?.().failClosed) {
      failClosedDeny('runtime', err, lib, repairPaths);
    }
    failOpenAllow('runtime', err, lib);
  }
}

main();
