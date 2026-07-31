/**
 * **R36** 判定期异常 fail-closed 回归。
 *
 * 背景（§8.4 自认多年的缺陷）：入口脚本自行 `try/catch` 并以退出码 0 输出合法
 * `{"permission":"allow"}`，属「Hook 成功」，故 `hooks.json` 的 `failClosed: true`
 * **永不触发**——判定期异常的语义完全由脚本自己的 fail-open 决定，等于
 * 「任何能让判定逻辑抛异常的 process.md 都能打开门禁」，而 process.md 恰由被约束方书写。
 * §8.4 早已写出修法（区分 lib 加载失败与判定期异常）但一直未实施，本套件锁定实施结果。
 *
 * 各通道裁决的取舍理由见 `buildGateExceptionVerdict` 注释；此处锁定「不静默放行」
 * 与「不把项目锁死」这两个方向都成立。
 *
 * 入口：node .trae/scripts/gate-selftest.mjs
 */
import {
  test, assert, cleanup, fixtureProcess, getGateExceptionPolicy, buildGateExceptionVerdict,
  resolveGateRepairPaths, isActiveProcessFilePath,
} from './_harness.mjs';

console.log('== R36：判定期异常 fail-closed ==');

const ERR = new Error('Cannot read properties of undefined (reading trim)');
const build = (channel, repairPaths = []) =>
  buildGateExceptionVerdict({ hook: `gate-${channel}`, context: 'runtime', err: ERR, channel, repairPaths });

test('R36: 出厂默认为 fail-closed（deny）', () => {
  const policy = getGateExceptionPolicy();
  assert.equal(policy.mode, 'deny');
  assert.equal(policy.failClosed, true);
});

test('R36: 写文件通道判定期异常 → deny（而非历史 allow）', () => {
  const { verdict, output } = build('write');
  assert.equal(verdict, 'deny');
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /R36/);
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /fail-closed/);
});

// 注：本例只验证「拿到已核实的 repairPaths 后裁决为 allow」。repairPaths 本身怎么来的
// 是绕过面的关键，由下方「修复通道的作用域」一组用例锁定。
test('R36: 写文件通道对活跃 process.md 保留修复通道（防「代理无法自愈」死局）', () => {
  const { verdict, output } = build('write', ['docs/process/process.md']);
  assert.equal(verdict, 'allow', '若连 process.md 都拒，用户会拿到只能手工编辑的死局');
  assert.equal(output.hookSpecificOutput.permissionDecision, 'allow');
});

test('R36: Shell 通道 → deny，且不提供修复通道例外（避免重复开口子）', () => {
  assert.equal(build('shell').verdict, 'deny');
  // Shell 通道即便传入 repairPaths 也不放行——修 process.md 应走 Write 工具
  assert.equal(build('shell', ['docs/process/process.md']).verdict, 'deny');
});

test('R36: Task 通道 → deny（否则「抛异常」即可跳过整条 R13 门禁链）', () => {
  const { verdict, output } = build('task');
  assert.equal(verdict, 'deny');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /角色派发/);
});

test('R36: 工具链通道 → ask 而非 deny（deny 会把缺工具链的机器彻底锁死）', () => {
  const { verdict, output } = build('toolchain');
  assert.equal(verdict, 'ask');
  assert.equal(output.hookSpecificOutput.permissionDecision, 'ask');
});

test('R36: stop 通道 → followup（该通道无 deny 语义，收紧即不放行收尾）', () => {
  const { verdict, output } = build('stop');
  assert.equal(verdict, 'followup');
  assert.equal(typeof output.reason, 'string');
  assert.equal(output.decision, 'block', 'Trae Stop 契约为 {decision:"block",reason}');
  assert.equal(output.hookSpecificOutput, undefined, 'stop 通道不得输出 hookSpecificOutput 字段');
  assert.match(output.reason, /不放行/);
});

