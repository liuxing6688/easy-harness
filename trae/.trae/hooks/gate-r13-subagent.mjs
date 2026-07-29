#!/usr/bin/env node
/**
 * R13 自动门禁（matcher:"*"，基于 agent_id）。
 *
 * 背景：Trae 不把 Task 调用路由进 PreToolUse（2026-07-29 实测确认），故
 * gate-role-sequence.mjs（matcher:"Task"）在 Trae 下不触发。R13 角色前置
 * 校验与 recordDispatchedRole 仅经手动 gate-check role 路径生效。
 *
 * 本 Hook 利用实测发现的机制：子代理内部工具调用（Read/Write/Glob 等）会
 * 触发 PreToolUse，且 stdin 携带 agent_id（项目级角色子代理的 agent_id =
 * 角色 name，如 "development-engineer"）。据此，本 Hook 在子代理发起任意
 * 工具调用时自动执行 R13 校验与角色记录，**不再依赖手动 gate-check role**。
 *
 * 判定逻辑（与 gate-role-sequence.mjs 共用 workflow-gate-lib.mjs）：
 *   1. agent_id 缺失或 = "solo_agent" -> 快速放行（顶层代理，由其他门禁处理）
 *   2. agent_id 不在 GATED_ROLES -> 放行 + recordDispatchedRole（供 R21）
 *   3. R10 cancelled -> 拒绝（除 project-manager 外）
 *   4. R20 未确认轻量模式 -> 拒绝受门禁角色
 *   5. checkRoleDispatchGate -> 满足放行，不满足 deny（子代理无法执行任何工具）
 *
 * 性能：matcher:"*" 每次工具调用都触发，但短路设计（solo_agent / 非 GATED_ROLES
 * 快速 allow）使额外开销仅在受门禁角色子代理上产生，R13 检查是文件存在性，成本低。
 *
 * 与 gate-role-sequence.mjs 的关系：
 *   - gate-role-sequence（matcher:"Task"）：前瞻性保留，若 Trae 未来路由 Task
 *     进 PreToolUse 则自动生效；当前 Trae 下不触发。
 *   - 本 Hook（matcher:"*"）：Trae 下的实际生效路径，复用同一套判定逻辑。
 *   - 手动 gate-check role：仍作为兜底（alwaysApply 规则强制），但不再是唯一路径。
 *
 * fail-open（§8.4）：lib 加载失败 / 运行时异常 -> allow（防死锁）。
 *
 * 共享判据：`./workflow-gate-lib.mjs`。
 */

/** 受 R13 门禁链约束的角色；不在此集合内的角色走 fail-open（仍会落盘派发记录）。 */
const GATED_ROLES = new Set([
  'system-architect',
  'requirement-reviewer',
  'development-engineer',
  'quality-engineer',
  'test-engineer',
]);

/**
 * 门禁自锁逃生：写 stderr、可选落盘、stdout 输出 allow 后退出。
 * @param {string} context
 * @param {unknown} [err]
 * @param {object} [lib]
 */
function failOpenAllow(context, err, lib) {
  if (err) {
    process.stderr.write(`[gate-r13-subagent] fail-open (${context}): ${err?.message ?? err}\n`);
    try {
      lib?.recordFailOpenEvent?.('gate-r13-subagent', context, err);
    } catch {
      /* 落盘失败不影响 fail-open 放行 */
    }
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }));
  process.exit(0);
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
    deny,
    allow,
  } = lib;

  try {
    const input = await readStdinJsonAsync();
    const agentId = input?.agent_id;

    // 顶层代理或缺失 agent_id -> 快速放行（顶层由 gate-dev-workflow/gate-dev-shell 处理）
    if (!agentId || typeof agentId !== 'string' || agentId === 'solo_agent') {
      allow();
    }

    const slug = normalizeRoleSlug(agentId) ?? agentId;

    // R5：凡能解析到角色名即落盘（含 project-manager / requirements-analyst），
    // 供写入期角色↔路径匹配。这是本 Hook 的关键价值：自动记录角色，不再依赖手动 gate-check。
    try {
      recordDispatchedRole(slug);
    } catch {
      /* 记录失败不阻断工具调用（fail-open） */
    }

    // 不在门禁表 -> fail-open 放行（PM/RA 是流程起点/无强前置）
    if (!GATED_ROLES.has(slug)) {
      allow();
    }

    // R10：已取消（不可逆冻结）的流程上，除 project-manager 外禁止任何角色活动
    if (slug !== 'project-manager' && isActiveProcessCancelled()) {
      deny(
        `流程门禁（R13）：子代理 ${agentId} 试图执行工具，但该流程已被用户取消终止（不可逆，R10），除 project-manager 外不得再在其上推进任何工作；请由项目经理引导发起新流程/迭代。`,
        `AGENTS.md R13/gate-chain.md：该流程已被用户取消终止（不可逆，R10），除 project-manager 外不得再对其发起任何角色 Task；请由项目经理引导发起新流程/迭代。（reason=cancelled）`,
      );
    }

    // R13：角色前置成果物校验
    const result = checkRoleDispatchGate(slug);
    if (result.ok) {
      allow();
    }

    deny(
      `流程门禁（R13）：子代理 ${agentId} 试图执行工具，但发起该角色的前置条件未满足--${result.message ?? result.reason}`,
      `AGENTS.md R13/gate-chain.md：${result.message ?? result.reason}（reason=${result.reason}）。请先完成对应前置成果物或分派，再重新派发该角色。`,
    );
  } catch (err) {
    failOpenAllow('runtime', err, lib);
  }
}

main();
