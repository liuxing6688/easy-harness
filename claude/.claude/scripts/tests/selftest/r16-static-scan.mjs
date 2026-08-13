/**
 * R16：静态扫描机读结果、dupCheck/securityScan 豁免与 checkStaticScanClean。
 *
 * 入口：node .claude/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs；共享 fixture：./_fixtures.mjs
 */
import {
  test, fixtureProcess, assert, parseWorkflowState, isDupCheckExempt, isSecurityScanExempt,
  readStaticScanResult, checkStaticScanClean, resolveDupCommand, resolveSecurityCommand,
  computeSubGate, computeStaticScanGate, snapshotStaticScanResult, restoreStaticScanResult,
  writeStaticScanResult, clearStaticScanResult,
  parseDupThreshold, extractDupPercentage, evaluateDuplicationReport, DEFAULT_DUP_THRESHOLD,
} from './_harness.mjs';

import {
  liteModeConfirmSection, R16_QE_DONE, STATIC_SCAN_PASS, STATIC_SCAN_DUP_FAIL,
  STATIC_SCAN_SECURITY_FAIL, DUP_NA_GATED, SECURITY_NA_GATED, DUP_EXEMPT_CONFIRM_PROCESS,
  SECURITY_EXEMPT_CONFIRM_PROCESS,
} from './_fixtures.mjs';

console.log('== R16：静态代码质量门禁纯函数判据 ==');
test('R16: resolveDupCommand/resolveSecurityCommand 覆盖优先于默认值', () => {
  assert.equal(resolveDupCommand({ override: 'jscpd --threshold 10 .' }), 'jscpd --threshold 10 .');
  assert.ok(resolveDupCommand({ override: null }).includes('jscpd-rs'));
  assert.equal(resolveDupCommand({ override: '' }), null);
  assert.equal(resolveSecurityCommand({ override: 'gitleaks detect' }), 'gitleaks detect');
  assert.ok(resolveSecurityCommand({ override: null }).includes('gitleaks-secret-scanner'));
  assert.equal(resolveSecurityCommand({ override: '' }), null);
});
test('R16: 默认重复代码命令须以 --threshold 生效，且不得含 --exitCode（回归）', () => {
  const cmd = resolveDupCommand({ override: null });
  // jscpd-rs 的 --exitCode 语义是「检出任何重复即用该退出码」，与 --threshold 无关；
  // 二者同时出现会使 5% 阈值完全失效，门禁退化为零重复容忍 ⇒ 真实项目永远过不了 R16。
  assert.doesNotMatch(
    cmd,
    /--exitCode/,
    '默认命令重新引入了 --exitCode：会使 --threshold 5 失效，门禁退化为零重复容忍',
  );
  assert.match(cmd, /--threshold\s+5\b/, '默认命令须保留 5% 阈值（R16 声明的判据）');
});

// ── F-13：重复率判据的两处失效 ──────────────────────────────────────────────
test('R16 F-13: 默认 --ignore 须排除 .claude/** 与 migration/**（否则门禁自身掺大分母）', () => {
  const cmd = resolveDupCommand({ override: null });
  // 把 harness 自身 3 万余行（含成片同构的 fixture/用例）计入分母，业务侧重复率被摊薄
  // 两个数量级，效果等价于把阈值放大到不可达。与「提高 --threshold」同向，一并禁止（R12）。
  assert.match(cmd, /\*\*\/\.claude\/\*\*/, '默认 --ignore 须排除 .claude/**');
  assert.match(cmd, /\*\*\/migration\/\*\*/, '默认 --ignore 须排除 migration/**');
});
test('R16 F-13: parseDupThreshold 从命令解析阈值，缺省/非法回退默认值', () => {
  assert.equal(parseDupThreshold('jscpd --threshold 10 .'), 10);
  assert.equal(parseDupThreshold('jscpd --threshold=7.5 .'), 7.5);
  assert.equal(parseDupThreshold('jscpd .'), DEFAULT_DUP_THRESHOLD);
  assert.equal(parseDupThreshold('jscpd --threshold abc .'), DEFAULT_DUP_THRESHOLD);
  assert.equal(parseDupThreshold(null), DEFAULT_DUP_THRESHOLD);
  assert.equal(parseDupThreshold(resolveDupCommand({ override: null })), 5);
});
test('R16 F-13: extractDupPercentage 兼容 jscpd / jscpd-rs 的字段位置', () => {
  assert.equal(extractDupPercentage({ statistics: { total: { percentage: 3.2 } } }), 3.2);
  assert.equal(extractDupPercentage({ statistics: { percentage: 4 } }), 4);
  assert.equal(extractDupPercentage({ total: { percentage: '6.5' } }), 6.5);
  assert.equal(extractDupPercentage({ percentage: 0 }), 0);
  assert.equal(extractDupPercentage({}), null);
  assert.equal(extractDupPercentage(null), null);
});
test('R16 F-13: evaluateDuplicationReport —— 超阈值判失败，报告不可读不放行', () => {
  assert.equal(evaluateDuplicationReport({ percentage: 3, threshold: 5 }).ok, true);
  const exceeded = evaluateDuplicationReport({ percentage: 12, threshold: 5 });
  assert.equal(exceeded.ok, false);
  assert.equal(exceeded.reason, 'dup-threshold-exceeded');
  // 恰好等于阈值按失败处理（与 --threshold 的「达到即超」语义一致）。
  assert.equal(evaluateDuplicationReport({ percentage: 5, threshold: 5 }).ok, false);
  // 报告读不到 ⇒ 判别力缺失，不得当作通过（与 R38 工具不可用是不同出口）。
  const unreadable = evaluateDuplicationReport({ percentage: null, threshold: 5 });
  assert.equal(unreadable.ok, false);
  assert.equal(unreadable.reason, 'dup-report-unreadable');
});
test('R16: computeSubGate —— 有命令且退出码 0 才 gatePassed', () => {
  assert.equal(computeSubGate({ command: 'jscpd .', exitCode: 0 }).gatePassed, true);
  assert.equal(computeSubGate({ command: 'jscpd .', exitCode: 1 }).gatePassed, false);
  assert.equal(computeSubGate({ command: null, exitCode: null }).gatePassed, false);
  assert.equal(computeSubGate({ command: null, exitCode: null }).reason, 'no-command');
});
test('R16: computeStaticScanGate —— 两项子检查均通过才 gatePassed', () => {
  const pass = { gatePassed: true };
  const fail = { gatePassed: false };
  assert.equal(computeStaticScanGate({ duplication: pass, security: pass }).gatePassed, true);
  assert.equal(computeStaticScanGate({ duplication: fail, security: pass }).gatePassed, false);
  assert.equal(computeStaticScanGate({ duplication: pass, security: fail }).gatePassed, false);
});

