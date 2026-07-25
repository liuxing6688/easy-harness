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

console.log('== R17：业务数据存储对账机读判据 ==');
snapshotReconDir();

test('R17: 缺少存储对账记录章节时校验失败', () => {
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': '# 测试报告\n\n## 接口测试报告\n\n| 接口 | 是否通过 |\n| ---- | -------- |\n| /a | 是 |\n',
  });
  assert.equal(checkBatchStorageReconciliationReport().ok, false);
});
test('R17: 存储对账章节为空（仅表头）时校验失败', () => {
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': STORAGE_RECON_EMPTY,
  });
  assert.equal(checkBatchStorageReconciliationReport().ok, false);
});
test('R17: 缺 E2E 场景类型行时校验失败（未豁免 E2E）', () => {
  ensureDefaultReconEvidence();
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': STORAGE_RECON_API_ONLY,
  });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-e2e-scene-row');
});
test('R17: 缺接口场景类型行时校验失败（未豁免 R14）', () => {
  ensureDefaultReconEvidence();
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': STORAGE_RECON_E2E_ONLY,
  });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-api-scene-row');
});
test('R17: 存储介质列无合法关键词时校验失败', () => {
  ensureDefaultReconEvidence();
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': STORAGE_RECON_BAD_MEDIUM,
  });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid-storage-medium');
});
test('R17: 适用行缺证据路径时校验失败', () => {
  clearReconDir();
  const noEvidence = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 数据库 | SELECT id FROM todos | 有行 | 有行 | 是 | |',
    '| E2E | R-001 | T0-1 | 缓存 | Redis GET todo:1 | 有值 | 有值 | 是 | |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': noEvidence });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-recon-evidence-path');
});
test('R17: 证据路径存在但文件缺失时校验失败', () => {
  clearReconDir();
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': STORAGE_RECON_BOTH,
  });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-recon-evidence-file');
});
test('R17: checkReconEvidenceRef 要求 command/summary/exitCode', () => {
  clearReconDir();
  writeReconEvidence('bad.json', { command: '', summary: 'x', exitCode: 0 });
  assert.equal(checkReconEvidenceRef('test-results/recon/bad.json').reason, 'recon-evidence-missing-command');
  writeReconEvidence('ok.json');
  assert.equal(checkReconEvidenceRef('test-results/recon/ok.json · SELECT 1').ok, true);
});
test('R17: 接口+E2E 行且介质合法（数据库/缓存）时校验通过', () => {
  ensureDefaultReconEvidence();
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': STORAGE_RECON_BOTH,
  });
  assert.equal(checkBatchStorageReconciliationReport().ok, true);
});
test('R17: 文件与对象存储介质关键词可识别', () => {
  ensureDefaultReconEvidence();
  const mixed = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | filesystem | test-results/recon/t0-1-api.json · 读盘 | 存在 | 存在 | 是 | |',
    '| E2E | R-001 | T0-1 | s3 | test-results/recon/t0-1-e2e.json · head | 存在 | 存在 | 是 | |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': mixed });
  assert.equal(checkBatchStorageReconciliationReport().ok, true);
});
test('R17: 「其他」介质缺备注时校验失败', () => {
  ensureDefaultReconEvidence();
  const otherNoNote = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 其他 | test-results/recon/t0-1-api.json · 查外部系统 | 有记录 | 有记录 | 是 | |',
    '| E2E | R-001 | T0-1 | 数据库 | test-results/recon/t0-1-e2e.json · SELECT 1 | 有行 | 有行 | 是 | |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': otherNoNote });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'other-medium-requires-note');
});
test('R17: 「其他」介质含非空备注时校验通过', () => {
  ensureDefaultReconEvidence();
  const otherWithNote = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 其他 | test-results/recon/t0-1-api.json · 查外部系统 | 有记录 | 有记录 | 是 | 业务落盘至自建消息队列 MQ-X |',
    '| E2E | R-001 | T0-1 | 数据库 | test-results/recon/t0-1-e2e.json · SELECT 1 | 有行 | 有行 | 是 | |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': otherWithNote });
  assert.equal(checkBatchStorageReconciliationReport().ok, true);
});
test('R17: 描述列（对账方式/预期/实际/是否通过）为空时校验失败', () => {
  ensureDefaultReconEvidence();
  const missingDesc = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 数据库 | | 有行 | 有行 | 是 | |',
    '| E2E | R-001 | T0-1 | 缓存 | test-results/recon/t0-1-e2e.json · Redis GET | 有值 | 有值 | 是 | |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': missingDesc });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-recon-method');
});
test('R17: 关联任务包为空时校验失败', () => {
  ensureDefaultReconEvidence();
  const missingTask = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | | 数据库 | test-results/recon/t0-1-api.json · SELECT 1 | 有行 | 有行 | 是 | |',
    '| E2E | R-001 | T0-1 | 缓存 | test-results/recon/t0-1-e2e.json · Redis GET | 有值 | 有值 | 是 | |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': missingTask });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-task-package');
});
test('R17: 多批次进度任务包须全部被对账行覆盖（仅覆盖首批不够）', () => {
  ensureDefaultReconEvidence();
  const multiBatchProgress = [
    '---',
    'workflow_mode: full',
    'iterationType: greenfield',
    '---',
    '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    '| 开发工程师 | T0-1 | 执行完成 | |',
    '| 质量工程师 | T0-1 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    '| 开发工程师 | T0-2 | 执行完成 | |',
    '| 质量工程师 | T0-2 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-2 | 执行完成 | |',
    '',
  ].join('\n');
  // 仅覆盖 T0-1，缺 T0-2
  fixtureProcess(multiBatchProgress, { 'docs/test/test-report.md': STORAGE_RECON_BOTH });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.match(r.reason, /^missing-batch-task-coverage:/);
  assert.match(r.reason, /T0-2/);
});
test('R17: 多批次任务包均有对账行时校验通过', () => {
  ensureDefaultReconEvidence();
  const multiBatchProgress = [
    '---',
    'workflow_mode: full',
    'iterationType: greenfield',
    '---',
    '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    '| 开发工程师 | T0-1 | 执行完成 | |',
    '| 质量工程师 | T0-1 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    '| 开发工程师 | T0-2 | 执行完成 | |',
    '| 质量工程师 | T0-2 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-2 | 执行完成 | |',
    '',
  ].join('\n');
  const bothBatches = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 数据库 | test-results/recon/t0-1-api.json · SELECT | 有行 | 有行 | 是 | |',
    '| E2E | R-001 | T0-1 | 缓存 | test-results/recon/t0-1-e2e.json · Redis GET | 有值 | 有值 | 是 | |',
    '| 接口 | R-002 | T0-2 | 数据库 | test-results/recon/t0-2-api.json · SELECT | 有行 | 有行 | 是 | |',
    '| E2E | R-002 | T0-2 | 文件 | test-results/recon/t0-1-e2e.json · 读盘 | 存在 | 存在 | 是 | |',
    '',
  ].join('\n');
  fixtureProcess(multiBatchProgress, { 'docs/test/test-report.md': bothBatches });
  assert.equal(checkBatchStorageReconciliationReport().ok, true);
});
test('R17: 「不适用」介质缺备注时校验失败', () => {
  ensureDefaultReconEvidence();
  const naNoNote = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 数据库 | test-results/recon/t0-1-api.json · SELECT 1 | 有行 | 有行 | 是 | |',
    '| E2E | R-001 | T0-1 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': naNoNote });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'na-medium-requires-note');
});
test('R17: 仅有接口/E2E「不适用」行时校验失败（不能代替真实对账）', () => {
  const onlyNa = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 本任务包无业务数据写入，不适用对账 |',
    '| E2E | R-001 | T0-1 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 本任务包无业务数据写入，不适用对账 |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': onlyNa });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-applicable-recon-row');
});
test('R17: 「不适用」行不计入分类型真实对账（仅有不适用接口行 + 适用 E2E 行仍缺接口）', () => {
  ensureDefaultReconEvidence();
  const naApiOnly = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 本任务包无业务数据写入，不适用对账 |',
    '| E2E | R-001 | T0-1 | 数据库 | test-results/recon/t0-1-e2e.json · SELECT 1 | 有行 | 有行 | 是 | |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': naApiOnly });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-api-scene-row');
});
test('R17: 真实对账行 + 无写入任务包「不适用」留痕时校验通过', () => {
  ensureDefaultReconEvidence();
  const multiBatchProgress = [
    '---',
    'workflow_mode: full',
    'iterationType: greenfield',
    '---',
    '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    '| 开发工程师 | T0-1 | 执行完成 | |',
    '| 质量工程师 | T0-1 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    '| 开发工程师 | T0-2 | 执行完成 | |',
    '| 质量工程师 | T0-2 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-2 | 执行完成 | |',
    '',
  ].join('\n');
  const mixed = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 数据库 | test-results/recon/t0-1-api.json · SELECT | 有行 | 有行 | 是 | |',
    '| E2E | R-001 | T0-1 | 缓存 | test-results/recon/t0-1-e2e.json · Redis GET | 有值 | 有值 | 是 | |',
    '| 接口 | R-002 | T0-2 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 本任务包无业务数据写入，不适用对账 |',
    '',
  ].join('\n');
  fixtureProcess(multiBatchProgress, { 'docs/test/test-report.md': mixed });
  assert.equal(checkBatchStorageReconciliationReport().ok, true);
});
test('R17: 缺存储对账时 batchTestComplete=false', () => {
  const content = fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': API_REPORT_FILLED,
  });
  const state = parseWorkflowState(content);
  assert.equal(state.batchApiReportPresent, true);
  assert.equal(state.batchStorageReconPresent, false);
  assert.equal(state.batchTestComplete, false);
});

