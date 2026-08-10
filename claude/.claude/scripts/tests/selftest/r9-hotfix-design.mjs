/**
 * R9：hotfix 进入开发前须存在 detail-design-spec.md（checkHotfixDesign）。
 *
 * 入口：node .claude/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs；共享 fixture：./_fixtures.mjs
 */
import {
  test, fixtureProcess, assert, checkHotfixDesign, getWorkflowMode,
} from './_harness.mjs';

import {
  hotfixProcessBody,
} from './_fixtures.mjs';

console.log('== R9：hotfix 设计存在性前置校验 ==');
test('R9: hotfix 模式下设计缺失时失败', () => {
  const content = fixtureProcess(hotfixProcessBody());
  assert.equal(checkHotfixDesign(content).ok, false);
});
test('R9: hotfix 模式下设计存在时通过', () => {
  const content = fixtureProcess(hotfixProcessBody(), {
    'docs/design/detail-design-spec.md': '# design',
  });
  assert.equal(checkHotfixDesign(content).ok, true);
});
test('R9: 非 hotfix 模式豁免', () => {
  assert.equal(checkHotfixDesign('---\nworkflow_mode: full\n---\n').ok, true);
});
test('R9: 未确认的 hotfix 声明不触发设计校验（fail-safe full）', () => {
  assert.equal(checkHotfixDesign('---\nworkflow_mode: hotfix\n---\n').ok, true);
  assert.equal(getWorkflowMode('---\nworkflow_mode: hotfix\n---\n'), 'full');
});

