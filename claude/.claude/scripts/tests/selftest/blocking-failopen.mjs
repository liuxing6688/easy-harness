/**
 * 阻塞态（blocking）与 fail-open 留痕（recordFailOpenEvent）行为。
 *
 * 入口：node .claude/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs（仅导入本套件实际使用的符号，见该目录 README）
 */
import {
  test, fixtureProcess, assert, path, fs, isProcessBlocked, recordFailOpenEvent, PROJECT_ROOT,
  getTestProcessPath,
  findOrphanGateExceptionLedgerEntries, checkGateExceptionLedgerReconciled,
  restoreGateExceptionLedger, GATE_EXCEPTION_LEDGER,
  hasPendingGateExceptionEvent, checkBlockingReleaseEvidence, extractSection,
} from './_harness.mjs';

test('§8.4: recordFailOpenEvent 写入 blocking 与门禁异常事件', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      'blocking: false',
      'cancelled: false',
      '---',
      '',
      '## 阻塞原因',
      '',
      '无',
      '',
    ].join('\n'),
  );
  const r = recordFailOpenEvent('gate-selftest', 'runtime', new Error('boom'));
  assert.equal(r.ok, true);
  const md = fs.readFileSync(getTestProcessPath(), 'utf8');
  assert.match(md, /blocking:\s*true/);
  assert.match(md, /## 门禁异常事件/);
  assert.match(md, /gate-selftest/);
  assert.match(md, /boom/);
});

/**
 * **F-25 闭环回归**：写出去的行必须能被**自己的解析器**读回来。
 *
 * 上一条用例只断言「行被写出」（`assert.match(md, /gate-selftest/)`）——而 F-25 的缺陷恰恰
 * 落在写出与读回之间：`recordFailOpenEvent` 的插入正则末尾用 `\s*\n`（`\s` 含换行）贪婪吃掉
 * 分隔行后的空行，数据行被插到**空行之后**；读取侧 `parseMarkdownTables` 按空行断表，于是
 * 该行归入「另一段表」，`## 门禁异常事件` 表 0 的 rows 为 0。后果：**门禁自己出故障时，
 * 唯一为此设计的自动释放通道 100% 不可达**——修好输入后跑 stop 仍得
 * `blocking-missing-decision-trace`，被要求去找用户补一条本不该由人补的决策。
 *
 * 该形态对「行被写出」类断言完全透明（正文一字不差），故必须走真实判据闭环：
 * `recordFailOpenEvent` → `hasPendingGateExceptionEvent` → `checkBlockingReleaseEvidence`。
 * 三者任一环节回归（写入侧再吞空行、读取侧鲁棒化被移除、台账登记失效）本用例即红。
 *
 * **夹具必须照出厂模板带上已存在的空表**：章节缺失时 `recordFailOpenEvent` 走「整节新建」
 * 分支（`header` 里数据行紧跟分隔行，天然无空行），**测不到** F-25 的插入正则。
 * 出厂 `.claude/templates/process.md` 的该章节形如「标题 / 空行 / 说明引用 / 空行 / 表头 /
 * 分隔行 / 空行」，正是原缺陷触发形态。
 */
const GATE_EXCEPTION_SECTION = [
  '## 门禁异常事件',
  '',
  '> Hook fail-open 时由门禁脚本自动追加；出厂为空表，不构成阻塞。',
  '',
  '| 时间 | Hook | 上下文 | 异常摘要 | 处理状态 |',
  '| ---- | ---- | ------ | -------- | -------- |',
  '',
].join('\n');

function fixtureWithEmptyGateExceptionTable() {
  // 台账是**全局累积**文件；先清空，确保下面对上的条目只可能来自本次 recordFailOpenEvent，
  // 而不是邻居用例留下的同指纹残条（与 seedGateExceptionEvent 同一理由）。
  fs.rmSync(GATE_EXCEPTION_LEDGER, { force: true });
  return fixtureProcess(
    ['---', 'workflow_mode: full', 'blocking: false', 'cancelled: false', '---', '',
      '## 阻塞原因', '', '无', '', GATE_EXCEPTION_SECTION].join('\n'),
  );
}

