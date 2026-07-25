/**
 * 场景级门禁回归：加载各套件并汇总。
 */
import fs from 'node:fs';
import {
  SCEN_ROOT, snapshotE2e, restoreE2e, snapshotLint, restoreLint,
  snapshotStaticScan, restoreStaticScan, snapshotRootConversation, restoreRootConversation,
  snapshotRecon, restoreRecon, snapshotDispatchedRoles, restoreDispatchedRoles,
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

fs.rmSync(SCEN_ROOT, { recursive: true, force: true });
snapshotE2e();
snapshotLint();
snapshotStaticScan();
snapshotRootConversation();
snapshotRecon();
snapshotDispatchedRoles();
ensureScenarioReconEvidence();
try {
  greenfieldScenarios();
  featureScenarios();
  hotfixScenarios();
  lintGateScenarios();
  staticScanGateScenarios();
  adversarialScenarios();
  r5ConversationScenarios();
  finding1Scenario();
} finally {
  restoreE2e();
  restoreLint();
  restoreStaticScan();
  restoreRootConversation();
  restoreRecon();
  restoreDispatchedRoles();
  fs.rmSync(SCEN_ROOT, { recursive: true, force: true });
}

const { passCount, failCount, failures } = getScenarioStats();
console.log('');
console.log('结果：' + passCount + ' passed, ' + failCount + ' failed');
if (failCount > 0) {
  console.error('失败场景：');
  for (const f of failures) console.error('  - ' + f.label + '（expect=' + f.expect + ' got=' + f.outcome + '）');
  process.exit(1);
}
process.exit(0);

