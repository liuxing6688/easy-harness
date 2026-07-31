/**
 * R11：hotfix 批次/最终测试折叠——parseWorkflowState 中 batch 恒真、final 通道。
 *
 * 入口：node .trae/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs；共享 fixture：./_fixtures.mjs
 */
import {
  test, assert, parseWorkflowState,
} from './_harness.mjs';

import {
  liteModeConfirmSection,
} from './_fixtures.mjs';

console.log('== R11：hotfix 批次/最终测试折叠 ==');
test('R11: hotfix 模式下 finalTestRequired 不要求批次集成测试完成', () => {
  const content = [
    '---',
    'workflow_mode: hotfix',
    '---',
    '',
    liteModeConfirmSection('hotfix'),
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    '| 开发工程师 | T-1 | 执行完成 | |',
    '| 质量工程师 | T-1 | 执行完成 | |',
    '',
  ].join('\n');
  const state = parseWorkflowState(content);
  assert.equal(state.finalTestRequired, true, 'hotfix 只需 dev+QE 完成即视为需要（唯一一次）最终测试');
});