test('F-25 闭环：门禁自己写的异常事件行必须能被自己的判据读回并释放阻塞', () => {
  fixtureWithEmptyGateExceptionTable();
  // 摘要取原报告原文，与 EVIDENCE_LOG F-25 同源。
  const r = recordFailOpenEvent(
    'gate-dev-workflow-enhanced',
    'runtime',
    new Error('(extra.extraSourceDirs ?? []) is not iterable'),
  );
  assert.equal(r.ok, true);

  const md = fs.readFileSync(getTestProcessPath(), 'utf8');
  // 形态断言：数据行必须**紧接**分隔行，中间不得隔空行（写入侧回归的直接信号）。
  assert.match(
    md,
    /\| ---- \| ---- \| ------ \| -------- \| -------- \|\r?\n\| [^\n]*extraSourceDirs/,
    'F-25：数据行被插到分隔行后的空行之后（写入侧正则又吞了换行）',
  );
  assert.equal(
    hasPendingGateExceptionEvent(md),
    true,
    'F-25：写出的事件行必须被 parsePendingGateExceptionRows 读回（历史缺陷：被空行断表整段丢弃）',
  );
  const release = checkBlockingReleaseEvidence(md);
  assert.equal(release.ok, true, `F-25：机器起源释放分支必须可达，实际 ${JSON.stringify(release)}`);
  assert.equal(release.reason, 'gate-exception-originated');
  restoreGateExceptionLedger();
});

/**
 * **F-25 判别力对照**：把数据行挪到分隔行后的空行之后（即历史写入侧产生的形态），
 * 证明上一条用例测的是真判据而非空跑——同时锁住读取侧对历史形态的鲁棒化不得被移除。
 * 读取侧鲁棒化是双向修复的另一半：即使遇到历史遗留的落盘形态也须读得回来。
 */
test('F-25 对照：数据行落在空行之后（历史形态）时读取侧仍须读得回来', () => {
  fixtureWithEmptyGateExceptionTable();
  const r = recordFailOpenEvent('gate-selftest', 'runtime', new Error('legacy-blank-line-form'));
  assert.equal(r.ok, true);
  const md = fs.readFileSync(getTestProcessPath(), 'utf8');
  // 在分隔行与数据行之间插回一个空行，复刻 F-25 的落盘形态。
  const legacy = md.replace(
    /^(\|[\s|:-]+\|)\r?\n(\|[^\n]*legacy-blank-line-form[^\n]*\|)/m,
    '$1\n\n$2',
  );
  assert.notEqual(legacy, md, '对照夹具未生效：未能构造出「空行 + 数据行」形态');
  assert.equal(hasPendingGateExceptionEvent(legacy), true);
  assert.equal(checkBlockingReleaseEvidence(legacy).reason, 'gate-exception-originated');
  restoreGateExceptionLedger();
});

/**
 * **F-25 二次加固**：同一流程连续两次 fail-open，两行都必须落在「## 门禁异常事件」里。
 *
 * 缺陷形态：第一次 fail-open 后，`fillBlockingReason` 会往「## 阻塞原因」正文写一句
 * 「- 待决事项：核查 stderr 与「## 门禁异常事件」……」。历史实现用**裸子串**匹配章节，
 * 于是第二次 fail-open 的插入点命中的是**那句提示语**——数据行被写进「## 阻塞原因」的
 * 条目列表中间。后果是审计面自毁：行不在审计章节里，`parsePendingGateExceptionRows`
 * 读不到，F-22 反向对账判 `gate-exception-ledger-orphan`，stop 门禁要求 PM
 * 「据台账原样恢复该行」——恢复一条门禁自己放错位置的行。两次 fail-open 即死锁。
 */
test('F-25 二次加固：连续两次 fail-open 的行都须落在门禁异常事件章节内（不得被阻塞原因正文劫持）', () => {
  fixtureWithEmptyGateExceptionTable();
  assert.equal(recordFailOpenEvent('gate-selftest', 'runtime', new Error('first-fail-open')).ok, true);
  assert.equal(recordFailOpenEvent('gate-selftest', 'stop', new Error('second-fail-open')).ok, true);

  const md = fs.readFileSync(getTestProcessPath(), 'utf8');
  // 前提校验：阻塞原因正文确实含「## 门禁异常事件」字样（缺陷的触发条件，勿删）。
  assert.match(
    extractSection(md, '阻塞原因') ?? '',
    /## 门禁异常事件/,
    '前提不成立：fillBlockingReason 不再写该提示语，本用例失去判别力，须重写',
  );
  const section = extractSection(md, '门禁异常事件') ?? '';
  assert.match(section, /first-fail-open/, '第一条事件行不在门禁异常事件章节内');
  assert.match(section, /second-fail-open/, '第二条事件行不在门禁异常事件章节内（被阻塞原因正文劫持）');

  // 两条都读得回来，且台账反向对账无孤儿——即审计面完整。
  assert.equal(hasPendingGateExceptionEvent(md), true);
  assert.deepEqual(
    findOrphanGateExceptionLedgerEntries(md),
    [],
    'F-22：门禁自己写的两条事件均须在表格中找得到，否则 stop 门禁会就自身的错位落盘死锁',
  );
  assert.equal(checkGateExceptionLedgerReconciled(md).ok, true);
  restoreGateExceptionLedger();
});
test('§8.4: cancelled 流程不写 fail-open 事件', () => {
  fixtureProcess('---\nworkflow_mode: full\ncancelled: true\nblocking: false\n---\n');
  const r = recordFailOpenEvent('gate-selftest', 'runtime', new Error('boom'));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'cancelled');
});

