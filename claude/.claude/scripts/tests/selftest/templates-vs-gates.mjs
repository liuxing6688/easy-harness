/**
 * 出厂模板 ↔ 出厂门禁一致性回归。
 *
 * 背景（2026-07-29 规约审核）：R19 的 `checkImplicitRequirementRecord` 用
 * `extractSection(spec, '隐性需求确认记录')` 定位章节，而出厂模板
 * `.claude/templates/requirement-spec.md` 的标题是 `## 6. 隐性需求确认记录`——
 * 编号前缀使章节永远定位不到，需求分析师照模板填写也过不了 R19，且 Hook 报出的
 * 理由是「缺少真实数据行」，指向完全错误的方向。
 *
 * 394 条既有回归全绿却抓不到，原因是**所有夹具都是套件内自拼的字符串**，
 * 从不加载 `.claude/templates/` 下的真实文件——测的是「解析器对夹具的行为」，
 * 而非「出厂模板能否通过出厂门禁」。本套件补上这一层：
 *   1. 凡被 Hook 解析的章节标题，必须能在对应出厂模板中被 `extractSection` 定位；
 *   2. 模板按说明做**最小合规填充**后，对应门禁判据必须真的通过。
 *
 * 新增「模板章节 ↔ 门禁判据」耦合时，请在下方两张表登记，否则同类漂移会再次逃逸。
 *
 * 入口：node .claude/scripts/gate-selftest.mjs
 */
import {
  test, assert, fs, path, PROJECT_ROOT, cleanup, extractSection, checkImplicitRequirementRecord,
  fixtureProcess, checkRoleDispatchGate,
  checkIncrementScopeDeclared, hasSubstantiveBlockingReason, hasPendingGateExceptionEvent,
  LITE_WORKFLOW_MODES,
} from './_harness.mjs';

const TEMPLATE_DIR = path.join(PROJECT_ROOT, '.claude/templates');

function readTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATE_DIR, name), 'utf8');
}

/**
 * 「模板文件 → 该模板中会被 Hook 用 extractSection 定位的章节标题」。
 * 标题字符串须与 Hook 源码中的实参**逐字一致**（这正是要锁定的耦合点）。
 */
const PARSED_SECTIONS = [
  ['process.md', [
    '用户确认记录',   // R20/R26/R27/R33 与各门禁双要素豁免第二要素
    '当前分派计划',   // hasValidDispatchPlan
    '待派发角色列表', // hasValidDispatchPlan
    '进度列表',       // B1 / roleProgressStats / testEngineerStats
    '回退计数',       // R31
    '增量范围',       // R37（single-task 增量档前置声明）
    '阻塞原因',       // R35（阻塞释放证据之一）
    '门禁异常事件',   // R35（机器起源阻塞的依据）/ §8.4 recordFailOpenEvent
  ]],
  ['requirement-spec.md', [
    '隐性需求确认记录', // R19
  ]],
  ['detail-design-spec.md', [
    '同构模块识别',     // R25
  ]],
  ['design-problem-list.md', [
    '需求覆盖矩阵',     // R18
    '审核结论',         // R18
  ]],
  ['test-report.md', [
    '接口测试报告',     // R14
    '存储对账记录',     // R17
  ]],
];

console.log('== 出厂模板 ↔ 出厂门禁一致性 ==');

for (const [file, titles] of PARSED_SECTIONS) {
  for (const title of titles) {
    test(`模板可解析: ${file} 的「${title}」章节能被 extractSection 定位`, () => {
      const body = extractSection(readTemplate(file), title);
      assert.notEqual(
        body,
        null,
        `出厂模板 ${file} 中 Hook 会解析的「## ${title}」章节定位失败——` +
          '模板标题与 Hook 实参已漂移，照模板填写将被门禁误拒。',
      );
    });
  }
}

