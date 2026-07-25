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

console.log('== R15：编程规范（lint）门禁纯函数判据 ==');
test('R15: resolveLintCommand 覆盖优先于栈默认值', () => {
  assert.equal(resolveLintCommand({ stack: 'node', override: 'eslint .' }), 'eslint .');
  assert.equal(resolveLintCommand({ stack: 'node', override: null }), 'npm run lint');
  assert.equal(resolveLintCommand({ stack: 'python', override: null }), 'ruff check .');
});
test('R15: 无 lint 命令的栈返回 null', () => {
  assert.equal(resolveLintCommand({ stack: 'java-maven', override: null }), null);
  assert.equal(resolveLintCommand({ stack: null, override: null }), null);
});
test('R15: computeLintGate —— 有命令且退出码 0 才 gatePassed', () => {
  assert.equal(computeLintGate({ command: 'npm run lint', exitCode: 0 }).gatePassed, true);
  assert.equal(computeLintGate({ command: 'npm run lint', exitCode: 1 }).gatePassed, false);
  assert.equal(computeLintGate({ command: null, exitCode: null }).gatePassed, false);
  assert.equal(computeLintGate({ command: null, exitCode: null }).reason, 'no-lint-command');
});

console.log('== R15：编程规范（lint）门禁机读判据（含双要素豁免）==');

snapshotLintResult();
test('R15: 无 lint 机读产物时 checkLintClean 失败、lintPassed=false', () => {
  const content = fixtureProcess(R15_QE_DONE);
  clearLintResult();
  assert.equal(readLintResult(), null);
  assert.equal(checkLintClean().ok, false);
  assert.equal(parseWorkflowState(content).lintPassed, false);
});
test('R15: lint gatePassed=true 时 checkLintClean 通过、lintPassed=true', () => {
  const content = fixtureProcess(R15_QE_DONE);
  writeLintResult(LINT_PASS);
  assert.equal(checkLintClean().ok, true);
  assert.equal(parseWorkflowState(content).lintPassed, true);
});
test('R15: lint gatePassed=false（lint 失败）时 checkLintClean 失败、lintPassed=false', () => {
  const content = fixtureProcess(R15_QE_DONE);
  writeLintResult(LINT_FAIL);
  assert.equal(checkLintClean().ok, false);
  assert.equal(parseWorkflowState(content).lintPassed, false);
});
test('R15: 仅架构师声明 n/a 但无用户确认 → 不豁免', () => {
  const content = fixtureProcess(R15_QE_DONE, { 'docs/design/gated-lint-na.json': LINT_NA_GATED });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-lint-na.json';
  clearLintResult();
  assert.equal(isLintExempt(content), false);
  assert.equal(parseWorkflowState(content).lintPassed, false);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R15: 仅用户确认但架构师未声明 n/a → 不豁免', () => {
  const content = fixtureProcess(LINT_EXEMPT_CONFIRM_PROCESS, { 'docs/design/none.json': '{}\n' });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/none.json';
  clearLintResult();
  assert.equal(isLintExempt(content), false);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R15: 架构师声明 n/a + 用户确认 → 豁免，lintPassed 视为满足（即便无 lint 产物）', () => {
  const content = fixtureProcess(LINT_EXEMPT_CONFIRM_PROCESS, { 'docs/design/gated-lint-na.json': LINT_NA_GATED });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-lint-na.json';
  clearLintResult();
  assert.equal(isLintExempt(content), true);
  assert.equal(checkLintClean().ok, true);
  assert.equal(parseWorkflowState(content).lintPassed, true);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R15: docs-only 模式 lintPassed 视为满足', () => {
  const content = ['---', 'workflow_mode: docs-only', '---', '', liteModeConfirmSection('docs-only')].join('\n');
  clearLintResult();
  assert.equal(parseWorkflowState(content).lintPassed, true);
});
restoreLintResult();

