/**
 * **R37** `single-task` 增量迭代档回归。
 *
 * 背景：重构前 `single-task` 在代码里与 `full` 完全等价（`workflow-gate-lib` 只对
 * `docs-only`/`hotfix` 做特判），`workflow-modes.md` 因此只能写一段「本模式不省任何验证、
 * 若你想少做几步请不要选本项」的劝阻文案——一个规约自己劝人别用的模式。
 *
 * 重构后的取舍（本套件即锁定这些取舍）：
 *   - **省**：测试轮次折叠为一轮（批次 + 最终 → 单通道）；R26 技术选型确认豁免。
 *   - **不省**：R14 接口测试、R17 存储对账、R32 启动冒烟、R15/R16、R18 设计审核、
 *     R19/R27/R33 需求确认、R25 同构模块识别。
 *   - **新增前置**：基线设计须存在（证明是增量而非首次开发）；`## 增量范围` 四维声明；
 *     声明涉及 schema 变更时直接拒绝（补齐分诊表里早有、实现里从未有的规则）。
 *
 * 入口：node .cursor/scripts/gate-selftest.mjs
 */
import {
  test, assert, cleanup, fixtureProcess, parseWorkflowState,
  parseIncrementScope, checkIncrementScopeDeclared, checkSingleTaskBaseDesign,
  checkSingleTaskPreconditions, INCREMENT_SCOPE_DIMENSIONS, getWorkflowMode,
  checkRoleDispatchGate, hasLiteModeConfirmation,
  snapshotLintResult, restoreLintResult, writeLintResult,
  snapshotStaticScanResult, restoreStaticScanResult, writeStaticScanResult,
  snapshotStartupSmokeResult, restoreStartupSmokeResult, writeStartupSmokePassResult,
} from './_harness.mjs';

console.log('== R37：single-task 增量迭代档 ==');

snapshotLintResult();
snapshotStaticScanResult();
snapshotStartupSmokeResult();

const CONFIRM = [
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 工作流模式确认 | 2026-07-30 | 确认采用 workflow_mode: single-task；AskQuestion「增量迭代」 |',
  '| 需求摘要 | 2026-07-30 | 用户确认无误 |',
  '| 界面与交互期望 | 2026-07-30 | 沿用既有布局，本次增量无独立界面期望 |',
  '',
];

function scopeSection(rows) {
  return [
    '## 增量范围',
    '',
    '| 影响面 | 是否涉及 | 说明 |',
    '| ------ | -------- | ---- |',
    ...rows,
    '',
  ];
}

const SCOPE_OK = scopeSection([
  '| 新增/变更对外接口 | 是 | 新增 GET /api/todos/export 导出接口 |',
  '| 数据模型 / schema 变更 | 否 | 复用既有 todos 表，无字段与迁移变更 |',
  '| 新增交互面（页面/命令/入口） | 否 | 复用既有列表页，仅加一个导出按钮 |',
  '| 影响的既有行为 | 是 | 列表页工具栏布局有微调，回归范围限于列表页 |',
]);

function singleTaskProcess(extra = []) {
  return [
    '---',
    'workflow_mode: single-task',
    'iterationType: feature',
    '---',
    '',
    ...CONFIRM,
    ...SCOPE_OK,
    ...extra,
  ].join('\n');
}

const BASE_DESIGN = { 'docs/design/detail-design-spec.md': '# 详细设计\n\n## 4. 存储设计\n\n既有设计。\n' };

// ---------------------------------------------------------------------------
// R20 确认关键词
// ---------------------------------------------------------------------------

test('R37: 「增量」「增量迭代」也是 single-task 的合法确认意图词', () => {
  const md = [
    '---', 'workflow_mode: single-task', '---', '',
    '## 用户确认记录', '',
    '| 确认项 | 时间 | 用户原话摘要 |',
    '| ------ | ---- | ------------ |',
    '| 工作流模式确认 | 2026-07-30 | 确认按增量迭代推进 |',
    '',
  ].join('\n');
  assert.equal(hasLiteModeConfirmation(md, 'single-task'), true);
  assert.equal(getWorkflowMode(md), 'single-task');
});

test('R37: 未经 R20 确认的 single-task 仍 fail-safe 为 full（原语义不变）', () => {
  const md = ['---', 'workflow_mode: single-task', '---', ''].join('\n');
  assert.equal(getWorkflowMode(md), 'full');
});

// ---------------------------------------------------------------------------
// 增量范围声明
// ---------------------------------------------------------------------------

test('R37: 四维定义齐全（接口 / schema / 交互面 / 既有行为）', () => {
  assert.equal(INCREMENT_SCOPE_DIMENSIONS.length, 4);
  assert.deepEqual(
    INCREMENT_SCOPE_DIMENSIONS.map((d) => d.key).sort(),
    ['api', 'behavior', 'schema', 'surface'],
  );
});

