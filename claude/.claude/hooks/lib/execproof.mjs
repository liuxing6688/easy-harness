/**
 * 门禁域：execproof — **R34** 证据产物执行证明（nonce + ed25519 签名）。
 *
 * 消费方：`gate-dev-shell`（签发）、`.claude/scripts/*-run.mjs`（落签）、
 * `iteration` / `qe` / `dispatch`（验签）。域对照见 ./README.md。
 *
 * ## 要解决的问题
 *
 * R15/R16/R17/R32 与批次/最终 E2E 共五项硬门禁，判据都是读 `test-results/**` 下的
 * `gatePassed`。该目录**必须**豁免写门禁（否则运行器自身会被 R6/R28 拦住），于是
 * 历史实现里「手写 `{"gatePassed":true}`」与「真跑一遍」对门禁完全等价——机械层
 * 拦不住任何一项，这是本框架最大的承重缺口（原 §8.7 边界 2）。
 *
 * ## 机制
 *
 * 1. **签发（Hook）**：`PreToolUse`（`Bash|PowerShell`）上 `gate-dev-shell` 识别出本次命令是框架
 *    自带运行器时，生成一对 ed25519 密钥：**公钥**写入台账 `.exec-proof-ledger.json`，
 *    **私钥**写入交接文件 `.exec-proof-pending/<nonce>.json`。两者都在 `.claude/hooks/`
 *    下并由 **R29** 分级为 `runtime-marker`（代理写入一律 deny，含 Shell 通道）。
 * 2. **落签（运行器）**：运行器写产物前调用 `attachExecutionProof()`——领取并**立即删除**
 *    交接文件（私钥单次使用、不留存），对「产物去掉 `execProof` 后的规范化 JSON」签名，
 *    把 `{ nonce, algo, signature }` 写进产物。
 * 3. **验签（门禁）**：`verifyExecutionProof()` 用台账里的公钥验签，并要求交接文件**已被
 *    消费**（仍存在 ⇒ 私钥没被运行器取走 ⇒ 该 nonce 作废）。
 * 4. **验新鲜度（门禁）**：`checkArtifactFreshness()` 要求产物时间戳不早于最后一次源码
 *    变更。验签只说明「跑过」，不说明「对应现在这份代码」——两者缺一，存一份绿产物
 *    改坏代码后放回即可过关（2026-07-30 复核实测可重放）。
 *
 * ## 能力边界（坦诚披露，§8.7 边界 2）
 *
 * 这**不是**密码学安全边界，宿主上的代理拥有完整读文件权限。它把伪造成本从
 * 「改一个 JSON 字段」抬到「在私钥被运行器消费前抢读交接文件 + 自行完成 ed25519
 * 签名 + 规范化序列化」——一条需要刻意构造、且在会话记录里清晰可见的多步链路。
 * 目标是消除「顺手抄近路」，不是宣称不可伪造。
 *
 * ## 防死锁
 *
 * - 台账条目**按 kind 保留最近 N 条**（默认 8），不做全局淘汰，避免「产物还在用、
 *   nonce 已被挤掉」导致门禁永久红灯（R12：新增门禁不得制造不可达标准）。
 * - nonce **不设过期**，过期只作用于**私钥交接文件**（默认 15 分钟，由任意 Hook 运行时清扫）。
 *   产物是否「反映当前代码」不靠 nonce 过期，而由 `checkArtifactFreshness` 与源码 mtime
 *   比对——这样重跑一次即可自愈，不会出现「nonce 到期导致产物永久作废」的死锁。
 *   `execProof.requireFreshArtifacts: false` 是该判据的**用户级**逃生开关。
 * - `execProof.enforce: false` 是**用户级**逃生开关：`harness.config.json` 受 R29 锁定，
 *   代理改不了；用户在受限环境（自己在终端里跑运行器、Hook 未生效等）可关闭。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, randomBytes } from 'node:crypto';
import { readJsonFileSafe, loadHarnessConfig, PROJECT_ROOT, getMergedGatedPaths } from './core.mjs';

/**
 * 路径常量本地推导，**刻意不用 core.mjs 的 `HOOKS_DIR`**。
 * 既有依赖链是 `core → role-path → paths → iteration → execproof`：core 尚在求值中就会
 * 加载到本模块，此时引用 core 的 `const HOOKS_DIR` 会落进 TDZ（`Cannot access before
 * initialization`）。函数体内调用 core 的 `readJsonFileSafe` / `loadHarnessConfig` 无此问题
 * （运行期才求值），故只有模块顶层的路径常量需要自算。
 */
