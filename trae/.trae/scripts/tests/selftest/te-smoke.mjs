/**
 * R22：TE 冒烟——替代 E2E 启动命令识别、双要素豁免、checkTeAlternativeE2eStartup。
 *
 * 入口：node .trae/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs；共享 fixture：./_fixtures.mjs
 */
import {
  test, fixtureProcess, cleanup, assert, isAlternativeE2eStartupCommand,
  isAlternativeE2eStartupExempt, checkTeAlternativeE2eStartup, recordDispatchedRole,
  clearDispatchedRoles, snapshotDispatchedRoles, restoreDispatchedRoles, FIXTURE_ROOT, path, fs,
} from './_harness.mjs';

function writeFixtureGated(name, obj) {
  const abs = path.join(FIXTURE_ROOT, 'docs/design', `${name}.json`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  process.env.HARNESS_GATED_ARTIFACTS_PATH = `test-results/.gate-selftest/docs/design/${name}.json`;
}

console.log('== TE 冒烟：替代 E2E 启动命令门禁 ==');
snapshotDispatchedRoles();

test('TE 冒烟: isAlternativeE2eStartupCommand 识别 E2E_WEB_SERVER_COMMAND', () => {
  assert.equal(
    isAlternativeE2eStartupCommand(
      'E2E_WEB_SERVER_COMMAND=npx vite-node server.ts node .trae/scripts/e2e-run.mjs',
    ),
    true,
  );
  assert.equal(isAlternativeE2eStartupCommand('node .trae/scripts/e2e-run.mjs --scope=batch'), false);
  assert.equal(isAlternativeE2eStartupCommand('npm run start'), false);
});

test('TE 冒烟: isAlternativeE2eStartupCommand 识别 npx vite-node + e2e 同现', () => {
  assert.equal(isAlternativeE2eStartupCommand('npx vite-node ./web -- e2e'), true);
  assert.equal(isAlternativeE2eStartupCommand('npx vite-node ./scripts/seed.ts'), false);
});

test('TE 冒烟: 非 TE 派发时替代启动不拦截', () => {
  clearDispatchedRoles();
  recordDispatchedRole('development-engineer');
  fixtureProcess('---\nworkflow_mode: full\n---\n');
  writeFixtureGated('gated-empty', {});
  const r = checkTeAlternativeE2eStartup(
    'E2E_WEB_SERVER_COMMAND=npx vite-node x node .trae/scripts/e2e-run.mjs',
  );
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'not-te-dispatch');
});

test('TE 冒烟: TE 派发且无双要素时拒绝替代启动', () => {
  clearDispatchedRoles();
  recordDispatchedRole('test-engineer');
  fixtureProcess(
    '---\nworkflow_mode: full\n---\n\n## 用户确认记录\n\n| 确认项 | 时间 | 用户原话摘要 |\n| ------ | ---- | ------------ |\n| 需求摘要 | 2026-01-01 | 已确认 |\n',
  );
  writeFixtureGated('gated-empty2', {});
  const r = checkTeAlternativeE2eStartup(
    'E2E_WEB_SERVER_COMMAND=npx vite-node x node .trae/scripts/e2e-run.mjs',
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'te-alternative-startup-denied');
});

test('TE 冒烟: 仅声明 allowed 无用户确认时不豁免', () => {
  clearDispatchedRoles();
  recordDispatchedRole('test-engineer');
  fixtureProcess(
    '---\nworkflow_mode: full\n---\n\n## 用户确认记录\n\n| 确认项 | 时间 | 用户原话摘要 |\n| ------ | ---- | ------------ |\n| 需求摘要 | 2026-01-01 | 已确认 |\n',
  );
  writeFixtureGated('gated-alt-only', {
    e2eAlternativeStartup: 'allowed',
    e2eAlternativeStartupReason: 'dev only',
  });
  assert.equal(isAlternativeE2eStartupExempt(), false);
  const r = checkTeAlternativeE2eStartup(
    'E2E_WEB_SERVER_COMMAND=npx vite-node x node .trae/scripts/e2e-run.mjs',
  );
  assert.equal(r.ok, false);
});

test('TE 冒烟: 双要素齐备时允许替代启动', () => {
  clearDispatchedRoles();
  recordDispatchedRole('test-engineer');
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
      '## 用户确认记录',
      '',
      '| 确认项 | 时间 | 用户原话摘要 |',
      '| ------ | ---- | ------------ |',
      '| 非 dist 启动 | 2026-07-28 | 确认允许非 dist 启动做 E2E |',
      '',
    ].join('\n'),
  );
  writeFixtureGated('gated-alt-ok', {
    e2eAlternativeStartup: 'allowed',
    e2eAlternativeStartupReason: '临时允许',
  });
  assert.equal(isAlternativeE2eStartupExempt(), true);
  const r = checkTeAlternativeE2eStartup(
    'E2E_WEB_SERVER_COMMAND=npx vite-node x node .trae/scripts/e2e-run.mjs',
  );
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'dual-element-exempt');
});

test('TE 冒烟: 常规 e2e-run 不视为替代启动', () => {
  clearDispatchedRoles();
  recordDispatchedRole('test-engineer');
  writeFixtureGated('gated-empty3', {});
  const r = checkTeAlternativeE2eStartup(
    'node .trae/scripts/e2e-run.mjs --scope=batch --required-ids=R-001',
  );
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'not-alternative-startup');
});

restoreDispatchedRoles();
cleanup();
