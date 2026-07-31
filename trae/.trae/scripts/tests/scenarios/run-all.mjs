/**
 * 场景级门禁回归：加载各套件、快照宿主产物、汇总退出码。
 *
 * 运行前快照/还原 E2E、lint、scan、根会话、派发角色、对账证据，避免污染宿主。
 * 新增场景：在对应 `*.mjs` 导出函数，并在下方调用列表注册；同步更新 `./README.md`。
 * 入口：`node .trae/scripts/gate-scenarios.mjs`（`--verbose` 可选）
 */
import fs from 'node:fs';
import {
  SCEN_ROOT, snapshotE2e, restoreE2e, snapshotLint, restoreLint,
  snapshotStaticScan, restoreStaticScan, snapshotRootConversation, restoreRootConversation,
  snapshotRecon, restoreRecon, snapshotDispatchedRoles, restoreDispatchedRoles,
  snapshotStartupSmoke, restoreStartupSmoke, writeStartupSmokePass,
  snapshotExecProofState, restoreExecProofState,
  snapshotClosureLock, restoreClosureLock, clearClosureLock,
  ensureScenarioReconEvidence, getScenarioStats,
} from './_harness.mjs';
import { greenfieldScenarios } from './greenfield.mjs';
import { featureScenarios } from './feature.mjs';
import { hotfixScenarios } from './hotfix.mjs';
import { lintGateScenarios } from './lint-gate.mjs';
import { staticScanGateScenarios } from './static-scan-gate.mjs';
import { adversarialScenarios } from './adversarial.mjs';
import { r5ConversationScenarios } from './r5-conversation.mjs';
import { finding1Scenario } from './finding1.mjs';
import { teSmokeScenarios } from './te-smoke.mjs';
import { startupSmokeScenarios } from './startup-smoke.mjs';
import { hardeningScenarios } from './hardening.mjs';
import { auditFixesScenarios } from './audit-fixes.mjs';
import { closureLockScenarios } from './closure-lock.mjs';

fs.rmSync(SCEN_ROOT, { recursive: true, force: true });
snapshotE2e();
snapshotLint();
snapshotStaticScan();
snapshotRootConversation();
snapshotRecon();
snapshotDispatchedRoles();
snapshotStartupSmoke();
// R34：套件会真实签发 nonce 到 `.trae/hooks/`（台账 + 私钥交接目录），须快照还原。
snapshotExecProofState();
// R34 防竞态：清理上一轮测试可能残留的私钥交接文件。claimExecutionProofKey 按 mtime
// 取最新，若残留文件被 antivirus/文件系统刷新 mtime，会抢先于本轮新建的 pending 文件
// 被选中，导致产物落签到已不在台账中的旧 nonce → 验签 unknown-nonce（flaky 失败根因）。
fs.rmSync('.trae/hooks/.exec-proof-pending', { recursive: true, force: true });
// R40：闭环锁 marker 同为宿主真实路径下的运行时状态，套件会写入/清除它。
snapshotClosureLock();
clearClosureLock();
ensureScenarioReconEvidence();
// R32：默认让全部套件处于「冒烟已通过」基线，只有 startup-smoke 套件会主动构造失败态
// （与 ensureScenarioReconEvidence 同思路，避免在每个既有套件里散落一行 fixture）。
writeStartupSmokePass();
try {
  greenfieldScenarios();
  featureScenarios();
  hotfixScenarios();
  lintGateScenarios();
  staticScanGateScenarios();
  adversarialScenarios();
  r5ConversationScenarios();
  teSmokeScenarios();
  startupSmokeScenarios();
  hardeningScenarios();
  auditFixesScenarios();
  closureLockScenarios();
  finding1Scenario();
} finally {
  restoreE2e();
  restoreLint();
  restoreStaticScan();
  restoreRootConversation();
  restoreRecon();
  restoreDispatchedRoles();
  restoreStartupSmoke();
  restoreExecProofState();
  restoreClosureLock();
  fs.rmSync(SCEN_ROOT, { recursive: true, force: true });
}

const { passCount, failCount, failures } = getScenarioStats();
console.log('');
console.log('结果：' + passCount + ' passed, ' + failCount + ' failed');
if (failCount > 0) {
  console.error('失败场景：');
  for (const f of failures) console.error('  - ' + f.label + '（expect=' + f.expect + ' got=' + f.outcome + '）' + (f.reason ? '\n      reason: ' + String(f.reason).split('\n')[0].slice(0, 200) : ''));
  process.exit(1);
}
process.exit(0);

