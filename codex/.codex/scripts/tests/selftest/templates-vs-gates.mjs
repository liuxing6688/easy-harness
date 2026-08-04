/**
 * 出厂模板 ↔ 出厂门禁一致性回归。
 *
 * 背景（2026-07-29 规约审核）：R19 的 `checkImplicitRequirementRecord` 用
 * `extractSection(spec, '隐性需求确认记录')` 定位章节，而出厂模板
 * `.codex/templates/requirement-spec.md` 的标题是 `## 6. 隐性需求确认记录`——
 * 编号前缀使章节永远定位不到，需求分析师照模板填写也过不了 R19，且 Hook 报出的
 * 理由是「缺少真实数据行」，指向完全错误的方向。
 *
 * 394 条既有回归全绿却抓不到，原因是**所有夹具都是套件内自拼的字符串**，
 * 从不加载 `.codex/templates/` 下的真实文件——测的是「解析器对夹具的行为」，
 * 而非「出厂模板能否通过出厂门禁」。本套件补上这一层：
 *   1. 凡被 Hook 解析的章节标题，必须能在对应出厂模板中被 `extractSection` 定位；
 *   2. 模板按说明做**最小合规填充**后，对应门禁判据必须真的通过。
 *
 * 新增「模板章节 ↔ 门禁判据」耦合时，请在下方两张表登记，否则同类漂移会再次逃逸。
 *
 * 入口：node .codex/scripts/gate-selftest.mjs
 */
import {
  test, assert, fs, path, PROJECT_ROOT, cleanup, extractSection, checkImplicitRequirementRecord,
  fixtureProcess, checkRoleDispatchGate,
  checkIncrementScopeDeclared, hasSubstantiveBlockingReason, hasPendingGateExceptionEvent,
} from './_harness.mjs';

const TEMPLATE_DIR = path.join(PROJECT_ROOT, '.codex/templates');

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
  // 出厂模板四维行齐全、仅两列待填 ⇒ 应报枚举不合规（指引「去填这两列」），
  // 若落到 no-increment-scope-section 会把人指向一个其实存在的章节（R19 同类缺陷）。
  assert.equal(r.reason, 'increment-scope-invalid-enum');
});

test('R37: 出厂模板按注释最小填充「## 增量范围」后必须通过（照模板填写不得被拒）', () => {
  const filled = readTemplate('process.md')
    .replace('| 新增/变更对外接口 | | |', '| 新增/变更对外接口 | 否 | 本次不新增或变更任何对外接口 |')
    .replace('| 数据模型 / schema 变更 | | |', '| 数据模型 / schema 变更 | 否 | 复用既有表结构，无字段与迁移变更 |')
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

cleanup();
