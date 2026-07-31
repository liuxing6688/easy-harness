/**
 * R20：轻量模式声明须有用户确认，否则拒绝除 PM/RA 外角色派发。
 *
 * 入口：node .cursor/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs；共享 fixture：./_fixtures.mjs
 */
import {
  test, fixtureProcess, assert, checkRoleDispatchGate, checkLiteModeConfirmed,
  hasLiteModeConfirmation, getWorkflowMode, getDeclaredWorkflowMode,
} from './_harness.mjs';

import {
  liteModeConfirmSection, hotfixProcessBody,
} from './_fixtures.mjs';

console.log('== R20：轻量模式用户确认 ==');
test('R20: full 无需确认', () => {
  assert.equal(checkLiteModeConfirmed('---\nworkflow_mode: full\n---\n').ok, true);
  assert.equal(hasLiteModeConfirmation('---\nworkflow_mode: full\n---\n', 'full'), true);
});
test('R20: 声明 hotfix 缺确认行时失败', () => {
  const r = checkLiteModeConfirmed('---\nworkflow_mode: hotfix\n---\n');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'lite-mode-unconfirmed');
});
test('R20: 工作流模式确认行匹配人话意图时通过', () => {
  const md = [
    '---',
    'workflow_mode: hotfix',
    '---',
    '',
    '## 用户确认记录',
    '',
    '| 确认项 | 时间 | 用户原话摘要 |',
    '| ------ | ---- | ------------ |',
    '| 工作流模式确认 | 2026-01-01 | AskQuestion 选「修缺陷」（热修复） |',
    '',
  ].join('\n');
  assert.equal(checkLiteModeConfirmed(md).ok, true);
  assert.equal(getWorkflowMode(md), 'hotfix');
});
test('R20: 确认行模式与 frontmatter 不一致时不生效', () => {
  const md = [
    '---',
    'workflow_mode: hotfix',
    '---',
    '',
    liteModeConfirmSection('docs-only'),
  ].join('\n');
  assert.equal(checkLiteModeConfirmed(md).ok, false);
  assert.equal(getWorkflowMode(md), 'full');
});
test('R20: 未确认时 checkRoleDispatchGate 拒绝 DE，允许 PM', () => {
  fixtureProcess('---\nworkflow_mode: hotfix\n---\n');
  const de = checkRoleDispatchGate('development-engineer');
  assert.equal(de.ok, false);
  assert.equal(de.reason, 'lite-mode-unconfirmed');
  assert.equal(checkRoleDispatchGate('project-manager').ok, true);
});
test('R20: 已确认时 getWorkflowMode 返回 lite', () => {
  const md = hotfixProcessBody();
  assert.equal(getDeclaredWorkflowMode(md), 'hotfix');
  assert.equal(getWorkflowMode(md), 'hotfix');
});

