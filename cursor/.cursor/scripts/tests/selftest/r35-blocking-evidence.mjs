/**
 * **R35** 阻塞释放证据回归。
 *
 * 背景：`gate-stop-workflow` 判据链最前面有一个无条件放行分支——`blocking: true` 即当轮放行。
 * §8.7 把 stop 门禁的强度上限归结为 `loop_limit: 3`，但实际释放成本只是**一行 frontmatter**，
 * 而且 R31 注入的 followup 本身就在指示代理去写这一行。本套件锁定收紧后的判据：
 * 机器起源（Hook 自己写的门禁异常）直接放行；代理自述的阻塞须同时有实质阻塞原因
 * 与用户决策留痕。
 *
 * 入口：node .cursor/scripts/gate-selftest.mjs
 */
import {
  test, assert, fs, cleanup, fixtureProcess, PROJECT_ROOT, path,
  hasSubstantiveBlockingReason, hasPendingGateExceptionEvent, hasBlockingDecisionTrace,
  checkBlockingReleaseEvidence, isProcessBlocked, recordFailOpenEvent,
  consumeGateExceptionRelease, readGateExceptionLedger,
} from './_harness.mjs';

console.log('== R35：阻塞释放证据 ==');

const FM_BLOCKED = ['---', 'workflow_mode: full', 'blocking: true', '---', ''];

function withSections(...sections) {
  return [...FM_BLOCKED, ...sections].join('\n');
}

const BLOCK_REASON_REAL = [
  '## 阻塞原因',
  '',
  '- 阻塞原因：第三方支付沙箱账号未开通，批次 2 的支付回调无法联调',
  '- 待决事项：请用户决定是否先交付不含支付的版本',
  '- 已产出成果物：docs/test/test-report-batch-1.md',
  '',
];

const CONFIRM_WITH_TRACE = [
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 阻塞决策 | 2026-07-30 | AskQuestion「先交付不含支付的版本」，用户选择等待沙箱开通 |',
  '',
];

const CONFIRM_WITHOUT_TRACE = [
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 需求摘要 | 2026-07-30 | 用户确认无误 |',
  '',
];

// ---------------------------------------------------------------------------
// 组件判据
// ---------------------------------------------------------------------------

test('R35: 出厂模板的裸「无」+ 引用块说明不算实质阻塞原因', () => {
  const md = withSections(
    '## 阻塞原因',
    '',
    '无',
    '',
    '> 出厂默认为裸「无」（表示未阻塞，`isProcessBlocked` 据此放行）。',
    '',
  );
  assert.equal(hasSubstantiveBlockingReason(md), false);
});

test('R35: 占位文本（—/待补/TBD/括号提示）不算实质阻塞原因', () => {
  for (const placeholder of ['—', '-', '待补', 'TBD', '（此处填写阻塞原因）']) {
    const md = withSections('## 阻塞原因', '', placeholder, '');
    assert.equal(
      hasSubstantiveBlockingReason(md),
      false,
      `占位「${placeholder}」被误判为实质阻塞原因`,
    );
  }
});

test('R35: 「- 阻塞原因：<具体内容>」算实质阻塞原因（去前缀后仍有实质字数）', () => {
  assert.equal(hasSubstantiveBlockingReason(withSections(...BLOCK_REASON_REAL)), true);
});

test('R35: 仅有前缀无内容（「- 阻塞原因：无」）不算实质', () => {
  const md = withSections('## 阻塞原因', '', '- 阻塞原因：无', '');
  assert.equal(hasSubstantiveBlockingReason(md), false);
});

test('R35: 用户决策留痕行须同时含阻塞类主题与「问过用户」的表态', () => {
  assert.equal(hasBlockingDecisionTrace(withSections(...CONFIRM_WITH_TRACE)), true);
  assert.equal(hasBlockingDecisionTrace(withSections(...CONFIRM_WITHOUT_TRACE)), false);
});

