/** Codex lifecycle-hook wire-format adapter regression tests. */
import { test, assert, path } from './_harness.mjs';
import {
  normalizeCodexInput,
  resolveHookProjectRoot,
  toCodexOutput,
} from '../../../hooks/codex-adapter-lib.mjs';

console.log('== Codex Hook 协议适配 ==');

test('Codex apply_patch command 映射为旧门禁可解析的 patch', () => {
  const result = normalizeCodexInput('write', {
    tool_name: 'apply_patch',
    tool_input: { command: '*** Update File: src/app.ts' },
  });
  assert.equal(result.tool_name, 'ApplyPatch');
  assert.equal(result.tool_input.patch, '*** Update File: src/app.ts');
  assert.equal(result.conversation_id, undefined);
  assert.equal(result.codex_identity_unavailable, true);
});

test('Codex Agent task_name 映射为角色 Task', () => {
  const result = normalizeCodexInput('role', {
    tool_name: 'spawn_agent',
    tool_input: { task_name: 'development_engineer' },
  });
  assert.equal(result.tool_name, 'Task');
  assert.equal(result.tool_input.subagent_type, 'development-engineer');
});

test('Codex Bash command 映射为 Shell command', () => {
  const result = normalizeCodexInput('shell', {
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  });
  assert.equal(result.command, 'npm test');
  assert.equal(result.codex_identity_unavailable, true);
});

test('SubagentStart 仅为旧身份健康记录提供 parent session id', () => {
  const result = normalizeCodexInput('subagent', { session_id: 'session-1' });
  assert.equal(result.conversation_id, 'session-1');
});

test('旧 deny 输出映射为 Codex PreToolUse deny', () => {
  const result = toCodexOutput('write', {
    permission: 'deny',
    user_message: 'blocked',
    agent_message: 'fix the workflow first',
  });
  assert.equal(result.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(result.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /blocked/);
});

test('旧 ask 输出在 Codex PreToolUse 上保守降级为 deny', () => {
  const result = toCodexOutput('shell', { permission: 'ask', user_message: 'confirm' });
  assert.equal(result.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /do not support an ask decision/);
});

test('旧 stop followup 映射为 Codex Stop continuation', () => {
  assert.deepEqual(toCodexOutput('stop', { followup_message: 'continue tests' }), {
    decision: 'block',
    reason: 'continue tests',
  });
  assert.deepEqual(toCodexOutput('stop', {}), {});
  assert.deepEqual(
    toCodexOutput('stop', { followup_message: 'continue tests' }, { stop_hook_active: true }),
    { continue: false, stopReason: 'continue tests' },
  );
});

test('Hook project root follows the Codex cwd instead of a Git or hook-file root', () => {
  const workspaceRoot = path.resolve('target-project');
  const fallbackRoot = path.resolve('template-root');
  assert.equal(
    resolveHookProjectRoot({ cwd: workspaceRoot }, fallbackRoot),
    workspaceRoot,
  );
  assert.equal(
    resolveHookProjectRoot({}, fallbackRoot),
    fallbackRoot,
  );
});
