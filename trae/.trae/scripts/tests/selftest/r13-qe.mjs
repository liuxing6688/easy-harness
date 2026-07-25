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


