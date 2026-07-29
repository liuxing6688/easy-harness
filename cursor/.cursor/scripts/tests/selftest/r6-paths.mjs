/**
 * R6：源码/扩展名路径门禁、.cursor/scripts|agents|hooks 纳入、扩展名豁免目录。
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

console.log('== R6：.cursor/ 门禁路径判定 ==');
test('R6: .cursor/scripts 下的文件受门禁保护', () => {
  assert.equal(isGatedDevPath('.cursor/scripts/foo.mjs'), true);
});
test('R6: .cursor/agents 下的文件受门禁保护', () => {
  assert.equal(isGatedDevPath('.cursor/agents/foo.md'), true);
});
test('R6: .cursor/hooks 下的文件受门禁保护（豁免标记文件除外）', () => {
  assert.equal(isGatedDevPath('.cursor/hooks/gate-foo.mjs'), true);
  assert.equal(isGatedDevPath('.cursor/hooks/.toolchain-install-approved.json'), false);
});
test('R6: 治理配置文件不走 DE 源码门禁（改由 R29 自治资产分级裁决）', () => {
  // 这些路径刻意不进 isGatedDevPath——否则会被当成 DE 源码而要求分派计划。
  // 它们的保护由 R29 承担：hooks.json/harness.config.json → ask（人工批准），
  // harness-state.json → 角色门禁（project-manager）。
  // 详见 selftest/r28-r31-hardening.mjs 与 mechanical-gates.md §8.5。
  assert.equal(isGatedDevPath('.cursor/templates/process.md'), false);
  assert.equal(isGatedDevPath('.cursor/harness.config.json'), false);
  assert.equal(isGatedDevPath('.cursor/hooks.json'), false);
  assert.equal(isGatedDevPath('.cursor/harness-state.json'), false);
});
test('R6: 常规源码路径仍受门禁保护（回归既有行为）', () => {
  assert.equal(isGatedDevPath('src/index.ts'), true);
  assert.equal(isGatedDevPath('docs/requirement/requirement-list.md'), false);
});
test('R5: e2e/** 纳入 isGatedDevPath，期望角色为 test-engineer', () => {
  assert.equal(isGatedDevPath('e2e/specs/foo.spec.ts'), true);
  assert.equal(isGatedDevPath('e2e/helpers/nav.ts'), true);
  assert.deepEqual(expectedRolesForPath('e2e/specs/foo.spec.ts'), ['test-engineer']);
  assert.deepEqual(expectedRolesForPath('e2e/helpers/nav.ts'), ['test-engineer']);
});
test('R5: docs 角色成果物纳入 isGatedRoleArtifactPath（与 isGatedDevPath 互补）', () => {
  assert.equal(isGatedRoleArtifactPath('docs/requirement/requirement-list.md'), true);
  assert.equal(isGatedRoleArtifactPath('docs/design/detail-design-spec.md'), true);
  assert.equal(isGatedRoleArtifactPath('docs/process/process.md'), true);
  assert.equal(isGatedRoleArtifactPath('docs/quality/quality-report.md'), true);
  assert.equal(isGatedRoleArtifactPath('docs/test/test-report.md'), true);
  assert.equal(isGatedRoleArtifactPath('src/index.ts'), false);
  assert.deepEqual(expectedRolesForPath('docs/requirement/requirement-spec.md'), [
    'requirements-analyst',
  ]);
  assert.deepEqual(expectedRolesForPath('src/app.ts'), ['development-engineer']);
});
test('R5: docs 下代码扩展名期望 DE（Finding #2），文档扩展名仍期望对应角色', () => {
  assert.deepEqual(expectedRolesForPath('docs/design/notes.py'), ['development-engineer']);
  assert.deepEqual(expectedRolesForPath('docs/design/detail-design-spec.md'), ['system-architect']);
  assert.equal(isGatedDevPath('docs/design/notes.py'), true);
});

