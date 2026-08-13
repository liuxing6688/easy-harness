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
 *   - **新增前置**：基线设计须存在（证明是增量而非首次开发）；`## 增量范围` 五维声明（F-08）；
 *     声明「需要迁移脚本 / 破坏向后兼容」时直接拒绝（补齐分诊表里早有、实现里从未有的规则）；
 *     「形状变、兼容未破」时增量档仍可用，但须声明并落地兼容性回归用例（**F-08**，放松方向，
 *     经用户确认，留痕见 `mechanical-gates.md` §8.5）。
 *
 * 入口：node .claude/scripts/gate-selftest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  test, assert, cleanup, fixtureProcess, parseWorkflowState,
  FIXTURE_ROOT, PROJECT_ROOT,
  parseIncrementScope, checkIncrementScopeDeclared, checkSingleTaskBaseDesign,
  checkSingleTaskPreconditions, INCREMENT_SCOPE_DIMENSIONS, getWorkflowMode,
  isCompatOnlySchemaChange,
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
  '| 数据形状变更（新增/修改字段、表、集合） | 否 | 复用既有 todos 表，无字段变更 |',
  '| 需要迁移脚本 / 破坏向后兼容 | 否 | 无迁移脚本，读写口径不变 |',
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

test('R37/F-08: 五维定义齐全（接口 / 数据形状 / 迁移兼容 / 交互面 / 既有行为）', () => {
  assert.equal(INCREMENT_SCOPE_DIMENSIONS.length, 5);
  assert.deepEqual(
    INCREMENT_SCOPE_DIMENSIONS.map((d) => d.key).sort(),
    ['api', 'behavior', 'migration', 'schema', 'surface'],
  );
});

test('R37/F-08: schema 维不得再吃「迁移」关键词（否则两维命中同一行，拆维等于没拆）', () => {
  const schema = INCREMENT_SCOPE_DIMENSIONS.find((d) => d.key === 'schema');
  const migration = INCREMENT_SCOPE_DIMENSIONS.find((d) => d.key === 'migration');
  assert.equal(schema.re.test('需要迁移脚本 / 破坏向后兼容'), false);
  assert.equal(migration.re.test('数据形状变更（新增/修改字段、表、集合）'), false);
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

test('R37: 五维齐备且填写规范 → 通过', () => {
  const md = ['---', '---', '', ...SCOPE_OK].join('\n');
  const r = checkIncrementScopeDeclared(md);
  assert.equal(r.ok, true, `合规声明被拒（reason=${r.reason}）`);
});

test('R37: 缺任一维 → increment-scope-missing-dimension', () => {
  const md = ['---', '---', '', ...scopeSection([
    '| 新增/变更对外接口 | 否 | 不涉及任何对外接口变更 |',
    '| 数据形状变更（新增/修改字段、表、集合） | 否 | 复用既有表结构 |',
    '| 需要迁移脚本 / 破坏向后兼容 | 否 | 无迁移脚本 |',
    '| 影响的既有行为 | 是 | 仅列表页默认排序规则调整 |',
  ])].join('\n');
  const r = checkIncrementScopeDeclared(md);
  assert.equal(r.reason, 'increment-scope-missing-dimension');
  assert.match(r.message, /交互面/);
});

test('R37: 「是否涉及」非是/否枚举 → increment-scope-invalid-enum', () => {
  const md = ['---', '---', '', ...scopeSection([
    '| 新增/变更对外接口 | 可能 | 尚未确定是否新增导出端点 |',
    '| 数据形状变更（新增/修改字段、表、集合） | 否 | 复用既有表结构 |',
    '| 需要迁移脚本 / 破坏向后兼容 | 否 | 无迁移脚本 |',
    '| 新增交互面（页面/命令/入口） | 否 | 复用既有列表页 |',
    '| 影响的既有行为 | 否 | 无影响，纯新增能力 |',
  ])].join('\n');
  assert.equal(checkIncrementScopeDeclared(md).reason, 'increment-scope-invalid-enum');
});

test('R37: 说明列为占位/过短 → increment-scope-empty-note', () => {
  const md = ['---', '---', '', ...scopeSection([
    '| 新增/变更对外接口 | 否 | - |',
    '| 数据形状变更（新增/修改字段、表、集合） | 否 | 复用既有表结构 |',
    '| 需要迁移脚本 / 破坏向后兼容 | 否 | 无迁移脚本 |',
    '| 新增交互面（页面/命令/入口） | 否 | 复用既有列表页 |',
    '| 影响的既有行为 | 否 | 无影响，纯新增能力 |',
  ])].join('\n');
  assert.equal(checkIncrementScopeDeclared(md).reason, 'increment-scope-empty-note');
});

test('R37/F-08: 声明需要迁移/破坏兼容 → 直接拒绝并要求改走 full', () => {
  const md = ['---', '---', '', ...scopeSection([
    '| 新增/变更对外接口 | 是 | 新增导出接口 GET /api/todos/export |',
    '| 数据形状变更（新增/修改字段、表、集合） | 是 | 新增 todos.exported_at 字段 |',
    '| 需要迁移脚本 / 破坏向后兼容 | 是 | 须写迁移脚本回填历史行 |',
    '| 新增交互面（页面/命令/入口） | 否 | 复用既有列表页 |',
    '| 影响的既有行为 | 否 | 无影响，纯新增能力 |',
  ])].join('\n');
  const r = checkIncrementScopeDeclared(md);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'increment-scope-breaking-change');
  assert.match(r.message, /full/);
});

/**
 * F-08 的两条新用例锁定「放松换来的新增判据」：形状变而兼容未破时增量档可用，
 * **但**必须在说明列声明兼容性回归用例——否则退回拒绝，与旧的硬禁用等效。
 * 少了下面第一条，F-08 就是净放松（R12 不允许）。
 */
const SCOPE_COMPAT_ONLY = (compatNote) => scopeSection([
  '| 新增/变更对外接口 | 否 | 复用既有 PATCH /api/todos/:id |',
  `| 数据形状变更（新增/修改字段、表、集合） | 是 | 新增可选字段 todos.dueDate，默认 null |`,
  `| 需要迁移脚本 / 破坏向后兼容 | 否 | ${compatNote} |`,
  '| 新增交互面（页面/命令/入口） | 否 | 复用既有列表页 |',
  '| 影响的既有行为 | 否 | 读取侧容忍字段缺失，既有行为不变 |',
]);

test('R37/F-08: 形状变+兼容未破，但未声明兼容性回归用例 → 拒绝（放松须有对价）', () => {
  const md = ['---', '---', '', ...SCOPE_COMPAT_ONLY('无迁移脚本，字段可选且有默认值')].join('\n');
  const r = checkIncrementScopeDeclared(md);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'increment-scope-missing-compat-regression');
  assert.match(r.message, /兼容性回归/);
});