console.log('== R17：无业务数据持久化适用性豁免（双要素）==');

test('R17: 仅用户确认但架构师未声明 n/a → 不豁免', () => {
  const content = fixtureProcess(STORAGE_EXEMPT_CONFIRM_PROCESS, {
    'docs/design/none.json': '{}\n',
  });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/none.json';
  assert.equal(isStorageReconciliationExempt(content), false);
});
test('R17: 仅架构师声明 n/a 但无用户确认 → 不豁免', () => {
  const content = fixtureProcess(
    ['---', 'workflow_mode: full', 'iterationType: greenfield', '---', ''].join('\n'),
    { 'docs/design/gated-storage-na.json': STORAGE_NA_GATED },
  );
  process.env.HARNESS_GATED_ARTIFACTS_PATH =
    'test-results/.gate-selftest/docs/design/gated-storage-na.json';
  assert.equal(isStorageReconciliationExempt(content), false);
});
test('R17: 架构师声明 n/a + 用户确认 → 豁免，batchStorageReconPresent 视为满足', () => {
  const content = fixtureProcess(STORAGE_EXEMPT_CONFIRM_PROCESS, {
    'docs/design/gated-storage-na.json': STORAGE_NA_GATED,
  });
  process.env.HARNESS_GATED_ARTIFACTS_PATH =
    'test-results/.gate-selftest/docs/design/gated-storage-na.json';
  assert.equal(isStorageReconciliationExempt(content), true);
  const state = parseWorkflowState(content);
  assert.equal(state.storageReconciliationExempt, true);
  assert.equal(state.batchStorageReconPresent, true);
});
test('R17: API 豁免后仅需 E2E 对账行即可通过机读', () => {
  ensureDefaultReconEvidence();
  const content = fixtureProcess(API_EXEMPT_CONFIRM_PROCESS, {
    'docs/design/gated-na.json': API_NA_GATED,
    'docs/test/test-report.md': STORAGE_RECON_E2E_ONLY,
  });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-na.json';
  assert.equal(isApiTestExempt(content), true);
  assert.equal(checkBatchStorageReconciliationReport(content).ok, true);
});
test('R17: E2E 豁免后仅需接口对账行即可通过机读', () => {
  ensureDefaultReconEvidence();
  const e2eExemptProcess = [
    '---',
    'workflow_mode: full',
    'iterationType: greenfield',
    '---',
    '',
    '## 用户确认记录',
    '',
    '| 确认项 | 时间 | 用户原话摘要 |',
    '| ------ | ---- | ------------ |',
    '| E2E豁免 | 2026-01-01 | 纯后端无 UI，确认豁免 E2E |',
    '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    '| 开发工程师 | T0-1 | 执行完成 | |',
    '',
  ].join('\n');
  const e2eNaGated = '{ "e2eApplicability": "n/a", "e2eApplicabilityReason": "无 UI" }\n';
  const content = fixtureProcess(e2eExemptProcess, {
    'docs/design/gated-e2e-na.json': e2eNaGated,
    'docs/test/test-report.md': STORAGE_RECON_API_ONLY,
  });
  process.env.HARNESS_GATED_ARTIFACTS_PATH =
    'test-results/.gate-selftest/docs/design/gated-e2e-na.json';
  assert.equal(isE2eExempt(content), true);
  assert.equal(checkBatchStorageReconciliationReport(content).ok, true);
});
test('R17: hotfix 折叠通道不并入存储对账判据（batchTestComplete 恒真）', () => {
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
      '',
    ].join('\n'),
  );
  assert.equal(parseWorkflowState(content).batchTestComplete, true);
});
delete process.env.HARNESS_GATED_ARTIFACTS_PATH;


