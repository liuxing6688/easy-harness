#!/usr/bin/env node
/**
 * Codex SubagentStart 记录钩子（R5 机械化补强）：仅记录父 session id，从不 deny。
 *
 * 触发：`hooks.json` → `SubagentStart`。
 * 职责：把「首次」SubagentStart 的父会话 id 落盘为顶层基准
 * （`.harness/.root-conversation-id.json`），供 gate-dev-workflow /
 * gate-dev-shell 的 `isRootConversationCaller` 拦截顶层代写/代执行。
 *
 * 重要语义（见 identity.mjs / mechanical-gates.md §8.5）：
 *   - Codex 的 SubagentStart payload 以 `session_id` 表示父会话；
 *   - 框架内第一次 SubagentStart 通常是顶层聊天派发 project-manager，该值即 root id；
 *   - `recordRootConversationId`：TTL 内不覆盖（防嵌套子代理误写），超 TTL 自愈覆盖；
 *   - 本 Hook **只记录、不裁决**——是否允许创建子代理仍由 gate-role-sequence（R13）等决定。
 *
 * fail-open（§8.4，与其余 Hook 一致）：lib 加载失败或记录期未预期异常时仍 allow，
 * 避免跟踪 Hook 故障阻断子代理创建（身份拦截会随之降级，见 inspectIdentityBaseline 告警）。
 *
 * 共享判据：`./workflow-gate-lib.mjs`。
 */
/**
 * 门禁自锁逃生：写 stderr（若有 err）、可选落盘、stdout 输出 allow 后退出。
 * @param {string} context
 * @param {unknown} [err]
 * @param {object} [lib]
 */
function failOpenAllow(context, err, lib) {
  if (err) {
    process.stderr.write(`[gate-subagent-track] fail-open (${context}): ${err?.message ?? err}\n`);
    try {
      lib?.recordFailOpenEvent?.('gate-subagent-track', context, err);
    } catch {
      /* 落盘失败不影响 fail-open 放行 */
    }
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

  const { readStdinJsonAsync, recordRootConversationId } = lib;

  try {
    const input = await readStdinJsonAsync();
    // conversation_id = 调用方会话；首次落盘即顶层基准；后续嵌套事件由 TTL 防覆盖保护。
    recordRootConversationId(input?.conversation_id);
    process.stdout.write(JSON.stringify({ permission: 'allow' }));
    process.exit(0);
  } catch (err) {
    failOpenAllow('runtime', err, lib);
  }
}

main();
