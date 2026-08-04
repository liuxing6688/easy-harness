/**
 * **R34** 证据产物执行证明回归。
 *
 * 覆盖两个方向：
 *   1. **合法路径必须能过**——真实签发 + 真实落签的产物验签通过，且五项门禁照常放行。
 *      这一条与 R16 `--exitCode` 事件同类：新增门禁若使正常流程不可达，比没有门禁更糟。
 *   2. **五种伪造/异常形态必须被识破**——缺字段、未签发、未知 nonce、kind 错配、
 *      私钥未被消费、签名与内容不符（即「手工把 gatePassed 改成 true」）。
 *
 * 入口：node .codex/scripts/gate-selftest.mjs
 */
import {
  test, assert, fs, path, cleanup, fixtureProcess,
  verifyExecutionProof, detectRunnerExecProofKind, getExecProofPolicy, canonicalJson,
  attachExecutionProof, EXEC_PROOF_PENDING_DIR, signFixtureArtifact,
  writeLintResult, clearLintResult, snapshotLintResult, restoreLintResult, checkLintClean,
  writeStaticScanResult, clearStaticScanResult, snapshotStaticScanResult, restoreStaticScanResult,
  checkStaticScanClean,
  writeStartupSmokePassResult, clearStartupSmokeResult,
  snapshotStartupSmokeResult, restoreStartupSmokeResult, checkStartupSmoke,
  checkArtifactFreshness, latestSourceChangeMs,
} from './_harness.mjs';

console.log('== R34：证据产物执行证明（nonce + 签名） ==');

snapshotLintResult();
snapshotStaticScanResult();
snapshotStartupSmokeResult();

const LINT_PASS = () => ({
  gatePassed: true,
  reason: 'passed',
  stack: 'node',
  command: 'npm run lint',
  exitCode: 0,
  output: '',
  executedAt: new Date().toISOString(),
});

// ---------------------------------------------------------------------------
// 出厂默认与运行器识别
// ---------------------------------------------------------------------------

test('R34: 默认启用执行证明（enforce 默认为 true）', () => {
  assert.equal(getExecProofPolicy().enforce, true);
});

test('R34: 按运行器命令识别产物类别（e2e 按 --scope 分流）', () => {
  assert.equal(detectRunnerExecProofKind('node .codex/scripts/lint-run.mjs'), 'lint');
  assert.equal(detectRunnerExecProofKind('node .codex/scripts/static-scan-run.mjs'), 'static-scan');
  assert.equal(
    detectRunnerExecProofKind('node .codex/scripts/startup-smoke-run.mjs'),
    'startup-smoke',
  );
  assert.equal(
    detectRunnerExecProofKind('node .codex/scripts/e2e-run.mjs --scope=batch --required-ids=R-001'),
    'e2e-batch',
  );
  assert.equal(
    detectRunnerExecProofKind('node .codex/scripts/e2e-run.mjs --scope=final'),
    'e2e-final',
  );
  // Windows 反斜杠路径同样识别（本框架宿主常为 win32）
  assert.equal(detectRunnerExecProofKind('node .codex\\scripts\\lint-run.mjs'), 'lint');
});

test('R34: 非运行器命令不签发（不制造无人消费的私钥）', () => {
  assert.equal(detectRunnerExecProofKind('npm run build'), null);
  assert.equal(detectRunnerExecProofKind('node .codex/scripts/qe-run.mjs'), null);
  assert.equal(detectRunnerExecProofKind(''), null);
  assert.equal(detectRunnerExecProofKind(null), null);
});

test('R34: 规范化 JSON 对键序不敏感（签名不因键序变化而失配）', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] }), canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }));
  // undefined 被丢弃，与 JSON.stringify 落盘行为一致
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
});

// ---------------------------------------------------------------------------
// 合法路径必须能过（防「新增门禁 = 不可达标准」，R12）
// ---------------------------------------------------------------------------

test('R34: 真实签发+落签的产物验签通过', () => {
  const artifact = signFixtureArtifact('lint', LINT_PASS());
  assert.equal(typeof artifact.execProof.nonce, 'string');
  assert.equal(typeof artifact.execProof.signature, 'string');
  const r = verifyExecutionProof('lint', artifact);
  assert.equal(r.ok, true, `合法产物被拒（reason=${r.reason}）——门禁将不可达`);
});

test('R34: 已签名产物经磁盘 JSON 往返后仍验签通过（落盘格式不破坏签名）', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', ''].join('\n'));
  writeLintResult(LINT_PASS());
  const r = checkLintClean();
  assert.equal(r.ok, true, `R15 判据在合法签名下未通过（reason=${r.reason}）`);
});

