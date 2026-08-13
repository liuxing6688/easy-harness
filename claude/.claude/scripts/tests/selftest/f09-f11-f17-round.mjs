/**
 * 2026-08-11 v2 评审加固：
 * - **F-11**：`extractSection` 只取第一个同名章节 → 多轮审核时新轮次的表格不入判据；
 *   且「审核问题表」的 12 维校验只读第一节，等于第二轮起自动沿用第一轮的充分性。
 * - **F-17**：R20 轻量模式确认行无时效性 → 上一轮的确认行为本轮背书。
 * - **F-09**：`## 审核结论` 单表累积 → 第一轮的「通过」为第二轮的新设计背书。
 *
 * 入口：node .claude/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs
 */
import {
  test, assert, fixtureProcess, cleanup,
  extractSection, extractSectionAll, getIterationRound, mentionsIterationRound,
  parseMarkdownTables, hasLiteModeConfirmation, checkLiteModeConfirmed,
  checkDesignReviewConclusion,
  checkIncrementScopeRequirementCrossCheck, extractRoundRequirementIds,
  getIncrementScopeYesRows,
} from './_harness.mjs';

console.log('== F-11：同名 / 多轮章节聚合（extractSection）==');

const MULTI_ROUND_DPL = [
  '# 设计问题清单',
  '',
  '## 需求覆盖矩阵',
  '',
  '| 需求编号 | 优先级 | 覆盖结论 |',
  '| --- | --- | --- |',
  '| R-001 | P0 | 已覆盖 |',
  '',
  '## 第二轮需求覆盖矩阵',
  '',
  '| 需求编号 | 优先级 | 覆盖结论 |',
  '| --- | --- | --- |',
  '| R-002 | P0 | 未覆盖 |',
  '',
].join('\n');

test('F-11: extractSectionAll 返回全部同名/带轮次前缀章节', () => {
  const bodies = extractSectionAll(MULTI_ROUND_DPL, '需求覆盖矩阵');
  assert.equal(bodies.length, 2);
  assert.match(bodies[0], /R-001/);
  assert.match(bodies[1], /R-002/);
});

test('F-11: extractSection 聚合后第二轮的数据行进入判据视野', () => {
  const body = extractSection(MULTI_ROUND_DPL, '需求覆盖矩阵');
  assert.match(body, /R-001/);
  assert.match(body, /R-002/); // 历史实现在此漏掉整个第二轮
});

test('F-11: 聚合以空行分隔，后一节表头不被并入前一节表格', () => {
  const body = extractSection(MULTI_ROUND_DPL, '需求覆盖矩阵');
  const tables = parseMarkdownTables(body);
  assert.equal(tables.length, 2);
  assert.deepEqual(tables[0].rows.length, 1);
  assert.deepEqual(tables[1].rows.length, 1);
});

test('F-11: 章节完全不存在时仍返回 null（缺章节判据不变）', () => {
  assert.equal(extractSection(MULTI_ROUND_DPL, '审核结论'), null);
  assert.deepEqual(extractSectionAll(MULTI_ROUND_DPL, '审核结论'), []);
});

test('F-11: 标题行余下文字不计入正文（「（须逐项列出）」不构成非空正文）', () => {
  const md = '## 同构模块识别（须逐项列出）\n\n> 模板说明\n';
  const body = extractSection(md, '同构模块识别');
  assert.doesNotMatch(body, /须逐项列出/);
});

console.log('== F-09 / F-17：轮次标识机读 ==');

test('F-17: getIterationRound 缺省为 1，可被 frontmatter 覆盖', () => {
  assert.equal(getIterationRound('---\nworkflow_mode: full\n---\n'), 1);
  assert.equal(getIterationRound('---\niterationRound: 3\n---\n'), 3);
  assert.equal(getIterationRound('---\niterationRound: 0\n---\n'), 1); // 非法值兜底为 1
  assert.equal(getIterationRound('---\niterationRound: abc\n---\n'), 1);
});

test('F-17: mentionsIterationRound 只认轮次语义，不把需求编号/年份当轮次', () => {
  assert.equal(mentionsIterationRound('| 工作流模式确认 | 第2轮 hotfix |', 2), true);
  assert.equal(mentionsIterationRound('| 工作流模式确认 | 轮次 2 hotfix |', 2), true);
  assert.equal(mentionsIterationRound('| 工作流模式确认 | round: 2 |', 2), true);
  assert.equal(mentionsIterationRound('| R-002 | 2026-01-01 |', 2), false);
  assert.equal(mentionsIterationRound('| 第22轮 |', 2), false);
});

const liteProcess = (extraFrontmatter, confirmRows) => [
  '---',
  'workflow_mode: hotfix',
  ...extraFrontmatter,
  '---',
  '',
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| --- | --- | --- |',
  ...confirmRows,
  '',
].join('\n');

