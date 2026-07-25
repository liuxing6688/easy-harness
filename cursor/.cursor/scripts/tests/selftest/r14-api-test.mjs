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

console.log('== R14：开发窗口批次接口测试报告章节校验 ==');

test('R14: 测试报告缺少接口测试报告章节时校验失败', () => {
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': '# 测试报告\n\n## 测试环境\n\n无\n',
  });
  assert.equal(checkBatchApiTestReport().ok, false);
});
test('R14: 接口测试报告章节存在但为空（仅表头）时校验失败', () => {
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': API_REPORT_EMPTY,
  });
  assert.equal(checkBatchApiTestReport().ok, false);
});
test('R14: 接口测试报告章节含真实数据行时校验通过', () => {
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': API_REPORT_FILLED,
  });
  assert.equal(checkBatchApiTestReport().ok, true);
});
test('R14: parseWorkflowState 反映 batchApiReportPresent', () => {
  const content = fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': API_REPORT_FILLED,
  });
  assert.equal(parseWorkflowState(content).batchApiReportPresent, true);
});
test('R14: 缺接口测试报告章节时 batchTestComplete=false（即便测试记录完成）', () => {
  const content = fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': API_REPORT_EMPTY,
  });
  const state = parseWorkflowState(content);
  assert.equal(state.batchTestRowComplete, true, '批次测试进度行应为完成');
  assert.equal(state.batchApiReportPresent, false);
  assert.equal(state.batchTestComplete, false, '接口测试报告缺失应使批次测试判定为未完成');
});
console.log('== R14：无对外接口项目适用性豁免（双要素）==');

test('R14: 仅用户确认但架构师未声明 n/a → 不豁免', () => {
  const content = fixtureProcess(API_EXEMPT_CONFIRM_PROCESS, {
    'docs/design/none.json': '{}\n',
  });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/none.json';
  assert.equal(isApiTestExempt(content), false);
});
test('R14: 仅架构师声明 n/a 但无用户确认 → 不豁免', () => {
  const content = fixtureProcess(
    ['---', 'workflow_mode: full', 'iterationType: greenfield', '---', ''].join('\n'),
    { 'docs/design/gated-na.json': API_NA_GATED },
  );
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-na.json';
  assert.equal(isApiTestExempt(content), false);
});
test('R14: 架构师声明 n/a + 用户确认 → 豁免，batchApiReportPresent 视为满足', () => {
  const content = fixtureProcess(API_EXEMPT_CONFIRM_PROCESS, {
    'docs/design/gated-na.json': API_NA_GATED,
  });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-na.json';
  assert.equal(isApiTestExempt(content), true);
  const state = parseWorkflowState(content);
  assert.equal(state.apiTestExempt, true);
  assert.equal(state.batchApiReportPresent, true, '豁免后即便无接口测试报告章节也视为满足');
});
delete process.env.HARNESS_GATED_ARTIFACTS_PATH;

test('R14: hotfix 折叠通道不并入接口测试报告判据（batchTestComplete 恒真）', () => {
  const content = fixtureProcess(
    [
      '---',
      'workflow_mode: hotfix',
      'iterationType: hotfix',
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
    ].join('\n'),
  );
  assert.equal(parseWorkflowState(content).batchTestComplete, true);
});

