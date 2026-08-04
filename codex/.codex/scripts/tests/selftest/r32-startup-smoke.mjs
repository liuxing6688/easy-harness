/**
 * R32：生产启动冒烟正向证据门禁——命令解析、两段判据、产物有效性/新鲜度、
 * 双要素豁免，以及并入 batchTestComplete / finalTestComplete。
 *
 * 入口：node .codex/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs；共享 fixture：./_fixtures.mjs
 */
import {
  test, fixtureProcess, cleanup, assert, resolveStartupCommand, computeStartupSmokeGate,
  evaluateStartupSmokeResult, isStartupSmokeExempt, checkStartupSmoke, parseWorkflowState,
  snapshotStartupSmokeResult, restoreStartupSmokeResult, writeStartupSmokeResult,
  writeStartupSmokePassResult, clearStartupSmokeResult, FIXTURE_ROOT, path, fs,
} from './_harness.mjs';

function writeFixtureGated(name, obj) {
  const abs = path.join(FIXTURE_ROOT, 'docs/design', `${name}.json`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  process.env.HARNESS_GATED_ARTIFACTS_PATH = `test-results/.gate-selftest/docs/design/${name}.json`;
}

const CONFIRM_BASE = [
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 需求摘要 | 2026-01-01 | 已确认 |',
];

console.log('== R32：生产启动冒烟（正向证据）==');
snapshotStartupSmokeResult();

test('R32: resolveStartupCommand 按 config > gated-artifacts > package.json 优先级解析', () => {
  assert.deepEqual(
    resolveStartupCommand({ override: 'node dist/server.js', declared: 'npm run serve', packageScripts: { start: 'x' } }),
    { command: 'node dist/server.js', source: 'harness.config.te.startupSmoke.command' },
  );
  assert.deepEqual(
    resolveStartupCommand({ declared: 'npm run serve', packageScripts: { start: 'x' } }),
    { command: 'npm run serve', source: 'gated-artifacts.productionStartupCommand' },
  );
  assert.deepEqual(
    resolveStartupCommand({ packageScripts: { start: 'node dist/index.js' } }),
    { command: 'npm run start', source: 'package.json.scripts.start' },
  );
});

test('R32: 无声明且无 start 脚本时不猜测启动命令（不回退 dev/preview）', () => {
  assert.equal(resolveStartupCommand({ packageScripts: { dev: 'vite', preview: 'vite preview' } }), null);
  assert.equal(resolveStartupCommand({}), null);
  assert.equal(computeStartupSmokeGate({ command: null }).reason, 'no-startup-command');
});

test('R32: 两段皆过才 gatePassed（干净启动 + 强杀后再启动）', () => {
  const passed = { passed: true };
  assert.equal(
    computeStartupSmokeGate({ command: 'npm run start', cleanStart: passed, restartAfterKill: passed }).gatePassed,
    true,
  );
  assert.equal(
    computeStartupSmokeGate({
      command: 'npm run start',
      cleanStart: { passed: false },
      restartAfterKill: passed,
    }).reason,
    'clean-start-failed',
  );
  // 复盘 1c：yaml 修完后才暴露的 DATA_DIRECTORY_LOCKED——干净启动过、重启不过
  assert.equal(
    computeStartupSmokeGate({
      command: 'npm run start',
      cleanStart: passed,
      restartAfterKill: { passed: false },
    }).reason,
    'restart-after-kill-failed',
  );
});

test('R32: evaluateStartupSmokeResult 拒绝缺产物/未通过/缺重启段/无时间戳/陈旧', () => {
  assert.equal(evaluateStartupSmokeResult(null).reason, 'no-startup-smoke-result');
  assert.equal(
    evaluateStartupSmokeResult({ command: 'npm run start', gatePassed: false, reason: 'clean-start-failed' }).reason,
    'startup-smoke-not-passed:clean-start-failed',
  );
  assert.equal(
    evaluateStartupSmokeResult({ command: '', gatePassed: true }).reason,
    'startup-smoke-missing-command',
  );
  assert.equal(
    evaluateStartupSmokeResult({
      command: 'npm run start',
      gatePassed: true,
      capturedAt: new Date().toISOString(),
    }).reason,
    'startup-smoke-missing-restart-phase',
  );
  const fresh = {
    command: 'npm run start',
    gatePassed: true,
    restartAfterKill: { passed: true },
  };
  assert.equal(evaluateStartupSmokeResult({ ...fresh }).reason, 'startup-smoke-missing-timestamp');
  assert.equal(
    evaluateStartupSmokeResult({ ...fresh, capturedAt: '2020-01-01T00:00:00.000Z' }).reason,
    'startup-smoke-stale',
  );
  assert.equal(
    evaluateStartupSmokeResult({ ...fresh, capturedAt: new Date().toISOString() }).ok,
    true,
  );
});

test('R32: 缺冒烟产物时 checkStartupSmoke 不通过', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', '', ...CONFIRM_BASE, ''].join('\n'));
  writeFixtureGated('r32-gated-empty', {});
  clearStartupSmokeResult();
  const r = checkStartupSmoke();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-startup-smoke-result');
});

