#!/usr/bin/env node
/**
 * SessionStart Hook: records the top-level (root) session id (R5 mechanical
 * hardening, see the header comment above recordRootConversationId in
 * workflow-gate-lib.mjs). This hook only records; it never denies session
 * creation -- whether a subagent SHOULD be created is still decided by
 * gate-role-sequence (R13) and other hooks.
 *
 * Trae 没有 SubagentStart 事件；`source: "startup"` 表明 SessionStart 仅在新建会话时
 * 触发，子代理 Task 不触发 SessionStart。本 Hook 采用双源记录根会话 ID：
 * 1. `$TRAE_ENV_FILE`（P2-2/P2-3 修复，主源）：写入 `ROOT_SESSION_ID=<session_id>`，
 *    会话级隔离，后续 PreToolUse/Stop Hook 与 RunCommand 可读，跨会话不陈旧。
 * 2. `.root-conversation-id.json`（兜底，first-write-wins）：供无 env 的子代理会话等场景。
 *
 * Fail-open safety net (consistent with the other 5 hooks, see
 * `.trae/harness/spec/mechanical-gates.md` section 8.4): if the lib fails to
 * load or an unexpected error occurs while recording, fail open (allow) so a
 * broken tracking hook never blocks session creation.
 */
function failOpenAllow(context, err, lib) {
  if (err) {
    process.stderr.write(`[gate-subagent-track] fail-open (${context}): ${err?.message ?? err}\n`);
    try {
      lib?.recordFailOpenEvent?.('gate-subagent-track', context, err);
    } catch {
      /* logging failure must not affect fail-open allow */
    }
  }
  // Trae SessionStart：空 JSON 即放行
  process.stdout.write(JSON.stringify({}));
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

  const { readStdinJsonAsync, recordRootConversationId, writeRootSessionIdToEnvFile } = lib;

  try {
    const input = await readStdinJsonAsync();
    const sessionId = input?.session_id;
    // Trae SessionStart 的 session_id 即为当前会话 ID（根 ID）。
    // 1. 写入 $TRAE_ENV_FILE（主源，会话级隔离，修复跨会话陈旧 bug）
    writeRootSessionIdToEnvFile(sessionId);
    // 2. 写入持久化文件（兜底，first-write-wins，供无 env 的子代理会话等场景）
    recordRootConversationId(sessionId);
    process.stdout.write(JSON.stringify({}));
    process.exit(0);
  } catch (err) {
    failOpenAllow('runtime', err, lib);
  }
}

main();