test('R37: 缺「## 增量范围」章节 → no-increment-scope-section', () => {
  const r = checkIncrementScopeDeclared(['---', 'workflow_mode: single-task', '---', ''].join('\n'));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-increment-scope-section');
  assert.match(r.message, /R37/);
});

test('R37: 出厂空表 → 缺数据行（理由须与「缺章节」可区分）', () => {
  const md = ['---', '---', '', ...scopeSection([])].join('\n');
  assert.equal(checkIncrementScopeDeclared(md).reason, 'no-increment-scope-data-row');
});

test('R37: 四维齐备且填写规范 → 通过', () => {
  const md = ['---', '---', '', ...SCOPE_OK].join('\n');
  const r = checkIncrementScopeDeclared(md);
  assert.equal(r.ok, true, `合规声明被拒（reason=${r.reason}）`);
});

test('R37: 缺任一维 → increment-scope-missing-dimension', () => {
  const md = ['---', '---', '', ...scopeSection([
    '| 新增/变更对外接口 | 否 | 不涉及任何对外接口变更 |',
    '| 数据模型 / schema 变更 | 否 | 复用既有表结构，无迁移 |',
    '| 影响的既有行为 | 是 | 仅列表页默认排序规则调整 |',
  ])].join('\n');
  const r = checkIncrementScopeDeclared(md);
  assert.equal(r.reason, 'increment-scope-missing-dimension');
  assert.match(r.message, /交互面/);
});

test('R37: 「是否涉及」非是/否枚举 → increment-scope-invalid-enum', () => {
  const md = ['---', '---', '', ...scopeSection([
    '| 新增/变更对外接口 | 可能 | 尚未确定是否新增导出端点 |',
    '| 数据模型 / schema 变更 | 否 | 复用既有表结构，无迁移 |',
    '| 新增交互面（页面/命令/入口） | 否 | 复用既有列表页 |',
    '| 影响的既有行为 | 否 | 无影响，纯新增能力 |',
  ])].join('\n');
  assert.equal(checkIncrementScopeDeclared(md).reason, 'increment-scope-invalid-enum');
});

test('R37: 说明列为占位/过短 → increment-scope-empty-note', () => {
  const md = ['---', '---', '', ...scopeSection([
    '| 新增/变更对外接口 | 否 | - |',
    '| 数据模型 / schema 变更 | 否 | 复用既有表结构，无迁移 |',
    '| 新增交互面（页面/命令/入口） | 否 | 复用既有列表页 |',
    '| 影响的既有行为 | 否 | 无影响，纯新增能力 |',
  ])].join('\n');
  assert.equal(checkIncrementScopeDeclared(md).reason, 'increment-scope-empty-note');
});

test('R37: 声明涉及 schema 变更 → 直接拒绝并要求改走 full（补齐分诊表规则）', () => {
  const md = ['---', '---', '', ...scopeSection([
    '| 新增/变更对外接口 | 是 | 新增导出接口 GET /api/todos/export |',
    '| 数据模型 / schema 变更 | 是 | 新增 todos.exported_at 字段与迁移 |',
    '| 新增交互面（页面/命令/入口） | 否 | 复用既有列表页 |',
    '| 影响的既有行为 | 否 | 无影响，纯新增能力 |',
  ])].join('\n');
  const r = checkIncrementScopeDeclared(md);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'increment-scope-schema-change');
  assert.match(r.message, /full/);
});

test('R37: 表格可被解析出结构化行（供人工核查与后续扩展）', () => {
  const parsed = parseIncrementScope(['---', '---', '', ...SCOPE_OK].join('\n'));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows.length, 4);
  assert.equal(parsed.rows[0].affected, '是');
});

// ---------------------------------------------------------------------------
// 基线设计前置
// ---------------------------------------------------------------------------

test('R37: 无基线 detail-design-spec.md → 拒绝（这其实是首次开发，应走 full）', () => {
  fixtureProcess(singleTaskProcess());
  const r = checkSingleTaskBaseDesign();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'single-task-base-design-missing');
  assert.match(r.message, /R26|技术选型/, '须说明不得用增量档绕过选型确认');
});

test('R37: 有基线设计 + 合规增量范围 → 前置校验通过', () => {
  fixtureProcess(singleTaskProcess(), BASE_DESIGN);
  const r = checkSingleTaskPreconditions(fixtureProcess(singleTaskProcess(), BASE_DESIGN));
  assert.equal(r.ok, true, `前置校验被拒（reason=${r.reason}）`);
});

test('R37: 前置校验对非 single-task 模式无副作用', () => {
  const md = ['---', 'workflow_mode: full', '---', ''].join('\n');
  assert.equal(checkSingleTaskPreconditions(md).reason, 'not-single-task');
});

