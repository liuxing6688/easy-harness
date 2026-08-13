#!/usr/bin/env node
/**
 * PreToolUse 门禁（Agent / Task）：R13 成果物门禁链机械化。
 *
 * 移植自 `cursor/.cursor/hooks/gate-role-sequence.mjs`（B 方案）。本文件是**薄适配器**：
 * 判据一律复用 `./workflow-gate-lib.mjs`，此处只做三件事——
 *   1. 读 stdin、解析目标角色名；
 *   2. 按官方 PreToolUse 契约出口（`hookSpecificOutput.permissionDecision`）；
 *   3. 自锁逃生（fail-open / R36 fail-closed）。
 * **请勿在本文件写判据逻辑**；行为变更请改 `./lib/dispatch.mjs` 等域文件，
 * 并跑 `node .claude/scripts/gate-selftest.mjs` 与 `node .claude/scripts/gate-scenarios.mjs`。
 *
 * 判定顺序（与 Cursor 版同源，说明权威见 harness/spec/mechanical-gates.md）：
 *   R10 cancelled（PM 例外）→ R5 recordDispatchedRole → 不在门禁表即放行
 *   → checkRoleDispatchGate（含 R19/R18/R15/R16/R20/R25 等）
 *
 * Claude Code 契约翻译（与 Cursor 版的唯一差异）：
 *   - 出口：`{permission:'allow'}` → `hookSpecificOutput.permissionDecision`；
 *     `user_message` → `permissionDecisionReason`，`agent_message` → `additionalContext`。
 *   - 角色字段：Claude Code 的 Agent/Task 工具用 `subagent_type`，回归脚手架用 `agentType`（驼峰）。
 *     二者都须认——只认 Cursor 的候选名会解析不到角色，静默走 fail-open 并跳过
 *     `recordDispatchedRole`，使写入期的 R5 角色↔路径判据永远拿不到活跃角色。
 *   - 注意 exit 0 且无输出＝无裁决（走正常权限流），**沉默不等于放行**，故放行也须显式 allow。
 *
 * fail-open（§8.4）：lib 加载失败、解析不到角色名、角色不在 GATED_ROLES（PM/RA 是流程起点）。
 * R36：**判定期异常**默认 fail-closed（deny），否则「让判定逻辑抛异常」即可跳过整条 R13 链。
 */

/** 受 R13 门禁链约束的角色；不在此集合内的角色走 fail-open（仍会落盘派发记录）。 */
const GATED_ROLES = new Set([
  'system-architect',
  'requirement-reviewer',
  'development-engineer',
  'quality-engineer',
  'test-engineer',
]);

const HOOK_NAME = 'gate-role-sequence';

/**
 * 官方 PreToolUse 裁决出口。
 * @param {'allow'|'deny'|'ask'} decision
 * @param {string} [reason] 给用户看的裁决理由 → permissionDecisionReason
 * @param {string} [additionalContext] 给模型看的下一步指引 → additionalContext
 */
function emit(decision, reason, additionalContext) {
  const hookSpecificOutput = { hookEventName: 'PreToolUse', permissionDecision: decision };
  if (reason) hookSpecificOutput.permissionDecisionReason = reason;
  if (additionalContext) hookSpecificOutput.additionalContext = additionalContext;
  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
  process.exit(0);
}

/**
 * 门禁自锁逃生：门禁自身坏了（lib 加载失败 / 解析不到角色）时放行，避免锁死项目。
 * @param {string} context
 * @param {unknown} [err]
 * @param {object} [lib]
 */
function failOpenAllow(context, err, lib) {
  if (err) {
    process.stderr.write(`[${HOOK_NAME}] fail-open (${context}): ${err?.message ?? err}\n`);
    try {
      lib?.recordFailOpenEvent?.(HOOK_NAME, context, err);
    } catch {
      /* 落盘失败不影响 fail-open 放行 */
    }
  }
  emit('allow');
}

