/**
 * 场景套件：teSmokeScenarios（SM0–SM6）
 * 覆盖 R22：TE 最近派发时替代 E2E 启动命令的 deny，以及双要素豁免 ask/allow。
 *
 * 入口：node .codex/scripts/gate-scenarios.mjs；脚手架：./_harness.mjs
 */
import {
  CONFIRM_SECTION,
  ARTIFACT_REF,
  BLOCK_OK,
  REQ_SPEC,
  REQ_LIST,
  DESIGN_SPEC,
  TASK_LIST,
  DPL_CLEAN,
  GATED_EMPTY,
  progressSection,
  relToProject,
  writeFixture,
  check,
  clearDispatchedRoles,
  writeLintPass,
  writeStaticScanPass,
  clearLint,
  clearStaticScan,
  QUALITY_REPORT_CLEAN,
  path,
} from './_harness.mjs';

const ALT_CMD =
  'E2E_WEB_SERVER_COMMAND="npx vite-node ./server/index.ts" node .codex/scripts/e2e-run.mjs --scope=batch --required-ids=R-001';
const NORMAL_E2E = 'node .codex/scripts/e2e-run.mjs --scope=batch --required-ids=R-001';

function teProcessBody({ confirmExtra = '' } = {}) {
  const confirm = confirmExtra
    ? CONFIRM_SECTION.replace(
        '| ------ | ---- | ------------ |\n',
        `| ------ | ---- | ------------ |\n${confirmExtra}`,
      )
    : CONFIRM_SECTION;
  return [
    '---',
    'phase: development',
    'workflow_mode: full',
    'iterationType: greenfield',
    'blocking: false',
    'cancelled: false',
    '---',
    '',
    confirm,
    '',
    '## 当前分派计划',
    '',
    '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
    '| ---------- | -------- | --------- | ---- |',
    '| T0-1 | test-engineer | 串行 | 批次测试 |',
    '',
    '## 待派发角色列表',
    '',
    '| 角色 | 说明 |',
    '| ---- | ---- |',
    '| test-engineer | 批次集成测试 T0-1 |',
    '',
    progressSection([
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '| 质量工程师 | T0-1 | 执行完成 | |',
      '| 测试工程师 | 批次集成测试 T0-1 | 正在执行 | |',
    ]),
    BLOCK_OK,
    '',
    ARTIFACT_REF,
    '',
  ].join('\n');
}

export function teSmokeScenarios() {
  console.log('== TE 冒烟：替代 E2E 启动命令（补强项 3）==');

  const teRoot = writeFixture('te-smoke-deny', {
    'docs/process/process.md': teProcessBody(),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
    'docs/quality/quality-report.md': QUALITY_REPORT_CLEAN,
  });
  const teProc = relToProject(path.join(teRoot, 'docs/process/process.md'));
  const teGated = relToProject(path.join(teRoot, 'docs/design/gated-artifacts.json'));

  clearDispatchedRoles();
  writeLintPass();
  writeStaticScanPass();
  check('SM0 派发 test-engineer（冒烟场景前置）', 'allow', {
    hook: 'role',
    role: 'test-engineer',
    processPath: teProc,
    gatedPath: teGated,
  });
  check('SM1 TE 使用 E2E_WEB_SERVER_COMMAND=vite-node 替代启动被拒', 'deny', {
    hook: 'shell',
    command: ALT_CMD,
    processPath: teProc,
    gatedPath: teGated,
    conversationId: 'subagent-te-smoke-1',
  });
  check('SM2 TE 常规 e2e-run 不受替代启动门禁拦截', 'allow', {
    hook: 'shell',
    command: NORMAL_E2E,
    processPath: teProc,
    gatedPath: teGated,
    conversationId: 'subagent-te-smoke-2',
  });

  const exemptRoot = writeFixture('te-smoke-exempt', {
    'docs/process/process.md': teProcessBody({
      confirmExtra: '| 非 dist 启动 | 2026-07-28 | 确认允许非 dist 启动做 E2E |\n',
    }),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json':
      JSON.stringify(
        {
          e2eAlternativeStartup: 'allowed',
          e2eAlternativeStartupReason: '用户确认允许非 dist 启动做 E2E',
        },
        null,
        2,
      ) + '\n',
    'docs/quality/quality-report.md': QUALITY_REPORT_CLEAN,
  });
  const exProc = relToProject(path.join(exemptRoot, 'docs/process/process.md'));
  const exGated = relToProject(path.join(exemptRoot, 'docs/design/gated-artifacts.json'));
  clearDispatchedRoles();
  check('SM3 派发 TE（双要素豁免 fixture）', 'allow', {
    hook: 'role',
    role: 'test-engineer',
    processPath: exProc,
    gatedPath: exGated,
  });
  check('SM4 TE + e2eAlternativeStartup allowed + 用户确认后替代启动放行', 'allow', {
    hook: 'shell',
    command: ALT_CMD,
    processPath: exProc,
    gatedPath: exGated,
    conversationId: 'subagent-te-smoke-exempt',
  });

  const deRoot = writeFixture('te-smoke-de', {
    'docs/process/process.md': [
      '---',
      'phase: development',
      'workflow_mode: full',
      'iterationType: greenfield',
      'blocking: false',
      'cancelled: false',
      '---',
      '',
      CONFIRM_SECTION,
      '',
      '## 当前分派计划',
      '',
      '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
      '| ---------- | -------- | --------- | ---- |',
      '| T0-1 | development-engineer | 串行 | 进行中 |',
      '',
      '## 待派发角色列表',
      '',
      '| 角色 | 说明 |',
      '| ---- | ---- |',
      '| development-engineer | T0-1 |',
      '',
      progressSection(['| 开发工程师 | T0-1 | 正在执行 | |']),
      BLOCK_OK,
      '',
      ARTIFACT_REF,
      '',
    ].join('\n'),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const deProc = relToProject(path.join(deRoot, 'docs/process/process.md'));
  const deGated = relToProject(path.join(deRoot, 'docs/design/gated-artifacts.json'));
  clearDispatchedRoles();
  check('SM5 派发 development-engineer', 'allow', {
    hook: 'role',
    role: 'development-engineer',
    processPath: deProc,
    gatedPath: deGated,
  });
  check('SM6 DE 使用替代启动命令不触发 TE 冒烟门禁', 'allow', {
    hook: 'shell',
    command: ALT_CMD,
    processPath: deProc,
    gatedPath: deGated,
    conversationId: 'subagent-de-alt',
  });

  clearLint();
  clearStaticScan();
  clearDispatchedRoles();
}