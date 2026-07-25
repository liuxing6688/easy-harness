import {
  test, fixtureProcess, cleanup, assert, path, fs,
  isGatedDevPath, parseWorkflowState, checkIterationArtifacts, checkHotfixDesign,
  isCancelledProcessFile, checkRoleDispatchGate, checkBatchApiTestReport, isApiTestExempt,
  checkBatchStorageReconciliationReport, isStorageReconciliationExempt, isE2eExempt,
  isLintExempt, readLintResult, checkLintClean, isDupCheckExempt, isSecurityScanExempt,
  readStaticScanResult, checkStaticScanClean, hasUnresolvedIssues, isProcessBlocked,
  checkDesignProblemListStructure, checkRequirementCoverageMatrix, extractP0RequirementIds,
  checkDesignReviewClean, checkTechSelectionConfirmed, checkDesignReviewConclusion,
  checkHotfixP0Impact, checkHotfixP0InterfaceStorageMention, recordHotfixP0SoftReminder,
  recordFailOpenEvent, hasResolvedDesignIssues, extractQeDispatchTaskPacks,
  getDevLineStatusForTaskPack, ROOT_CONVERSATION_STATE, DISPATCHED_ROLES_STATE,
  recordRootConversationId, checkLiteModeConfirmed, hasLiteModeConfirmation, getWorkflowMode,
  getDeclaredWorkflowMode, readRootConversationId, isRootConversationCaller, recordDispatchedRole,
  readRecentlyDispatchedRoles, isGatedRoleArtifactPath, expectedRolesForPath,
  checkRolePathPermission, collectActiveRoleSlugs, checkReconEvidenceRef,
  excerptInDesignAnchorWindow, extractDesignSectionWindow,
  resolveLintCommand, computeLintGate, resolveDupCommand, resolveSecurityCommand,
  computeSubGate, computeStaticScanGate,
  snapshotLintResult, restoreLintResult, writeLintResult, clearLintResult,
  snapshotStaticScanResult, restoreStaticScanResult, writeStaticScanResult, clearStaticScanResult,
  snapshotRootConversationState, restoreRootConversationState, clearRootConversationState,
  snapshotReconDir, restoreReconDir, writeReconEvidence, clearReconDir, ensureDefaultReconEvidence,
  snapshotDispatchedRoles, restoreDispatchedRoles, clearDispatchedRoles,
  PROJECT_ROOT, FIXTURE_ROOT,
} from './_harness.mjs';

import {
  R18_DIMS,
  makeCleanDplForSelftest,
  SELFTEST_REQ_LIST,
  SELFTEST_REQ_LIST_3P0,
  SELFTEST_DPL_CLEAN,
  SELFTEST_DPL_UNRESOLVED,
  SELFTEST_TECH_CONFIRM,
  liteModeConfirmSection,
  hotfixProcessBody,
  HOTFIX_STRUCTURED_API_STORAGE_REPORT,
  makeQeDispatchProcess,
  R14_PROGRESS_BATCH_DONE,
  API_REPORT_EMPTY,
  API_REPORT_FILLED,
  API_EXEMPT_CONFIRM_PROCESS,
  API_NA_GATED,
  STORAGE_RECON_HEADER,
  STORAGE_RECON_SEP,
  STORAGE_RECON_BOTH,
  STORAGE_RECON_API_ONLY,
  STORAGE_RECON_E2E_ONLY,
  STORAGE_RECON_BAD_MEDIUM,
  STORAGE_RECON_EMPTY,
  STORAGE_EXEMPT_CONFIRM_PROCESS,
  STORAGE_NA_GATED,
  R15_QE_DONE,
  LINT_PASS,
  LINT_FAIL,
  LINT_NA_GATED,
  LINT_EXEMPT_CONFIRM_PROCESS,
  R16_QE_DONE,
  STATIC_SCAN_PASS,
  STATIC_SCAN_DUP_FAIL,
  STATIC_SCAN_SECURITY_FAIL,
  DUP_NA_GATED,
  SECURITY_NA_GATED,
  DUP_EXEMPT_CONFIRM_PROCESS,
  SECURITY_EXEMPT_CONFIRM_PROCESS
} from './_fixtures.mjs';

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
  // forSource 收紧后活跃集不含 DE → no-active-role；若仅有非 DE 活跃则为 role-path-mismatch
  assert.ok(
    r.reason === 'no-active-role' || r.reason === 'role-path-mismatch',
    `unexpected reason: ${r.reason}`,
  );
});
test('R5: DE 正在执行时允许写源码', () => {
  clearDispatchedRoles();
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
