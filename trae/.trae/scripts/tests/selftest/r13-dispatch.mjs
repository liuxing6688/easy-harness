/**
 * R13：角色派发门禁链（checkRoleDispatchGate）各角色前置条件。
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
  checkIsomorphicModuleSection, checkIsomorphicModuleSectionReady,
  resolveLintCommand, computeLintGate, resolveDupCommand, resolveSecurityCommand,
  computeSubGate, computeStaticScanGate,
  snapshotLintResult, restoreLintResult, writeLintResult, clearLintResult,
  snapshotStaticScanResult, restoreStaticScanResult, writeStaticScanResult, clearStaticScanResult,
  snapshotRootConversationState, restoreRootConversationState, clearRootConversationState,
  snapshotReconDir, restoreReconDir, writeReconEvidence, clearReconDir, ensureDefaultReconEvidence,
  snapshotDispatchedRoles, restoreDispatchedRoles, clearDispatchedRoles,
  extractPlannedRoles, checkDispatchPlanMatch,
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

console.log('== R13：成果物门禁链机械化（Task 前置校验）==');
test('R13: 已取消流程禁止发起受门禁角色（PM 例外见 hardening 套件 CX1–CX3）', () => {
  // 注意：本用例测的是库函数 checkRoleDispatchGate。Hook 入口
  // gate-role-sequence.mjs 另有 R10 前置判定，覆盖「不在门禁表」的
  // requirements-analyst 等角色，并只为 project-manager 留逃生口。
  fixtureProcess('---\nworkflow_mode: full\ncancelled: true\n---\n');
  const result = checkRoleDispatchGate('development-engineer');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'cancelled');
});
test('R13: project-manager / requirements-analyst 不在门禁表中，恒放行', () => {
  fixtureProcess('---\nworkflow_mode: full\n---\n');
  assert.equal(checkRoleDispatchGate('project-manager').ok, true);
  assert.equal(checkRoleDispatchGate('requirements-analyst').ok, true);
});
test('R13: 需求成果物未就绪时禁止发起 system-architect', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
      '## 用户确认记录',
      '',
      '| 确认项 | 时间 | 用户原话摘要 |',
      '| ------ | ---- | ------------ |',
      '',
    ].join('\n'),
  );
  assert.equal(checkRoleDispatchGate('system-architect').ok, false);
});
test('R13: 需求成果物就绪且有用户确认记录时允许发起 system-architect', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
      '## 用户确认记录',
      '',
      '| 确认项 | 时间 | 用户原话摘要 |',
      '| ------ | ---- | ------------ |',
      '| 需求摘要 | 2026-01-01 | 用户确认无误 |',
      '',
    ].join('\n'),
    {
      'docs/requirement/requirement-spec.md': [
        '# spec',
        '',
        '## 隐性需求确认记录',
        '',
        '| 类别 | 要点 | 用户确认摘要 | 关联需求/§7 追溯 | 状态 | 影响/决策点 |',
        '| ---- | ---- | ------------ | ---------------- | ---- | ------------ |',
        '| 排查结论 | 已排查，无额外隐性假设 | 用户确认现有描述已完整 | R-001；§7 追溯-001 | 已确认 | 已确认不影响额外范围 |',
        '',
      ].join('\n'),
      'docs/requirement/requirement-list.md': '# list',
    },
  );
  assert.equal(checkRoleDispatchGate('system-architect').ok, true);
});
test('R19: 需求说明书隐性需求确认记录为空时禁止发起 system-architect', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
      '## 用户确认记录',
      '',
      '| 确认项 | 时间 | 用户原话摘要 |',
      '| ------ | ---- | ------------ |',
      '| 需求摘要 | 2026-01-01 | 用户确认无误 |',
      '',
    ].join('\n'),
    {
      'docs/requirement/requirement-spec.md':
        '# spec\n\n## 隐性需求确认记录\n\n| 类别 | 要点 | 用户确认摘要 | 关联需求/§7 追溯 | 状态 | 影响/决策点 |\n| ---- | ---- | ------------ | ---------------- | ---- | ------------ |\n',
      'docs/requirement/requirement-list.md': '# list',
    },
  );
  const r = checkRoleDispatchGate('system-architect');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-implicit-requirement-record');
});
test('R19: 隐性需求记录缺关联需求与 §7 追溯时禁止发起 system-architect', () => {
  fixtureProcess(
    ['---', 'workflow_mode: full', '---', '', '## 用户确认记录', '', '| 确认项 | 时间 | 用户原话摘要 |', '| ------ | ---- | ------------ |', '| 需求摘要 | 2026-01-01 | 用户确认无误 |', ''].join('\n'),
    {
      'docs/requirement/requirement-spec.md':
        '# spec\n\n## 隐性需求确认记录\n\n| 类别 | 要点 | 用户确认摘要 | 关联需求/§7 追溯 | 状态 | 影响/决策点 |\n| ---- | ---- | ------------ | ---------------- | ---- | ------------ |\n| 假设 | 默认用户已登录 | 用户确认 | R-001 | 已确认 | 未登录不适用 |\n',
      'docs/requirement/requirement-list.md': '# list',
    },
  );
  const r = checkRoleDispatchGate('system-architect');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-implicit-requirement-trace');
});
test('R19: 待决假设未写责任方与最晚决策点时禁止发起 system-architect', () => {
  fixtureProcess(
    ['---', 'workflow_mode: full', '---', '', '## 用户确认记录', '', '| 确认项 | 时间 | 用户原话摘要 |', '| ------ | ---- | ------------ |', '| 需求摘要 | 2026-01-01 | 用户确认无误 |', ''].join('\n'),
    {
      'docs/requirement/requirement-spec.md':
        '# spec\n\n## 隐性需求确认记录\n\n| 类别 | 要点 | 用户确认摘要 | 关联需求/§7 追溯 | 状态 | 影响/决策点 |\n| ---- | ---- | ------------ | ---------------- | ---- | ------------ |\n| 待决 | 是否保留旧入口 | 用户同意暂缓决定 | R-001；§7 追溯-001 | 待决假设 | 影响导航路径 |\n',
      'docs/requirement/requirement-list.md': '# list',
    },
  );
  const r = checkRoleDispatchGate('system-architect');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'incomplete-pending-assumption-decision');
});
test('R13: 设计问题清单存在未解决问题时禁止发起 development-engineer', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
      SELFTEST_TECH_CONFIRM,
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
    ].join('\n'),
    {
      'docs/design/detail-design-spec.md': '# design',
      'docs/design/develop-task-list.md': '# tasks',
      'docs/design/design-problem-list.md': SELFTEST_DPL_UNRESOLVED,
      'docs/requirement/requirement-list.md': SELFTEST_REQ_LIST,
    },
  );
  const result = checkRoleDispatchGate('development-engineer');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unresolved-design-issues');
});
test('R13: 设计审核通过 + 有效分派计划时允许发起 development-engineer', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
      SELFTEST_TECH_CONFIRM,
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
    ].join('\n'),
    {
      'docs/design/detail-design-spec.md': '# design',
      'docs/design/develop-task-list.md': '# tasks',
      'docs/design/design-problem-list.md': SELFTEST_DPL_CLEAN,
      'docs/requirement/requirement-list.md': SELFTEST_REQ_LIST,
    },
  );
  const result = checkRoleDispatchGate('development-engineer');
  assert.equal(result.ok, true);
});
test('R13: 缺少技术选型确认时禁止发起 development-engineer', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
      '## 用户确认记录',
      '',
      '| 确认项 | 时间 | 用户原话摘要 |',
      '| ------ | ---- | ------------ |',
      '| 需求摘要 | 2026-01-01 | 已确认 |',
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
    ].join('\n'),
    {
      'docs/design/detail-design-spec.md': '# design',
      'docs/design/develop-task-list.md': '# tasks',
      'docs/design/design-problem-list.md': SELFTEST_DPL_CLEAN,
      'docs/requirement/requirement-list.md': SELFTEST_REQ_LIST,
    },
  );
  const result = checkRoleDispatchGate('development-engineer');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-tech-selection-confirmation');
});
test('R13: 缺少技术选型确认时禁止发起 requirement-reviewer', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
      '## 用户确认记录',
      '',
      '| 确认项 | 时间 | 用户原话摘要 |',
      '| ------ | ---- | ------------ |',
      '| 需求摘要 | 2026-01-01 | 已确认 |',
      '',
    ].join('\n'),
    {
      'docs/design/detail-design-spec.md': '# design',
      'docs/design/develop-task-list.md': '# tasks',
    },
  );
  const result = checkRoleDispatchGate('requirement-reviewer');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-tech-selection-confirmation');
});

const R25_TECH_CONFIRM = [
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 技术选型 | 2026-01-01 | 用户确认采用 Node.js |',
  '',
].join('\n');

console.log('== R32：分派计划匹配（R8 越级派发机械化）==');
test('R32: 无分派计划时 fail-open（PM 尚未写计划）', () => {
  fixtureProcess('---\nworkflow_mode: full\n---\n');
  // SA 不在门禁表中但无分派计划 -> fail-open
  assert.equal(checkDispatchPlanMatch('system-architect').ok, true);
  assert.equal(checkDispatchPlanMatch('system-architect').reason, 'no-plan-fail-open');
});
test('R32: 角色在待派发角色列表中时放行', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
      '## 待派发角色列表',
      '',
      '| 角色 | 说明 |',
      '| ---- | ---- |',
      '| system-architect | 需求已就绪 |',
      '',
    ].join('\n'),
  );
  const r = checkDispatchPlanMatch('system-architect');
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'in-plan');
});
test('R32: 角色在当前分派计划中时放行（中文角色名）', () => {
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
      '| T0-1 | 开发工程师 | 串行 | 待开发 |',
      '',
    ].join('\n'),
  );
  const r = checkDispatchPlanMatch('development-engineer');
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'in-plan');
});
test('R32: 角色不在分派计划中时拒绝（PM 已计划其他角色）', () => {
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
    ].join('\n'),
  );
  // 顶层想派 SA，但 PM 只计划了 DE -> 越级派发，拒绝
  const r = checkDispatchPlanMatch('system-architect');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-in-dispatch-plan');
});
test('R32: checkRoleDispatchGate 集成——角色不在分派计划时被拒', () => {
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
    ].join('\n'),
  );
  const r = checkRoleDispatchGate('system-architect');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-in-dispatch-plan');
});
test('R32: extractPlannedRoles 解析两节合并去重', () => {
  const content = [
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
    '| test-engineer | T0-1 |',
    '',
  ].join('\n');
  const roles = extractPlannedRoles(content);
  assert.equal(roles.size, 2);
  assert.equal(roles.has('development-engineer'), true);
  assert.equal(roles.has('test-engineer'), true);
  assert.equal(roles.has('system-architect'), false);
});

console.log('== R25：设计阶段「同构模块识别」章节机读 ==');
test('R25: 设计文档为 stub 时跳过同构模块识别校验，允许发起 requirement-reviewer', () => {
  fixtureProcess(
    ['---', 'workflow_mode: full', '---', '', R25_TECH_CONFIRM].join('\n'),
    {
      'docs/design/detail-design-spec.md': '# design',
      'docs/design/develop-task-list.md': '# tasks',
    },
  );
  assert.equal(checkIsomorphicModuleSectionReady().ok, true);
  assert.equal(checkRoleDispatchGate('requirement-reviewer').ok, true);
});
test('R25: 非 stub 设计文档缺少「同构模块识别」章节时禁止发起 requirement-reviewer', () => {
  fixtureProcess(
    ['---', 'workflow_mode: full', '---', '', R25_TECH_CONFIRM].join('\n'),
    {
      'docs/design/detail-design-spec.md': [
        '# 详细设计说明书',
        '',
        '## 2. 系统架构',
        '',
        '本项目采用分层架构，划分 API 层、服务层、数据层。',
        '',
        '## 3. 目录结构',
        '',
        '| 路径 | 用途 |',
        '| ---- | ---- |',
        '| src/ | 源码 |',
        '',
      ].join('\n'),
      'docs/design/develop-task-list.md': '# tasks',
    },
  );
  const r = checkRoleDispatchGate('requirement-reviewer');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-isomorphic-module-section');
});
test('R25: 声明「已排查，无同构资源族」但缺排查依据时禁止发起 requirement-reviewer', () => {
  fixtureProcess(
    ['---', 'workflow_mode: full', '---', '', R25_TECH_CONFIRM].join('\n'),
    {
      'docs/design/detail-design-spec.md': [
        '# 详细设计说明书',
        '',
        '## 2. 系统架构',
        '',
        '本项目采用分层架构。',
        '',
        '## 同构模块识别（须逐项列出）',
        '',
        '已排查，无同构资源族。',
        '',
        '## 3. 目录结构',
        '',
      ].join('\n'),
      'docs/design/develop-task-list.md': '# tasks',
    },
  );
  const r = checkRoleDispatchGate('requirement-reviewer');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'isomorphic-no-group-missing-rationale');
});
test('R25: 声明「已排查，无同构资源族」且附排查依据时允许发起 requirement-reviewer', () => {
  fixtureProcess(
    ['---', 'workflow_mode: full', '---', '', R25_TECH_CONFIRM].join('\n'),
    {
      'docs/design/detail-design-spec.md': [
        '# 详细设计说明书',
        '',
        '## 2. 系统架构',
        '',
        '本项目采用分层架构。',
        '',
        '## 同构模块识别（须逐项列出）',
        '',
        '已排查，无同构资源族：本项目仅一个 CRUD 资源，无并行同构页面或测试脚手架。',
        '',
        '## 3. 目录结构',
        '',
      ].join('\n'),
      'docs/design/develop-task-list.md': '# tasks',
    },
  );
  assert.equal(checkRoleDispatchGate('requirement-reviewer').ok, true);
});
test('R25: 同构组表格存在但无真实数据行时禁止发起 requirement-reviewer', () => {
  fixtureProcess(
    ['---', 'workflow_mode: full', '---', '', R25_TECH_CONFIRM].join('\n'),
    {
      'docs/design/detail-design-spec.md': [
        '# 详细设计说明书',
        '',
        '## 2. 系统架构',
        '',
        '本项目采用分层架构。',
        '',
        '## 同构模块识别（须逐项列出）',
        '',
        '| 同构组名称 | 涉及范围 | 共享 Primitive 名称 | 落点路径 |',
        '| ---------- | -------- | -------------------- | -------- |',
        '| | | | |',
        '',
        '## 3. 目录结构',
        '',
      ].join('\n'),
      'docs/design/develop-task-list.md': '# tasks',
    },
  );
  const r = checkRoleDispatchGate('requirement-reviewer');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'isomorphic-module-table-empty');
});
test('R25: 同构组表格含真实数据行且字段完整时允许发起 requirement-reviewer', () => {
  fixtureProcess(
    ['---', 'workflow_mode: full', '---', '', R25_TECH_CONFIRM].join('\n'),
    {
      'docs/design/detail-design-spec.md': [
        '# 详细设计说明书',
        '',
        '## 2. 系统架构',
        '',
        '本项目采用分层架构。',
        '',
        '## 同构模块识别（须逐项列出）',
        '',
        '| 同构组名称 | 涉及范围 | 共享 Primitive 名称 | 落点路径 |',
        '| ---------- | -------- | -------------------- | -------- |',
        '| CRUD 路由族 | projects/workspaces | routeSchemas | shared/route-schemas.ts |',
        '',
        '## 3. 目录结构',
        '',
      ].join('\n'),
      'docs/design/develop-task-list.md': '# tasks',
    },
  );
  assert.equal(checkRoleDispatchGate('requirement-reviewer').ok, true);
});
test('R25: 出厂 detail-design-spec 模板未填写时不得通过（防说明文字使门禁空转）', () => {
  const template = fs.readFileSync(
    path.join(PROJECT_ROOT, '.trae/templates/detail-design-spec.md'),
    'utf8',
  );
  fixtureProcess(
    ['---', 'workflow_mode: full', '---', '', R25_TECH_CONFIRM].join('\n'),
    {
      'docs/design/detail-design-spec.md': template,
      'docs/design/develop-task-list.md': '# tasks',
    },
  );
  const r = checkRoleDispatchGate('requirement-reviewer');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'isomorphic-module-table-empty');
});
test('R25: 出厂模板填入真实同构组数据行后允许发起 requirement-reviewer', () => {
  const template = fs.readFileSync(
    path.join(PROJECT_ROOT, '.trae/templates/detail-design-spec.md'),
    'utf8',
  );
  const filled = template.replace(
    '| | | | |',
    '| CRUD 路由族 | projects/workspaces | routeSchemas | shared/route-schemas.ts |',
  );
  fixtureProcess(
    ['---', 'workflow_mode: full', '---', '', R25_TECH_CONFIRM].join('\n'),
    {
      'docs/design/detail-design-spec.md': filled,
      'docs/design/develop-task-list.md': '# tasks',
    },
  );
  assert.equal(checkRoleDispatchGate('requirement-reviewer').ok, true);
});
test('R25: 模板说明文字中的「已排查，无同构资源族」示例句不得替代架构师声明', () => {
  const designWithOnlyTemplateHint = [
    '# 详细设计说明书',
    '',
    '## 2. 系统架构',
    '',
    '本项目采用分层架构。',
    '',
    '## 同构模块识别（须逐项列出）',
    '',
    '> **机制说明**：若确认无同构资源族，须写「已排查，无同构资源族」并附排查依据，不得留空。',
    '',
    '## 3. 目录结构',
    '',
  ].join('\n');
  const r = checkIsomorphicModuleSection(designWithOnlyTemplateHint);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-isomorphic-module-table');
});
test('R25: hotfix 模式豁免同构模块识别机械校验', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: hotfix',
      'hotfix_p0_impact: none',
      '---',
      '',
      '## 用户确认记录',
      '',
      '| 确认项 | 时间 | 用户原话摘要 |',
      '| ------ | ---- | ------------ |',
      '| 工作流模式确认 | 2026-01-01 | 确认采用 workflow_mode: hotfix |',
      '| hotfix影响面 | 2026-01-01 | 受影响用户：无；既有行为：不改变；回滚条件：git revert；已比对全部 P0，不涉及 | ',
      '',
    ].join('\n'),
    {
      'docs/design/detail-design-spec.md': [
        '# 详细设计说明书',
        '',
        '## 2. 系统架构',
        '',
        '最小热修设计，仅涉及登录接口修复。',
        '',
      ].join('\n'),
      'docs/design/develop-task-list.md': '# tasks',
    },
  );
  assert.equal(checkRoleDispatchGate('requirement-reviewer').ok, true);
});
