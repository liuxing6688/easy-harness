#!/usr/bin/env node
/**
 * R13（需求 6）：成果物门禁链机械化 — preToolUse（Task）。
 *
 * 职责：在角色 Task 真正发起前，对 `.cursor/harness/spec/gate-chain.md` 表格中
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
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
}

/**
 * 从 Task tool_input 中解析目标子代理角色名（兼容多种字段名）。
 * @param {object} input Cursor Hook stdin JSON
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
  } = lib;

  /** @param {string} role @param {string} message @param {string} reason */
  function denyVerdict(role, message, reason) {
    process.stdout.write(
      JSON.stringify({
        permission: 'deny',
        user_message: `流程门禁（R13）：发起 ${role} 前置条件未满足——${message}`,
        agent_message: `AGENTS.md R13/gate-chain.md：${message}（reason=${reason}）。请先完成对应前置成果物或分派，再重试发起该角色。`,
      }),
    );
    process.exit(0);
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
    // 供写入期角色↔路径匹配；不依赖 Cursor 子代理 conversation_id 回链。
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
      process.stdout.write(JSON.stringify({ permission: 'allow' }));
      process.exit(0);
    }

    denyVerdict(role, result.message ?? result.reason, result.reason);
  } catch (err) {
    failOpenAllow('runtime', err, lib);
  }
}

main();
