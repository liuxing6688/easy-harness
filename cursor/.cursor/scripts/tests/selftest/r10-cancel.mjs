/**
 * R10：cancelled 不可逆冻结（isCancelledProcessFile / isActiveProcessCancelled）。
 *
 * 入口：node .cursor/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs（仅导入本套件实际使用的符号，见该目录 README）
 */
import {
  test, fixtureProcess, assert, parseWorkflowState, isCancelledProcessFile,
} from './_harness.mjs';

console.log('== R10：流程终止（不可逆取消）==');
test('R10: cancelled=true 的 process.md 被识别为冻结', () => {
  fixtureProcess('---\nworkflow_mode: full\ncancelled: true\n---\n');
  assert.equal(isCancelledProcessFile(process.env.HARNESS_PROCESS_PATH), true);
});
test('R10: cancelled=false 时不冻结', () => {
  fixtureProcess('---\nworkflow_mode: full\ncancelled: false\n---\n');
  assert.equal(isCancelledProcessFile(process.env.HARNESS_PROCESS_PATH), false);
});
test('R10: 非 process.md 路径不受冻结判定影响', () => {
  assert.equal(isCancelledProcessFile('docs/design/detail-design-spec.md'), false);
});
test('R10: parseWorkflowState 正确反映 cancelled 状态', () => {
  const state = parseWorkflowState('---\nworkflow_mode: full\ncancelled: true\n---\n');
  assert.equal(state.cancelled, true);
});