console.log('== Finding #1：出厂 process.md 模板不得被误判为阻塞 ==');
test('出厂模板的「## 阻塞原因」默认体不被判为阻塞（开箱即用不卡死）', () => {
  const templatePath = path.join(PROJECT_ROOT, '.claude/templates/process.md');
  const templateContent = fs.readFileSync(templatePath, 'utf8');
  assert.equal(
    isProcessBlocked(templateContent),
    false,
    '出厂 process.md 模板不应开箱即被判为阻塞（Finding #1 回归）',
  );
});
test('真实阻塞原因仍被判为阻塞（回归 isProcessBlocked 严格性，防止 R12 弱化）', () => {
  const blocked = [
    '---',
    'blocking: false',
    '---',
    '',
    '## 阻塞原因',
    '',
    '- 阻塞原因：等待用户确认预算上限',
    '',
  ].join('\n');
  assert.equal(isProcessBlocked(blocked), true);
});
test('frontmatter blocking: true 时判为阻塞（与章节内容无关）', () => {
  assert.equal(isProcessBlocked('---\nblocking: true\n---\n\n## 阻塞原因\n\n无\n'), true);
});

console.log('== F-22：门禁异常台账 → 表格行反向对账 ==');

/**
 * 触发一次真实 fail-open 留痕（同时写 process.md 事件行与旁路台账条目）。
 *
 * 先清空台账：台账是**全局累积**文件，同一轮自测里其他套件也会往里写属于同一夹具
 * 流程路径的条目，若不清空，本用例的「无孤儿」断言会被邻居用例的残留条目干扰。
 */
function seedGateExceptionEvent() {
  fs.rmSync(GATE_EXCEPTION_LEDGER, { force: true });
  fixtureProcess(
    ['---', 'workflow_mode: full', 'blocking: false', 'cancelled: false', '---', '',
      '## 阻塞原因', '', '无', ''].join('\n'),
  );
  const r = recordFailOpenEvent('gate-selftest', 'runtime', new Error('orphan-probe'));
  assert.equal(r.ok, true);
  return fs.readFileSync(getTestProcessPath(), 'utf8');
}

test('F-22: 门禁写入的事件行与台账对得上时无孤儿', () => {
  const md = seedGateExceptionEvent();
  assert.deepEqual(findOrphanGateExceptionLedgerEntries(md), []);
  assert.equal(checkGateExceptionLedgerReconciled(md).ok, true);
  restoreGateExceptionLedger();
});

test('F-22: 事件行被从 process.md 抹掉 → 台账条目成孤儿并被追究', () => {
  const md = seedGateExceptionEvent();
  // 「删掉整节」即历史上零成本抹除审计面的做法：台账仍在，行没了。
  const stripped = md.replace(/\n## 门禁异常事件[\s\S]*$/, '\n');
  // 只断言**章节标题行**没了：阻塞原因正文本身会提到「## 门禁异常事件」这个名字。
  assert.doesNotMatch(stripped, /^##\s*门禁异常事件/m);
  assert.doesNotMatch(stripped, /orphan-probe/);
  const orphans = findOrphanGateExceptionLedgerEntries(stripped);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].hook, 'gate-selftest');
  assert.equal(orphans[0].context, 'runtime');
  const r = checkGateExceptionLedgerReconciled(stripped);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'gate-exception-ledger-orphan');
  assert.match(r.message, /R35\/F-22/);
  assert.match(r.message, /原样/, '处置方向须是「据台账原样恢复该行」');
  restoreGateExceptionLedger();
});

test('F-22: 只改写摘要同样成孤儿（指纹对不上，等于换掉了事件内容）', () => {
  const md = seedGateExceptionEvent();
  const tampered = md.replace(/orphan-probe[^|]*/, '已自行处理，无影响 ');
  assert.doesNotMatch(tampered, /orphan-probe/);
  const r = checkGateExceptionLedgerReconciled(tampered);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'gate-exception-ledger-orphan');
  restoreGateExceptionLedger();
});

test('F-22: 无台账条目时对账恒通过（升级/首次运行不得凭空死锁）', () => {
  restoreGateExceptionLedger();
  const md = ['---', 'workflow_mode: full', '---', '', '## 门禁异常事件', '',
    '| 时间 | Hook | 上下文 | 异常摘要 | 处理状态 |',
    '| --- | --- | --- | --- | --- |', ''].join('\n');
  fixtureProcess(md);
  assert.equal(checkGateExceptionLedgerReconciled(md).ok, true);
});

