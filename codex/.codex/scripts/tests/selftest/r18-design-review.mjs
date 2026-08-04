/**
 * R18：设计问题清单结构、覆盖矩阵、审核干净、技术选型确认。
 *
 * 入口：node .codex/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs；共享 fixture：./_fixtures.mjs
 */
import {
  test, fixtureProcess, cleanup, assert, path, fs, checkDesignProblemListStructure,
  checkRequirementCoverageMatrix, extractP0RequirementIds, checkDesignReviewClean,
  checkTechSelectionConfirmed, checkDesignReviewConclusion, checkHotfixP0Impact,
  hasResolvedDesignIssues, excerptInDesignAnchorWindow, extractDesignSectionWindow, FIXTURE_ROOT,
} from './_harness.mjs';

import {
  makeCleanDplForSelftest, SELFTEST_REQ_LIST, SELFTEST_REQ_LIST_3P0, SELFTEST_DPL_CLEAN,
  SELFTEST_DPL_UNRESOLVED, SELFTEST_TECH_CONFIRM, hotfixProcessBody,
} from './_fixtures.mjs';

console.log('== R18：设计审核可修复性与需求覆盖机读 ==');
test('R18: extractP0RequirementIds 提取 P0', () => {
  assert.deepEqual(extractP0RequirementIds(SELFTEST_REQ_LIST), ['R-001']);
});
test('R18: 完整清洁清单结构通过', () => {
  assert.equal(checkDesignProblemListStructure(SELFTEST_DPL_CLEAN).ok, true);
});
test('R18: 缺少需求覆盖度维度时结构失败', () => {
  const bad = SELFTEST_DPL_CLEAN.replace('| 需求覆盖度 |', '| 其他维度 |');
  const r = checkDesignProblemListStructure(bad);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-review-dimension');
});
test('R18: 未解决行缺修复建议时结构失败', () => {
  const bad = SELFTEST_DPL_UNRESOLVED.replace('补充边界说明', '');
  const r = checkDesignProblemListStructure(bad);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unresolved-missing-fix');
});
test('R18: P0 覆盖矩阵通过', () => {
  assert.equal(
    checkRequirementCoverageMatrix(SELFTEST_DPL_CLEAN, SELFTEST_REQ_LIST).ok,
    true,
  );
});
test('R18: P0 未入矩阵时失败', () => {
  const bad = SELFTEST_DPL_CLEAN.replace('| R-001 | P0 |', '| R-999 | P0 |');
  const r = checkRequirementCoverageMatrix(bad, SELFTEST_REQ_LIST);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'p0-missing-in-matrix');
});
test('R18: P0 结论非已覆盖时失败', () => {
  const bad = SELFTEST_DPL_CLEAN.replace('已覆盖', '未覆盖');
  const r = checkRequirementCoverageMatrix(bad, SELFTEST_REQ_LIST);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'p0-not-covered');
});
test('R18: checkDesignReviewClean 在清洁清单+需求清单时通过', () => {
  fixtureProcess('---\nworkflow_mode: full\n---\n', {
    'docs/design/design-problem-list.md': SELFTEST_DPL_CLEAN,
    'docs/requirement/requirement-list.md': SELFTEST_REQ_LIST,
  });
  assert.equal(checkDesignReviewClean().ok, true);
});
test('R18: 缺少覆盖矩阵章节时 checkDesignReviewClean 失败', () => {
  const noMatrix = SELFTEST_DPL_CLEAN.replace('## 需求覆盖矩阵', '## 其他章节');
  fixtureProcess('---\nworkflow_mode: full\n---\n', {
    'docs/design/design-problem-list.md': noMatrix,
    'docs/requirement/requirement-list.md': SELFTEST_REQ_LIST,
  });
  const r = checkDesignReviewClean();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-coverage-matrix');
});
test('R18: 缺少验收标准列时覆盖矩阵失败', () => {
  const bad = SELFTEST_DPL_CLEAN
    .replace('| 需求编号 | 优先级 | 验收标准 | 设计落点 | 设计落点原文摘录 | 任务包 | 覆盖结论 |', '| 需求编号 | 优先级 | 设计落点 | 设计落点原文摘录 | 任务包 | 覆盖结论 |')
    .replace('| R-001 | P0 | AC-R-001-1 可验证 | detail-design-spec.md §2 | 用户可创建待办项 | T0-1 | 已覆盖 |', '| R-001 | P0 | detail-design-spec.md §2 | 用户可创建待办项 | T0-1 | 已覆盖 |');
  const r = checkRequirementCoverageMatrix(bad, SELFTEST_REQ_LIST);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-acceptance-column');
});
test('R18: 缺少设计落点原文摘录列时覆盖矩阵失败', () => {
  const bad = SELFTEST_DPL_CLEAN
    .replace('| 需求编号 | 优先级 | 验收标准 | 设计落点 | 设计落点原文摘录 | 任务包 | 覆盖结论 |', '| 需求编号 | 优先级 | 验收标准 | 设计落点 | 任务包 | 覆盖结论 |')
    .replace('| R-001 | P0 | AC-R-001-1 可验证 | detail-design-spec.md §2 | 用户可创建待办项 | T0-1 | 已覆盖 |', '| R-001 | P0 | AC-R-001-1 可验证 | detail-design-spec.md §2 | T0-1 | 已覆盖 |');
  const r = checkRequirementCoverageMatrix(bad, SELFTEST_REQ_LIST);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-excerpt-column');
});
test('R18: 设计落点原文摘录为空时覆盖矩阵失败', () => {
  const bad = SELFTEST_DPL_CLEAN.replace(
    '| R-001 | P0 | AC-R-001-1 可验证 | detail-design-spec.md §2 | 用户可创建待办项 | T0-1 | 已覆盖 |',
    '| R-001 | P0 | AC-R-001-1 可验证 | detail-design-spec.md §2 | | T0-1 | 已覆盖 |',
  );
  const r = checkRequirementCoverageMatrix(bad, SELFTEST_REQ_LIST);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'p0-empty-design-excerpt');
});
test('R18 加固: 设计落点原文摘录过短时覆盖矩阵失败', () => {
  const bad = SELFTEST_DPL_CLEAN.replace(
    '| R-001 | P0 | AC-R-001-1 可验证 | detail-design-spec.md §2 | 用户可创建待办项 | T0-1 | 已覆盖 |',
    '| R-001 | P0 | AC-R-001-1 可验证 | detail-design-spec.md §2 | 见§2 | T0-1 | 已覆盖 |',
  );
  const r = checkRequirementCoverageMatrix(bad, SELFTEST_REQ_LIST);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'p0-design-excerpt-too-short');
});
test('R18 加固: 设计文档非 stub 时，摘录若不是设计文档真实原文则覆盖矩阵失败', () => {
  fixtureProcess('---\nworkflow_mode: full\n---\n', {
    'docs/design/detail-design-spec.md':
      '# 详细设计\n\n## 2. 核心模块\n\n系统通过队列异步处理待办事项的创建请求。\n',
    'docs/design/develop-task-list.md': '# tasks\nT0-1',
  });
  const bad = SELFTEST_DPL_CLEAN.replace(
    '| R-001 | P0 | AC-R-001-1 可验证 | detail-design-spec.md §2 | 用户可创建待办项 | T0-1 | 已覆盖 |',
    '| R-001 | P0 | AC-R-001-1 可验证 | detail-design-spec.md §2 | 这句话完全不在设计文档里 | T0-1 | 已覆盖 |',
  );
  const r = checkRequirementCoverageMatrix(bad, SELFTEST_REQ_LIST);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'p0-design-excerpt-not-found');
});
test('R18 加固: 摘录确为设计文档真实原文（含换行/空白差异）时覆盖矩阵通过', () => {
  fixtureProcess('---\nworkflow_mode: full\n---\n', {
    'docs/design/detail-design-spec.md':
      '# 详细设计\n\n## 2. 核心模块\n\n系统\n支持\n用户\n可创建待办项\n以便追踪进度。\n',
    'docs/design/develop-task-list.md': '# tasks\nT0-1',
  });
  const r = checkRequirementCoverageMatrix(SELFTEST_DPL_CLEAN, SELFTEST_REQ_LIST);
  assert.equal(r.ok, true);
});
test('R18 加固: 摘录在设计文档中存在但不在落点章节窗口内时失败', () => {
  fixtureProcess('---\nworkflow_mode: full\n---\n', {
    'docs/design/detail-design-spec.md': [
      '# 详细设计',
      '',
      '## 2. 核心模块',
      '',
      '本章只描述模块划分与依赖方向。',
      '',
      '## 4. 接口设计',
      '',
      '用户可创建待办项并返回唯一编号。',
      '',
    ].join('\n'),
    'docs/design/develop-task-list.md': '# tasks\nT0-1',
  });
  assert.ok(extractDesignSectionWindow('detail-design-spec.md §2', fs.readFileSync(
    path.join(FIXTURE_ROOT, 'docs/design/detail-design-spec.md'),
    'utf8',
  )));
  assert.equal(
    excerptInDesignAnchorWindow(
      '用户可创建待办项',
      'detail-design-spec.md §2',
      fs.readFileSync(path.join(FIXTURE_ROOT, 'docs/design/detail-design-spec.md'), 'utf8'),
    ),
    false,
  );
  const r = checkRequirementCoverageMatrix(SELFTEST_DPL_CLEAN, SELFTEST_REQ_LIST);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'p0-design-excerpt-outside-anchor-window');
});
test('R18 加固: 摘录落在设计落点章节窗口内时覆盖矩阵通过', () => {
  fixtureProcess('---\nworkflow_mode: full\n---\n', {
    'docs/design/detail-design-spec.md': [
      '# 详细设计',
      '',
      '## 2. 核心模块',
      '',
      '系统支持用户可创建待办项以便追踪进度。',
      '',
      '## 4. 接口设计',
      '',
      '另有无关接口说明文字。',
      '',
    ].join('\n'),
    'docs/design/develop-task-list.md': '# tasks\nT0-1',
  });
  const r = checkRequirementCoverageMatrix(SELFTEST_DPL_CLEAN, SELFTEST_REQ_LIST);
  assert.equal(r.ok, true);
});
test('R18 加固: 跨多个 P0 行摘录完全相同（复制糊弄）时覆盖矩阵失败', () => {
  fixtureProcess('---\nworkflow_mode: full\n---\n', {
    'docs/design/detail-design-spec.md':
      '# 详细设计\n\n## 2. 核心模块\n\n系统支持用户可创建待办项以便追踪进度。\n',
    'docs/design/develop-task-list.md': '# tasks\nT0-1',
  });
  const dup = makeCleanDplForSelftest(['R-001', 'R-002', 'R-003']);
  const r = checkRequirementCoverageMatrix(dup, SELFTEST_REQ_LIST_3P0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'excerpt-duplicated-across-rows');
});
test('R18 加固: 设计文档为 stub（无正文）时摘录真实性/去重校验跳过真实性一项（已知局限，向后兼容）', () => {
  cleanup();
  const r = checkRequirementCoverageMatrix(SELFTEST_DPL_CLEAN, SELFTEST_REQ_LIST);
  assert.equal(r.ok, true);
});
test('R18: 缺少审核结论时 checkDesignReviewClean 失败', () => {
  const noConclusion = SELFTEST_DPL_CLEAN.replace('## 审核结论', '## 其他结论');
  fixtureProcess('---\nworkflow_mode: full\n---\n', {
    'docs/design/design-problem-list.md': noConclusion,
    'docs/requirement/requirement-list.md': SELFTEST_REQ_LIST,
  });
  const r = checkDesignReviewClean();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-review-conclusion');
});
test('R18: 已解决问题但结论非复审通过时失败', () => {
  const resolved = SELFTEST_DPL_UNRESOLVED
    .replace('| 是 | 否 |', '| 是 | 是 |')
    .replace('| 1 | 不通过 | 存在未解决问题 |', '| 1 | 通过 | SA 已修复但未复审 |');
  assert.equal(hasResolvedDesignIssues(resolved), true);
  const r = checkDesignReviewConclusion(resolved);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'rereview-required');
});
test('R18: 已解决问题且复审通过时结论校验通过', () => {
  const resolved = SELFTEST_DPL_UNRESOLVED
    .replace('| 是 | 否 |', '| 是 | 是 |')
    .replace(
      '| 1 | 不通过 | 存在未解决问题 |',
      '| 1 | 不通过 | 首次\n| 2 | 复审通过 | SA 返工后复审 |',
    );
  assert.equal(checkDesignReviewConclusion(resolved).ok, true);
});
test('R18: checkTechSelectionConfirmed 识别技术选型确认', () => {
  assert.equal(checkTechSelectionConfirmed(SELFTEST_TECH_CONFIRM).ok, true);
  assert.equal(
    checkTechSelectionConfirmed('## 用户确认记录\n\n| 确认项 | 时间 | 用户原话摘要 |\n| --- | --- | --- |\n| 需求摘要 | 2026-01-01 | 已确认 |\n')
      .ok,
    false,
  );
});
test('R9: hotfix_p0_impact 未声明时失败', () => {
  const content = fixtureProcess(hotfixProcessBody(), {
    'docs/design/detail-design-spec.md': '# design',
  });
  const r = checkHotfixP0Impact(content);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'hotfix-p0-impact-unset');
});
test('R9: hotfix_p0_impact=none 缺判断依据留痕时失败', () => {
  const content = fixtureProcess(
    hotfixProcessBody(['hotfix_p0_impact: none']),
    {
      'docs/design/detail-design-spec.md': '# design',
    },
  );
  const r = checkHotfixP0Impact(content);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'hotfix-none-justification-missing');
});
test('R9: hotfix_p0_impact=none 且有判断依据留痕时通过', () => {
  const content = fixtureProcess(
    hotfixProcessBody(
      ['hotfix_p0_impact: none'],
      [
        '| hotfix影响面 | 2026-01-01 | 受影响用户：管理员；既有行为：不改变任何 P0 行为；回滚条件：日志展示异常即回滚；已比对 requirement-list.md 全部 P0（R-001），本次修复仅涉及日志格式 |',
      ],
    ),
    {
      'docs/design/detail-design-spec.md': '# design',
    },
  );
  assert.equal(checkHotfixP0Impact(content).ok, true);
});
test('R9: hotfix_p0_impact=none 缺最小影响澄清字段时失败', () => {
  const content = fixtureProcess(
    hotfixProcessBody(
      ['hotfix_p0_impact: none'],
      ['| hotfix影响面 | 2026-01-01 | 已比对全部 P0，不改变任何 P0 行为 |'],
    ),
    {
      'docs/design/detail-design-spec.md': '# design',
    },
  );
  const r = checkHotfixP0Impact(content);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'hotfix-none-justification-missing');
});
test('R9: hotfix_p0_impact=p0 且无 R18 通过时失败', () => {
  const content = fixtureProcess(hotfixProcessBody(['hotfix_p0_impact: p0']), {
    'docs/design/detail-design-spec.md': '# design',
  });
  const r = checkHotfixP0Impact(content);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'hotfix-p0-needs-rr');
});
