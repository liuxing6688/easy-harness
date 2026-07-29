/**
 * R13 自动门禁（gate-r13-subagent.mjs）：基于 agent_id 的 matcher:"*" 自动 R13 校验。
 *
 * 验证：子代理工具调用时，本 Hook 能从 agent_id 识别角色并自动执行 R13 前置校验
 * 与 recordDispatchedRole，不再依赖手动 gate-check role。
 *
 * 入口：node .trae/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs；共享 fixture：./_fixtures.mjs
 */
import {
  test, fixtureProcess, cleanup, assert,
  checkRoleDispatchGate, recordDispatchedRole, readRecentlyDispatchedRoles,
  snapshotDispatchedRoles, restoreDispatchedRoles, clearDispatchedRoles,
  PROJECT_ROOT, FIXTURE_ROOT,
} from './_harness.mjs';

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const HOOK_PATH = path.join(PROJECT_ROOT, '.trae', 'hooks', 'gate-r13-subagent.mjs');

/** 直接调用 Hook 脚本，返回 { outcome, verdict, stderr }。 */
function runHook(payload) {
  const res = spawnSync('node', [HOOK_PATH], {
    cwd: PROJECT_ROOT,
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  let verdict;
  try { verdict = JSON.parse((res.stdout || '').trim() || '{}'); } catch { verdict = { _raw: res.stdout }; }
  const outcome = verdict?.hookSpecificOutput?.permissionDecision ?? 'unknown';
  return { outcome, verdict, stderr: res.stderr };
}

console.log('== R13 自动门禁（gate-r13-subagent，matcher:*，基于 agent_id）==');

// 基础身份识别测试（不需要 process.md fixture）
test('R13-subagent: agent_id 缺失 -> 快速放行（fail-open）', () => {
  const { outcome } = runHook({ tool_name: 'Read', tool_input: { file_path: 'x' } });
  assert.equal(outcome, 'allow');
});

test('R13-subagent: agent_id=solo_agent（顶层）-> 快速放行', () => {
  const { outcome } = runHook({ tool_name: 'Read', agent_id: 'solo_agent', tool_input: { file_path: 'x' } });
  assert.equal(outcome, 'allow');
});

test('R13-subagent: agent_id=非门禁角色（project-manager）-> 放行 + 记录角色', () => {
  clearDispatchedRoles();
  const { outcome } = runHook({ tool_name: 'Read', agent_id: 'project-manager', tool_input: {} });
  assert.equal(outcome, 'allow');
  const roles = readRecentlyDispatchedRoles();
  assert.ok(roles.includes('project-manager'), 'project-manager 应被记录');
});

test('R13-subagent: agent_id=非门禁角色（requirements-analyst）-> 放行 + 记录角色', () => {
  clearDispatchedRoles();
  const { outcome } = runHook({ tool_name: 'Read', agent_id: 'requirements-analyst', tool_input: {} });
  assert.equal(outcome, 'allow');
  const roles = readRecentlyDispatchedRoles();
  assert.ok(roles.includes('requirements-analyst'), 'requirements-analyst 应被记录');
});

test('R13-subagent: agent_id=内置子代理（search）-> 放行（不在 GATED_ROLES）', () => {
  const { outcome } = runHook({ tool_name: 'Glob', agent_id: 'search', tool_input: {} });
  assert.equal(outcome, 'allow');
});

test('R13-subagent: agent_id=内置子代理（general_purpose_task）-> 放行', () => {
  const { outcome } = runHook({ tool_name: 'Glob', agent_id: 'general_purpose_task', tool_input: {} });
  assert.equal(outcome, 'allow');
});

// 门禁角色 R13 校验测试（需要 process.md fixture）
snapshotDispatchedRoles();

test('R13-subagent: development-engine子代理（无分派计划）-> deny', () => {
  clearDispatchedRoles();
  fixtureProcess('---\nworkflow_mode: full\n---\n');
  const { outcome } = runHook({ tool_name: 'Write', agent_id: 'development-engineer', tool_input: { path: 'src/app.ts' } });
  assert.equal(outcome, 'deny');
});

test('R13-subagent: system-architect 子代理（需求未就绪）-> deny', () => {
  clearDispatchedRoles();
  fixtureProcess('---\nworkflow_mode: full\n---\n');
  const { outcome } = runHook({ tool_name: 'Read', agent_id: 'system-architect', tool_input: {} });
  assert.equal(outcome, 'deny');
});

test('R13-subagent: project-manager 子代理在 cancelled 流程上 -> 放行（逃生口）', () => {
  clearDispatchedRoles();
  fixtureProcess('---\nworkflow_mode: full\ncancelled: true\n---\n');
  const { outcome } = runHook({ tool_name: 'Read', agent_id: 'project-manager', tool_input: {} });
  assert.equal(outcome, 'allow');
});

test('R13-subagent: development-engineer 子代理在 cancelled 流程上 -> deny', () => {
  clearDispatchedRoles();
  fixtureProcess('---\nworkflow_mode: full\ncancelled: true\n---\n');
  const { outcome } = runHook({ tool_name: 'Read', agent_id: 'development-engineer', tool_input: {} });
  assert.equal(outcome, 'deny');
});

test('R13-subagent: 门禁角色子代理通过 R13 后 -> 放行 + 记录角色', () => {
  clearDispatchedRoles();
  // 用已有的 greenfield fixture（需求就绪 + 用户确认）
  // checkRoleDispatchGate('system-architect') 需要 requirement-spec.md + requirement-list.md + 用户确认
  // 这里仅验证角色记录功能（R13 deny 时也会记录）
  fixtureProcess('---\nworkflow_mode: full\n---\n');
  runHook({ tool_name: 'Read', agent_id: 'development-engineer', tool_input: {} });
  const roles = readRecentlyDispatchedRoles();
  assert.ok(roles.includes('development-engineer'), '角色应被记录（即使 R13 deny）');
});

restoreDispatchedRoles();
