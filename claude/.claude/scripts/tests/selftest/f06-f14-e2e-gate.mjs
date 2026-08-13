/**
 * **F-06 / F-14** E2E 门禁判据补强 回归（2026-08-11 v2 评审）。
 *
 * 两条缺陷都让「零条真实覆盖」拿到 `gatePassed: true`，且 R34 签名完全有效——
 * 因为产物**确实**是真运行器跑出来的，伪造检测在此无从发力。
 *
 * **F-06（覆盖率可被省参数架空）**：`--scope=final` 不带 `--baseline` 时
 * `requiredIds: []` → `missingIds` 恒空 → `coverageComplete` 恒真。少打一个参数
 * 即可让覆盖率判据整体失效。修复：`loadRequiredIds` 在既无 `--required-ids`
 * 也无 `--baseline` 时回退到默认 baseline，缺失或解析不到 P0 时**直接 fail**，
 * 不再返回空集。
 *
 * **F-14（进程级故障被当成用例没写够）**：企业代理劫持 `http://127.0.0.1:<port>`
 * 就绪探测时，Playwright 报「端口已被占用」并**零条用例执行**，产物出现
 * `allPassed: true`（零条失败）与 `playwrightExitCode: 1` 并存，而
 * `computeGateResult` 从不校验退出码。门禁只能报「覆盖率不达标」，把环境故障
 * 指引成「TE 用例写少了」——正是 R38 想避免的错误指引。修复：退出码并入
 * `gatePassed` 必要条件，且「非 0 退出码 + 零条用例」归入 R38 工具不可用分流。
 *
 * 本套件锁定的边界：
 *   1. 退出码非 0 时**绝不** `gatePassed`，无论用例状态多干净；
 *   2. 退出码非 0 且零条用例时须给出 R38 分类，不得指向「用例缺失」；
 *   3. 正常通过路径（退出码 0 + 覆盖齐全）不受影响——修复不得误伤；
 *   4. Hook 侧 `checkE2eGate` 对带非 0 退出码的产物独立兜底（防旧产物/改写产物）。
 *
 * 入口：node .claude/scripts/gate-selftest.mjs
 */
import { test, assert, snapshotE2eResults, restoreE2eResults, writeE2eResult, clearE2eResult, checkE2eGate } from './_harness.mjs';
import { computeGateResult } from '../../e2e-run-lib.mjs';

console.log('== F-06 / F-14：E2E 覆盖率与进程退出码判据 ==');

snapshotE2eResults();

const PASSED = (id) => ({ id, status: 'passed' });

// ---------------------------------------------------------------------------
// F-14：进程退出码并入 gatePassed
// ---------------------------------------------------------------------------

test('F-14 退出码 0 + 覆盖齐全 → gatePassed（正常路径不受误伤）', () => {
  const gate = computeGateResult([PASSED('R-001'), PASSED('R-002')], ['R-001', 'R-002'], new Set(), {
    playwrightExitCode: 0,
  });
  assert(gate.gatePassed === true, `期望 gatePassed，实际 ${JSON.stringify(gate)}`);
  assert(gate.processPassed === true, '退出码 0 应判 processPassed');
});

test('F-14 零条用例 + 退出码 1 → 不得 gatePassed（历史为 true）', () => {
  const gate = computeGateResult([], [], new Set(), { playwrightExitCode: 1 });
  assert(gate.allPassed === true, '零条失败用例，allPassed 仍为 true（复现前提）');
  assert(gate.coverageComplete === true, '空 required 集合下 coverageComplete 为 true（复现前提）');
  assert(gate.gatePassed === false, 'F-14：退出码非 0 必须使 gatePassed 为 false');
  assert(gate.processPassed === false, '应显式标记 processPassed=false');
});

test('F-14 零条用例 + 退出码 1 → 归入 R38 工具不可用，不指向「用例缺失」', () => {
  const gate = computeGateResult([], ['R-001'], new Set(), { playwrightExitCode: 1 });
  assert(gate.toolUnavailable === true, '应标记 toolUnavailable 交 R38 分流');
  assert(
    gate.toolUnavailableCategory === 'runner-process-failure',
    `分类应为 runner-process-failure，实际 ${gate.toolUnavailableCategory}`,
  );
  assert(/NO_PROXY|代理/.test(gate.toolUnavailableDetail ?? ''), '文案须提示代理/回环成因（可操作指引）');
});

test('F-14 有用例执行但退出码非 0 → gatePassed 为 false 且不误判工具不可用', () => {
  const gate = computeGateResult([PASSED('R-001')], ['R-001'], new Set(), { playwrightExitCode: 1 });
  assert(gate.gatePassed === false, '退出码非 0 仍须 fail');
  assert(!gate.toolUnavailable, '有用例真实执行过，不属工具不可用（防误判）');
});

test('F-14 未传退出码 → 兼容旧调用，不因缺参数误 fail', () => {
  const gate = computeGateResult([PASSED('R-001')], ['R-001']);
  assert(gate.gatePassed === true, '缺 opts 时应保持历史行为，避免误伤既有调用点');
});

// ---------------------------------------------------------------------------
// F-14：Hook 侧独立兜底（防旧产物 / 被改写产物）
// ---------------------------------------------------------------------------

test('F-14 Hook 侧：gatePassed:true + 退出码 1 的产物须被 checkE2eGate 拒绝', () => {
  writeE2eResult('batch', {
    scope: 'batch',
    gatePassed: true,
    allPassed: true,
    coverageComplete: true,
    missingIds: [],
    unexplainedSkips: [],
    coveredIds: ['R-001'],
    requiredIds: ['R-001'],
    playwrightExitCode: 1,
    executedAt: new Date().toISOString(),
  });
  const verdict = checkE2eGate('batch');
  assert(verdict.ok === false, `Hook 侧须兜底拒绝，实际 ${JSON.stringify(verdict)}`);
  clearE2eResult('batch');
});

test('F-14 Hook 侧：退出码 0 的合规产物仍放行', () => {
  writeE2eResult('batch', {
    scope: 'batch',
    gatePassed: true,
    allPassed: true,
    coverageComplete: true,
    missingIds: [],
    unexplainedSkips: [],
    coveredIds: ['R-001'],
    requiredIds: ['R-001'],
    playwrightExitCode: 0,
    executedAt: new Date().toISOString(),
  });
  const verdict = checkE2eGate('batch');
  assert(verdict.ok === true, `合规产物应放行，实际 ${JSON.stringify(verdict)}`);
  clearE2eResult('batch');
});

restoreE2eResults();