test('R37: 前置未满足时拒绝发起 system-architect', () => {
  fixtureProcess(
    ['---', 'workflow_mode: single-task', '---', '', ...CONFIRM].join('\n'),
    BASE_DESIGN,
  );
  const r = checkRoleDispatchGate('system-architect');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-increment-scope-section');
});

// ---------------------------------------------------------------------------
// 折叠测试通道（核心收益）
// ---------------------------------------------------------------------------

function foldedState(progressRows, extra = []) {
  const content = fixtureProcess(
    singleTaskProcess([
      '## 进度列表',
      '',
      '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
      '| ----------- | -------- | ---- | ---- |',
      ...progressRows,
      '',
      ...extra,
    ]),
    BASE_DESIGN,
  );
  return parseWorkflowState(content);
}

test('R37: single-task 被识别为折叠测试通道（与 hotfix 同类，与 full 不同）', () => {
  const state = foldedState(['| 开发工程师 | T-1 | 执行完成 | |']);
  assert.equal(state.workflowMode, 'single-task');
  assert.equal(state.foldedTestChannel, true);
  assert.equal(state.batchTestComplete, true, '折叠后不再要求独立的批次集成测试环节');
});

test('R37: dev + QE 完成即要求（唯一一次）最终测试，不以批次测试为前提', () => {
  const state = foldedState([
    '| 开发工程师 | T-1 | 执行完成 | |',
    '| 质量工程师 | T-1 | 执行完成 | |',
  ]);
  assert.equal(state.finalTestRequired, true);
});

test('R37: 折叠通道仍要求 R14 接口测试与 R17 存储对账（区别于 hotfix R11）', () => {
  writeLintResult({ gatePassed: true, reason: 'passed', command: 'npm run lint', exitCode: 0 });
  writeStaticScanResult({
    gatePassed: true,
    duplication: { gatePassed: true, reason: 'passed' },
    security: { gatePassed: true, reason: 'passed' },
  });
  writeStartupSmokePassResult();
  // 无测试报告 ⇒ R14/R17 机读均不满足；即便进度行与 E2E 都齐备也不得视为测试完成
  const state = foldedState([
    '| 开发工程师 | T-1 | 执行完成 | |',
    '| 质量工程师 | T-1 | 执行完成 | |',
    '| 测试工程师 | 最终整体集成测试 T-1 | 执行完成 | |',
  ]);
  assert.equal(state.batchApiReportPresent, false);
  assert.equal(
    state.finalTestComplete,
    false,
    'single-task 的折叠通道若跳过 R14/R17，等于「小改动免做接口测试与存储对账」（放松，R12）',
  );
});

test('R37: 折叠通道仍要求 R32 启动冒烟（沿用 R11 的并入口径）', () => {
  const state = foldedState(['| 开发工程师 | T-1 | 执行完成 | |']);
  assert.equal(typeof state.startupSmokePassed, 'boolean');
  assert.equal(state.startupSmokeExempt, false);
});

// ---------------------------------------------------------------------------
// 唯一的角色侧简化：R26 技术选型确认豁免
// ---------------------------------------------------------------------------

test('R37: 发起 requirement-reviewer 豁免 R26 技术选型确认（基线项目已确认过）', () => {
  fixtureProcess(singleTaskProcess(), {
    ...BASE_DESIGN,
    'docs/design/detail-design-spec.md':
      '# 详细设计\n\n## 同构模块识别（须逐项列出）\n\n已排查，无同构资源族；本次仅新增单个导出端点，未发现可复用资源族。\n',
    'docs/design/develop-task-list.md': '# 任务清单\n\n## 3. 任务包\n\n| T-1 | 导出接口 |\n',
  });
  const r = checkRoleDispatchGate('requirement-reviewer');
  assert.equal(
    r.ok,
    true,
    `single-task 未豁免技术选型确认（reason=${r.reason}）——增量迭代不换栈，再确认一次只是重复劳动`,
  );
});

test('R37: full 模式仍要求 R26 技术选型确认（豁免不得外溢）', () => {
  fixtureProcess(
    [
      '---', 'workflow_mode: full', '---', '',
      '## 用户确认记录', '',
      '| 确认项 | 时间 | 用户原话摘要 |',
      '| ------ | ---- | ------------ |',
      '| 需求摘要 | 2026-07-30 | 已确认 |',
      '',
    ].join('\n'),
    {
      'docs/design/detail-design-spec.md':
        '# 详细设计\n\n## 同构模块识别（须逐项列出）\n\n已排查，无同构资源族；理由充分。\n',
      'docs/design/develop-task-list.md': '# 任务清单\n',
    },
  );
  const r = checkRoleDispatchGate('requirement-reviewer');
  assert.equal(r.ok, false);
  assert.match(r.reason, /tech/i);
});

restoreLintResult();
restoreStaticScanResult();
restoreStartupSmokeResult();
cleanup();