test('R37/F-08: 形状变+兼容未破+已声明兼容性回归用例 → 增量档放行（新开路径）', () => {
  const md = ['---', '---', '', ...SCOPE_COMPAT_ONLY(
    '无迁移脚本；兼容性回归：历史无 dueDate 的待办仍可读取与更新',
  )].join('\n');
  const r = checkIncrementScopeDeclared(md);
  assert.equal(r.ok, true, `F-08 新路径被拒（reason=${r.reason}）`);
});

test('R37/F-08: isCompatOnlySchemaChange 仅在该路径被显式选用时为真（不外溢）', () => {
  const compat = ['---', '---', '', ...SCOPE_COMPAT_ONLY(
    '无迁移；兼容性回归：历史数据缺字段仍可读',
  )].join('\n');
  assert.equal(isCompatOnlySchemaChange(compat), true);
  assert.equal(isCompatOnlySchemaChange(['---', '---', '', ...SCOPE_OK].join('\n')), false);
  assert.equal(isCompatOnlySchemaChange(''), false);
});

test('R37: 表格可被解析出结构化行（供人工核查与后续扩展）', () => {
  const parsed = parseIncrementScope(['---', '---', '', ...SCOPE_OK].join('\n'));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows.length, 5);
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

/**
 * F-07：Feature 布局夹具（`docs/<feature>/process/process.md`），可选写父级基线设计。
 * 不用 `fixtureProcess`——后者固定写 `docs/process/process.md`，构不出父子两层。
 */
function featureFixture({ feature = 'export-csv', parentDesign = null } = {}) {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  const procAbs = path.join(FIXTURE_ROOT, `docs/${feature}/process/process.md`);
  fs.mkdirSync(path.dirname(procAbs), { recursive: true });
  fs.writeFileSync(procAbs, singleTaskProcess(), 'utf8');
  if (parentDesign) {
    const designAbs = path.join(FIXTURE_ROOT, 'docs/design/detail-design-spec.md');
    fs.mkdirSync(path.dirname(designAbs), { recursive: true });
    fs.writeFileSync(designAbs, parentDesign, 'utf8');
  }
  process.env.HARNESS_PROCESS_PATH = path.relative(PROJECT_ROOT, procAbs).replace(/\\/g, '/');
}

test('R37/F-07: Feature 子树缺基线设计，但父级 docs/design/ 有 → 回落放行（增量档在 Feature 迭代下可用）', () => {
  featureFixture({ parentDesign: '# 详细设计\n\n## 4. 存储设计\n\n既有基线。\n' });
  const r = checkSingleTaskBaseDesign();
  assert.equal(r.ok, true, `父级基线未被采纳（reason=${r.reason}）`);
  assert.equal(r.reason, 'checked-parent-baseline');
});

test('R37/F-07: Feature 子树与父级 docs/design/ 均无基线 → 仍拒绝（回落不得放松判据，R12）', () => {
  featureFixture({ parentDesign: null });
  const r = checkSingleTaskBaseDesign();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'single-task-base-design-missing');
});

