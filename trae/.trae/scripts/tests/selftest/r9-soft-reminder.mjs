/**
 * R9：hotfix P0 接口/存储软性提醒（非阻塞，recordHotfixP0SoftReminder）。
 *
 * 入口：node .trae/scripts/gate-selftest.mjs
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

console.log('== R9 软性提醒：P0 影响 hotfix 的本次报告结构化章节检测（非阻塞）==');
test('R9 软性提醒: 非 hotfix 时不适用', () => {
  const content = fixtureProcess('---\nworkflow_mode: full\n---\n');
  assert.equal(checkHotfixP0InterfaceStorageMention(content).applicable, false);
});
test('R9 软性提醒: hotfix 但 hotfix_p0_impact=none 时不适用', () => {
  const content = fixtureProcess(hotfixProcessBody(['hotfix_p0_impact: none']));
  assert.equal(checkHotfixP0InterfaceStorageMention(content).applicable, false);
});
test('R9 软性提醒: hotfix_p0_impact=p0 但本次报告缺结构化接口/存储章节时 needsReminder=true', () => {
  const content = fixtureProcess(hotfixProcessBody(['hotfix_p0_impact: p0']), {
    'docs/test/test-report.md': '# 测试报告\n\n## 集成测试记录\n\n全部通过。\n',
  });
  const r = checkHotfixP0InterfaceStorageMention(content);
  assert.equal(r.applicable, true);
  assert.equal(r.mentionsInterface, false);
  assert.equal(r.mentionsStorage, false);
  assert.equal(r.needsReminder, true);
});
test('R9 软性提醒: 本次 test-report.md 含结构化章节真实数据行时 needsReminder=false', () => {
  const content = fixtureProcess(hotfixProcessBody(['hotfix_p0_impact: p0']), {
    'docs/test/test-report.md': HOTFIX_STRUCTURED_API_STORAGE_REPORT,
  });
  const r = checkHotfixP0InterfaceStorageMention(content);
  assert.equal(r.mentionsInterface, true);
  assert.equal(r.mentionsStorage, true);
  assert.equal(r.needsReminder, false);
});
test('R9 软性提醒: 仅有关键词而无真实数据行时仍 needsReminder=true', () => {
  const content = fixtureProcess(hotfixProcessBody(['hotfix_p0_impact: p0']), {
    'docs/test/test-report.md':
      '# 测试报告\n\n## 接口测试报告\n\n已核对接口契约无变化。\n\n## 存储对账记录\n\n已完成存储对账，结果一致。\n',
  });
  const r = checkHotfixP0InterfaceStorageMention(content);
  assert.equal(r.mentionsInterface, false);
  assert.equal(r.mentionsStorage, false);
  assert.equal(r.needsReminder, true);
});
test('R9 软性提醒: 历史无关报告中的结构化章节不得抑制本次提醒', () => {
  const content = fixtureProcess(hotfixProcessBody(['hotfix_p0_impact: p0']), {
    'docs/test/old-history.md': HOTFIX_STRUCTURED_API_STORAGE_REPORT,
    'docs/test/test-report.md': '# 测试报告\n\n## 集成测试记录\n\n全部通过。\n',
  });
  const r = checkHotfixP0InterfaceStorageMention(content);
  assert.equal(r.needsReminder, true, '历史报告不得抑制本次 test-report.md 的提醒');
});
test('R9 软性提醒: recordHotfixP0SoftReminder 命中时写入一次性非阻塞记录', () => {
  const content = fixtureProcess(
    hotfixProcessBody(['hotfix_p0_impact: p0', 'blocking: false', 'cancelled: false']),
    {
      'docs/test/test-report.md': '# 测试报告\n\n## 集成测试记录\n\n全部通过。\n',
    },
  );
  const r = recordHotfixP0SoftReminder(content);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'recorded');
  const md = fs.readFileSync(process.env.HARNESS_PROCESS_PATH, 'utf8');
  assert.match(md, /## 门禁软性提醒（非阻塞）/);
  assert.match(md, /接口测试报告|存储对账记录/);
  // blocking 不应被本机制置为 true（区别于 recordFailOpenEvent 的 fail-open 语义）
  assert.doesNotMatch(md, /blocking:\s*true/);
});
test('R9 软性提醒: recordHotfixP0SoftReminder 幂等——同一 process.md 不重复写入', () => {
  const content = fixtureProcess(
    hotfixProcessBody(['hotfix_p0_impact: p0', 'blocking: false', 'cancelled: false']),
    {
      'docs/test/test-report.md': '# 测试报告\n\n## 集成测试记录\n\n全部通过。\n',
    },
  );
  recordHotfixP0SoftReminder(content);
  const first = fs.readFileSync(process.env.HARNESS_PROCESS_PATH, 'utf8');
  const r2 = recordHotfixP0SoftReminder(content);
  assert.equal(r2.ok, true);
  assert.equal(r2.reason, 'already-recorded');
  const second = fs.readFileSync(process.env.HARNESS_PROCESS_PATH, 'utf8');
  assert.equal(first, second, '第二次调用不应再追加内容');
});
test('R9 软性提醒: 不满足条件（needsReminder=false）时不写入', () => {
  const content = fixtureProcess(
    hotfixProcessBody(['hotfix_p0_impact: p0', 'blocking: false', 'cancelled: false']),
    {
      'docs/test/test-report.md': HOTFIX_STRUCTURED_API_STORAGE_REPORT,
    },
  );
  const r = recordHotfixP0SoftReminder(content);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'not-needed');
  const md = fs.readFileSync(process.env.HARNESS_PROCESS_PATH, 'utf8');
  assert.doesNotMatch(md, /## 门禁软性提醒/);
});
test('R9 软性提醒: cancelled 流程不写入', () => {
  const content = fixtureProcess(
    hotfixProcessBody(['hotfix_p0_impact: p0', 'cancelled: true']),
    {
      'docs/test/test-report.md': '# 测试报告\n\n全部通过。\n',
    },
  );
  const r = recordHotfixP0SoftReminder(content);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'cancelled');
});