test('R35: 表头行不被误认作决策留痕', () => {
  const md = withSections(
    '## 用户确认记录',
    '',
    '| 确认项 | 时间 | 用户原话摘要 |',
    '| ------ | ---- | ------------ |',
    '',
  );
  assert.equal(hasBlockingDecisionTrace(md), false);
});

test('R35: 出厂空的「## 门禁异常事件」表不构成机器起源阻塞', () => {
  const md = withSections(
    '## 门禁异常事件',
    '',
    '| 时间 | Hook | 上下文 | 异常摘要 | 处理状态 |',
    '| ---- | ---- | ------ | -------- | -------- |',
    '',
  );
  assert.equal(hasPendingGateExceptionEvent(md), false);
});

test('R35: 未处理的门禁异常行构成机器起源阻塞；已处理则不构成', () => {
  const header = [
    '## 门禁异常事件',
    '',
    '| 时间 | Hook | 上下文 | 异常摘要 | 处理状态 |',
    '| ---- | ---- | ------ | -------- | -------- |',
  ];
  const pending = withSections(...header, '| 2026-07-30 | gate-dev-workflow | runtime | boom | 待处理 |', '');
  const handled = withSections(...header, '| 2026-07-30 | gate-dev-workflow | runtime | boom | 已处理 |', '');
  assert.equal(hasPendingGateExceptionEvent(pending), true);
  assert.equal(hasPendingGateExceptionEvent(handled), false);
});

// ---------------------------------------------------------------------------
// 汇总判据
// ---------------------------------------------------------------------------

test('R35: 只写 blocking: true、其余全是出厂模板 → 不放行（本次收紧的核心路径）', () => {
  const md = withSections('## 阻塞原因', '', '无', '');
  const r = checkBlockingReleaseEvidence(md);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'blocking-missing-reason');
  assert.match(r.message, /R35/);
  assert.match(r.message, /AskQuestion/, '文案须给出补齐路径，而不只是拒绝');
});

test('R35: 有实质阻塞原因但无用户决策留痕 → 不放行（理由可区分）', () => {
  const md = withSections(...BLOCK_REASON_REAL, ...CONFIRM_WITHOUT_TRACE);
  const r = checkBlockingReleaseEvidence(md);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'blocking-missing-decision-trace');
});

test('R35: 有用户决策留痕但阻塞原因仍是模板「无」 → 不放行', () => {
  const md = withSections('## 阻塞原因', '', '无', '', ...CONFIRM_WITH_TRACE);
  assert.equal(checkBlockingReleaseEvidence(md).reason, 'blocking-missing-reason');
});

test('R35: 实质阻塞原因 + 用户决策留痕 → 放行', () => {
  const md = withSections(...BLOCK_REASON_REAL, ...CONFIRM_WITH_TRACE);
  const r = checkBlockingReleaseEvidence(md);
  assert.equal(r.ok, true, `齐备证据仍被拒（reason=${r.reason}）`);
  assert.equal(r.reason, 'evidenced');
});

test('R35: 代理自己补的门禁异常行不构成机器起源——台账里查无出处（2026-07-30 复核复现的绕过）', () => {
  const md = withSections(
    '## 阻塞原因',
    '',
    '无',
    '',
    '## 门禁异常事件',
    '',
    '| 时间 | Hook | 上下文 | 异常摘要 | 处理状态 |',
    '| ---- | ---- | ------ | -------- | -------- |',
    '| 2026-07-30 | gate-stop-workflow | runtime | 代理自己编的一行 | 待处理 |',
    '',
  );
  // 该行在语法上与 Hook 写的完全一致，历史实现据此放行——比它要补强的双证据分支还便宜。
  assert.equal(hasPendingGateExceptionEvent(md), true, '行本身确实是「未处理」形态');
  const r = checkBlockingReleaseEvidence(md);
  assert.equal(r.ok, false, '仅凭 process.md 里的一行表格不得解除 stop 门禁');
  assert.ok(
    (r.missing ?? []).some((m) => /查无出处/.test(m)),
    '须明确指出问题在「无台账出处」，而不是笼统地报缺证据',
  );
});

