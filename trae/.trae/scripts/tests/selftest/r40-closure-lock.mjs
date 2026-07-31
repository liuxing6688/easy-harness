/**
 * **R40** 闭环锁回归。
 *
 * 背景（摩擦点1优化，2026-07-31）：stop 门禁受 `hooks.json` `loop_limit` 限次，
 * 而 Trae 平台对 `loop_limit` 的强制力未保证。代理硬结束回合后下一轮 PreToolUse
 * 读不到任何「未闭环」痕迹，约束即断。闭环锁把 stop 的「事后催促」转化为
 * PreToolUse 的「事前阻断」：stop block 落盘 marker，PreToolUse 读 marker 收紧 DE。
 *
 * 本套件锁定：
 *   - marker 生命周期（read/write/clear）与 TTL 过期 fail-open；
 *   - `closureLockBlocksDev` 对各 stage 的裁决（dev-incomplete 不拦、rollback-exceeded/
 *     blocking-no-evidence 拦、qe/test-incomplete 须回派依据）；
 *   - R29 把 marker 纳入 `runtime-marker`（代理写入/删除被拒）。
 *
 * 端到端（stop 写 marker → PreToolUse 读 marker 收紧 DE）由
 * `scenarios/closure-lock.mjs` spawn Hook 入口验证。
 *
 * 入口：node .trae/scripts/gate-selftest.mjs
 */
import {
  test, assert, fs, path, cleanup, fixtureProcess, PROJECT_ROOT,
  CLOSURE_LOCK_MARKER, CLOSURE_STAGES,
  readClosureLock, writeClosureLock, clearClosureLock, closureLockBlocksDev,
  classifyHarnessSelfGovernedPath, harnessSelfGovernedVerdict, normalizePath,
  parseRollbackCounts,
} from './_harness.mjs';

console.log('== R40：闭环锁 ==');

const MARKER_ABS = path.join(PROJECT_ROOT, CLOSURE_LOCK_MARKER);

/** 每条用例前清掉 marker，避免相互污染 */
function clearMarker() {
  try { fs.rmSync(MARKER_ABS, { force: true }); } catch { /* ignore */ }
}

const ROLLBACK_TABLE = [
  '## 回退计数',
  '',
  '| 对象类型 | 对象编号 | 回退次数 |',
  '| -------- | -------- | -------- |',
  '| 任务包 | T0-1 | 1 |',
  '',
].join('\n');

// ---------------------------------------------------------------------------
// marker 生命周期
// ---------------------------------------------------------------------------

test('R40: 不存在 marker 时 readClosureLock 返回 null（fail-open）', () => {
  clearMarker();
  assert.equal(readClosureLock(), null);
});

test('R40: writeClosureLock 落盘后 readClosureLock 读回全部字段', () => {
  clearMarker();
  writeClosureLock(CLOSURE_STAGES.QE_INCOMPLETE, ['lint', 'staticScan'], 'QE 未完成');
  const lock = readClosureLock();
  assert.equal(lock?.stage, 'qe-incomplete');
  assert.deepEqual(lock?.missingGates, ['lint', 'staticScan']);
  assert.equal(lock?.reason, 'QE 未完成');
  assert.ok(typeof lock?.pendingSince === 'string' && lock.pendingSince.length > 0);
});

test('R40: writeClosureLock 容错非数组 missingGates / 非字符串 reason', () => {
  clearMarker();
  writeClosureLock(CLOSURE_STAGES.TEST_INCOMPLETE, 'not-an-array', 123);
  const lock = readClosureLock();
  assert.deepEqual(lock?.missingGates, []);
  assert.equal(lock?.reason, '');
});

test('R40: clearClosureLock 后 marker 不复存在', () => {
  writeClosureLock(CLOSURE_STAGES.DEV_INCOMPLETE);
  assert.ok(fs.existsSync(MARKER_ABS));
  clearClosureLock();
  assert.equal(fs.existsSync(MARKER_ABS), false);
  assert.equal(readClosureLock(), null);
});

test('R40: clearClosureLock 对不存在的 marker 不抛（幂等）', () => {
  clearMarker();
  assert.doesNotThrow(() => clearClosureLock());
});

test('R40: marker 解析失败 → null（不因损坏文件锁死项目）', () => {
  clearMarker();
  fs.writeFileSync(MARKER_ABS, '{ not json', 'utf8');
  assert.equal(readClosureLock(), null);
});

test('R40: marker 缺 stage 字段 → null（判据不完整不阻拦）', () => {
  clearMarker();
  fs.writeFileSync(MARKER_ABS, JSON.stringify({ missingGates: [] }), 'utf8');
  assert.equal(readClosureLock(), null);
});

// ---------------------------------------------------------------------------
// TTL 过期 fail-open（防历史 marker 永久锁死项目）
// ---------------------------------------------------------------------------

test('R40: pendingSince 超过 7 天 → 视为残留返回 null', () => {
  clearMarker();
  const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(
    MARKER_ABS,
    JSON.stringify({ stage: 'qe-incomplete', missingGates: [], reason: '', pendingSince: stale }),
    'utf8',
  );
  assert.equal(readClosureLock(), null);
});

test('R40: pendingSince 在 7 天内 → 仍有效', () => {
  clearMarker();
  const fresh = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(
    MARKER_ABS,
    JSON.stringify({ stage: 'qe-incomplete', missingGates: ['lint'], reason: 'x', pendingSince: fresh }),
    'utf8',
  );
  const lock = readClosureLock();
  assert.equal(lock?.stage, 'qe-incomplete');
});