test('F-17: 单轮项目（默认 iterationRound）判据与历史一致', () => {
  const md = liteProcess([], ['| 工作流模式确认 | 2026-01-01 | 用户确认走 hotfix 热修 |']);
  assert.equal(hasLiteModeConfirmation(md), true);
  fixtureProcess(md);
  assert.equal(checkLiteModeConfirmed(md).ok, true);
  cleanup();
});

test('F-17: 第二轮时上一轮的确认行不为本轮背书', () => {
  const md = liteProcess(
    ['iterationRound: 2'],
    ['| 工作流模式确认 | 2026-01-01 | 用户确认走 hotfix 热修 |'],
  );
  assert.equal(hasLiteModeConfirmation(md), false);
  fixtureProcess(md);
  const r = checkLiteModeConfirmed(md);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'lite-mode-unconfirmed');
  assert.match(r.message, /第2轮/);
  cleanup();
});

test('F-17: 第二轮补本轮确认行后通过', () => {
  const md = liteProcess(
    ['iterationRound: 2'],
    [
      '| 工作流模式确认 | 2026-01-01 | 用户确认走 hotfix 热修 |',
      '| 工作流模式确认（第2轮） | 2026-02-01 | 用户确认本轮仍按 hotfix 热修处理 |',
    ],
  );
  assert.equal(hasLiteModeConfirmation(md), true);
  fixtureProcess(md);
  assert.equal(checkLiteModeConfirmed(md).ok, true);
  cleanup();
});

const dplWithConclusion = (rows) => [
  '# 设计问题清单',
  '',
  '## 审核结论',
  '',
  '| 审核轮次 | 结论 | 说明 |',
  '| --- | --- | --- |',
  ...rows,
  '',
].join('\n');

test('F-09: 单轮项目审核结论「通过」照旧放行', () => {
  fixtureProcess('---\nworkflow_mode: full\n---\n');
  const r = checkDesignReviewConclusion(dplWithConclusion(['| 1 | 通过 | 首次审核 |']));
  assert.equal(r.ok, true);
  cleanup();
});

test('F-09: 第二轮迭代时第一轮的「通过」不为本轮设计背书', () => {
  fixtureProcess('---\nworkflow_mode: single-task\niterationRound: 2\n---\n');
  const r = checkDesignReviewConclusion(dplWithConclusion(['| 1 | 通过 | 首次审核 |']));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'review-conclusion-stale-round');
  assert.match(r.message, /第 2 轮/);
  cleanup();
});

test('F-09: 第二轮补本轮审核结论行后放行', () => {
  fixtureProcess('---\nworkflow_mode: single-task\niterationRound: 2\n---\n');
  const r = checkDesignReviewConclusion(
    dplWithConclusion(['| 1 | 通过 | 首次审核 |', '| 第2轮 | 通过 | 增量设计审核 |']),
  );
  assert.equal(r.ok, true);
  cleanup();
});

test('F-09: 第二轮结论仍为「不通过」时按既有判据拒绝（不被轮次判据掩盖）', () => {
  fixtureProcess('---\nworkflow_mode: single-task\niterationRound: 2\n---\n');
  const r = checkDesignReviewConclusion(
    dplWithConclusion(['| 1 | 通过 | 首次审核 |', '| 第2轮 | 不通过 | 增量设计有问题 |']),
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'review-not-passed');
  cleanup();
});

console.log('== F-09：增量范围 ↔ requirement-list 本轮编号交叉校验 ==');

const CROSS_CONFIRM = [
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| --- | --- | --- |',
  '| 工作流模式确认 | 2026-07-30 | 确认按增量迭代推进 single-task |',
  '| 工作流模式确认（第2轮） | 2026-08-01 | 确认本轮仍按增量迭代推进 |',
  '| 需求摘要 | 2026-08-01 | 用户确认无误 |',
  '| 界面与交互期望 | 2026-08-01 | 沿用既有布局，本轮增量无独立界面期望 |',
  '',
];

/** 构造 single-task 第 N 轮的 process.md（增量范围行由调用方给定） */
function crossProcess(scopeRows, { round = 2 } = {}) {
  return [
    '---',
    'workflow_mode: single-task',
    'iterationType: feature',
    `iterationRound: ${round}`,
    '---',
    '',
    ...CROSS_CONFIRM,
    '## 增量范围',
    '',
    '| 影响面 | 是否涉及 | 说明 |',
    '| --- | --- | --- |',
    ...scopeRows,
    '',
  ].join('\n');
}

const SCOPE_LINKED = [
  '| 新增/变更对外接口 | 是 | R-101 新增 GET /api/todos/export 导出接口 |',
  '| 数据形状变更（新增/修改字段、表、集合） | 否 | 复用既有 todos 表，无字段变更 |',
  '| 需要迁移脚本 / 破坏向后兼容 | 否 | 无迁移脚本，读写口径不变 |',
  '| 新增交互面（页面/命令/入口） | 否 | 复用既有列表页，仅加一个导出按钮 |',
  '| 影响的既有行为 | 否 | 本轮不改既有行为，仅新增导出路径 |',
];