test('R37/F-07: 非 Feature 布局（父目录不是 docs）不给回落——否则任意历史流程都能借用根设计', () => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  const procAbs = path.join(FIXTURE_ROOT, 'archive/2020/process/process.md');
  fs.mkdirSync(path.dirname(procAbs), { recursive: true });
  fs.writeFileSync(procAbs, singleTaskProcess(), 'utf8');
  const designAbs = path.join(FIXTURE_ROOT, 'archive/design/detail-design-spec.md');
  fs.mkdirSync(path.dirname(designAbs), { recursive: true });
  fs.writeFileSync(designAbs, '# 详细设计\n', 'utf8');
  process.env.HARNESS_PROCESS_PATH = path.relative(PROJECT_ROOT, procAbs).replace(/\\/g, '/');
  const r = checkSingleTaskBaseDesign();
  assert.equal(r.ok, false, '父目录名不是 docs 时不得回落');
  assert.equal(r.reason, 'single-task-base-design-missing');
});

// ---------------------------------------------------------------------------
// F-09：增量范围 ↔ 本轮需求编号交叉校验，在**两个**派发分支同时生效
// （判据本体的用例在 f09-f11-f17-round.mjs；这里只锁「确实挂在派发门禁上」）
// ---------------------------------------------------------------------------

/** 第 2 轮增量的 process.md：`linked` 决定「是」维度是否引用本轮编号 */
function round2Process({ linked }) {
  return [
    '---',
    'workflow_mode: single-task',
    'iterationType: feature',
    'iterationRound: 2',
    '---',
    '',
    '## 用户确认记录',
    '',
    '| 确认项 | 时间 | 用户原话摘要 |',
    '| ------ | ---- | ------------ |',
    '| 工作流模式确认 | 2026-07-30 | 确认采用 workflow_mode: single-task；AskQuestion「增量迭代」 |',
    '| 工作流模式确认（第2轮） | 2026-08-01 | 确认本轮仍按增量迭代推进 |',
    '| 需求摘要 | 2026-08-01 | 用户确认无误 |',
    '| 界面与交互期望 | 2026-08-01 | 沿用既有布局，本轮增量无独立界面期望 |',
    '',
    ...scopeSection([
      linked
        ? '| 新增/变更对外接口 | 是 | R-101 新增 GET /api/todos/export 导出接口 |'
        : '| 新增/变更对外接口 | 是 | 新增 GET /api/todos/export 导出接口 |',
      '| 数据形状变更（新增/修改字段、表、集合） | 否 | 复用既有 todos 表，无字段变更 |',
      '| 需要迁移脚本 / 破坏向后兼容 | 否 | 无迁移脚本，读写口径不变 |',
      '| 新增交互面（页面/命令/入口） | 否 | 复用既有列表页，仅加一个导出按钮 |',
      '| 影响的既有行为 | 否 | 本轮不改既有行为，仅新增导出路径 |',
    ]),
    '## 当前分派计划',
    '',
    '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
    '| ---------- | -------- | --------- | ---- |',
    '| T-2 | development-engineer | 串行 | 待开发 |',
    '',
  ].join('\n');
}

const ROUND2_ARTIFACTS = {
  ...BASE_DESIGN,
  'docs/requirement/requirement-spec.md': [
    '# 需求说明书',
    '',
    '## 隐性需求确认记录',
    '',
    '| 类别 | 要点 | 用户确认摘要 | 关联需求/§7 追溯 | 状态 | 影响/决策点 |',
    '| ---- | ---- | ------------ | ---------------- | ---- | ------------ |',
    '| 排查结论 | 已排查，无额外隐性假设 | 用户确认现有描述已完整 | R-101；§7 追溯-101 | 已确认 | 已确认不影响额外范围 |',
    '',
  ].join('\n'),
  'docs/requirement/requirement-list.md': [
    '| 需求编号 | 需求名称 | 需求描述 | 验收标准 | 需求优先级 | 来源确认 | 状态 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| R-001 | 待办列表 | 首轮基线 | Given | P0 | 第1轮用户确认 | 已确认 |',
    '| R-101 | 导出待办 | 本轮新增 | Given | P0 | 第2轮用户确认 | 已确认 |',
    '',
  ].join('\n'),
};

test('R37/F-09: 「是」维度未引用本轮编号 → 拒发起 system-architect', () => {
  fixtureProcess(round2Process({ linked: false }), ROUND2_ARTIFACTS);
  const r = checkRoleDispatchGate('system-architect');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'increment-scope-requirement-unlinked');
});

test('R37/F-09: 同一条判据也挂在 development-engineer 分支（否则跳过 SA 直接派 DE 即可绕过）', () => {
  fixtureProcess(round2Process({ linked: false }), ROUND2_ARTIFACTS);
  const r = checkRoleDispatchGate('development-engineer');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'increment-scope-requirement-unlinked');
});

test('R37/F-09: 引用本轮编号后交叉校验不再拦 system-architect', () => {
  fixtureProcess(round2Process({ linked: true }), ROUND2_ARTIFACTS);
  const r = checkRoleDispatchGate('system-architect');
  assert.equal(r.ok, true, `合规的第2轮增量被拒（reason=${r.reason}）`);
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
