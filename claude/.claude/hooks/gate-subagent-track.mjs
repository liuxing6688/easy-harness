#!/usr/bin/env node
/**
 * SubagentStart 门禁（R5 机械化补强）：仅记录顶层会话 id，从不 deny。
 *
 * 触发：`.claude/settings.json` → `SubagentStart`（matcher: `.*`）。
 * 职责：把「首次」SubagentStart 的**调用方**会话 id 落盘为顶层基准，供
 * gate-dev-workflow / gate-dev-shell 的 `isRootConversationCaller` 拦截顶层代写/代执行。
 *
 * 【本次改造：消除双份身份基准来源（B 方案 · 约束 3）】
 * 历史实现自带路径常量并手写 fs 落盘：
 *   - 写 `.claude/hooks/.root-session-id.json`，字段 `rootSessionId`；
 *   - 而 lib 的判据侧读 `ROOT_CONVERSATION_STATE`
 *     = `.claude/hooks/.root-conversation-id.json`，字段 `rootConversationId`。
 *   文件名与字段名**双双不一致** → lib 读到的基准永远不存在，
 *   `isRootConversationCaller` 恒为 false，顶层代写拦截静默永久失效。
 * 且手写版无条件覆盖 rootSessionId 之外的 subagents 数组，
 * 缺少 lib `recordRootConversationId` 的两项关键语义：
 *   - TTL 内不覆盖（防嵌套子代理把自己误写成顶层基准）；
 *   - 超 TTL 自愈覆盖（防跨会话陈旧值永久占位）。
 * 现改为直接复用 lib 的身份基准写入口，身份基准由此单一来源（见 lib/identity.mjs）。
 *
 * I/O 契约翻译（唯一需要改写的部分）：
 *   - 入参：Claude Code 的 SubagentStart 提供 `session_id`；
 *     lib/回归夹具沿用 `conversation_id`。二者取先有者，两个运行时都成立。
 *   - 出参：本 Hook 属 SubagentStart 事件，**不可**复用 lib 的 `allow()`
 *     （那是 PreToolUse 形状的 `hookSpecificOutput.permissionDecision`）。
 *     故保留本地 emitter，输出 SubagentStart 形状。
 *
 * fail-open（§8.4，与其余 Hook 一致）：lib 加载失败或记录期异常时仍放行，
 * 避免跟踪 Hook 故障阻断子代理创建（身份拦截随之降级，见 inspectIdentityBaseline 告警）。
 *
 * 共享判据：`./workflow-gate-lib.mjs`。
 */

/** SubagentStart 放行输出（该事件无 permissionDecision 语义）。 */
function emitAllow() {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SubagentStart' },
  }));
  process.exit(0);
}

/**
 * 门禁自锁逃生：写 stderr（若有 err）、可选落盘台账，再放行退出。
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
  emitAllow();
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
    // 调用方会话 id：首次落盘即顶层基准；后续嵌套事件由 lib 的 TTL 防覆盖保护。
    recordRootConversationId(input?.session_id ?? input?.conversation_id);
    emitAllow();
  } catch (err) {
    failOpenAllow('runtime', err, lib);
  }
}

main();
