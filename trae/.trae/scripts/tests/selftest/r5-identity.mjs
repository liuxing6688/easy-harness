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
  recordRootConversationId, writeRootSessionIdToEnvFile, readRootSessionIdFromEnv,
  checkLiteModeConfirmed, hasLiteModeConfirmation, getWorkflowMode,
  getDeclaredWorkflowMode, readRootConversationId, isRootConversationCaller, recordDispatchedRole,
  readRecentlyDispatchedRoles, isGatedRoleArtifactPath, expectedRolesForPath,
  checkRolePathPermission, collectActiveRoleSlugs, checkReconEvidenceRef,
  excerptInDesignAnchorWindow, extractDesignSectionWindow,
  resolveLintCommand, computeLintGate, resolveDupCommand, resolveSecurityCommand,
  computeSubGate, computeStaticScanGate,
  snapshotLintResult, restoreLintResult, writeLintResult, clearLintResult,
  snapshotStaticScanResult, restoreStaticScanResult, writeStaticScanResult, clearStaticScanResult,
  snapshotRootConversationState, restoreRootConversationState, clearRootConversationState,
  snapshotRootSessionEnv, restoreRootSessionEnv, clearRootSessionEnv, setRootSessionEnv,
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
snapshotRootSessionEnv();
test('R5: 未记录顶层会话 id 时 readRootConversationId 返回 null', () => {
  clearRootConversationState();
  clearRootSessionEnv();
  assert.equal(readRootConversationId(), null);
});
test('R5: 未记录顶层会话 id 时 isRootConversationCaller 恒 false（fail-open，不误报）', () => {
  clearRootConversationState();
  clearRootSessionEnv();
  assert.equal(isRootConversationCaller('any-conversation-id'), false);
});
test('R5: recordRootConversationId 首次写入后 readRootConversationId 可读回', () => {
  clearRootConversationState();
  clearRootSessionEnv();
  recordRootConversationId('root-conv-abc');
  assert.equal(readRootConversationId(), 'root-conv-abc');
});
test('R5: recordRootConversationId 只记录一次，不覆盖已有值（防嵌套子代理误写基准）', () => {
  clearRootConversationState();
  clearRootSessionEnv();
  recordRootConversationId('root-conv-abc');
  recordRootConversationId('some-nested-subagent-id');
  assert.equal(readRootConversationId(), 'root-conv-abc');
});
test('R5: isRootConversationCaller 对等于顶层会话 id 的调用返回 true', () => {
  clearRootConversationState();
  clearRootSessionEnv();
  recordRootConversationId('root-conv-abc');
  assert.equal(isRootConversationCaller('root-conv-abc'), true);
});
test('R5: isRootConversationCaller 对子代理自己独立的 session_id 返回 false', () => {
  clearRootConversationState();
  clearRootSessionEnv();
  recordRootConversationId('root-conv-abc');
  assert.equal(isRootConversationCaller('subagent-conv-xyz'), false);
});
test('R5: isRootConversationCaller 对缺失/空 session_id 返回 false（fail-open）', () => {
  clearRootConversationState();
  clearRootSessionEnv();
  recordRootConversationId('root-conv-abc');
  assert.equal(isRootConversationCaller(undefined), false);
  assert.equal(isRootConversationCaller(''), false);
  assert.equal(isRootConversationCaller(null), false);
});
test('R5: recordRootConversationId 对空/非字符串值不写入', () => {
  clearRootConversationState();
  clearRootSessionEnv();
  recordRootConversationId(undefined);
  recordRootConversationId(null);
  recordRootConversationId(123);
  assert.equal(readRootConversationId(), null);
});

