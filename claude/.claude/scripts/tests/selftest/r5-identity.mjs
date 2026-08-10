/**
 * R5：顶层会话 id 基准、TTL 自愈、身份健康度、isRootConversationCaller。
 *
 * 入口：node .claude/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs（仅导入本套件实际使用的符号，见该目录 README）
 */
import {
  test, fixtureProcess, assert, path, recordRootConversationId, readRootConversationId,
  isRootConversationCaller, recordDispatchedRole, readRecentlyDispatchedRoles,
  checkRolePathPermission, collectActiveRoleSlugs, snapshotRootConversationState,
  restoreRootConversationState, clearRootConversationState, restoreReconDir,
  snapshotDispatchedRoles, restoreDispatchedRoles, clearDispatchedRoles,
} from './_harness.mjs';

console.log('== R5 机械化补强：顶层会话 id 记录与调用者身份判定 ==');
snapshotRootConversationState();
test('R5: 未记录顶层会话 id 时 readRootConversationId 返回 null', () => {
  clearRootConversationState();
  assert.equal(readRootConversationId(), null);
});
test('R5: 未记录顶层会话 id 时 isRootConversationCaller 恒 false（fail-open，不误报）', () => {
  clearRootConversationState();
  assert.equal(isRootConversationCaller('any-conversation-id'), false);
});
test('R5: recordRootConversationId 首次写入后 readRootConversationId 可读回', () => {
  clearRootConversationState();
  recordRootConversationId('root-conv-abc');
  assert.equal(readRootConversationId(), 'root-conv-abc');
});
test('R5: recordRootConversationId 只记录一次，不覆盖已有值（防嵌套子代理误写基准）', () => {
  clearRootConversationState();
  recordRootConversationId('root-conv-abc');
  recordRootConversationId('some-nested-subagent-id');
  assert.equal(readRootConversationId(), 'root-conv-abc');
});
test('R5: isRootConversationCaller 对等于顶层会话 id 的调用返回 true', () => {
  clearRootConversationState();
  recordRootConversationId('root-conv-abc');
  assert.equal(isRootConversationCaller('root-conv-abc'), true);
});
test('R5: isRootConversationCaller 对子代理自己独立的 conversation_id 返回 false', () => {
  clearRootConversationState();
  recordRootConversationId('root-conv-abc');
  assert.equal(isRootConversationCaller('subagent-conv-xyz'), false);
});
test('R5: isRootConversationCaller 对缺失/空 conversation_id 返回 false（fail-open）', () => {
  clearRootConversationState();
  recordRootConversationId('root-conv-abc');
  assert.equal(isRootConversationCaller(undefined), false);
  assert.equal(isRootConversationCaller(''), false);
  assert.equal(isRootConversationCaller(null), false);
});
test('R5: recordRootConversationId 对空/非字符串值不写入', () => {
  clearRootConversationState();
  recordRootConversationId(undefined);
  recordRootConversationId(null);
  recordRootConversationId(123);
  assert.equal(readRootConversationId(), null);
});
restoreRootConversationState();

