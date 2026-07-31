/**
 * **R38** 工具不可用 vs 检查未通过 回归。
 *
 * 背景：R16 的两个默认命令都靠 `npx --yes` 在线获取非主流包（`jscpd-rs` /
 * `gitleaks-secret-scanner`）。历史实现只看退出码，于是「离线/代理环境下拉不到包」与
 * 「代码里真有 8% 重复」产出完全相同的 `{ gatePassed: false, reason: 'scan-failed' }`，
 * 门禁给出的指引是「请整改重复代码」——用户第一次在受限网络里用本框架就会卡死在 QE 阶段，
 * 并且被指向完全错误的修复方向。
 *
 * 本套件锁定两条边界：
 *   1. **不误判**：检查工具正常运行并报出真实问题时，绝不能被判为工具不可用；
 *   2. **不放行**：工具不可用**仍然**使门禁失败（否则「网络一断即免检」是放松，R12），
 *      改变的只是失败的**性质**与处置路径。
 *
 * 入口：node .trae/scripts/gate-selftest.mjs
 */
import {
  test, assert, cleanup, fixtureProcess,
  classifyCommandFailure, applyToolAvailability,
  computeLintGate, computeSubGate, computeStaticScanGate,
  checkLintClean, checkStaticScanClean, parseWorkflowState,
  snapshotLintResult, restoreLintResult, writeLintResult,
  snapshotStaticScanResult, restoreStaticScanResult, writeStaticScanResult,
  snapshotStartupSmokeResult, restoreStartupSmokeResult,
  writeStartupSmokeResult, writeStartupSmokePassResult, checkStartupSmoke,
} from './_harness.mjs';

console.log('== R38：工具不可用 vs 检查未通过 ==');

snapshotLintResult();
snapshotStaticScanResult();
snapshotStartupSmokeResult();

const FULL = ['---', 'workflow_mode: full', '---', ''].join('\n');

// ---------------------------------------------------------------------------
// 分类器：不可用信号
// ---------------------------------------------------------------------------

const UNAVAILABLE_SAMPLES = [
  ['command-not-found', "bash: ruff: command not found"],
  ['command-not-found', "'ruff' is not recognized as an internal or external command"],
  ['command-not-found', '无法将“ruff”项识别为 cmdlet、函数、脚本文件或可运行程序的名称。'],
  ['dependency-fetch', 'npm ERR! code E404\nnpm ERR! 404 Not Found - GET https://registry.npmjs.org/jscpd-rs'],
  ['dependency-fetch', 'npm error could not determine executable to run'],
  ['dependency-fetch', "Error: Cannot find module 'jscpd-rs'"],
  ['network', 'npm ERR! errno ENOTFOUND\nnpm ERR! network request to https://registry.npmjs.org failed'],
  ['network', 'getaddrinfo EAI_AGAIN registry.npmjs.org'],
  ['proxy-or-tls', 'npm ERR! unable to get local issuer certificate'],
  ['proxy-or-tls', 'tunneling socket could not be established, statusCode=407'],
  ['browser-binary-missing', "Executable doesn't exist at C:\\ms-playwright\\chromium-1091"],
];

for (const [category, output] of UNAVAILABLE_SAMPLES) {
  test(`R38: 识别为工具不可用/${category} :: ${output.split('\n')[0].slice(0, 46)}`, () => {
    const r = classifyCommandFailure({ exitCode: 1, output });
    assert.equal(r.toolUnavailable, true);
    assert.equal(r.category, category);
    assert.ok(r.detail && r.detail.length > 0, '须回显具体证据供人工核查');
  });
}

test('R38: 退出码 127 / 9009 视为命令不存在（POSIX / Windows cmd）', () => {
  assert.equal(classifyCommandFailure({ exitCode: 127, output: '' }).toolUnavailable, true);
  assert.equal(classifyCommandFailure({ exitCode: 9009, output: '' }).toolUnavailable, true);
});

// ---------------------------------------------------------------------------
// 分类器：ENOENT 只在「进程没起来」时才算工具不可用（2026-07-30 复核修正）
// ---------------------------------------------------------------------------

test('R38: spawn 层 ENOENT（进程没被拉起来）算 command-not-found', () => {
  const r = classifyCommandFailure({
    exitCode: -1,
    output: '',
    launchError: new Error('spawn ruff ENOENT'),
  });
  assert.equal(r.toolUnavailable, true);
  assert.equal(r.category, 'command-not-found');
});

const APP_LEVEL_ENOENT_SAMPLES = [
  "Error: ENOENT: no such file or directory, open '/app/config/production.json'\n    at Object.openSync",
  '错误：系统找不到指定的文件。 (data/seed.sql)',
];

for (const output of APP_LEVEL_ENOENT_SAMPLES) {
  test(`R38: 应用自己报的 ENOENT 不算工具不可用 :: ${output.split('\n')[0].slice(0, 46)}`, () => {
    const r = classifyCommandFailure({ exitCode: 1, output });
    assert.equal(
      r.toolUnavailable,
      false,
      '这是最典型的启动缺陷（配置路径写错），判成环境问题会把人指向完全相反的修复方向',
    );
  });
}

