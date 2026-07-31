/**
 * 测试夹具落签工具（**R34**）——`selftest/_harness.mjs` 与 `scenarios/_harness.mjs` 共用。
 *
 * ## 为什么夹具要走真实机制
 *
 * R34 之后，`test-results/**` 的机读产物必须带 Hook 签发、运行器落签的执行证明才被门禁采信。
 * 回归夹具是**合成**产物（不真跑 lint/Playwright），若给它们开一个「测试模式跳过验签」的后门，
 * 就等于回归测的是「验签被关掉时的行为」——那正是 `templates-vs-gates.mjs` 抓过的同类漂移：
 * 夹具与真实路径不是一条路，绿灯毫无意义。
 *
 * 故本模块**调用真实的 `issueExecutionProof` + `attachExecutionProof`**：
 * 前者模拟 `gate-dev-shell` 的签发，后者就是运行器落签用的同一个函数。
 * 这样「合法签名可通过」与「篡改后签名失配」两个方向都由真实实现兜底。
 *
 * ## 状态隔离
 *
 * 台账与私钥交接目录是宿主真实路径（`.trae/hooks/`），故提供快照/还原，
 * 与既有 lint / E2E / root-conversation 产物的处理方式一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  EXEC_PROOF_LEDGER,
  EXEC_PROOF_PENDING_DIR,
  attachExecutionProof,
  issueExecutionProof,
} from '../../hooks/lib/execproof.mjs';

/**
 * 为合成产物附加**有效**执行证明：先签发一个 nonce（模拟门禁），再落签（模拟运行器）。
 * @param {string} kind `EXEC_PROOF_KINDS` 之一
 * @param {object} artifact 就地写入 `execProof` 并返回同一对象
 */
export function signFixtureArtifact(kind, artifact) {
  issueExecutionProof({ kind, command: `node .trae/scripts/${kind}-run.mjs # test fixture` });
  return attachExecutionProof(kind, artifact);
}

let ledgerSnapshot = null;
let pendingSnapshot = null;

export function snapshotExecProofState() {
  ledgerSnapshot = fs.existsSync(EXEC_PROOF_LEDGER)
    ? fs.readFileSync(EXEC_PROOF_LEDGER, 'utf8')
    : null;
  pendingSnapshot = fs.existsSync(EXEC_PROOF_PENDING_DIR)
    ? Object.fromEntries(
        fs
          .readdirSync(EXEC_PROOF_PENDING_DIR)
          .map((n) => [n, fs.readFileSync(path.join(EXEC_PROOF_PENDING_DIR, n), 'utf8')]),
      )
    : null;
}

export function restoreExecProofState() {
  if (ledgerSnapshot === null) fs.rmSync(EXEC_PROOF_LEDGER, { force: true });
  else fs.writeFileSync(EXEC_PROOF_LEDGER, ledgerSnapshot, 'utf8');

  fs.rmSync(EXEC_PROOF_PENDING_DIR, { recursive: true, force: true });
  if (pendingSnapshot) {
    fs.mkdirSync(EXEC_PROOF_PENDING_DIR, { recursive: true });
    for (const [name, content] of Object.entries(pendingSnapshot)) {
      fs.writeFileSync(path.join(EXEC_PROOF_PENDING_DIR, name), content, 'utf8');
    }
  }
}