// P2-2/P2-3 修复：$TRAE_ENV_FILE 主源（env var）优先级与跨会话隔离测试
console.log('== R5 P2-2/P2-3：$TRAE_ENV_FILE 主源（env var 优先）跨会话隔离 ==');
test('R5 P2-2: readRootSessionIdFromEnv 读取 process.env.ROOT_SESSION_ID', () => {
  clearRootSessionEnv();
  assert.equal(readRootSessionIdFromEnv(), null);
  setRootSessionEnv('env-root-xyz');
  assert.equal(readRootSessionIdFromEnv(), 'env-root-xyz');
});
test('R5 P2-2: readRootConversationId 优先返回 env var（而非持久化文件）', () => {
  clearRootConversationState();
  clearRootSessionEnv();
  recordRootConversationId('file-root-abc');
  setRootSessionEnv('env-root-xyz');
  assert.equal(readRootConversationId(), 'env-root-xyz', 'env var 须优先于文件');
});
test('R5 P2-2: env var 缺失时回退持久化文件（子代理会话兜底）', () => {
  clearRootConversationState();
  clearRootSessionEnv();
  recordRootConversationId('file-root-abc');
  assert.equal(readRootConversationId(), 'file-root-abc', '无 env 时回退文件');
});
test('R5 P2-2: env var 空白时回退持久化文件', () => {
  clearRootConversationState();
  clearRootSessionEnv();
  recordRootConversationId('file-root-abc');
  setRootSessionEnv('   ');
  assert.equal(readRootConversationId(), 'file-root-abc', '空白 env 视为缺失');
});
test('R5 P2-2/P2-3 跨会话隔离: 新会话 env var 优先，旧持久化文件陈旧不再导致 R5 fail-open', () => {
  // 模拟会话1：文件写入 root-abc（first-write-wins）
  clearRootConversationState();
  clearRootSessionEnv();
  recordRootConversationId('root-abc');
  assert.equal(isRootConversationCaller('root-abc'), true, '会话1：顶层代写应被拦截');
  // 模拟会话2：持久化文件仍为 root-abc（first-write-wins 不覆盖），但 env var 注入新根 id root-xyz
  setRootSessionEnv('root-xyz');
  // 旧 bug：readRootConversationId() 读文件返回 root-abc → isRoot('root-xyz')=false → R5 fail-open
  // 修复后：readRootConversationId() 优先读 env var 返回 root-xyz → isRoot('root-xyz')=true → 拦截
  assert.equal(readRootConversationId(), 'root-xyz', '会话2：env var 提供新鲜根 id');
  assert.equal(isRootConversationCaller('root-xyz'), true, '会话2：顶层代写仍被拦截（bug 已修复）');
  assert.equal(isRootConversationCaller('subagent-xyz'), false, '会话2：子代理 session_id 仍放行');
});
test('R5 P2-2: writeRootSessionIdToEnvFile 非 SessionStart 上下文（无 TRAE_ENV_FILE）跳过', () => {
  const saved = process.env.TRAE_ENV_FILE;
  const savedClaude = process.env.CLAUDE_ENV_FILE;
  delete process.env.TRAE_ENV_FILE;
  delete process.env.CLAUDE_ENV_FILE;
  assert.equal(writeRootSessionIdToEnvFile('root-xyz'), false, '无 env file 路径时返回 false');
  assert.equal(writeRootSessionIdToEnvFile(null), false, '空 session_id 返回 false');
  assert.equal(writeRootSessionIdToEnvFile(123), false, '非字符串返回 false');
  process.env.TRAE_ENV_FILE = saved;
  process.env.CLAUDE_ENV_FILE = savedClaude;
});
test('R5 P2-2: writeRootSessionIdToEnvFile 写入 dotenv 格式到 $TRAE_ENV_FILE', () => {
  const tmpDir = path.join(FIXTURE_ROOT, 'env-file-test');
  fs.mkdirSync(tmpDir, { recursive: true });
  const envFile = path.join(tmpDir, '.trae-env');
  fs.writeFileSync(envFile, 'EXISTING_VAR=keep\n', 'utf8');
  const saved = process.env.TRAE_ENV_FILE;
  process.env.TRAE_ENV_FILE = envFile;
  try {
    const ok = writeRootSessionIdToEnvFile('root-via-env-file');
    assert.equal(ok, true);
    const content = fs.readFileSync(envFile, 'utf8');
    assert.match(content, /EXISTING_VAR=keep/, 'append 模式不覆盖已有变量');
    assert.match(content, /ROOT_SESSION_ID=root-via-env-file/, '写入 dotenv 格式');
  } finally {
    process.env.TRAE_ENV_FILE = saved;
    fs.rmSync(envFile, { force: true });
  }
});
restoreRootSessionEnv();
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