// ---------------------------------------------------------------------------
// 分类器：真实质量问题绝不能被误判（宁漏不误）
// ---------------------------------------------------------------------------

const REAL_FAILURE_SAMPLES = [
  '/src/app.ts\n  12:3  error  Unexpected console statement  no-console\n\n1 problem (1 error, 0 warnings)',
  'Clone found (javascript):\n - src/a.ts [10:1 - 40:1]\n - src/b.ts [12:1 - 42:1]\nDuplication: 8.31% (threshold 5%)',
  'Found 2 leaks\nsecret detected in src/config.ts:14 (aws-access-token)',
  'FAIL e2e/specs/todo.spec.ts\n  1) [R-001] add todo\n     expect(received).toBe(expected)',
];

for (const output of REAL_FAILURE_SAMPLES) {
  test(`R38: 真实检查失败不误判为工具不可用 :: ${output.split('\n')[0].slice(0, 46)}`, () => {
    const r = classifyCommandFailure({ exitCode: 1, output });
    assert.equal(r.toolUnavailable, false, '误判会让用户以为是环境问题，从而放过真实缺陷');
  });
}

test('R38: 成功（退出码 0）不进入分类，也不打 toolUnavailable 标记', () => {
  const gate = applyToolAvailability({ gatePassed: true, reason: 'passed' }, { exitCode: 0 }, 'x');
  assert.equal(gate.gatePassed, true);
  assert.equal(gate.toolUnavailable, undefined);
});

// ---------------------------------------------------------------------------
// 运行器判据
// ---------------------------------------------------------------------------

test('R38: computeLintGate 区分 lint-tool-unavailable 与 lint-failed', () => {
  const unavailable = computeLintGate({
    command: 'ruff check .',
    exitCode: 1,
    output: 'bash: ruff: command not found',
  });
  assert.equal(unavailable.gatePassed, false, '工具不可用不等于免检（R12）');
  assert.equal(unavailable.reason, 'lint-tool-unavailable');
  assert.equal(unavailable.toolUnavailable, true);

  const failed = computeLintGate({
    command: 'npm run lint',
    exitCode: 1,
    output: '1 problem (1 error, 0 warnings)',
  });
  assert.equal(failed.reason, 'lint-failed');
  assert.equal(failed.toolUnavailable, false);
});

test('R38: 无 lint 命令仍是 no-lint-command（与工具不可用可区分）', () => {
  assert.equal(computeLintGate({ command: null, exitCode: null }).reason, 'no-lint-command');
});

test('R38: computeSubGate 区分 tool-unavailable 与 scan-failed', () => {
  const unavailable = computeSubGate({
    command: 'npx --yes jscpd-rs .',
    exitCode: 1,
    output: 'npm ERR! code E404',
  });
  assert.equal(unavailable.reason, 'tool-unavailable');
  assert.equal(unavailable.gatePassed, false);

  const failed = computeSubGate({
    command: 'npx --yes jscpd-rs .',
    exitCode: 1,
    output: 'Duplication: 8.31% (threshold 5%)',
  });
  assert.equal(failed.reason, 'scan-failed');
});

test('R38: 任一子项工具不可用时在汇总结果上浮 toolUnavailable', () => {
  const gate = computeStaticScanGate({
    duplication: { gatePassed: false, toolUnavailable: true },
    security: { gatePassed: true },
  });
  assert.equal(gate.gatePassed, false);
  assert.equal(gate.toolUnavailable, true);
  assert.equal(gate.reason, 'tool-unavailable');
});

test('R38: 两项都真实失败时汇总 reason 仍为 failed（不冒充环境问题）', () => {
  const gate = computeStaticScanGate({
    duplication: { gatePassed: false, toolUnavailable: false },
    security: { gatePassed: false, toolUnavailable: false },
  });
  assert.equal(gate.reason, 'failed');
  assert.equal(gate.toolUnavailable, false);
});

// ---------------------------------------------------------------------------
// 门禁侧：性质正确、且仍不放行
// ---------------------------------------------------------------------------

test('R38: R15 判据报出 lint-tool-unavailable 并给出环境问题处置指引', () => {
  fixtureProcess(FULL);
  writeLintResult({
    gatePassed: false,
    reason: 'lint-tool-unavailable',
    toolUnavailable: true,
    toolUnavailableCategory: 'dependency-fetch',
    toolUnavailableDetail: 'npm ERR! code E404',
    command: 'npm run lint',
    exitCode: 1,
  });
  const r = checkLintClean();
  assert.equal(r.ok, false, '工具不可用不得放行');
  assert.equal(r.reason, 'lint-tool-unavailable');
  assert.equal(r.toolUnavailable, true);
  assert.match(r.message, /R38/);
  assert.match(r.message, /勿按|请勿/, '文案须明确劝阻按「整改质量问题」处理');
  assert.match(r.message, /AskUserQuestion/, '文案须给出「请用户决策」这条正确路径');
});

