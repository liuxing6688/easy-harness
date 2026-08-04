/**
 * 场景套件：lintGateScenarios（L1–L6）
 * 覆盖 R15：lint 未通过时 stop/派发 TE 拦截、失败性质决定的指引方向，以及双要素豁免放行。
 *
 * 入口：node .cursor/scripts/gate-scenarios.mjs；脚手架：./_harness.mjs
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
  writeLintFail,
  writeLintNoCommand,
  writeLintNotConfigured,
  clearLint,
  writeStaticScanPass,
  clearStaticScan,
  path,
  fs,
  QE_DONE_ROWS,
  QUALITY_REPORT_CLEAN
} from './_harness.mjs';

export function lintGateScenarios() {
  console.log('== 场景 4：编程规范（lint）硬门禁（R15）==');

  // stop 门禁：QE 记录完成后 lint 未通过则注入 followup
  const stopBase = {
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
  };

  const stopLintFail = writeFixture('lint-stop-fail', {
    'docs/process/process.md': greenfieldReady(QE_DONE_ROWS),
    ...stopBase,
  });
  clearE2e('batch');
  clearE2e('final');
  writeLintFail();
  writeStaticScanPass();
  check('L1 QE 记录完成但 lint 失败即想推进/收尾', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopLintFail, 'docs/process/process.md')),
  });

  const stopLintMissing = writeFixture('lint-stop-missing', {
    'docs/process/process.md': greenfieldReady(QE_DONE_ROWS),
    ...stopBase,
  });
  clearE2e('batch');
  clearE2e('final');
  clearLint();
  writeStaticScanPass();
  check('L2 QE 记录完成但缺 lint 机读产物即想推进/收尾', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopLintMissing, 'docs/process/process.md')),
  });

  // 失败性质决定指引方向：同为 followup，「没命令 / 没配 linter」不得被说成「请整改违规」。
  const stopNoCommand = writeFixture('lint-stop-no-command', {
    'docs/process/process.md': greenfieldReady(QE_DONE_ROWS),
    ...stopBase,
  });
  clearE2e('batch');
  clearE2e('final');
  writeLintNoCommand();
  writeStaticScanPass();
  check('L5 探测不到 lint 命令时指引「用户本人配覆盖 / 双要素豁免」而非整改违规', 'followup', {
    hook: 'stop',
    processPath: relToProject(path.join(stopNoCommand, 'docs/process/process.md')),
    mustInclude: ['no-lint-command', '用户本人', 'remediation'],
  });

  const stopNotConfigured = writeFixture('lint-stop-not-configured', {
    'docs/process/process.md': greenfieldReady(QE_DONE_ROWS),
    ...stopBase,
  });
  clearE2e('batch');
  clearE2e('final');
  writeLintNotConfigured();
  writeStaticScanPass();
  check('L6 项目没配 linter 时指引分派 DE 补配置，且禁止走豁免绕过', 'followup', {
    hook: 'stop',
    processPath: relToProject(path.join(stopNotConfigured, 'docs/process/process.md')),
    mustInclude: ['lint-not-configured', 'development-engineer', '不得'],
  });


  // 角色派发门禁（R13/R15）：lint 未通过时禁止发起 test-engineer
  const roleBase = {
    ...stopBase,
    'docs/quality/quality-report.md': QUALITY_REPORT_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  };

  const roleLintFail = writeFixture('lint-role-fail', {
    'docs/process/process.md': greenfieldReady(QE_DONE_ROWS),
    ...roleBase,
  });
  const roleFailProc = relToProject(path.join(roleLintFail, 'docs/process/process.md'));
  const roleFailGated = relToProject(path.join(roleLintFail, 'docs/design/gated-artifacts.json'));
  writeLintFail();
  writeStaticScanPass();
  check('L3 QE 通过但 lint 未过发起 test-engineer', 'deny', {
    hook: 'role', role: 'test-engineer', processPath: roleFailProc, gatedPath: roleFailGated,
  });

  const roleLintPass = writeFixture('lint-role-pass', {
    'docs/process/process.md': greenfieldReady(QE_DONE_ROWS),
    ...roleBase,
  });
  const rolePassProc = relToProject(path.join(roleLintPass, 'docs/process/process.md'));
  const rolePassGated = relToProject(path.join(roleLintPass, 'docs/design/gated-artifacts.json'));
  writeLintPass();
  writeStaticScanPass();
  check('L4 QE 通过 + lint 通过 + 静态代码质量门禁通过后发起 test-engineer', 'allow', {
    hook: 'role', role: 'test-engineer', processPath: rolePassProc, gatedPath: rolePassGated,
  });
  clearLint();
  clearStaticScan();
}

