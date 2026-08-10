/**
 * 场景套件：startupSmokeScenarios（SS0–SS7）
 * 覆盖 R32（生产启动冒烟正向证据）与 R33（界面与交互期望确认）的 Hook 端到端行为。
 *
 * 直接复刻 2026-07-29 复盘的两条真实失效路径：
 *   - 1a：dist 起不来（`clean-start-failed`）却因 E2E 全绿而收尾；
 *   - 1c：yaml 修好后 `DATA_DIRECTORY_LOCKED`（`restart-after-kill-failed`）；
 *   - #2：功能摘要已确认、界面维零表态即进入设计。
 *
 * 入口：node .claude/scripts/gate-scenarios.mjs；脚手架：./_harness.mjs
 */
import {
  CONFIRM_SECTION,
  REQ_SPEC,
  REQ_LIST,
  DESIGN_SPEC,
  TASK_LIST,
  DPL_CLEAN,
  GATED_EMPTY,
  TEST_REPORT_API,
  greenfieldReady,
  relToProject,
  writeFixture,
  check,
  writeE2e,
  clearE2e,
  writeLintPass,
  writeStaticScanPass,
  clearLint,
  clearStaticScan,
  writeStartupSmokePass,
  writeStartupSmokeFail,
  writeStartupSmokeRestartFail,
  clearStartupSmoke,
  path,
} from './_harness.mjs';

const CLOSED_LOOP_ROWS = [
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '| 质量工程师 | T0-1 | 执行完成 | |',
  '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
  '| 测试工程师 | 最终整体集成测试 | 执行完成 | |',
];

const CLOSED_LOOP_FILES = {
  'docs/requirement/requirement-spec.md': REQ_SPEC,
  'docs/requirement/requirement-list.md': REQ_LIST,
  'docs/design/detail-design-spec.md': DESIGN_SPEC,
  'docs/design/develop-task-list.md': TASK_LIST,
  'docs/design/design-problem-list.md': DPL_CLEAN,
  'docs/design/gated-artifacts.json': GATED_EMPTY,
  'docs/test/test-report.md': TEST_REPORT_API,
};

/** 全流程闭环（E2E/lint/scan 全绿），只留启动冒烟这一个变量 */
function closedLoopFixture(name, overrides = {}) {
  const root = writeFixture(name, {
    'docs/process/process.md': greenfieldReady(CLOSED_LOOP_ROWS),
    ...CLOSED_LOOP_FILES,
    ...overrides,
  });
  writeE2e('batch', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeE2e('final', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeLintPass();
  writeStaticScanPass();
  return {
    processPath: relToProject(path.join(root, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(root, 'docs/design/gated-artifacts.json')),
  };
}

export function startupSmokeScenarios() {
  console.log('== R32 生产启动冒烟 / R33 界面期望确认 ==');

  const base = closedLoopFixture('ss-closed-loop');

  clearStartupSmoke();
  check('SS0 R32：E2E 全绿但从未跑过启动冒烟 → 不得收尾', 'followup', {
    hook: 'stop',
    ...base,
  });

  writeStartupSmokeFail();
  check('SS1 R32：生产启动命令起不来（复盘 1a dist 崩溃）→ 不得收尾', 'followup', {
    hook: 'stop',
    ...base,
  });

  writeStartupSmokeRestartFail();
  check('SS2 R32：干净启动过但强杀后再启动失败（复盘 1c 陈旧锁）→ 不得收尾', 'followup', {
    hook: 'stop',
    ...base,
  });

  writeStartupSmokePass();
  check('SS3 R32：两段冒烟均通过后方可收尾', 'allow-stop', {
    hook: 'stop',
    ...base,
  });

  // 仅声明 applicability、无用户确认 → 单要素不生效（R12）
  const naOnly = closedLoopFixture('ss-smoke-na-only', {
    'docs/design/gated-artifacts.json':
      '{\n  "startupSmokeApplicability": "n/a",\n  "startupSmokeApplicabilityReason": "纯算法库无常驻进程"\n}\n',
  });
  clearStartupSmoke();
  check('SS4 R32：仅声明 startupSmokeApplicability n/a 但无用户确认 → 不豁免', 'followup', {
    hook: 'stop',
    ...naOnly,
  });

  const smokeExemptConfirm = CONFIRM_SECTION.replace(
    '| ------ | ---- | ------------ |\n',
    '| ------ | ---- | ------------ |\n| 生产启动冒烟豁免 | 2026-07-29 | 纯算法库无常驻进程，确认豁免生产启动冒烟 |\n',
  );
  const exemptRoot = writeFixture('ss-smoke-exempt', {
    'docs/process/process.md': greenfieldReady(CLOSED_LOOP_ROWS).replace(
      CONFIRM_SECTION,
      smokeExemptConfirm,
    ),
    ...CLOSED_LOOP_FILES,
    'docs/design/gated-artifacts.json':
      '{\n  "startupSmokeApplicability": "n/a",\n  "startupSmokeApplicabilityReason": "纯算法库无常驻进程"\n}\n',
  });
  writeE2e('batch', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeE2e('final', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeLintPass();
  writeStaticScanPass();
  clearStartupSmoke();
  check('SS5 R32：双要素齐备（声明 + 用户确认）后无冒烟产物也可收尾', 'allow-stop', {
    hook: 'stop',
    processPath: relToProject(path.join(exemptRoot, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(exemptRoot, 'docs/design/gated-artifacts.json')),
  });

  // R33：界面与交互期望确认是发起 system-architect 的机读前置
  const noUiConfirm = CONFIRM_SECTION.split('\n')
    .filter((line) => !line.includes('界面与交互期望'))
    .join('\n');
  const noUiRoot = writeFixture('ss-no-ui-confirm', {
    'docs/process/process.md': greenfieldReady([]).replace(CONFIRM_SECTION, noUiConfirm),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('SS6 R33：需求摘要+技术选型已确认但界面期望零表态 → 拒绝发起 system-architect', 'deny', {
    hook: 'role',
    role: 'system-architect',
    processPath: relToProject(path.join(noUiRoot, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(noUiRoot, 'docs/design/gated-artifacts.json')),
  });

  const uiRoot = writeFixture('ss-ui-confirm', {
    'docs/process/process.md': greenfieldReady([]),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('SS7 R33：补齐界面与交互期望确认行后放行 system-architect', 'allow', {
    hook: 'role',
    role: 'system-architect',
    processPath: relToProject(path.join(uiRoot, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(uiRoot, 'docs/design/gated-artifacts.json')),
  });

  clearE2e('batch');
  clearE2e('final');
  clearLint();
  clearStaticScan();
  // 还原为默认基线，避免影响后续套件
  writeStartupSmokePass();
}
