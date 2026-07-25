/**
 * 场景套件：staticScanGateScenarios
 */
import {
  REQ_SPEC,
  REQ_LIST,
  DESIGN_SPEC,
  TASK_LIST,
  DPL_CLEAN,
  GATED_EMPTY,
  greenfieldReady,
  relToProject,
  writeFixture,
  check,
  clearE2e,
  writeLintPass,
  clearLint,
  writeStaticScanPass,
  writeStaticScanDupFail,
  writeStaticScanSecurityFail,
  clearStaticScan,
  path,
  fs,
  QE_DONE_ROWS,
  QUALITY_REPORT_CLEAN
} from './_harness.mjs';

export function staticScanGateScenarios() {
  console.log('== 场景 5：静态代码质量硬门禁（R16：重复代码 + 安全扫描）==');

  // stop 门禁：QE 记录完成后重复代码/安全扫描未通过则注入 followup
  const stopBase = {
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
  };

  const stopDupFail = writeFixture('static-scan-stop-dupfail', {
    'docs/process/process.md': greenfieldReady(QE_DONE_ROWS),
    ...stopBase,
  });
  clearE2e('batch');
  clearE2e('final');
  writeLintPass();
  writeStaticScanDupFail();
  check('S1 QE 记录完成但重复代码检测未通过即想推进/收尾', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopDupFail, 'docs/process/process.md')),
  });

  const stopSecurityFail = writeFixture('static-scan-stop-securityfail', {
    'docs/process/process.md': greenfieldReady(QE_DONE_ROWS),
    ...stopBase,
  });
  clearE2e('batch');
  clearE2e('final');
  writeLintPass();
  writeStaticScanSecurityFail();
  check('S2 QE 记录完成但安全静态扫描未通过即想推进/收尾', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopSecurityFail, 'docs/process/process.md')),
  });

  const stopMissing = writeFixture('static-scan-stop-missing', {
    'docs/process/process.md': greenfieldReady(QE_DONE_ROWS),
    ...stopBase,
  });
  clearE2e('batch');
  clearE2e('final');
  writeLintPass();
  clearStaticScan();
  check('S3 QE 记录完成但缺静态代码质量机读产物即想推进/收尾', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopMissing, 'docs/process/process.md')),
  });

  // 角色派发门禁（R13/R16）：重复代码/安全扫描未通过时禁止发起 test-engineer
  const roleBase = {
    ...stopBase,
    'docs/quality/quality-report.md': QUALITY_REPORT_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  };

  const roleScanFail = writeFixture('static-scan-role-fail', {
    'docs/process/process.md': greenfieldReady(QE_DONE_ROWS),
    ...roleBase,
  });
  const roleFailProc = relToProject(path.join(roleScanFail, 'docs/process/process.md'));
  const roleFailGated = relToProject(path.join(roleScanFail, 'docs/design/gated-artifacts.json'));
  writeLintPass();
  writeStaticScanSecurityFail();
  check('S4 QE 通过 + lint 通过但安全静态扫描未过发起 test-engineer', 'deny', {
    hook: 'role', role: 'test-engineer', processPath: roleFailProc, gatedPath: roleFailGated,
  });

  const roleScanPass = writeFixture('static-scan-role-pass', {
    'docs/process/process.md': greenfieldReady(QE_DONE_ROWS),
    ...roleBase,
  });
  const rolePassProc = relToProject(path.join(roleScanPass, 'docs/process/process.md'));
  const rolePassGated = relToProject(path.join(roleScanPass, 'docs/design/gated-artifacts.json'));
  writeLintPass();
  writeStaticScanPass();
  check('S5 QE 通过 + lint 通过 + 重复代码/安全扫描均通过后发起 test-engineer', 'allow', {
    hook: 'role', role: 'test-engineer', processPath: rolePassProc, gatedPath: rolePassGated,
  });
  clearLint();
  clearStaticScan();
}