/**
 * 从 Task/Agent tool_input 中解析目标子代理角色名（兼容多种字段名）。
 *
 * `agentType` 为 Claude Code / 回归脚手架所用的驼峰字段，须与 Cursor 的候选名并列，
 * 否则解析失败会使本 Hook 静默降级为 fail-open。
 * @param {object} input
 * @returns {string|null}
 */
function extractTargetRole(input) {
  const toolInput = input.tool_input ?? input.arguments ?? {};
  const candidates = [
    toolInput.subagent_type,
    toolInput.subagentType,
    toolInput.agentType,
    toolInput.agent_type,
    toolInput.agent,
    toolInput.role,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
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
    readStdinJsonAsync,
    checkRoleDispatchGate,
    recordDispatchedRole,
    normalizeRoleSlug,
    isActiveProcessCancelled,
  } = lib;

  /**
   * R13 拒绝出口：判据文案入 reason，「怎么做」入 additionalContext。
   * @param {string} role @param {string} message @param {string} reason
   */
  function denyVerdict(role, message, reason) {
    emit(
      'deny',
      `流程门禁（R13）：发起 ${role} 前置条件未满足——${message}`,
      `CLAUDE.md R13/gate-chain.md：${message}（reason=${reason}）。请先完成对应前置成果物或分派，再重试发起该角色。`,
    );
  }

  try {
    const input = await readStdinJsonAsync();
    const role = extractTargetRole(input);
    const slug = role ? normalizeRoleSlug(role) ?? role : null;

    // R10：已取消（不可逆冻结）的流程上，除 project-manager（引导新流程的逃生口）外
    // 禁止发起任何角色 Task——须先于「不在门禁表即放行」的短路执行。
    if (slug && slug !== 'project-manager' && isActiveProcessCancelled()) {
      denyVerdict(
        role,
        '该流程已被用户取消终止（不可逆，R10），除 project-manager 外不得再对其发起任何角色 Task；请由项目经理引导发起新流程/迭代。',
        'cancelled',
      );
      return;
    }

    // R5：凡能解析到角色名即落盘（含 project-manager / requirements-analyst），
    // 供写入期角色↔路径匹配使用。
    if (role) {
      try {
        recordDispatchedRole(slug);
      } catch {
        /* 记录失败不阻断 Task（fail-open） */
      }
    }

    // 须用归一化后的 slug 判定：Task 若以中文角色名（「开发工程师」）或别名发起，
    // 用原始字符串查表会命中 fail-open 分支，把整条 R13 门禁链静默跳过。
    if (!slug || !GATED_ROLES.has(slug)) {
      failOpenAllow('not-gated-role');
      return;
    }

    const result = checkRoleDispatchGate(slug);
    if (result.ok) {
      emit('allow');
      return;
    }

    denyVerdict(role, result.message ?? result.reason, result.reason);
  } catch (err) {
    // R36：判定期异常默认 fail-closed。本 Hook 拦的是「发起角色 Task」，deny 代价最小
    // （PM 仍可继续维护 process.md 修复问题）。
    if (lib.getGateExceptionPolicy?.().failClosed) {
      process.stderr.write(`[${HOOK_NAME}] fail-closed (runtime): ${err?.message ?? err}\n`);
      try {
        lib.recordFailOpenEvent?.(HOOK_NAME, 'runtime', err);
      } catch {
        /* 落盘失败不影响本次判定 */
      }
      // buildGateExceptionVerdict 回传的是**旧形状**（{permission,user_message,agent_message}），
      // 那是 gate-selftest 的断言契约（r36-gate-exception.mjs），须保持不变；
      // 故在此出口翻译成官方形状，切勿直接透出 output。
      const { verdict, output } = lib.buildGateExceptionVerdict({
        hook: HOOK_NAME,
        context: 'runtime',
        err,
        channel: 'task',
      });
      emit(verdict, output?.user_message, output?.agent_message);
      return;
    }
    failOpenAllow('runtime', err, lib);
  }
}

main();
