import path from 'node:path';

const ROLE_NAMES = new Set([
  'project-manager',
  'requirements-analyst',
  'system-architect',
  'requirement-reviewer',
  'development-engineer',
  'quality-engineer',
  'test-engineer',
]);

/** Resolve the workspace governed by a Codex hook invocation. */
export function resolveHookProjectRoot(input = {}, fallbackCwd = process.cwd()) {
  const candidate = input?.cwd;
  if (typeof candidate === 'string' && candidate.trim()) {
    return path.resolve(candidate.trim());
  }
  return path.resolve(fallbackCwd);
}

function normalizeRole(value) {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().replaceAll('_', '-');
  return ROLE_NAMES.has(normalized) ? normalized : value.trim();
}

export function normalizeCodexInput(mode, input = {}) {
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const normalized = { ...input, tool_input: { ...toolInput } };

  if (mode === 'write') {
    normalized.tool_name = 'ApplyPatch';
    if (typeof toolInput.command === 'string' && typeof normalized.tool_input.patch !== 'string') {
      normalized.tool_input.patch = toolInput.command;
    }
  } else if (mode === 'role') {
    normalized.tool_name = 'Task';
    const role =
      toolInput.subagent_type ??
      toolInput.subagentType ??
      toolInput.agent_type ??
      toolInput.agent ??
      toolInput.role ??
      toolInput.task_name;
    normalized.tool_input.subagent_type = normalizeRole(role);
  } else if (mode === 'shell') {
    normalized.tool_name = 'Shell';
    normalized.command = typeof toolInput.command === 'string' ? toolInput.command : '';
  } else if (mode === 'subagent') {
    normalized.conversation_id = input.session_id;
  }

  // Codex reports the parent session id for subagents and does not expose a stable
  // per-tool caller id. Mark that limitation explicitly so the compatibility core
  // skips its legacy caller-id warning instead of polluting process.md on every write.
  if (mode !== 'subagent') {
    delete normalized.conversation_id;
    normalized.codex_identity_unavailable = true;
  }
  return normalized;
}

function reasonFrom(output) {
  return [output?.user_message, output?.agent_message].filter(Boolean).join('\n');
}

export function toCodexOutput(mode, output = {}, context = {}) {
  if (mode === 'stop') {
    if (!output.followup_message) return {};
    if (context.stop_hook_active === true) {
      return { continue: false, stopReason: output.followup_message };
    }
    return { decision: 'block', reason: output.followup_message };
  }
  if (mode === 'subagent') return {};
  if (output.permission === 'allow' || !output.permission) return {};

  const reason = reasonFrom(output) || 'Harness workflow gate rejected this action.';
  if (output.permission === 'ask') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `${reason}\nCodex PreToolUse hooks do not support an ask decision. ` +
          'Ask the user in the conversation, then use a user-run command or an approved native permission path.',
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}
