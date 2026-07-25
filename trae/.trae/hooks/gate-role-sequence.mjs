#!/usr/bin/env node
/**
 * R13（需求 6）：成果物门禁链机械化。
 *
 * 拦截 Task 工具调用，在角色 Task 真正发起前，对 `.trae/harness/spec/gate-chain.md` 门禁链表格中
 * 客观可判定的前置条件（成果物文件是否存在、设计问题清单/质量报告表格是否有
 * 未解决项等）做机械校验，不满足则 deny——把原先仅靠 R8/gate-chain.md 文字约束的部分
 * 转为 Hook 强制，减少对文字规则可靠性的依赖。
 *
 * **Trae 机制局限（坦诚披露）**：Trae 内置 "Agent" 通过 `description` 匹配自动调用
 * Subagent，不经过 PreToolUse 的 `Task` 工具调用。因此本 Hook 的 `matcher: "Task"`
 * 在 Trae 中**可能不会触发**——R13 角色前置条件校验在 Trae 下退化为文字约束
 * （由 AGENTS.md §5.1 R8 + gate-chain.md 表格覆盖），写入期门禁
 * （gate-dev-workflow 的角色↔路径校验）仍提供纵深防御。保留 `Task` matcher 是
 * 前瞻性设计：若 Trae 后续版本将 Subagent 调用暴露为 PreToolUse 事件，本 Hook
 * 将自动生效。详见 `mechanical-gates.md` §8.4「门禁能力边界」。
 *
 * fail-open 兜底（`.trae/harness/spec/mechanical-gates.md` §8.4）：
 * - workflow-gate-lib.mjs 动态加载失败或执行期出现未预期异常时放行；
 * - 无法从 tool_input 中解析出目标角色名时放行；
 * - 目标角色不在 ROLE_GATE_TABLE 中（如 project-manager、requirements-analyst，
 *   二者是流程起点/无强前置）时放行。
 *
 * 本 Hook 与写入期机械门禁（gate-dev-workflow / gate-dev-shell）互为纵深防御：
 * 本 Hook 在 Task 发起前拦，写入期 Hook 在真正写入/执行前再拦一次。
 */
const GATED_ROLES = new Set([
  'system-architect',
  'requirement-reviewer',
  'development-engineer',
  'quality-engineer',
  'test-engineer',
]);

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

  const { readStdinJsonAsync, checkRoleDispatchGate, recordDispatchedRole, normalizeRoleSlug, allow, deny } =
    lib;

  try {
    const input = await readStdinJsonAsync();
    const role = extractTargetRole(input);

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
      `流程门禁（R13）：发起 ${role} 前置条件未满足--${result.message ?? result.reason}`,
      `AGENTS.md R13/gate-chain.md：${result.message ?? result.reason}（reason=${result.reason}）。请先完成对应前置成果物或分派，再重试发起该角色。`,
    );
  } catch (err) {
    failOpenAllow('runtime', err, lib);
  }
}

main();

