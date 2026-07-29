#!/usr/bin/env node
/**
 * R13（需求 6）：成果物门禁链机械化 — preToolUse（Task）。
 *
 * 职责：在角色 Task 真正发起前，对 `.trae/harness/spec/gate-chain.md` 表格中
 * 客观可判定的前置条件（成果物是否存在、设计问题清单/质量报告是否有未解决项等）
 * 做机械校验，不满足则 deny——把原先仅靠 R8/文字约束的部分转为 Hook 强制。
 *
 * 与写入期门禁（gate-dev-workflow / gate-dev-shell）互为纵深防御：
 *   本 Hook 在 Task 发起前拦；写入期 Hook 在真正写入/执行前再拦一次。
 *
 * 判定顺序要点：
 *   1. R10 cancelled：除 project-manager 外一律拒绝（须先于「不在门禁表即放行」短路）；
 *   2. R5：凡能解析到角色名即 `recordDispatchedRole`（供写入期角色↔路径）；
 *   3. 不在 GATED_ROLES → fail-open 放行（PM/RA 是流程起点/无强前置）；
 *   4. `checkRoleDispatchGate(role)`（含 R19/R18/R15/R16/R20/R25 等，见 dispatch.mjs）。
 *
 * **R10 例外收敛**：历史上「不在门禁表即放行」被放在 cancelled 之前，导致
 * cancelled 后 PM/RA Task 仍被放行、与 AGENTS.md §5.19 冲突。现改为 cancelled 前置；
 * 保留 PM 例外作为逃生口——取消后须由 PM 引导建立新流程；活跃指针仍指向已冻结
 * process.md，PM 对该文件本身的写入仍被 gate-dev-workflow 的 R10 冻结拦死。
 *
 * **Trae 机制局限（已实测验证，2026-07-29）**：Trae 内置 "Agent" 通过 `description`
 * 匹配自动调用 Subagent，不经过 PreToolUse 的 `Task` 工具调用（实测确认：Task 调度
 * 本身不产生 PreToolUse 事件；但子代理内部工具调用如 Glob/Read 仍触发 PreToolUse，
 * agent_id 由 `solo_agent` 变为对应子代理类型）。因此本 Hook 的 `matcher: "Task"`
 * 在 Trae 中**不会触发**--R13 角色前置条件校验与 R5 角色记录（`recordDispatchedRole`）
 * 在 Trae 下**仅经手动 `gate-check.mjs role` 路径生效**（`gate-check.mjs` 以子进程
 * 调用本脚本，复用同一套判定与记录逻辑），由 AGENTS.md §5.1 R8 + gate-chain.md 表格
 * 覆盖；写入期门禁（gate-dev-workflow 的角色↔路径校验）仍提供纵深防御。保留 `Task`
 * matcher 是前瞻性设计：若 Trae 后续版本将 Subagent 调用暴露为 PreToolUse 事件，
 * 本 Hook 将自动生效。详见 `mechanical-gates.md` §8.4「门禁能力边界」。
 *
 * fail-open（§8.4；`hooks.json` 亦设 `failClosed: false`）：
 *   - lib 加载失败 / 未预期运行时异常；
 *   - 无法从 tool_input 解析出目标角色名；
 *   - 目标角色不在 GATED_ROLES（如 project-manager、requirements-analyst）。
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
 * 门禁自锁逃生：写 stderr（若有 err）、可选落盘、stdout 输出 allow 后退出。
 * Trae PreToolUse stdout 契约：
 * `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }`
 * @param {string} context
 * @param {unknown} [err]
 * @param {object} [lib]
 */
function failOpenAllow(context, err, lib) {
  if (err) {
    process.stderr.write(`[gate-role-sequence] fail-open (${context}): ${err?.message ?? err}\n`);
    try {
      lib?.recordFailOpenEvent?.('gate-role-sequence', context, err);
    } catch {
      /* 落盘失败不影响 fail-open 放行 */
    }
  }
  // Trae PreToolUse stdout 契约
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }));
  process.exit(0);
}

/**
 * 从 Task tool_input 中解析目标子代理角色名（兼容多种字段名）。
 * @param {object} input Trae Hook stdin JSON
 * @returns {string|null}
 */
function extractTargetRole(input) {
  const toolInput = input.tool_input ?? input.arguments ?? {};
  const candidates = [
    toolInput.subagent_type,
    toolInput.subagentType,
    toolInput.agent,
    toolInput.agent_type,
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
    deny,
    allow,
  } = lib;

  try {
    const input = await readStdinJsonAsync();
    const role = extractTargetRole(input);
    const slug = role ? normalizeRoleSlug(role) ?? role : null;

    // R10：已取消（不可逆冻结）的流程上，除 project-manager（引导新流程的逃生口）外
    // 禁止发起任何角色 Task——须先于「不在门禁表即放行」的短路执行。
    if (slug && slug !== 'project-manager' && isActiveProcessCancelled()) {
      deny(
        `流程门禁（R13）：发起 ${role} 前置条件未满足——该流程已被用户取消终止（不可逆，R10），除 project-manager 外不得再对其发起任何角色 Task；请由项目经理引导发起新流程/迭代。`,
        `AGENTS.md R13/gate-chain.md：该流程已被用户取消终止（不可逆，R10），除 project-manager 外不得再对其发起任何角色 Task；请由项目经理引导发起新流程/迭代。（reason=cancelled）`,
      );
      return;
    }

    // R5：凡能解析到角色名即落盘（含 project-manager / requirements-analyst），
    // 供写入期角色↔路径匹配；不依赖 Trae 子代理 session_id 回链。
    if (role) {
      try {
        recordDispatchedRole(normalizeRoleSlug(role) ?? role);
      } catch {
        /* 记录失败不阻断 Task（fail-open） */
      }
    }

    if (!role || !GATED_ROLES.has(role)) {
      failOpenAllow('not-gated-role');
      return;
    }

    const result = checkRoleDispatchGate(role);
    if (result.ok) {
      allow();
    }

    deny(
      `流程门禁（R13）：发起 ${role} 前置条件未满足——${result.message ?? result.reason}`,
      `AGENTS.md R13/gate-chain.md：${result.message ?? result.reason}（reason=${result.reason}）。请先完成对应前置成果物或分派，再重试发起该角色。`,
    );
  } catch (err) {
    failOpenAllow('runtime', err, lib);
  }
}

main();