test('R40: pendingSince 非法时间戳 → 不走 TTL 分支（按有效处理）', () => {
  clearMarker();
  fs.writeFileSync(
    MARKER_ABS,
    JSON.stringify({ stage: 'qe-incomplete', missingGates: [], reason: '', pendingSince: 'not-a-date' }),
    'utf8',
  );
  const lock = readClosureLock();
  assert.equal(lock?.stage, 'qe-incomplete');
});

// ---------------------------------------------------------------------------
// closureLockBlocksDev：各 stage 裁决
// ---------------------------------------------------------------------------

test('R40: marker 不存在 → 不阻拦（基线 fail-open）', () => {
  clearMarker();
  assert.equal(closureLockBlocksDev('', null).blocked, false);
});

test('R40: dev-incomplete 不阻拦（DE 任务未完成，继续开发合法）', () => {
  assert.equal(
    closureLockBlocksDev('', { stage: CLOSURE_STAGES.DEV_INCOMPLETE }).blocked,
    false,
  );
});

test('R40: rollback-exceeded 阻拦（已超回退上限，须 PM 标 blocking）', () => {
  const r = closureLockBlocksDev('', { stage: CLOSURE_STAGES.ROLLBACK_EXCEEDED });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /rollback-exceeded/);
  assert.match(r.reason, /project-manager/);
});

test('R40: blocking-no-evidence 阻拦（阻塞态缺 R35 证据）', () => {
  const r = closureLockBlocksDev('', { stage: CLOSURE_STAGES.BLOCKING_NO_EVIDENCE });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /blocking-no-evidence/);
  assert.match(r.reason, /R35/);
});

test('R40: qe-incomplete 无回退计数 → 阻拦（不得借 PM→DE 链开始新开发）', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', '# 流程', ''].join('\n'));
  const r = closureLockBlocksDev(null, { stage: CLOSURE_STAGES.QE_INCOMPLETE, missingGates: ['lint'] });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /qe-incomplete/);
  assert.match(r.reason, /回退计数/);
});

test('R40: test-incomplete 无回退计数 → 阻拦', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', '# 流程', ''].join('\n'));
  const r = closureLockBlocksDev(null, { stage: CLOSURE_STAGES.TEST_INCOMPLETE, missingGates: ['finalE2E'] });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /test-incomplete/);
});

test('R40: qe-incomplete 有回退计数（PM 回派 DE）→ 不阻拦', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', '', ROLLBACK_TABLE, ''].join('\n'));
  // 复用 R31 解析器，确认夹具确实能被机读
  assert.equal(parseRollbackCounts(fs.readFileSync(
    path.resolve(PROJECT_ROOT, process.env.HARNESS_PROCESS_PATH), 'utf8',
  )).some((r) => r.count > 0), true);
  const r = closureLockBlocksDev(null, { stage: CLOSURE_STAGES.QE_INCOMPLETE });
  assert.equal(r.blocked, false);
});

test('R40: test-incomplete 有回退计数 → 不阻拦', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', '', ROLLBACK_TABLE, ''].join('\n'));
  const r = closureLockBlocksDev(null, { stage: CLOSURE_STAGES.TEST_INCOMPLETE });
  assert.equal(r.blocked, false);
});

test('R40: qe-incomplete 回退计数全为 0 → 阻拦（无真实回派依据）', () => {
  const md = [
    '---', 'workflow_mode: full', '---', '',
    '## 回退计数', '',
    '| 对象类型 | 对象编号 | 回退次数 |',
    '| -------- | -------- | -------- |',
    '| 任务包 | T0-1 | 0 |',
    '',
  ].join('\n');
  fixtureProcess(md);
  const r = closureLockBlocksDev(null, { stage: CLOSURE_STAGES.QE_INCOMPLETE });
  assert.equal(r.blocked, true);
});

test('R40: 阻拦文案列出 missingGates（指明补完方向）', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', '# 流程', ''].join('\n'));
  const r = closureLockBlocksDev(null, {
    stage: CLOSURE_STAGES.QE_INCOMPLETE,
    missingGates: ['lint', 'finalE2E'],
  });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /lint/);
  assert.match(r.reason, /finalE2E/);
});

// ---------------------------------------------------------------------------
// R29：marker 纳入 runtime-marker，代理写入/删除被拒
// ---------------------------------------------------------------------------

test('R40/R29: 闭环锁 marker 路径被识别为 runtime-marker', () => {
  const kind = classifyHarnessSelfGovernedPath(CLOSURE_LOCK_MARKER);
  assert.equal(kind, 'runtime-marker');
});

test('R40/R29: 代理写 marker 路径 → deny（runtime-marker 一律拒绝）', () => {
  const verdict = harnessSelfGovernedVerdict('runtime-marker', normalizePath(CLOSURE_LOCK_MARKER));
  // runtime-marker 的裁决为 deny（见 paths.mjs harnessSelfGovernedVerdict）
  assert.match(verdict.userMessage, /R29|runtime-marker|门禁自治/);
});

test('R40/R29: marker 路径在 HARNESS_RUNTIME_MARKERS 集合内（防漂移）', async () => {
  const { HARNESS_RUNTIME_MARKERS } = await import(
    '../../../hooks/lib/paths.mjs'
  );
  assert.ok(
    HARNESS_RUNTIME_MARKERS.includes(CLOSURE_LOCK_MARKER),
    'marker 路径须在 R29 受保护集合内，否则代理可随意写/删绕过跨回合约束',
  );
});

// ---------------------------------------------------------------------------
// writeClosureLock 不抛（best-effort，stop hook 调用方不期望失败）
// ---------------------------------------------------------------------------

test('R40: writeClosureLock 对异常 stage 仍写盘（不校验枚举，由 stop hook 传值）', () => {
  clearMarker();
  assert.doesNotThrow(() => writeClosureLock('unknown-stage', [], 'x'));
  const lock = readClosureLock();
  assert.equal(lock?.stage, 'unknown-stage');
});

cleanup();