test('R19: 出厂模板带编号的「## 6. 隐性需求确认记录」标题能被定位（回归）', () => {
  const tpl = readTemplate('requirement-spec.md');
  assert.match(tpl, /^##\s*6\.\s*隐性需求确认记录\s*$/m, '模板标题形态已变，请同步本用例');
  assert.notEqual(extractSection(tpl, '隐性需求确认记录'), null);
});

test('R19: 出厂模板空表按判据应「缺数据行」而非「章节缺失」', () => {
  const r = checkImplicitRequirementRecord(readTemplate('requirement-spec.md'));
  assert.equal(r.ok, false);
  assert.equal(
    r.reason,
    'no-implicit-requirement-record',
    '空模板须走「无数据行」分支——若因定位失败落到同一 reason，说明理由不可区分',
  );
});

test('R19: 出厂模板做最小合规填充后必须通过（照模板填写不得被拒）', () => {
  const filled = readTemplate('requirement-spec.md').replace(
    '| | | | | | |',
    '| 排查结论 | 已排查，无额外隐性假设 | 用户确认现有描述已完整 | R-001；§7 追溯-001 | 已确认 | 不影响既有范围 |',
  );
  const r = checkImplicitRequirementRecord(filled);
  assert.equal(
    r.ok,
    true,
    `按模板注释填一行合规「排查结论」后仍被拒（reason=${r.reason}）——出厂模板过不了出厂门禁`,
  );
});

test('R19: 最小合规填充的模板可端到端放行 system-architect', () => {
  const filled = readTemplate('requirement-spec.md').replace(
    '| | | | | | |',
    '| 排查结论 | 已排查，无额外隐性假设 | 用户确认现有描述已完整 | R-001；§7 追溯-001 | 已确认 | 不影响既有范围 |',
  );
  fixtureProcess(
    [
      '---', 'workflow_mode: full', '---', '',
      '## 用户确认记录',
      '',
      '| 确认项 | 时间 | 用户原话摘要 |',
      '| ------ | ---- | ------------ |',
      '| 需求摘要 | 2026-07-29 | 用户确认无误 |',
      '| 界面与交互期望 | 2026-07-29 | 接受组件库默认外观 |',
      '',
    ].join('\n'),
    {
      'docs/requirement/requirement-spec.md': filled,
      'docs/requirement/requirement-list.md': '# list',
    },
  );
  const r = checkRoleDispatchGate('system-architect');
  assert.equal(r.ok, true, `出厂模板最小填充后仍无法发起 system-architect（reason=${r.reason}）`);
});

test('编号前缀容忍不影响章节边界（下一个 ## 仍终止本节）', () => {
  const md = [
    '## 6. 隐性需求确认记录',
    '',
    'AAA',
    '',
    '## 7. 需求追溯',
    '',
    'BBB',
  ].join('\n');
  const body = extractSection(md, '隐性需求确认记录');
  assert.match(body, /AAA/);
  assert.doesNotMatch(body, /BBB/, '章节未在下一个 ## 处终止');
});

test('R37: 出厂「## 增量范围」未填写时理由须指向「待填写」而非「章节缺失」', () => {
  const r = checkIncrementScopeDeclared(readTemplate('process.md'));
  assert.equal(r.ok, false);
  // 出厂模板五维行齐全、仅两列待填 ⇒ 应报枚举不合规（指引「去填这两列」），
  // 若落到 no-increment-scope-section 会把人指向一个其实存在的章节（R19 同类缺陷）。
  assert.equal(r.reason, 'increment-scope-invalid-enum');
});

test('R37: 出厂模板按注释最小填充「## 增量范围」后必须通过（照模板填写不得被拒）', () => {
  const filled = readTemplate('process.md')
    .replace('| 新增/变更对外接口 | | |', '| 新增/变更对外接口 | 否 | 本次不新增或变更任何对外接口 |')
    .replace(
      '| 数据形状变更（新增/修改字段、表、集合） | | |',
      '| 数据形状变更（新增/修改字段、表、集合） | 否 | 复用既有表结构，无字段变更 |',
    )
    .replace(
      '| 需要迁移脚本 / 破坏向后兼容 | | |',
      '| 需要迁移脚本 / 破坏向后兼容 | 否 | 无迁移脚本，读写口径不变 |',
    )
    .replace(
      '| 新增交互面（页面/命令/入口） | | |',
      '| 新增交互面（页面/命令/入口） | 否 | 复用既有列表页，不新增入口 |',
    )
    .replace('| 影响的既有行为 | | |', '| 影响的既有行为 | 是 | 列表页默认排序规则调整，回归范围限于列表页 |');
  const r = checkIncrementScopeDeclared(filled);
  assert.equal(r.ok, true, `按模板注释最小填充后仍被拒（reason=${r.reason}）——出厂模板过不了出厂门禁`);
});

test('R35: 出厂模板的「## 阻塞原因」与空的「## 门禁异常事件」不构成阻塞释放证据', () => {
  const tpl = readTemplate('process.md');
  assert.equal(hasSubstantiveBlockingReason(tpl), false, '出厂裸「无」不得被当成实质阻塞原因');
  assert.equal(hasPendingGateExceptionEvent(tpl), false, '出厂空表不得被当成机器起源阻塞');
});

test('章节标题须在行首：正文中提及「## 用户确认记录」不构成章节', () => {
  const md = '# doc\n\n请参见 ## 用户确认记录 一节。\n';
  assert.equal(extractSection(md, '用户确认记录'), null);
});

test('三级标题（###）不被误认作二级章节', () => {
  const md = '# doc\n\n### 同构模块识别\n\nXXX\n';
  assert.equal(extractSection(md, '同构模块识别'), null);
});

/**
 * **F-07 加固：规约表 ↔ 门禁常量一致性**。
 *
 * F-07 的根因不是判据写错了，而是**代码里有这个模式、`workflow-modes.md`「迭代模式（文档路径）」
 * 表里没有这一行**：`single-task` 未定义文档路径，于是 R37 前置「活跃 docs 子树下须有
 * `detail-design-spec.md`」与「Feature 迭代新建独立子树」两条规约合起来无解，
 * 增量档在它最该适用的场景里 100% 不可用。两条规约各自自洽，缺的是它们之间的那一行。
 *
 * 这与本套件既有的「模板章节 ↔ Hook 实参」漂移是同一类：两侧各自都对，**耦合点无人负责**。
 * 故把它一并纳入：`LITE_WORKFLOW_MODES` 的每个取值 + `full`，都必须在该表中有对应行。
 * 新增工作流模式而不补文档行时本用例即红——F-07 的成因不再能静默复现。
 */
const MODE_DOC_ROW_PATTERNS = Object.freeze({
  full: /^\|\s*(?:Greenfield|Feature)\b/,
  hotfix: /^\|\s*Hotfix\b/,
  'docs-only': /^\|\s*Docs-only\b/,
  'single-task': /^\|\s*Single-task\b/,
});

test('F-07: workflow-modes.md「迭代模式（文档路径）」表须覆盖全部工作流模式', () => {
  const spec = fs.readFileSync(
    path.join(PROJECT_ROOT, '.claude/harness/spec/workflow-modes.md'),
    'utf8',
  );
  // 该表在 `### 迭代模式（文档路径）` 下，是三级标题——`extractSection` 只认二级章节，
  // 故这里自行截取：从标题行到下一个同级或更高级标题为止。
  const lines = spec.split('\n');
  const start = lines.findIndex((l) => /^#{1,3}\s*迭代模式（文档路径）\s*$/.test(l.trim()));
  assert.ok(start >= 0, '找不到「迭代模式（文档路径）」标题——表被改名/删除，F-07 的耦合点失守');
  const rows = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,3}\s/.test(lines[i])) break;
    if (lines[i].trim().startsWith('|')) rows.push(lines[i].trim());
  }
  assert.ok(rows.length >= 5, `表内容异常，仅 ${rows.length} 行（表头 + 分隔行 + 至少 4 个模式）`);

  for (const mode of [...LITE_WORKFLOW_MODES, 'full']) {
    const re = MODE_DOC_ROW_PATTERNS[mode];
    assert.ok(
      re,
      `新增了工作流模式 \`${mode}\` 但本用例未登记其行首形态：请先在 workflow-modes.md ` +
        '「迭代模式（文档路径）」表补一行，再在 MODE_DOC_ROW_PATTERNS 登记（F-07 同类漂移）',
    );
    assert.ok(
      rows.some((l) => re.test(l)),
      `\`${mode}\` 在「迭代模式（文档路径）」表中没有对应行——正是 F-07 的成因：` +
        '模式在代码里存在、文档里没有它的 process.md 路径定义，两条规约合起来无解',
    );
  }
});

test('F-07 用例自身有判别力：删掉某一行即须转红', () => {
  // 反事实：把 Single-task 行从表里抹掉，断言逻辑必须报出该模式缺行。
  const rows = [
    '| 模式 | `process.md` 路径 | 适用场景 |',
    '| ---- | --- | --- |',
    '| Greenfield | `docs/process/process.md` | 首次从零开发 |',
    '| Hotfix | 沿用当前活跃 `process.md` | 紧急修复 |',
    '| Docs-only | 沿用当前活跃 `process.md` | 只动文档 |',
  ];
  const missing = [...LITE_WORKFLOW_MODES, 'full'].filter(
    (m) => !rows.some((l) => MODE_DOC_ROW_PATTERNS[m]?.test(l.trim())),
  );
  assert.deepEqual(missing, ['single-task'], '断言逻辑无法识别缺行，本用例形同虚设');
});

cleanup();