test('R38: R16 判据同样区分工具不可用', () => {
  fixtureProcess(FULL);
  writeStaticScanResult({
    gatePassed: false,
    reason: 'tool-unavailable',
    toolUnavailable: true,
    toolUnavailableCategory: 'network',
    toolUnavailableDetail: 'ENOTFOUND registry.npmjs.org',
    duplication: { gatePassed: false, reason: 'tool-unavailable', toolUnavailable: true },
    security: { gatePassed: false, reason: 'tool-unavailable', toolUnavailable: true },
  });
  const r = checkStaticScanClean();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'static-scan-tool-unavailable');
  assert.equal(r.toolUnavailable, true);
});

test('R38: 真实质量失败仍走原有 reason（不被工具不可用分支吞掉）', () => {
  fixtureProcess(FULL);
  writeStaticScanResult({
    gatePassed: false,
    reason: 'failed',
    toolUnavailable: false,
    duplication: { gatePassed: false, reason: 'scan-failed' },
    security: { gatePassed: true, reason: 'passed' },
  });
  assert.equal(checkStaticScanClean().reason, 'dup-check-not-passed');
});

test('R38: 未通过验签的产物即便自称 toolUnavailable 也先报执行证明失败', () => {
  fixtureProcess(FULL);
  writeLintResult(
    { gatePassed: false, reason: 'lint-tool-unavailable', toolUnavailable: true, command: 'x', exitCode: 1 },
    { sign: false },
  );
  const r = checkLintClean();
  assert.match(
    r.reason,
    /^exec-proof-/,
    '否则手写一份 toolUnavailable 就能把失败改写成「环境问题」这条更宽松的叙事',
  );
});

test('R38: R32 冒烟的工具不可用分支确实生效（回归：曾因 isPassed 恒真而永不触发）', () => {
  fixtureProcess(FULL);
  writeStartupSmokeResult({
    gatePassed: false,
    reason: 'startup-tool-unavailable',
    toolUnavailable: true,
    toolUnavailableCategory: 'command-not-found',
    toolUnavailableDetail: "'npm' is not recognized",
    command: 'npm run start',
    commandSource: 'package.json.scripts.start',
    cleanStart: { passed: false, exited: true, exitCode: 9009 },
    restartAfterKill: { passed: false, skipped: true, reason: 'clean-start-failed' },
    capturedAt: new Date().toISOString(),
  });
  const r = checkStartupSmoke();
  assert.equal(r.ok, false, '工具不可用不得放行');
  assert.equal(r.reason, 'startup-tool-unavailable');
  assert.equal(r.toolUnavailable, true);
  assert.match(r.message, /R38/);
});

test('R38: R32 真实启动失败仍报产品缺陷类理由（工具不可用分支不得吞掉它）', () => {
  fixtureProcess(FULL);
  writeStartupSmokeResult({
    gatePassed: false,
    reason: 'clean-start-failed',
    toolUnavailable: false,
    command: 'npm run start',
    commandSource: 'package.json.scripts.start',
    cleanStart: { passed: false, exited: true, exitCode: 1 },
    restartAfterKill: { passed: false, skipped: true, reason: 'clean-start-failed' },
    capturedAt: new Date().toISOString(),
  });
  const r = checkStartupSmoke();
  assert.equal(r.ok, false);
  assert.notEqual(r.reason, 'startup-tool-unavailable', '应用起不来属产品缺陷，不得被叙述成环境问题');
});

test('R38: R32 未验签的冒烟产物先报执行证明失败（capturedAt 也不可信）', () => {
  fixtureProcess(FULL);
  writeStartupSmokePassResult({}, { sign: false });
  assert.match(checkStartupSmoke().reason, /^exec-proof-/);
});

test('R38: parseWorkflowState 汇总工具不可用的门禁清单（供 stop 选择正确文案）', () => {
  const content = fixtureProcess(FULL);
  writeLintResult({
    gatePassed: false,
    reason: 'lint-tool-unavailable',
    toolUnavailable: true,
    toolUnavailableCategory: 'command-not-found',
    command: 'ruff check .',
    exitCode: 127,
  });
  const state = parseWorkflowState(content);
  assert.ok(state.toolUnavailableGates.includes('R15 lint'));
  assert.equal(state.lintPassed, false);
  // 只断言 lint 这一项：其余门禁的产物由宿主仓库现状决定（可能缺失或为升级前的旧产物），
  // 不应让本用例依赖它们。
  assert.equal(
    state.execProofFailedGates.includes('R15 lint'),
    false,
    '合法签名的产物不应被算作执行证明失败',
  );
});

restoreLintResult();
restoreStaticScanResult();
restoreStartupSmokeResult();
cleanup();
