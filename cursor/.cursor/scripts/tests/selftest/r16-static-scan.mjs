/**
 * R16：静态扫描机读结果、dupCheck/securityScan 豁免与 checkStaticScanClean。
 *
 * 入口：node .cursor/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs；共享 fixture：./_fixtures.mjs
 */
import {
  test, fixtureProcess, assert, parseWorkflowState, isDupCheckExempt, isSecurityScanExempt,
  readStaticScanResult, checkStaticScanClean, resolveDupCommand, resolveSecurityCommand,
  computeSubGate, computeStaticScanGate, snapshotStaticScanResult, restoreStaticScanResult,
  writeStaticScanResult, clearStaticScanResult,
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