test('R35: fail-open 落盘的阻塞天然满足 R35（门禁不得自相矛盾）', () => {
  // 用出厂模板的形态（「无」后紧跟引用块）——历史正则在此匹配失败，导致门禁自己写的
  // 阻塞既没有阻塞原因、也过不了自己的证据校验。
  fixtureProcess(
    [
      '---', 'workflow_mode: full', 'blocking: false', 'cancelled: false', '---', '',
      '## 阻塞原因',
      '',
      '无',
      '',
      '> 出厂默认为裸「无」（表示未阻塞）。',
      '',
    ].join('\n'),
  );
  const rec = recordFailOpenEvent('gate-dev-workflow', 'runtime', new Error('boom'));
  assert.equal(rec.ok, true);
  const md = fs.readFileSync(path.resolve(PROJECT_ROOT, process.env.HARNESS_PROCESS_PATH), 'utf8');
  assert.match(md, /blocking:\s*true/);
  assert.match(md, /- 阻塞原因：门禁 fail-open 异常/, '出厂模板形态下也须写入阻塞原因（历史正则匹配不到）');
  assert.equal(isProcessBlocked(md), true);
  assert.equal(hasSubstantiveBlockingReason(md), true);
  assert.equal(checkBlockingReleaseEvidence(md).ok, true);
});

// ---------------------------------------------------------------------------
// 机器起源的出处校验与一次性释放
// ---------------------------------------------------------------------------

/** 造一份「只有机器起源可能放行」的现场：阻塞原因仍是裸「无」、也没有用户确认记录 */
function fixtureMachineOriginOnly() {
  fixtureProcess(
    ['---', 'workflow_mode: full', 'blocking: false', 'cancelled: false', '---', '',
      '## 阻塞原因', '', '无', ''].join('\n'),
  );
  assert.equal(recordFailOpenEvent('gate-stop-workflow', 'runtime', new Error('boom')).ok, true);
  return fs.readFileSync(path.resolve(PROJECT_ROOT, process.env.HARNESS_PROCESS_PATH), 'utf8');
}

test('R35: Hook 自己落盘的事件在旁路台账里有出处，可放行', () => {
  const md = fixtureMachineOriginOnly();
  const r = checkBlockingReleaseEvidence(md);
  assert.equal(r.ok, true, `门禁自己写的阻塞过不了自己的证据校验（reason=${r.reason}）`);
  assert.equal(r.reason, 'gate-exception-originated');
  assert.ok(r.digest, '须回传台账指纹，供 stop 门禁标记已使用');
});

test('R35: 同一条机器起源事件只能释放一次（防抄回历史行当免死金牌）', () => {
  const md = fixtureMachineOriginOnly();
  const first = checkBlockingReleaseEvidence(md);
  assert.equal(first.ok, true);

  consumeGateExceptionRelease(first.digest);
  const entry = readGateExceptionLedger().entries.find((e) => e.digest === first.digest);
  assert.ok(entry?.releasedAt, '台账须记下这条已被用于释放');

  const second = checkBlockingReleaseEvidence(md);
  assert.equal(second.ok, false, '同一条事件被反复用于放行，等于永久免死金牌');
  assert.ok((second.missing ?? []).some((m) => /查无出处|已被用于释放/.test(m)));
});

test('R35: 改动摘要文字即与台账指纹失配（不能拿真事件的壳套假内容）', () => {
  const md = fixtureMachineOriginOnly();
  assert.equal(checkBlockingReleaseEvidence(md).ok, true);
  const tampered = md.replace(/\| boom \|/, '| 换成别的理由 |');
  assert.equal(
    checkBlockingReleaseEvidence(tampered).ok,
    false,
    '指纹覆盖时间/Hook/上下文/摘要四列，改任一列都应失配',
  );
});

cleanup();