const HOOKS_DIR_LOCAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** R34：执行证明台账（公钥 + nonce，只由 Hook 进程写入；R29 runtime-marker） */
export const EXEC_PROOF_LEDGER = path.join(HOOKS_DIR_LOCAL, '.exec-proof-ledger.json');

/** R34：私钥交接目录（运行器领取后立即删除；R29 runtime-marker） */
export const EXEC_PROOF_PENDING_DIR = path.join(HOOKS_DIR_LOCAL, '.exec-proof-pending');

/** R34：受执行证明约束的产物类别（与 test-results 下五项机读产物一一对应） */
export const EXEC_PROOF_KINDS = Object.freeze([
  'lint',
  'static-scan',
  'e2e-batch',
  'e2e-final',
  'startup-smoke',
]);

export const EXEC_PROOF_ALGO = 'ed25519';

const DEFAULT_POLICY = Object.freeze({
  enforce: true,
  keyTtlMinutes: 15,
  historyPerKind: 8,
  requireFreshArtifacts: true,
});

/**
 * R34 策略：`harness.config.json → execProof`。
 * `enforce: false` / `requireFreshArtifacts: false` 属放松型旋钮，故只读
 * `harness.config.json`（R29 锁定，仅用户可改），**不读** `gated-artifacts.json`
 * （由被约束方 SA 书写）。
 */
export function getExecProofPolicy() {
  const raw = loadHarnessConfig().execProof ?? {};
  const keyTtl = Number(raw.keyTtlMinutes);
  const history = Number(raw.historyPerKind);
  return {
    enforce: raw.enforce !== false,
    requireFreshArtifacts: raw.requireFreshArtifacts !== false,
    keyTtlMinutes: Number.isFinite(keyTtl) && keyTtl > 0 ? keyTtl : DEFAULT_POLICY.keyTtlMinutes,
    historyPerKind:
      Number.isFinite(history) && history > 0 ? Math.floor(history) : DEFAULT_POLICY.historyPerKind,
  };
}

/**
 * 框架自带运行器 → 产物类别。
 * 与 `paths.mjs` 的 `HARNESS_RUNNER_RE`（R28 豁免）同源但用途不同：此处要区分 kind，
 * 且 `e2e-run.mjs` 须按 `--scope` 分流到 batch/final 两份产物。
 */
export function detectRunnerExecProofKind(command) {
  if (!command || typeof command !== 'string') return null;
  const m = command.match(
    /\.claude[/\\]scripts[/\\](lint-run|static-scan-run|e2e-run|startup-smoke-run)\.mjs\b/i,
  );
  if (!m) return null;
  switch (m[1].toLowerCase()) {
    case 'lint-run':
      return 'lint';
    case 'static-scan-run':
      return 'static-scan';
    case 'startup-smoke-run':
      return 'startup-smoke';
    case 'e2e-run':
      return /--scope\s*=\s*final\b/i.test(command) ? 'e2e-final' : 'e2e-batch';
    default:
      return null;
  }
}