test('R32: 仅声明 startupSmokeApplicability 而无用户确认时不豁免', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', '', ...CONFIRM_BASE, ''].join('\n'));
  writeFixtureGated('r32-gated-na-only', {
    startupSmokeApplicability: 'n/a',
    startupSmokeApplicabilityReason: '纯库无常驻进程',
  });
  clearStartupSmokeResult();
  assert.equal(isStartupSmokeExempt(), false);
  assert.equal(checkStartupSmoke().ok, false);
});

test('R32: 双要素齐备时豁免（纯库/无常驻进程）', () => {
  fixtureProcess(
    [
      '---', 'workflow_mode: full', '---', '',
      ...CONFIRM_BASE,
      '| 生产启动冒烟豁免 | 2026-07-29 | 纯算法库无常驻进程，确认豁免生产启动冒烟 |',
      '',
    ].join('\n'),
  );
  writeFixtureGated('r32-gated-na-ok', {
    startupSmokeApplicability: 'n/a',
    startupSmokeApplicabilityReason: '纯库无常驻进程',
  });
  clearStartupSmokeResult();
  assert.equal(isStartupSmokeExempt(), true);
  assert.equal(checkStartupSmoke().reason, 'startup-smoke-exempt');
});

test('R32: docs-only 无开发窗口视为满足', () => {
  fixtureProcess(
    [
      '---', 'workflow_mode: docs-only', '---', '',
      ...CONFIRM_BASE,
      '| 工作流模式确认 | 2026-07-29 | 确认采用 workflow_mode: docs-only，仅改文档 |',
      '',
    ].join('\n'),
  );
  writeFixtureGated('r32-gated-docs', {});
  clearStartupSmokeResult();
  assert.equal(checkStartupSmoke().reason, 'docs-only');
});

test('R32: 冒烟未通过时 finalTestComplete=false（E2E 全绿也不得收尾）', () => {
  const content = [
    '---', 'phase: development', 'workflow_mode: full', 'blocking: false', 'cancelled: false', '---',
    '',
    ...CONFIRM_BASE,
    '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    '| 开发工程师 | T0-1 | 执行完成 | |',
    '| 质量工程师 | T0-1 | 执行完成 | |',
    '| 测试工程师 | 最终整体集成测试 | 执行完成 | |',
    '',
    '## 阻塞原因',
    '',
    '无',
    '',
  ].join('\n');
  fixtureProcess(content);
  writeFixtureGated('r32-gated-state', {});
  writeStartupSmokeResult({
    gatePassed: false,
    reason: 'restart-after-kill-failed',
    command: 'npm run start',
    restartAfterKill: { passed: false },
    capturedAt: new Date().toISOString(),
  });
  const failing = parseWorkflowState(content);
  assert.equal(failing.startupSmokePassed, false);
  assert.equal(failing.finalTestComplete, false);

  writeStartupSmokePassResult();
  const passing = parseWorkflowState(content);
  assert.equal(passing.startupSmokePassed, true);
  assert.equal(passing.startupSmokeReason, 'checked');
});

restoreStartupSmokeResult();
cleanup();
