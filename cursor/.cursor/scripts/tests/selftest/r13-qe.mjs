/**
 * R13/QE：分派 QE 前置（开发线状态、未解决问题）与 extractQeDispatchTaskPacks。
 *
 * 入口：node .cursor/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs；共享 fixture：./_fixtures.mjs
 */
import {
  test, fixtureProcess, assert, fs, checkRoleDispatchGate, extractQeDispatchTaskPacks,
  getDevLineStatusForTaskPack,
} from './_harness.mjs';

import {
  makeQeDispatchProcess,
} from './_fixtures.mjs';

console.log('== R13：quality-engineer 按任务包核验开发线执行完成 ==');
test('R13 QE: extractQeDispatchTaskPacks 从分派计划提取任务包', () => {
  const content = makeQeDispatchProcess({
    progressRows: ['| 开发工程师 | T0-1 | 执行完成 | |'],
  });
  assert.deepEqual(extractQeDispatchTaskPacks(content), ['T0-1']);
});
test('R13 QE: 开发线正在执行时拒绝发起 quality-engineer', () => {
  fixtureProcess(
    makeQeDispatchProcess({
      progressRows: ['| 开发工程师 | T0-1 | 正在执行 | |'],
    }),
  );
  const r = checkRoleDispatchGate('quality-engineer');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'qe-dev-line-not-complete');
});
test('R13 QE: 分派计划缺 QE 任务包编号时拒绝', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
      '## 当前分派计划',
      '',
      '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
      '| ---------- | -------- | --------- | ---- |',
      '| T0-1 | development-engineer | 串行 | 待开发 |',
      '',
      '## 待派发角色列表',
      '',
      '| 角色 | 说明 |',
      '| ---- | ---- |',
      '| development-engineer | T0-1 |',
      '',
      '## 进度列表',
      '',
      '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
      '| ----------- | -------- | ---- | ---- |',
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '',
    ].join('\n'),
  );
  const r = checkRoleDispatchGate('quality-engineer');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'qe-missing-task-packs');
});
test('R13 QE: 对应开发线执行完成且分派含任务包时允许发起 quality-engineer', () => {
  fixtureProcess(
    makeQeDispatchProcess({
      progressRows: ['| 开发工程师 | T0-1 | 执行完成 | |'],
    }),
  );
  const r = checkRoleDispatchGate('quality-engineer');
  assert.equal(r.ok, true);
  assert.equal(getDevLineStatusForTaskPack(fs.readFileSync(process.env.HARNESS_PROCESS_PATH, 'utf8'), 'T0-1'), 'complete');
});
test('R13 QE: 多任务包时任一未完成即拒绝', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
      '## 当前分派计划',
      '',
      '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
      '| ---------- | -------- | --------- | ---- |',
      '| T0-1 | quality-engineer | 并行 | 待 QE |',
      '| T0-2 | quality-engineer | 并行 | 待 QE |',
      '',
      '## 待派发角色列表',
      '',
      '| 角色 | 说明 |',
      '| ---- | ---- |',
      '| quality-engineer | T0-1 T0-2 批量审查 |',
      '',
      '## 进度列表',
      '',
      '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
      '| ----------- | -------- | ---- | ---- |',
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '| 开发工程师 | T0-2 | 正在执行 | |',
      '',
    ].join('\n'),
  );
  const r = checkRoleDispatchGate('quality-engineer');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'qe-dev-line-not-complete');
  assert.match(r.message, /T0-2/);
});

