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

console.log('== R16：静态代码质量门禁纯函数判据 ==');
test('R16: resolveDupCommand/resolveSecurityCommand 覆盖优先于默认值', () => {
  assert.equal(resolveDupCommand({ override: 'jscpd --threshold 10 .' }), 'jscpd --threshold 10 .');
  assert.ok(resolveDupCommand({ override: null }).includes('jscpd-rs'));
  assert.equal(resolveDupCommand({ override: '' }), null);
  assert.equal(resolveSecurityCommand({ override: 'gitleaks detect' }), 'gitleaks detect');
  assert.ok(resolveSecurityCommand({ override: null }).includes('gitleaks-secret-scanner'));
  assert.equal(resolveSecurityCommand({ override: '' }), null);
});
test('R16: computeSubGate —— 有命令且退出码 0 才 gatePassed', () => {
  assert.equal(computeSubGate({ command: 'jscpd .', exitCode: 0 }).gatePassed, true);
  assert.equal(computeSubGate({ command: 'jscpd .', exitCode: 1 }).gatePassed, false);
  assert.equal(computeSubGate({ command: null, exitCode: null }).gatePassed, false);
  assert.equal(computeSubGate({ command: null, exitCode: null }).reason, 'no-command');
});
test('R16: computeStaticScanGate —— 两项子检查均通过才 gatePassed', () => {
  const pass = { gatePassed: true };
  const fail = { gatePassed: false };
  assert.equal(computeStaticScanGate({ duplication: pass, security: pass }).gatePassed, true);
  assert.equal(computeStaticScanGate({ duplication: fail, security: pass }).gatePassed, false);
  assert.equal(computeStaticScanGate({ duplication: pass, security: fail }).gatePassed, false);
});

console.log('== R16：静态代码质量门禁机读判据（含双要素豁免，重复代码/安全扫描独立）==');

snapshotStaticScanResult();
test('R16: 无静态扫描机读产物时 checkStaticScanClean 失败、staticScanPassed=false', () => {
  const content = fixtureProcess(R16_QE_DONE);
  clearStaticScanResult();
  assert.equal(readStaticScanResult(), null);
  assert.equal(checkStaticScanClean().ok, false);
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
});
test('R16: 两项子检查均 gatePassed=true 时 checkStaticScanClean 通过、staticScanPassed=true', () => {
  const content = fixtureProcess(R16_QE_DONE);
  writeStaticScanResult(STATIC_SCAN_PASS);
  assert.equal(checkStaticScanClean().ok, true);
  assert.equal(parseWorkflowState(content).staticScanPassed, true);
});
test('R16: 重复代码检测未通过时 checkStaticScanClean 失败、staticScanPassed=false', () => {
  const content = fixtureProcess(R16_QE_DONE);
  writeStaticScanResult(STATIC_SCAN_DUP_FAIL);
  assert.equal(checkStaticScanClean().ok, false);
  assert.equal(checkStaticScanClean().reason, 'dup-check-not-passed');
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
});
test('R16: 安全扫描未通过时 checkStaticScanClean 失败、staticScanPassed=false', () => {
  const content = fixtureProcess(R16_QE_DONE);
  writeStaticScanResult(STATIC_SCAN_SECURITY_FAIL);
  assert.equal(checkStaticScanClean().ok, false);
  assert.equal(checkStaticScanClean().reason, 'security-scan-not-passed');
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
});
test('R16: 仅架构师声明 dupCheckApplicability n/a 但无用户确认 → 不豁免', () => {
  const content = fixtureProcess(R16_QE_DONE, { 'docs/design/gated-dup-na.json': DUP_NA_GATED });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-dup-na.json';
  clearStaticScanResult();
  assert.equal(isDupCheckExempt(content), false);
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R16: 架构师声明 dupCheckApplicability n/a + 用户确认 → 仅重复代码豁免，安全扫描仍须通过', () => {
  const content = fixtureProcess(DUP_EXEMPT_CONFIRM_PROCESS, { 'docs/design/gated-dup-na.json': DUP_NA_GATED });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-dup-na.json';
  clearStaticScanResult();
  assert.equal(isDupCheckExempt(content), true);
  assert.equal(isSecurityScanExempt(content), false);
  // 未运行安全扫描，即便重复代码已豁免，整体仍不通过
  assert.equal(checkStaticScanClean().ok, false);
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
  // 安全扫描单独通过后，两项子判据（豁免 + 实测）皆满足
  writeStaticScanResult({
    gatePassed: false,
    duplication: { gatePassed: false, reason: 'scan-failed', command: 'jscpd .', exitCode: 1 },
    security: { gatePassed: true, reason: 'passed', command: 'gitleaks-secret-scanner', exitCode: 0 },
  });
  assert.equal(checkStaticScanClean().ok, true);
  assert.equal(parseWorkflowState(content).staticScanPassed, true);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R16: 架构师声明 securityScanApplicability n/a + 用户确认 → 仅安全扫描豁免，重复代码仍须通过', () => {
  const content = fixtureProcess(SECURITY_EXEMPT_CONFIRM_PROCESS, {
    'docs/design/gated-security-na.json': SECURITY_NA_GATED,
  });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-security-na.json';
  clearStaticScanResult();
  assert.equal(isSecurityScanExempt(content), true);
  assert.equal(isDupCheckExempt(content), false);
  assert.equal(checkStaticScanClean().ok, false);
  writeStaticScanResult({
    gatePassed: false,
    duplication: { gatePassed: true, reason: 'passed', command: 'jscpd .', exitCode: 0 },
    security: { gatePassed: false, reason: 'scan-failed', command: 'gitleaks-secret-scanner', exitCode: 1 },
  });
  assert.equal(checkStaticScanClean().ok, true);
  assert.equal(parseWorkflowState(content).staticScanPassed, true);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R16: docs-only 模式 staticScanPassed 视为满足', () => {
  const content = ['---', 'workflow_mode: docs-only', '---', '', liteModeConfirmSection('docs-only')].join('\n');
  clearStaticScanResult();
  assert.equal(parseWorkflowState(content).staticScanPassed, true);
});
restoreStaticScanResult();


