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

console.log('== R20：轻量模式用户确认 ==');
test('R20: full 无需确认', () => {
  assert.equal(checkLiteModeConfirmed('---\nworkflow_mode: full\n---\n').ok, true);
  assert.equal(hasLiteModeConfirmation('---\nworkflow_mode: full\n---\n', 'full'), true);
});
test('R20: 声明 hotfix 缺确认行时失败', () => {
  const r = checkLiteModeConfirmed('---\nworkflow_mode: hotfix\n---\n');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'lite-mode-unconfirmed');
});
test('R20: 工作流模式确认行匹配人话意图时通过', () => {
  const md = [
    '---',
    'workflow_mode: hotfix',
    '---',
    '',
    '## 用户确认记录',
    '',
    '| 确认项 | 时间 | 用户原话摘要 |',
    '| ------ | ---- | ------------ |',
    '| 工作流模式确认 | 2026-01-01 | AskQuestion 选「修缺陷」（热修复） |',
    '',
  ].join('\n');
  assert.equal(checkLiteModeConfirmed(md).ok, true);
  assert.equal(getWorkflowMode(md), 'hotfix');
});
test('R20: 确认行模式与 frontmatter 不一致时不生效', () => {
  const md = [
    '---',
    'workflow_mode: hotfix',
    '---',
    '',
    liteModeConfirmSection('docs-only'),
  ].join('\n');
  assert.equal(checkLiteModeConfirmed(md).ok, false);
  assert.equal(getWorkflowMode(md), 'full');
});
test('R20: 未确认时 checkRoleDispatchGate 拒绝 DE，允许 PM', () => {
  fixtureProcess('---\nworkflow_mode: hotfix\n---\n');
  const de = checkRoleDispatchGate('development-engineer');
  assert.equal(de.ok, false);
  assert.equal(de.reason, 'lite-mode-unconfirmed');
  assert.equal(checkRoleDispatchGate('project-manager').ok, true);
});
test('R20: 已确认时 getWorkflowMode 返回 lite', () => {
  const md = hotfixProcessBody();
  assert.equal(getDeclaredWorkflowMode(md), 'hotfix');
  assert.equal(getWorkflowMode(md), 'hotfix');
});

