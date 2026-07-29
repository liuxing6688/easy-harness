/**
 * R3：迭代进入开发前四件成果物存在且被 process.md 引用（hotfix/docs-only 豁免）。
 *
 * 入口：node .cursor/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs；共享 fixture：./_fixtures.mjs
 */
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

console.log('== R3：迭代成果物前置校验 ==');
test('R3: iterationType 缺失时按 full 兜底校验（缺成果物则失败）', () => {
  const result = checkIterationArtifacts('---\nworkflow_mode: full\n---\n');
  assert.equal(result.ok, false);
});
test('R3: iterationType 缺失但四件成果物齐全且被引用时通过', () => {
  const content = fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
      '已产出 requirement-spec.md、requirement-list.md、detail-design-spec.md、develop-task-list.md。',
      '',
    ].join('\n'),
    {
      'docs/requirement/requirement-spec.md': '# spec',
      'docs/requirement/requirement-list.md': '# list',
      'docs/design/detail-design-spec.md': '# design',
      'docs/design/develop-task-list.md': '# tasks',
    },
  );
  assert.equal(checkIterationArtifacts(content).ok, true);
});
test('R3: 已确认的 hotfix/docs-only 豁免', () => {
  assert.equal(
    checkIterationArtifacts(
      ['---', 'workflow_mode: hotfix', '---', '', liteModeConfirmSection('hotfix')].join('\n'),
    ).ok,
    true,
  );
  assert.equal(
    checkIterationArtifacts(
      ['---', 'workflow_mode: docs-only', '---', '', liteModeConfirmSection('docs-only')].join('\n'),
    ).ok,
    true,
  );
});
test('R3: 未确认的 lite 声明不豁免（有 iterationType 时按 full 校验）', () => {
  const content = fixtureProcess('---\nworkflow_mode: hotfix\niterationType: greenfield\n---\n');
  assert.equal(checkIterationArtifacts(content).ok, false);
  assert.equal(getWorkflowMode(content), 'full');
  assert.equal(getDeclaredWorkflowMode(content), 'hotfix');
});
test('R3: 非 hotfix 迭代缺成果物时失败', () => {
  const content = fixtureProcess('---\nworkflow_mode: full\niterationType: greenfield\n---\n');
  assert.equal(checkIterationArtifacts(content).ok, false);
});
test('R3: 四件成果物存在且被 process.md 引用时通过', () => {
  const content = fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      'iterationType: greenfield',
      '---',
      '',
      '已产出 requirement-spec.md、requirement-list.md、detail-design-spec.md、develop-task-list.md。',
      '',
    ].join('\n'),
    {
      'docs/requirement/requirement-spec.md': '# spec',
      'docs/requirement/requirement-list.md': '# list',
      'docs/design/detail-design-spec.md': '# design',
      'docs/design/develop-task-list.md': '# tasks',
    },
  );
  assert.equal(checkIterationArtifacts(content).ok, true);
});