console.log('== R16：静态代码质量门禁机读判据（含双要素豁免，重复代码/安全扫描独立）==');

snapshotStaticScanResult();
test('R16: 无静态扫描机读产物时 checkStaticScanClean 失败、staticScanPassed=false', () => {
  const content = fixtureProcess(R16_QE_DONE);
  clearStaticScanResult();
  assert.equal(readStaticScanResult(), null);
  assert.equal(checkStaticScanClean().ok, false);
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
});
test('R16: 两项子检查均 gatePassed=true 时 checkStaticScanClean 通过、staticScanPassed=true', () => {
  const content = fixtureProcess(R16_QE_DONE);
  writeStaticScanResult(STATIC_SCAN_PASS);
  assert.equal(checkStaticScanClean().ok, true);
  assert.equal(parseWorkflowState(content).staticScanPassed, true);
});
test('R16: 重复代码检测未通过时 checkStaticScanClean 失败、staticScanPassed=false', () => {
  const content = fixtureProcess(R16_QE_DONE);
  writeStaticScanResult(STATIC_SCAN_DUP_FAIL);
  assert.equal(checkStaticScanClean().ok, false);
  assert.equal(checkStaticScanClean().reason, 'dup-check-not-passed');
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
});
test('R16: 安全扫描未通过时 checkStaticScanClean 失败、staticScanPassed=false', () => {
  const content = fixtureProcess(R16_QE_DONE);
  writeStaticScanResult(STATIC_SCAN_SECURITY_FAIL);
  assert.equal(checkStaticScanClean().ok, false);
  assert.equal(checkStaticScanClean().reason, 'security-scan-not-passed');
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
});
test('R16: 仅架构师声明 dupCheckApplicability n/a 但无用户确认 → 不豁免', () => {
  const content = fixtureProcess(R16_QE_DONE, { 'docs/design/gated-dup-na.json': DUP_NA_GATED });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-dup-na.json';
  clearStaticScanResult();
  assert.equal(isDupCheckExempt(content), false);
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R16: 架构师声明 dupCheckApplicability n/a + 用户确认 → 仅重复代码豁免，安全扫描仍须通过', () => {
  const content = fixtureProcess(DUP_EXEMPT_CONFIRM_PROCESS, { 'docs/design/gated-dup-na.json': DUP_NA_GATED });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-dup-na.json';
  clearStaticScanResult();
  assert.equal(isDupCheckExempt(content), true);
  assert.equal(isSecurityScanExempt(content), false);
  // 未运行安全扫描，即便重复代码已豁免，整体仍不通过
  assert.equal(checkStaticScanClean().ok, false);
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
  // 安全扫描单独通过后，两项子判据（豁免 + 实测）皆满足
  writeStaticScanResult({
    gatePassed: false,
    duplication: { gatePassed: false, reason: 'scan-failed', command: 'jscpd .', exitCode: 1 },
    security: { gatePassed: true, reason: 'passed', command: 'gitleaks-secret-scanner', exitCode: 0 },
  });
  assert.equal(checkStaticScanClean().ok, true);
  assert.equal(parseWorkflowState(content).staticScanPassed, true);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R16: 架构师声明 securityScanApplicability n/a + 用户确认 → 仅安全扫描豁免，重复代码仍须通过', () => {
  const content = fixtureProcess(SECURITY_EXEMPT_CONFIRM_PROCESS, {
    'docs/design/gated-security-na.json': SECURITY_NA_GATED,
  });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-security-na.json';
  clearStaticScanResult();
  assert.equal(isSecurityScanExempt(content), true);
  assert.equal(isDupCheckExempt(content), false);
  assert.equal(checkStaticScanClean().ok, false);
  writeStaticScanResult({
    gatePassed: false,
    duplication: { gatePassed: true, reason: 'passed', command: 'jscpd .', exitCode: 0 },
    security: { gatePassed: false, reason: 'scan-failed', command: 'gitleaks-secret-scanner', exitCode: 1 },
  });
  assert.equal(checkStaticScanClean().ok, true);
  assert.equal(parseWorkflowState(content).staticScanPassed, true);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R16: docs-only 模式 staticScanPassed 视为满足', () => {
  const content = ['---', 'workflow_mode: docs-only', '---', '', liteModeConfirmSection('docs-only')].join('\n');
  clearStaticScanResult();
  assert.equal(parseWorkflowState(content).staticScanPassed, true);
});
restoreStaticScanResult();