console.log('== R5 角色↔路径匹配（分派/进度机读）==');
snapshotDispatchedRoles();
test('R5: recordDispatchedRole 记录并可被 readRecentlyDispatchedRoles 读回', () => {
  clearDispatchedRoles();
  recordDispatchedRole('requirements-analyst');
  recordDispatchedRole('development-engineer');
  const roles = readRecentlyDispatchedRoles();
  assert.ok(roles.includes('development-engineer'));
  assert.ok(roles.includes('requirements-analyst'));
  assert.equal(roles[0], 'development-engineer', '最近派发的角色排在前面');
});
test('R5: process.md 空活跃角色时允许 PM bootstrap 写 process.md', () => {
  clearDispatchedRoles();
  fixtureProcess('---\nworkflow_mode: full\nphase: requirement\n---\n\n## 进度列表\n\n| 角色/开发线 | 任务名称 | 状态 | 说明 |\n| --- | --- | --- | --- |\n');
  assert.equal(checkRolePathPermission('docs/process/process.md').ok, true);
  assert.equal(checkRolePathPermission('docs/process/process.md').reason, 'pm-bootstrap-window');
});
test('R5: 无活跃角色时拒绝写需求文档', () => {
  clearDispatchedRoles();
  fixtureProcess('---\nworkflow_mode: full\n---\n');
  const r = checkRolePathPermission('docs/requirement/requirement-spec.md');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-active-role');
});
test('R5: 最近派发 RA 后允许写需求文档', () => {
  clearDispatchedRoles();
  recordDispatchedRole('requirements-analyst');
  fixtureProcess('---\nworkflow_mode: full\n---\n');
  assert.equal(checkRolePathPermission('docs/requirement/requirement-spec.md').ok, true);
});
test('R5: QE 活跃时拒绝写源码（须 DE）', () => {
  clearDispatchedRoles();
  recordDispatchedRole('quality-engineer');
  const content = [
    '---',
    'workflow_mode: full',
    '---',
    '',
    '## 当前分派计划',
    '',
    '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
    '| --- | --- | --- | --- |',
    '| T0-1 | quality-engineer | 串行 | 待 QE |',
    '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| --- | --- | --- | --- |',
    '| 开发工程师 | T0-1 | 执行完成 | |',
    '| 质量工程师 | T0-1 | 正在执行 | |',
    '',
  ].join('\n');
  fixtureProcess(content);
  const r = checkRolePathPermission('src/index.ts');
  assert.equal(r.ok, false);
  // 最近派发为 QE → 直接 non-de-dispatched-denied；无派发记录时 forSource 收紧后为 no-active-role / role-path-mismatch
  assert.ok(
    r.reason === 'non-de-dispatched-denied' ||
      r.reason === 'no-active-role' ||
      r.reason === 'role-path-mismatch',
    `unexpected reason: ${r.reason}`,
  );
});
test('R5: 最近派发 TE 时即使进度残留 DE 正在执行也拒绝写产品源码', () => {
  clearDispatchedRoles();
  recordDispatchedRole('development-engineer');
  recordDispatchedRole('test-engineer');
  const content = [
    '---',
    'workflow_mode: full',
    '---',
    '',
    '## 当前分派计划',
    '',
    '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
    '| --- | --- | --- | --- |',
    '| T0-1 | development-engineer | 串行 | 进行中 |',
    '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| --- | --- | --- | --- |',
    '| 开发工程师 | T0-1 | 正在执行 | |',
    '| 测试工程师 | 批次集成测试 T0-1 | 正在执行 | |',
    '',
  ].join('\n');
  fixtureProcess(content);
  const r = checkRolePathPermission('web/src/app/App.tsx');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'non-de-dispatched-denied');
});
test('R5: 最近派发 TE 时可写 e2e，不可写产品源码；DE 活跃时不可写 e2e', () => {
  clearDispatchedRoles();
  recordDispatchedRole('test-engineer');
  const teContent = [
    '---',
    'workflow_mode: full',
    '---',
    '',
    '## 当前分派计划',
    '',
    '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
    '| --- | --- | --- | --- |',
    '| T0-1 | test-engineer | 串行 | 批次测试 |',
    '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| --- | --- | --- | --- |',
    '| 测试工程师 | 批次集成测试 T0-1 | 正在执行 | |',
    '',
  ].join('\n');
  fixtureProcess(teContent);
  assert.equal(checkRolePathPermission('e2e/specs/batch.spec.ts').ok, true);
  assert.equal(checkRolePathPermission('src/index.ts').ok, false);

  clearDispatchedRoles();
  recordDispatchedRole('development-engineer');
  const deContent = [
    '---',
    'workflow_mode: full',
    '---',
    '',
    '## 当前分派计划',
    '',
    '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
    '| --- | --- | --- | --- |',
    '| T0-1 | development-engineer | 串行 | 进行中 |',
    '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| --- | --- | --- | --- |',
    '| 开发工程师 | T0-1 | 正在执行 | |',
    '',
  ].join('\n');
  fixtureProcess(deContent);
  const deE2e = checkRolePathPermission('e2e/specs/batch.spec.ts');
  assert.equal(deE2e.ok, false);
  assert.ok(
    deE2e.reason === 'role-path-mismatch' || deE2e.reason === 'no-active-role',
    `unexpected reason: ${deE2e.reason}`,
  );
});
test('R5: DE 正在执行时允许写源码', () => {
  clearDispatchedRoles();
  recordDispatchedRole('development-engineer');
  const content = [
    '---',
    'workflow_mode: full',
    '---',
    '',
    '## 当前分派计划',
    '',
    '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
    '| --- | --- | --- | --- |',
    '| T0-1 | development-engineer | 串行 | 进行中 |',
    '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| --- | --- | --- | --- |',
    '| 开发工程师 | T0-1 | 正在执行 | |',
    '',
  ].join('\n');
  fixtureProcess(content);
  assert.deepEqual(collectActiveRoleSlugs(content, { forSource: true }), ['development-engineer']);
  assert.equal(checkRolePathPermission('src/index.ts').ok, true);
});
restoreDispatchedRoles();
restoreReconDir();