/** 规范化 JSON 序列化（键排序、丢弃 undefined），使签名对键序不敏感 */
export function canonicalJson(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/** 待签名字节：产物去掉 `execProof` 后的规范化形态 + kind + nonce 绑定 */
function buildSignedPayload({ kind, nonce, artifact }) {
  const rest = { ...(artifact ?? {}) };
  delete rest.execProof;
  return Buffer.from(canonicalJson({ kind, nonce, artifact: rest }), 'utf8');
}

function readLedger() {
  const data = readJsonFileSafe(EXEC_PROOF_LEDGER);
  if (!data || typeof data !== 'object' || !Array.isArray(data.entries)) {
    return { version: 1, entries: [] };
  }
  return { version: 1, entries: data.entries };
}

function writeLedger(ledger) {
  fs.mkdirSync(path.dirname(EXEC_PROOF_LEDGER), { recursive: true });
  fs.writeFileSync(EXEC_PROOF_LEDGER, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}

function pendingKeyPath(nonce) {
  return path.join(EXEC_PROOF_PENDING_DIR, `${nonce}.json`);
}

/**
 * 清扫超时未被消费的私钥交接文件。
 * 私钥只应存活「Hook 返回 → 运行器启动」这一瞬；超时未消费说明该命令没真的跑运行器
 * （或运行器崩在落签前），此时私钥留在盘上纯属泄漏面，须删除并使该 nonce 作废。
 */
export function sweepExecutionProofKeys(now = Date.now()) {
  const { keyTtlMinutes } = getExecProofPolicy();
  const ttlMs = keyTtlMinutes * 60 * 1000;
  let swept = 0;
  let names;
  try {
    names = fs.readdirSync(EXEC_PROOF_PENDING_DIR);
  } catch {
    return { swept: 0 };
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const abs = path.join(EXEC_PROOF_PENDING_DIR, name);
    try {
      if (now - fs.statSync(abs).mtimeMs <= ttlMs) continue;
      fs.rmSync(abs, { force: true });
      swept += 1;
    } catch {
      /* 清扫失败不影响门禁判定 */
    }
  }
  return { swept };
}

/**
 * 签发一次执行证明（由 `gate-dev-shell` 在放行运行器命令前调用）。
 * 公钥入台账、私钥入交接文件；写盘失败只记 stderr，绝不阻断 Shell 放行
 * （否则门禁自身故障会变成「所有运行器都跑不了」的硬死锁）。
 */
export function issueExecutionProof({ kind, command } = {}) {
  if (!EXEC_PROOF_KINDS.includes(kind)) return { ok: false, reason: 'unknown-kind' };
  try {
    sweepExecutionProofKeys();
    const nonce = randomBytes(16).toString('hex');
    const { publicKey, privateKey } = generateKeyPairSync(EXEC_PROOF_ALGO);
    const issuedAt = new Date().toISOString();

    const ledger = readLedger();
    ledger.entries.push({
      nonce,
      kind,
      algo: EXEC_PROOF_ALGO,
      issuedAt,
      command: String(command ?? '').slice(0, 500),
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });
    ledger.entries = capPerKind(ledger.entries, getExecProofPolicy().historyPerKind);
    writeLedger(ledger);

    fs.mkdirSync(EXEC_PROOF_PENDING_DIR, { recursive: true });
    fs.writeFileSync(
      pendingKeyPath(nonce),
      JSON.stringify({
        nonce,
        kind,
        issuedAt,
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      }),
      'utf8',
    );
    return { ok: true, nonce, kind };
  } catch (err) {
    process.stderr.write(`[execproof] issue failed: ${err?.message ?? err}\n`);
    return { ok: false, reason: 'issue-failed' };
  }
}

/** 按 kind 各保留最近 N 条（不做全局淘汰，防「产物还在用、nonce 被挤掉」死锁） */
function capPerKind(entries, perKind) {
  const kept = [];
  for (const kind of EXEC_PROOF_KINDS) {
    const ofKind = entries.filter((e) => e?.kind === kind);
    kept.push(...ofKind.slice(-perKind));
  }
  return entries.filter((e) => kept.includes(e));
}

/**
 * 领取并**立即销毁**私钥（运行器侧）。取最新一条匹配 kind 的交接文件。
 * @returns {{ nonce: string, privateKey: string }|null}
 */
export function claimExecutionProofKey(kind) {
  let names;
  try {
    names = fs.readdirSync(EXEC_PROOF_PENDING_DIR);
  } catch {
    return null;
  }
  const candidates = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const abs = path.join(EXEC_PROOF_PENDING_DIR, name);
    const data = readJsonFileSafe(abs);
    if (!data || data.kind !== kind || typeof data.privateKey !== 'string') continue;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(abs).mtimeMs;
    } catch {
      continue;
    }
    candidates.push({ abs, data, mtimeMs });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const chosen = candidates[0];
  try {
    fs.rmSync(chosen.abs, { force: true });
  } catch {
    // 删不掉私钥就不能落签——否则会产出一份「交接文件仍存在」的必然验签失败产物。
    process.stderr.write('[execproof] pending key not removable, skip signing\n');
    return null;
  }
  return { nonce: chosen.data.nonce, privateKey: chosen.data.privateKey };
}

/**
 * 运行器侧：为产物附加执行证明。就地写入 `artifact.execProof` 并返回同一对象。
 *
 * 领不到私钥时写一条**自述未签名**的 `execProof`（`signature: null` + reason），
 * 而不是什么都不写——这样门禁能报出「本次运行器未经门禁签发」而非笼统的「缺证明」，
 * 也便于用户区分「Hook 没生效」与「产物被手写」。
 */
export function attachExecutionProof(kind, artifact) {
  if (!artifact || typeof artifact !== 'object') return artifact;
  const claimed = claimExecutionProofKey(kind);
  if (!claimed) {
    artifact.execProof = {
      kind,
      algo: EXEC_PROOF_ALGO,
      nonce: null,
      signature: null,
      signedAt: new Date().toISOString(),
      reason: 'no-issued-nonce',
    };
    return artifact;
  }
  try {
    const signature = cryptoSign(
      null,
      buildSignedPayload({ kind, nonce: claimed.nonce, artifact }),
      claimed.privateKey,
    ).toString('base64');
    artifact.execProof = {
      kind,
      algo: EXEC_PROOF_ALGO,
      nonce: claimed.nonce,
      signature,
      signedAt: new Date().toISOString(),
    };
  } catch (err) {
    artifact.execProof = {
      kind,
      algo: EXEC_PROOF_ALGO,
      nonce: claimed.nonce,
      signature: null,
      signedAt: new Date().toISOString(),
      reason: `sign-failed: ${err?.message ?? err}`,
    };
  }
  return artifact;
}

/**
 * F-03（2026-08-11 审核修复）：运行器 stdout 对「未落签」给出醒目提示。
 *
 * 背景：`gatePassed` 与 `execProof` 是两套独立字段。在门禁通道之外直连终端跑运行器时，
 * 产物照样写出 `gatePassed: true`，而 stop 门禁会以另一条判据（`exec-proof-no-nonce`）
 * 拒绝收尾——用户看到的是「运行器说通过了，门禁说没通过」，排查方向完全错位。
 * 这里只加一行 stderr 提示，不改变任何判定（判定权仍在 Hook 侧）。
 *
 * @param {object|null} artifact 已 `attachExecutionProof` 的产物
 */
export function warnIfUnsigned(artifact) {
  const proof = artifact?.execProof;
  if (!proof || proof.signature) return;
  process.stderr.write(
    '\n[!] 本次运行**未取到门禁签发的 nonce**，产物为「自述未签名」状态'
      + `（execProof.reason: ${proof.reason ?? 'unknown'}）。\n`
      + '    即使上面显示 gatePassed: true，stop 门禁仍会按 R34 拒绝收尾。\n'
      + '    成因：运行器不是经代理 Shell 通道（PreToolUse / gate-dev-shell 门禁）执行的，例如直接在外部终端里跑。\n'
      + '    处置：由对应角色在代理会话内重新运行本运行器；若确需在门禁外执行，'
      + '须由**用户本人**在 .claude/harness.config.json 设 execProof.enforce: false（R29 锁定，代理不得改）。\n\n',
  );
}

// ---------------------------------------------------------------------------
// R34 新鲜度：产物须晚于最后一次源码变更
// ---------------------------------------------------------------------------

/**
 * 遍历源码树时跳过的目录（依赖、构建产物、受控运行产物、VCS 元数据）。
 * 与 `gatedPaths.extensionGateExemptDirs` 用途相近但**不复用**：那份清单由用户配置、
 * 语义是「这里的代码不受写门禁」；这里要的是「这里的变动不代表产品代码变了」，
 * 若挂到可配置项上，放松一处即可让新鲜度判据整体失效。
 */
const SOURCE_WALK_SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'test-results', 'playwright-report', 'coverage',
  'dist', 'build', 'out', 'target', 'bin', 'obj', 'vendor', 'Pods',
  '.venv', 'venv', 'env', '__pycache__', '.tox', '.mypy_cache', '.pytest_cache',
  '.next', '.nuxt', '.svelte-kit', '.output', '.turbo', '.parcel-cache',
  '.gradle', '.dart_tool', '.idea', '.vs', 'tmp', 'temp',
]);

