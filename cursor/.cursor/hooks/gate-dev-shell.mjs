#!/usr/bin/env node
/**
 * beforeShellExecution 门禁：无分派计划时，禁止项目初始化 / Tauri 构建命令。
 * 自锁防护（`.cursor/harness/spec/mechanical-gates.md` §8.4）：见 gate-dev-workflow.mjs 顶部注释，策略一致。
 */
function failOpenAllow(context, err, lib) {
  process.stderr.write(`[gate-dev-shell] fail-open (${context}): ${err?.message ?? err}\n`);
  try {
    lib?.recordFailOpenEvent?.('gate-dev-shell', context, err);
  } catch {
    /* 落盘失败不影响 fail-open 放行 */
  }
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
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

  const { allow, assertDevGateOrDeny, deny, isGatedShellCommand, isRootConversationCaller, readStdinJsonAsync } =
    lib;

  try {
    const input = await readStdinJsonAsync();
    const command = input.command ?? input.tool_input?.command ?? '';

    if (!isGatedShellCommand(command)) {
      allow();
    }

    // R5 机械化补强：同 gate-dev-workflow.mjs，见 workflow-gate-lib.mjs 的
    // isRootConversationCaller 顶部注释。顶层代理直接执行受门禁 Shell 命令时一律拒绝。
    if (isRootConversationCaller(input?.conversation_id)) {
      deny(
        '流程门禁（R5，机械化补强）：检测到本次 Shell 命令由顶层代理直接发起（conversation_id 与顶层会话一致），而非通过 Task 派发的子代理。受门禁 Shell 操作必须由对应子 agent（如 development-engineer / test-engineer）在 Task 内执行。',
        'AGENTS.md §5.1（R5）：顶层代理不得代行子角色职责，禁止直接执行受门禁 Shell 命令。请先经项目经理分派，再以 Task 发起对应子 agent 执行。',
      );
    }

    assertDevGateOrDeny();
    allow();
  } catch (err) {
    failOpenAllow('runtime', err, lib);
  }
}

main();