test('R34: R16 两项子检查合法签名下正常放行', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', ''].join('\n'));
  writeStaticScanResult({
    gatePassed: true,
    reason: 'passed',
    duplication: { gatePassed: true, reason: 'passed', command: 'jscpd-rs .', exitCode: 0 },
    security: { gatePassed: true, reason: 'passed', command: 'gitleaks', exitCode: 0 },
    executedAt: new Date().toISOString(),
  });
  assert.equal(checkStaticScanClean().ok, true);
});

test('R34: R32 冒烟产物合法签名下正常放行（不与新鲜度判据冲突）', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', ''].join('\n'));
  writeStartupSmokePassResult();
  const r = checkStartupSmoke();
  assert.equal(r.ok, true, `R32 判据在合法签名下未通过（reason=${r.reason}）`);
});

// ---------------------------------------------------------------------------
// 伪造与异常形态必须被识破
// ---------------------------------------------------------------------------

test('R34: 无 execProof 字段 → exec-proof-missing（旧版或手写产物）', () => {
  const r = verifyExecutionProof('lint', LINT_PASS());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'exec-proof-missing');
  assert.match(r.message, /R34/);
});

test('R34: 产物为 null → exec-proof-missing（不因缺产物而抛异常）', () => {
  assert.equal(verifyExecutionProof('lint', null).reason, 'exec-proof-missing');
});

test('R34: 运行器未取到签发的 nonce → 自述 no-issued-nonce 且验签失败（Hook 通道之外执行）', () => {
  // 清空交接目录后直接落签：模拟「用户自己在外部终端跑运行器」，门禁从未签发过 nonce
  fs.rmSync(EXEC_PROOF_PENDING_DIR, { recursive: true, force: true });
  const artifact = attachExecutionProof('lint', LINT_PASS());
  assert.equal(artifact.execProof.nonce, null);
  assert.equal(artifact.execProof.reason, 'no-issued-nonce', '须自述原因，便于区分「Hook 未生效」与「产物被手写」');
  assert.equal(verifyExecutionProof('lint', artifact).reason, 'exec-proof-no-nonce');
});

test('R34: 伪造 nonce → exec-proof-unknown-nonce', () => {
  const artifact = signFixtureArtifact('lint', LINT_PASS());
  artifact.execProof.nonce = 'deadbeefdeadbeefdeadbeefdeadbeef';
  assert.equal(verifyExecutionProof('lint', artifact).reason, 'exec-proof-unknown-nonce');
});

test('R34: 拿 lint 的 nonce 冒充 static-scan → exec-proof-kind-mismatch', () => {
  const artifact = signFixtureArtifact('lint', LINT_PASS());
  assert.equal(verifyExecutionProof('static-scan', artifact).reason, 'exec-proof-kind-mismatch');
});

test('R34: 私钥交接文件仍在盘上 → exec-proof-key-not-consumed（私钥未被运行器消费即作废）', () => {
  const artifact = signFixtureArtifact('lint', LINT_PASS());
  // 复现「私钥泄漏窗口」：把交接文件放回去，签名来源即不可信
  fs.mkdirSync(EXEC_PROOF_PENDING_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(EXEC_PROOF_PENDING_DIR, `${artifact.execProof.nonce}.json`),
    JSON.stringify({ nonce: artifact.execProof.nonce, kind: 'lint', privateKey: 'x' }),
    'utf8',
  );
  assert.equal(verifyExecutionProof('lint', artifact).reason, 'exec-proof-key-not-consumed');
  fs.rmSync(path.join(EXEC_PROOF_PENDING_DIR, `${artifact.execProof.nonce}.json`), { force: true });
});

test('R34: 落签后手工把 gatePassed 改成 true → exec-proof-signature-mismatch（核心攻击面）', () => {
  const failed = signFixtureArtifact('lint', {
    gatePassed: false,
    reason: 'lint-failed',
    stack: 'node',
    command: 'npm run lint',
    exitCode: 1,
    output: '3 problems',
    executedAt: new Date().toISOString(),
  });
  assert.equal(verifyExecutionProof('lint', failed).ok, true, '真实失败产物本身应验签通过');
  failed.gatePassed = true;
  failed.reason = 'passed';
  const r = verifyExecutionProof('lint', failed);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'exec-proof-signature-mismatch');
});

test('R34: 改动子结果（R16 duplication.gatePassed）同样被签名覆盖', () => {
  const artifact = signFixtureArtifact('static-scan', {
    gatePassed: false,
    reason: 'failed',
    duplication: { gatePassed: false, reason: 'scan-failed', command: 'jscpd-rs .', exitCode: 1 },
    security: { gatePassed: true, reason: 'passed', command: 'gitleaks', exitCode: 0 },
    executedAt: new Date().toISOString(),
  });
  artifact.duplication.gatePassed = true;
  artifact.gatePassed = true;
  assert.equal(verifyExecutionProof('static-scan', artifact).reason, 'exec-proof-signature-mismatch');
});