const SCOPE_UNLINKED = SCOPE_LINKED.map((r) =>
  r.startsWith('| 新增/变更对外接口')
    ? '| 新增/变更对外接口 | 是 | 新增 GET /api/todos/export 导出接口 |'
    : r,
);

const REQ_LIST_ROUND2 = [
  '# 需求清单',
  '',
  '| 需求编号 | 需求名称 | 需求描述 | 验收标准 | 需求优先级 | 来源确认 | 状态 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| R-001 | 待办列表 | 首轮基线需求 | 列表可见 | P0 | 第1轮用户确认 | 已确认 |',
  '| R-101 | 导出待办 | 本轮新增导出能力 | 可导出 CSV | P0 | 第2轮用户确认 | 已确认 |',
  '',
].join('\n');

const REQ_LIST_ROUND1_ONLY = [
  '# 需求清单',
  '',
  '| 需求编号 | 需求名称 | 需求描述 | 验收标准 | 需求优先级 | 来源确认 | 状态 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| R-001 | 待办列表 | 首轮基线需求 | 列表可见 | P0 | 第1轮用户确认 | 已确认 |',
  '',
].join('\n');

test('F-09: extractRoundRequirementIds 只收本轮标注的编号（无轮次列时全行扫描）', () => {
  const ids = extractRoundRequirementIds(REQ_LIST_ROUND2, 2);
  assert.deepEqual([...ids], ['R-101']);
  assert.equal(ids.has('R-101'), true);
  assert.equal(ids.has('R-001'), false, '第1轮的编号不得被算作本轮新立');
});

test('F-09: getIncrementScopeYesRows 只返回「是」维度行', () => {
  const rows = getIncrementScopeYesRows(crossProcess(SCOPE_LINKED));
  assert.equal(rows.length, 1);
  assert.match(rows[0].dimension, /对外接口/);
});

test('F-09: 首轮（默认 iterationRound）不做交叉校验（历史行为逐字不变）', () => {
  const md = crossProcess(SCOPE_UNLINKED, { round: 1 });
  fixtureProcess(md, { 'docs/requirement/requirement-list.md': REQ_LIST_ROUND1_ONLY });
  const r = checkIncrementScopeRequirementCrossCheck(md);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'first-round');
  cleanup();
});

test('F-09: 非 single-task 模式无副作用', () => {
  const md = ['---', 'workflow_mode: full', 'iterationRound: 2', '---', ''].join('\n');
  const r = checkIncrementScopeRequirementCrossCheck(md);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'not-single-task');
});

test('F-09: 第二轮零本轮需求编号 → 拒绝（上一轮需求清单不为本轮背书）', () => {
  const md = crossProcess(SCOPE_LINKED);
  fixtureProcess(md, { 'docs/requirement/requirement-list.md': REQ_LIST_ROUND1_ONLY });
  const r = checkIncrementScopeRequirementCrossCheck(md);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'increment-no-round-requirement-ids');
  assert.match(r.message, /requirements-analyst/);
  cleanup();
});

test('F-09: 「是」维度说明列未引用本轮编号 → 拒绝', () => {
  const md = crossProcess(SCOPE_UNLINKED);
  fixtureProcess(md, { 'docs/requirement/requirement-list.md': REQ_LIST_ROUND2 });
  const r = checkIncrementScopeRequirementCrossCheck(md);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'increment-scope-requirement-unlinked');
  assert.match(r.message, /对外接口/);
  cleanup();
});

test('F-09: 「是」维度引用的是上一轮编号同样拒绝（旧编号不算本轮承载）', () => {
  const rows = SCOPE_LINKED.map((r) =>
    r.startsWith('| 新增/变更对外接口')
      ? '| 新增/变更对外接口 | 是 | R-001 复用首轮需求，本轮不另立 |'
      : r,
  );
  const md = crossProcess(rows);
  fixtureProcess(md, { 'docs/requirement/requirement-list.md': REQ_LIST_ROUND2 });
  const r = checkIncrementScopeRequirementCrossCheck(md);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'increment-scope-requirement-unlinked');
  cleanup();
});

test('F-09: 「是」维度引用本轮编号 → 放行', () => {
  const md = crossProcess(SCOPE_LINKED);
  fixtureProcess(md, { 'docs/requirement/requirement-list.md': REQ_LIST_ROUND2 });
  const r = checkIncrementScopeRequirementCrossCheck(md);
  assert.equal(r.ok, true, `被拒（reason=${r.reason}）`);
  assert.equal(r.reason, 'checked');
  cleanup();
});

test('F-09: 全维皆「否」时不要求本轮编号（无声明改动即无须承载）', () => {
  const rows = SCOPE_LINKED.map((r) =>
    r.startsWith('| 新增/变更对外接口')
      ? '| 新增/变更对外接口 | 否 | 本轮不动对外接口 |'
      : r,
  );
  const md = crossProcess(rows);
  fixtureProcess(md, { 'docs/requirement/requirement-list.md': REQ_LIST_ROUND1_ONLY });
  const r = checkIncrementScopeRequirementCrossCheck(md);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'no-affected-dimension');
  cleanup();
});
