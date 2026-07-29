/**
 * 场景套件：greenfieldScenarios（G1–G11e）
 * 覆盖 greenfield/full 主路径：分派计划、R3 成果物、角色派发链、写入期门禁、stop 催促闭环。
 *
 * 入口：node .cursor/scripts/gate-scenarios.mjs；脚手架：./_harness.mjs
 */
import {
  CONFIRM_SECTION,
  DISPATCH_SECTION,
  ARTIFACT_REF,
  BLOCK_OK,
  REQ_SPEC,
  REQ_LIST,
  DESIGN_SPEC,
  TASK_LIST,
  DPL_CLEAN,
  DPL_UNRESOLVED,
  GATED_EMPTY,
  TEST_REPORT_API,
  TEST_REPORT_API_NO_STORAGE,
  TEST_REPORT_STORAGE_E2E_ONLY,
  progressSection,
  greenfieldReady,
  API_NA_GATED,
  greenfieldApiExempt,
  greenfieldNoDispatch,
  greenfieldEmpty,
  relToProject,
  writeFixture,
  check,
  writeE2e,
  clearE2e,
  writeLintPass,
  clearLint,
  writeStaticScanPass,
  clearStaticScan,
  path,
  fs
} from './_harness.mjs';

export function greenfieldScenarios() {
  console.log('== 场景 1：首次开发 Greenfield（full）==');

  const empty = writeFixture('gf-empty', {
    'docs/process/process.md': greenfieldEmpty(),
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('G1 需求未就绪时发起 system-architect', 'deny', {
    hook: 'role',
    role: 'system-architect',
    processPath: relToProject(path.join(empty, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(empty, 'docs/design/gated-artifacts.json')),
  });

  const ready = writeFixture('gf-ready', {
    'docs/process/process.md': greenfieldReady(),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const readyProc = relToProject(path.join(ready, 'docs/process/process.md'));
  const readyGated = relToProject(path.join(ready, 'docs/design/gated-artifacts.json'));

  check('G2 需求就绪 + 用户确认后发起 system-architect', 'allow', {
    hook: 'role', role: 'system-architect', processPath: readyProc, gatedPath: readyGated,
  });

  // R25：非 stub 设计文档须含「同构模块识别」章节方可发起设计审核
  const ISO_DESIGN_BASE = ['# detail-design-spec.md', '', '## 2. 系统架构', '', '分层架构：API 层、服务层、数据层。', ''];
  const isoMissing = writeFixture('gf-iso-missing', {
    'docs/process/process.md': greenfieldReady(),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': ISO_DESIGN_BASE.join('\n'),
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('G2b R25：非 stub 设计缺「同构模块识别」章节时发起 requirement-reviewer', 'deny', {
    hook: 'role',
    role: 'requirement-reviewer',
    processPath: relToProject(path.join(isoMissing, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(isoMissing, 'docs/design/gated-artifacts.json')),
  });

  const isoReady = writeFixture('gf-iso-ready', {
    'docs/process/process.md': greenfieldReady(),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': [
      ...ISO_DESIGN_BASE,
      '## 同构模块识别（须逐项列出）',
      '',
      '| 同构组名称 | 涉及范围 | 共享 Primitive 名称 | 落点路径 |',
      '| --- | --- | --- | --- |',
      '| CRUD 路由族 | projects/workspaces | routeSchemas | shared/route-schemas.ts |',
      '',
    ].join('\n'),
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('G2c R25：补齐同构模块识别后发起 requirement-reviewer', 'allow', {
    hook: 'role',
    role: 'requirement-reviewer',
    processPath: relToProject(path.join(isoReady, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(isoReady, 'docs/design/gated-artifacts.json')),
  });

  const badDesign = writeFixture('gf-baddesign', {
    'docs/process/process.md': greenfieldReady(),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_UNRESOLVED,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('G3 设计存在未解决问题时发起 development-engineer', 'deny', {
    hook: 'role',
    role: 'development-engineer',
    processPath: relToProject(path.join(badDesign, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(badDesign, 'docs/design/gated-artifacts.json')),
  });

  const noDispatch = writeFixture('gf-nodispatch', {
    'docs/process/process.md': greenfieldNoDispatch(),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const noDispatchProc = relToProject(path.join(noDispatch, 'docs/process/process.md'));
  const noDispatchGated = relToProject(path.join(noDispatch, 'docs/design/gated-artifacts.json'));

  check('G4 无分派计划写源码', 'deny', {
    hook: 'write', filePath: 'src/app.ts', processPath: noDispatchProc, gatedPath: noDispatchGated,
  });
  check('G5 有分派计划 + 设计审核通过写源码', 'allow', {
    hook: 'write', filePath: 'src/app.ts', processPath: readyProc, gatedPath: readyGated,
  });
  check('G6 设计审核通过 + 有效分派计划发起 development-engineer', 'allow', {
    hook: 'role', role: 'development-engineer', processPath: readyProc, gatedPath: readyGated,
  });
  check('G7 开发未开始发起 quality-engineer', 'deny', {
    hook: 'role', role: 'quality-engineer', processPath: readyProc, gatedPath: readyGated,
  });

  const qeInProgress = writeFixture('gf-qe-inprogress', {
    'docs/process/process.md': [
      '---',
      'phase: development',
      'workflow_mode: full',
      'iterationType: greenfield',
      'blocking: false',
      'cancelled: false',
      '---',
      '',
      ARTIFACT_REF,
      '',
      CONFIRM_SECTION,
      '',
      '## 当前分派计划',
      '',
      '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
      '| ---------- | -------- | --------- | ---- |',
      '| T0-1 | quality-engineer | 串行 | 待 QE |',
      '',
      '## 待派发角色列表',
      '',
      '| 角色 | 说明 |',
      '| ---- | ---- |',
      '| quality-engineer | T0-1 |',
      '',
      progressSection(['| 开发工程师 | T0-1 | 正在执行 | |']),
      '',
      BLOCK_OK,
      '',
    ].join('\n'),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('G7b 开发正在执行时发起 quality-engineer（对应任务包未完成）', 'deny', {
    hook: 'role',
    role: 'quality-engineer',
    processPath: relToProject(path.join(qeInProgress, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(qeInProgress, 'docs/design/gated-artifacts.json')),
  });

  const qeReady = writeFixture('gf-qe-ready', {
    'docs/process/process.md': [
      '---',
      'phase: development',
      'workflow_mode: full',
      'iterationType: greenfield',
      'blocking: false',
      'cancelled: false',
      '---',
      '',
      ARTIFACT_REF,
      '',
      CONFIRM_SECTION,
      '',
      '## 当前分派计划',
      '',
      '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
      '| ---------- | -------- | --------- | ---- |',
      '| T0-1 | quality-engineer | 串行 | 待 QE |',
      '',
      '## 待派发角色列表',
      '',
      '| 角色 | 说明 |',
      '| ---- | ---- |',
      '| quality-engineer | T0-1 |',
      '',
      progressSection(['| 开发工程师 | T0-1 | 执行完成 | |']),
      '',
      BLOCK_OK,
      '',
    ].join('\n'),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('G7c 对应开发线执行完成且分派含任务包时允许发起 quality-engineer', 'allow', {
    hook: 'role',
    role: 'quality-engineer',
    processPath: relToProject(path.join(qeReady, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(qeReady, 'docs/design/gated-artifacts.json')),
  });

  check('G8 QE 未过发起 test-engineer', 'deny', {
    hook: 'role', role: 'test-engineer', processPath: readyProc, gatedPath: readyGated,
  });

  const stopDev = writeFixture('gf-stop-dev', {
    'docs/process/process.md': greenfieldReady(['| 开发工程师 | T0-1 | 正在执行 | |']),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
  });
  clearE2e('batch');
  clearE2e('final');
  check('G9 开发「正在执行」就想收尾', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopDev, 'docs/process/process.md')),
  });

  const stopBatchFail = writeFixture('gf-stop-batchfail', {
    'docs/process/process.md': greenfieldReady([
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '| 质量工程师 | T0-1 | 执行完成 | |',
      '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    ]),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
  });
  writeE2e('batch', { requiredIds: ['R-001'], failed: ['R-001'] });
  clearE2e('final');
  writeLintPass();
  writeStaticScanPass();
  check('G10 批次 E2E 失败就想推进/收尾', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopBatchFail, 'docs/process/process.md')),
  });

  const stopBatchNoApi = writeFixture('gf-stop-batch-noapi', {
    'docs/process/process.md': greenfieldReady([
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '| 质量工程师 | T0-1 | 执行完成 | |',
      '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    ]),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
  });
  writeE2e('batch', { requiredIds: ['R-001'], passed: ['R-001'] });
  clearE2e('final');
  writeLintPass();
  writeStaticScanPass();
  check('G10b R14：批次 E2E 过但缺接口测试报告章节', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopBatchNoApi, 'docs/process/process.md')),
  });

  const stopBatchNoStorage = writeFixture('gf-stop-batch-nostorage', {
    'docs/process/process.md': greenfieldReady([
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '| 质量工程师 | T0-1 | 执行完成 | |',
      '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    ]),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/test/test-report.md': TEST_REPORT_API_NO_STORAGE,
  });
  writeE2e('batch', { requiredIds: ['R-001'], passed: ['R-001'] });
  clearE2e('final');
  writeLintPass();
  writeStaticScanPass();
  check('G10c R17：批次 E2E+接口报告齐但缺存储对账记录', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopBatchNoStorage, 'docs/process/process.md')),
  });

  const stopFinal = writeFixture('gf-stop-final', {
    'docs/process/process.md': greenfieldReady([
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '| 质量工程师 | T0-1 | 执行完成 | |',
      '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
      '| 测试工程师 | 最终整体集成测试 | 执行完成 | |',
    ]),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/test/test-report.md': TEST_REPORT_API,
  });
  writeE2e('batch', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeE2e('final', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeLintPass();
  writeStaticScanPass();
  check('G11 最终 E2E 通过 + 批次接口测试报告齐备 + lint 通过 + 静态代码质量门禁通过后收尾（唯一放行点）', 'allow-stop', {
    hook: 'stop', processPath: relToProject(path.join(stopFinal, 'docs/process/process.md')),
  });
  clearE2e('batch');
  clearE2e('final');

  const stopApiNaOnly = writeFixture('gf-stop-apina-only', {
    'docs/process/process.md': greenfieldReady([
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '| 质量工程师 | T0-1 | 执行完成 | |',
      '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    ]),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': API_NA_GATED,
  });
  writeE2e('batch', { requiredIds: ['R-001'], passed: ['R-001'] });
  clearE2e('final');
  writeLintPass();
  writeStaticScanPass();
  check('G11b R14：仅声明 apiTestApplicability n/a 但无用户确认 → 不豁免', 'followup', {
    hook: 'stop',
    processPath: relToProject(path.join(stopApiNaOnly, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(stopApiNaOnly, 'docs/design/gated-artifacts.json')),
  });

  const stopApiExempt = writeFixture('gf-stop-apiexempt', {
    'docs/process/process.md': greenfieldApiExempt([
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '| 质量工程师 | T0-1 | 执行完成 | |',
      '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
      '| 测试工程师 | 最终整体集成测试 | 执行完成 | |',
    ]),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': API_NA_GATED,
    'docs/test/test-report.md': TEST_REPORT_STORAGE_E2E_ONLY,
  });
  writeE2e('batch', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeE2e('final', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeLintPass();
  writeStaticScanPass();
  check('G11c R14：无接口项目声明豁免 + 用户确认后无接口测试报告也可收尾', 'allow-stop', {
    hook: 'stop',
    processPath: relToProject(path.join(stopApiExempt, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(stopApiExempt, 'docs/design/gated-artifacts.json')),
  });

  const STORAGE_EXEMPT_CONFIRM = [
    '## 用户确认记录',
    '',
    '| 确认项 | 时间 | 用户原话摘要 |',
    '| ------ | ---- | ------------ |',
    '| 需求摘要 | 2026-01-01 | 已确认 |',
    '| 技术选型 | 2026-01-01 | 确认采用 Node.js |',
    '| 存储对账豁免 | 2026-01-01 | 无业务数据持久化，确认豁免存储对账 |',
  ].join('\n');
  const STORAGE_NA_GATED =
    '{\n  "storageReconciliationApplicability": "n/a",\n  "storageReconciliationApplicabilityReason": "无业务数据持久化"\n}\n';
  function greenfieldStorageExempt(progressRows = []) {
    return [
      '---',
      'phase: development',
      'workflow_mode: full',
      'iterationType: greenfield',
      'blocking: false',
      'cancelled: false',
      '---',
      '',
      '# 流程进度记录',
      '',
      ARTIFACT_REF,
      '',
      STORAGE_EXEMPT_CONFIRM,
      '',
      DISPATCH_SECTION,
      '',
      progressSection(progressRows),
      '',
      BLOCK_OK,
      '',
    ].join('\n');
  }

  const stopStorageNaOnly = writeFixture('gf-stop-storagena-only', {
    'docs/process/process.md': greenfieldReady([
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '| 质量工程师 | T0-1 | 执行完成 | |',
      '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    ]),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': STORAGE_NA_GATED,
    'docs/test/test-report.md': TEST_REPORT_API_NO_STORAGE,
  });
  writeE2e('batch', { requiredIds: ['R-001'], passed: ['R-001'] });
  clearE2e('final');
  writeLintPass();
  writeStaticScanPass();
  check('G11d R17：仅声明 storageReconciliationApplicability n/a 但无用户确认 → 不豁免', 'followup', {
    hook: 'stop',
    processPath: relToProject(path.join(stopStorageNaOnly, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(stopStorageNaOnly, 'docs/design/gated-artifacts.json')),
  });

  const stopStorageExempt = writeFixture('gf-stop-storageexempt', {
    'docs/process/process.md': greenfieldStorageExempt([
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '| 质量工程师 | T0-1 | 执行完成 | |',
      '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
      '| 测试工程师 | 最终整体集成测试 | 执行完成 | |',
    ]),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': STORAGE_NA_GATED,
    'docs/test/test-report.md': TEST_REPORT_API_NO_STORAGE,
  });
  writeE2e('batch', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeE2e('final', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeLintPass();
  writeStaticScanPass();
  check('G11e R17：无持久化声明豁免 + 用户确认后无存储对账记录也可收尾', 'allow-stop', {
    hook: 'stop',
    processPath: relToProject(path.join(stopStorageExempt, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(stopStorageExempt, 'docs/design/gated-artifacts.json')),
  });
  clearE2e('batch');
  clearE2e('final');
  clearLint();
  clearStaticScan();
}