test('R34: 未签名产物使 R15 判据不通过，且 reason 指向执行证明而非「lint 有问题」', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', ''].join('\n'));
  writeLintResult(LINT_PASS(), { sign: false });
  const r = checkLintClean();
  assert.equal(r.ok, false);
  assert.match(r.reason, /^exec-proof-/, '理由须指向执行证明，否则会把代理引向「整改 lint」的错误方向');
});

test('R34: 缺产物仍报「缺产物」而非「执行证明缺失」（理由须可区分）', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', ''].join('\n'));
  clearLintResult();
  assert.equal(checkLintClean().reason, 'no-lint-result');
});

// ---------------------------------------------------------------------------
// 新鲜度：验签只证明「跑过」，不证明「对应现在这份代码」（2026-07-30 复核）
//
// 复核实测：同一份签名产物可无限次通过验签，`executedAt: 2020-01-01` 也照过；
// R15/R16/批次 E2E/最终 E2E 四项都没有任何新鲜度判据。于是存在一条不必抢私钥的
// 重放路径——代码还绿时真跑一次、存下产物，改坏代码后原样放回即可。
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;

test('R34: 产物早于最后一次源码变更 → exec-proof-stale-artifact（重放被拦）', () => {
  const sourceChangedMs = Date.now();
  const stale = { gatePassed: true, executedAt: new Date(sourceChangedMs - HOUR).toISOString() };
  const r = checkArtifactFreshness('lint', stale, { sourceChangedMs });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'exec-proof-stale-artifact');
  assert.match(r.message, /上一版代码/);
});

test('R34: 产物晚于最后一次源码变更 → 通过（重跑一次即可自愈，不是死锁）', () => {
  const sourceChangedMs = Date.now() - HOUR;
  const fresh = { gatePassed: true, executedAt: new Date().toISOString() };
  assert.equal(checkArtifactFreshness('lint', fresh, { sourceChangedMs }).ok, true);
});

test('R34: `capturedAt` 与 `executedAt` 两种字段名都认（R32 用前者）', () => {
  const sourceChangedMs = Date.now() - HOUR;
  assert.equal(
    checkArtifactFreshness('startup-smoke', { capturedAt: new Date().toISOString() }, { sourceChangedMs }).ok,
    true,
  );
});

test('R34: 产物完全没有时间戳 → 判为不新鲜（合法运行器一定会写）', () => {
  const r = checkArtifactFreshness('lint', { gatePassed: true }, { sourceChangedMs: Date.now() });
  assert.equal(r.reason, 'exec-proof-stale-artifact');
});

test('R34: 没有源码树时不判新鲜度（空项目/纯文档项目不得被卡住，R12）', () => {
  assert.equal(checkArtifactFreshness('lint', { gatePassed: true }, { sourceChangedMs: null }).ok, true);
});

test('R34: latestSourceChangeMs 返回毫秒时间戳或 null，且不抛异常', () => {
  const v = latestSourceChangeMs({ force: true });
  assert.ok(v === null || (typeof v === 'number' && v > 0));
});

test('R34: 陈旧产物在 R15 判据上报执行证明类理由（而非「lint 有问题」）', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', ''].join('\n'));
  // 签名覆盖 executedAt，故这份「2020 年的绿产物」签名有效、内容却早已过期
  writeLintResult({ ...LINT_PASS(), executedAt: '2020-01-01T00:00:00.000Z' });
  const r = checkLintClean();
  assert.equal(r.ok, false, '把旧的绿产物放回 test-results 就能过关，等于 R34 白做');
  assert.equal(r.reason, 'exec-proof-stale-artifact');
});

test('R34: 陈旧冒烟产物在 R32 判据上同样被拦（24h 有效期不等于「这份代码」）', () => {
  fixtureProcess(['---', 'workflow_mode: full', '---', ''].join('\n'));
  writeStartupSmokePassResult({ capturedAt: '2020-01-01T00:00:00.000Z' });
  assert.equal(checkStartupSmoke().reason, 'exec-proof-stale-artifact');
});

test('R34: docs-only 与双要素豁免优先于验签（不因豁免项目缺产物而死锁）', () => {
  fixtureProcess(
    [
      '---', 'workflow_mode: docs-only', '---', '',
      '## 用户确认记录', '',
      '| 确认项 | 时间 | 用户原话摘要 |',
      '| ------ | ---- | ------------ |',
      '| 工作流模式确认 | 2026-01-01 | 确认采用 workflow_mode: docs-only；只改文档 |',
      '',
    ].join('\n'),
  );
  clearLintResult();
  clearStaticScanResult();
  clearStartupSmokeResult();
  assert.equal(checkLintClean().ok, true);
  assert.equal(checkStaticScanClean().ok, true);
  assert.equal(checkStartupSmoke().ok, true);
});

restoreLintResult();
restoreStaticScanResult();
restoreStartupSmokeResult();
cleanup();
