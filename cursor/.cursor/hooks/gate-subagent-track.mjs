#!/usr/bin/env node
/**
 * subagentStart Hook: records the top-level (root) conversation id (R5 mechanical
 * hardening, see the header comment above recordRootConversationId in
 * workflow-gate-lib.mjs). This hook only records; it never denies subagent
 * creation -- whether a subagent SHOULD be created is still decided by
 * gate-role-sequence (R13) and other hooks.
 *
 * Fail-open safety net (consistent with the other 5 hooks, see
 * `.cursor/harness/spec/mechanical-gates.md` section 8.4): if the lib fails to
 * load or an unexpected error occurs while recording, fail open (allow) so a
 * broken tracking hook never blocks subagent creation.
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
    // subagentStart's conversation_id is always the CALLER's session id.
    // The first-ever subagentStart in this framework is always the top-level
    // chat dispatching project-manager, so that value is exactly the root id.
    // recordRootConversationId only writes once (never overwrites), so no
    // extra guard is needed here even for later, nested subagentStart events.
    recordRootConversationId(input?.conversation_id);
    process.stdout.write(JSON.stringify({ permission: 'allow' }));
    process.exit(0);
  } catch (err) {
    failOpenAllow('runtime', err, lib);
  }
}

main();