test('R36: 所有通道的文案都指向「用户本人改 config」这一唯一放松路径', () => {
  for (const channel of ['write', 'shell', 'task', 'toolchain', 'stop']) {
    const { output } = build(channel);
    const text = `${output.hookSpecificOutput?.additionalContext ?? ''}${output.reason ?? ''}`;
    assert.match(text, /gateException\.onJudgmentError/, `${channel} 通道未给出放松路径`);
    assert.match(text, /用户本人/, `${channel} 通道未强调放松须由用户决定（R12）`);
  }
});

// ---------------------------------------------------------------------------
// 修复通道的**作用域**（2026-07-30 复核复现的绕过）
//
// 历史实现是 `filePaths.filter(isProcessFilePath)`，而 filePaths 里混着从写入**内容**
// 解析出的 ApplyPatch 目标路径。于是「写 src/app.ts + 内容里夹一行
// `*** Update File: docs/process/process.md`」即可凭空造出修复路径，叠加
// 「repairPaths 非空 ⇒ 整次调用 allow」，判定期异常一被触发，任意源码写入都能过。
// 下面这组用例锁定收窄后的三个条件。
// ---------------------------------------------------------------------------

const ACTIVE_PROCESS = 'test-results/.gate-selftest/docs/process/process.md';
const OTHER_PROCESS = 'docs/archived-2020/process/process.md';

/** 复刻 gate-dev-workflow 的两类路径来源：直接字段 vs 内容里解析出来的 */
const repair = (toolName, directPaths, contentPaths = []) =>
  resolveGateRepairPaths({ toolName, directPaths, allPaths: [...directPaths, ...contentPaths] });

test('R36: 单独写活跃 process.md → 给修复例外（防「代理无法自愈」死局）', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', ''].join('\n'));
  assert.equal(isActiveProcessFilePath(ACTIVE_PROCESS), true);
  assert.equal(repair('Write', [ACTIVE_PROCESS]).length, 1);
  assert.equal(repair('Edit', [ACTIVE_PROCESS]).length, 1);
});

test('R36: 写源码 + 内容夹带活跃 process.md 路径 → 不给例外（复核复现的绕过）', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', ''].join('\n'));
  assert.deepEqual(
    repair('Write', ['src/app.ts'], [ACTIVE_PROCESS]),
    [],
    '内容里的路径由代理完全掌控，不能作为放行依据',
  );
});

test('R36: 写活跃 process.md 时夹带其他路径 → 整次调用都不给例外', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', ''].join('\n'));
  assert.deepEqual(
    repair('Write', [ACTIVE_PROCESS], ['src/app.ts']),
    [],
    'Hook 的裁决是整次调用一个，放行即等于放行全部路径',
  );
});

test('R36: 非活跃（历史/其他 feature）process.md 不算修复通道', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', ''].join('\n'));
  assert.equal(isActiveProcessFilePath(OTHER_PROCESS), false);
  assert.deepEqual(repair('Write', [OTHER_PROCESS]), []);
});

test('R36: ApplyPatch / Delete 不享受修复例外（修流程文件请用 Write 类工具）', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', ''].join('\n'));
  assert.deepEqual(repair('ApplyPatch', [], [ACTIVE_PROCESS]), [], 'ApplyPatch 只有内容路径');
  assert.deepEqual(repair('Delete', [ACTIVE_PROCESS]), [], '异常态下没有删流程文件的正当需求');
});

test('R36: 无 repairPaths 时写通道仍是 deny（例外收窄后默认路径不变）', () => {
  assert.equal(build('write', []).verdict, 'deny');
});

test('R36: 异常摘要被截断，不把整段堆栈灌进裁决文案', () => {
  const long = new Error('x'.repeat(1000));
  const { output } = buildGateExceptionVerdict({
    hook: 'gate-dev-workflow',
    context: 'runtime',
    err: long,
    channel: 'write',
  });
  assert.ok(output.hookSpecificOutput.permissionDecisionReason.length < 600, '裁决文案未截断异常摘要');
});

cleanup();