/** 遍历上限：超过即停（宁可判据偏松，也不让门禁在巨型仓库上卡住，R12） */
const SOURCE_WALK_MAX_ENTRIES = 20000;

/**
 * 时间戳容差：产物 `capturedAt` 由运行器在命令跑完后取，理应晚于任何源码 mtime；
 * 留 2 秒吸收文件系统时间戳粒度（FAT / 网络盘）与进程调度抖动。
 */
const FRESHNESS_TOLERANCE_MS = 2000;

let _sourceChangeCache;

/**
 * 最后一次**产品源码**变更时间（毫秒）；无源码树时返回 `null`。
 *
 * 范围取 `gatedPaths.sourceDirs`（合并 `gated-artifacts.json` 的收紧项）加 `e2e/`——
 * 即 R15/R16/E2E/R32 这几项门禁真正在检查的东西。刻意**不含** `.claude/**`：
 * 那是门禁自身的代码，改 Hook 不应让全部质量产物失效。
 *
 * Hook 进程是一次性的，故按进程缓存，避免一次 stop 判定里重复遍历五遍。
 */
export function latestSourceChangeMs({ force = false } = {}) {
  if (!force && _sourceChangeCache !== undefined) return _sourceChangeCache;
  let dirs;
  try {
    dirs = [...(getMergedGatedPaths().sourceDirs ?? []), 'e2e'];
  } catch {
    // 配置损坏时不把新鲜度判据也拖下水（该异常另有 R36 处理）
    dirs = ['src', 'lib', 'app', 'tests', 'test', 'e2e'];
  }
  let latest = 0;
  let budget = SOURCE_WALK_MAX_ENTRIES;
  const walk = (abs) => {
    if (budget <= 0) return;
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (budget-- <= 0) return;
      if (entry.isDirectory()) {
        if (SOURCE_WALK_SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(abs, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const { mtimeMs } = fs.statSync(path.join(abs, entry.name));
        if (mtimeMs > latest) latest = mtimeMs;
      } catch {
        /* 单个文件 stat 失败不影响整体判据 */
      }
    }
  };
  for (const dir of new Set(dirs)) {
    const abs = path.join(PROJECT_ROOT, String(dir));
    try {
      if (fs.statSync(abs).isDirectory()) walk(abs);
    } catch {
      /* 该项目没有这个源码目录 */
    }
  }
  _sourceChangeCache = latest > 0 ? latest : null;
  return _sourceChangeCache;
}

/**
 * **R34 新鲜度**：产物是否反映**当前**代码。
 *
 * ## 要解决的问题（2026-07-30 复核）
 *
 * 验签只证明「这份产物确实由真运行器跑出来过」，不证明「它对应现在这份代码」——
 * nonce 不设过期、验签也不标记消费，同一份签名产物可以无限次通过。而 R15 / R16 /
 * 批次 E2E / 最终 E2E 四项都没有任何新鲜度判据（只有 R32 有 24h 上限）。于是有一条
 * 不需要抢私钥的重放路径：代码还绿时真跑一次、把产物存一份、改坏代码后原样放回
 * （`test-results/**` 必须豁免写门禁，这是设计前提）。
 *
 * ## 判据
 *
 * 产物的 `capturedAt`/`executedAt` 须不早于最后一次源码变更（含 2 秒容差）。
 * 时间戳落在签名覆盖范围内，改它即签名失配，故只能靠**真的重跑一次**来刷新。
 *
 * 无源码树（`latestSourceChangeMs()` 为 `null`）时不判——空项目/纯文档项目不应被卡住。
 * 产物**完全没有时间戳**则判为不新鲜：合法运行器写的产物一定带 `executedAt` 或
 * `capturedAt`，缺失说明来自手写或早于 R34 的版本。
 *
 * ## 能力边界
 *
 * 与 §8.7 边界 2 同源：判据建立在文件 mtime 上，宿主上的代理能改 mtime。它要消除的是
 * 「存一份绿产物、改坏代码后原样放回」这条零成本重放，而不是宣称不可伪造。
 *
 * @param {string} kind
 * @param {object|null} artifact
 * @param {{ sourceChangedMs?: number|null }} [options] 注入基准时间（回归用）
 */
export function checkArtifactFreshness(kind, artifact, options = {}) {
  const policy = getExecProofPolicy();
  if (!policy.enforce || !policy.requireFreshArtifacts) {
    return { ok: true, reason: 'not-enforced' };
  }
  const sourceChangedMs =
    options.sourceChangedMs !== undefined ? options.sourceChangedMs : latestSourceChangeMs();
  if (!sourceChangedMs) return { ok: true, reason: 'no-source-tree' };

  const stampText = artifact?.capturedAt ?? artifact?.executedAt ?? null;
  const stamp = stampText ? Date.parse(stampText) : NaN;
  if (!Number.isFinite(stamp)) return fail('exec-proof-stale-artifact');
  if (stamp + FRESHNESS_TOLERANCE_MS < sourceChangedMs) return fail('exec-proof-stale-artifact');
  return { ok: true, reason: 'fresh' };
}

const REASON_MESSAGES = {
  'exec-proof-stale-artifact':
    '产物的执行时间早于最后一次源码变更——它是**上一版代码**的检查结果，不能用来证明当前代码。'
    + '典型成因是把先前存下来的绿产物放回 test-results（签名仍然有效，但内容已经过期）',
  'exec-proof-missing':
    '产物不含 execProof 执行证明字段——说明它不是由框架运行器在门禁签发下写出的（很可能是手写或旧版产物）',
  'exec-proof-no-nonce':
    '产物自述未取到门禁签发的 nonce（execProof.nonce 为空）——本次运行器未经 PreToolUse Shell 门禁签发，通常是在门禁之外的终端里执行的',
  'exec-proof-unknown-nonce':
    '产物携带的 nonce 不在门禁台账中——nonce 伪造，或台账已被重置/该产物来自上一台账周期',
  'exec-proof-kind-mismatch': '产物携带的 nonce 是为另一类运行器签发的（kind 不匹配）',
  'exec-proof-key-not-consumed':
    '该 nonce 的私钥交接文件仍在盘上，说明私钥未被运行器消费——签名来源不可信，nonce 作废',
  'exec-proof-signature-mismatch':
    '签名与产物内容不符——产物在运行器落签之后被改动过（典型即手工把 gatePassed 改成 true）',
  'exec-proof-verify-error': '验签过程本身出错（公钥或签名格式非法）',
};

function fail(reason) {
  return {
    ok: false,
    reason,
    message: `R34 执行证明未通过：${REASON_MESSAGES[reason] ?? reason}。请由对应角色**重新实际运行**该运行器（须在代理的 Shell 通道内执行，门禁才会签发 nonce），不得手工编辑 test-results 产物。`,
  };
}

/**
 * 门禁侧：验证产物的执行证明。
 * @param {string} kind EXEC_PROOF_KINDS 之一
 * @param {object|null} artifact 已解析的产物对象
 */
export function verifyExecutionProof(kind, artifact) {
  if (!getExecProofPolicy().enforce) return { ok: true, reason: 'not-enforced' };
  if (!artifact || typeof artifact !== 'object') return fail('exec-proof-missing');
  const proof = artifact.execProof;
  if (!proof || typeof proof !== 'object') return fail('exec-proof-missing');
  if (!proof.nonce || typeof proof.nonce !== 'string') return fail('exec-proof-no-nonce');
  if (!proof.signature || typeof proof.signature !== 'string') return fail('exec-proof-no-nonce');

  const entry = readLedger().entries.find((e) => e?.nonce === proof.nonce);
  if (!entry) return fail('exec-proof-unknown-nonce');
  if (entry.kind !== kind || (proof.kind && proof.kind !== kind)) {
    return fail('exec-proof-kind-mismatch');
  }
  if (fs.existsSync(pendingKeyPath(proof.nonce))) return fail('exec-proof-key-not-consumed');

  try {
    const okSig = cryptoVerify(
      null,
      buildSignedPayload({ kind, nonce: proof.nonce, artifact }),
      entry.publicKey,
      Buffer.from(proof.signature, 'base64'),
    );
    return okSig ? { ok: true, reason: 'verified' } : fail('exec-proof-signature-mismatch');
  } catch {
    return fail('exec-proof-verify-error');
  }
}
