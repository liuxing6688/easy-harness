/**
 * 场景套件：hotfixScenarios（H1–H6）
 * 覆盖 R11 折叠通道、R9 热修设计/影响面、R20 模式确认与最终 E2E 唯一通道。
 *
 * 入口：node .trae/scripts/gate-scenarios.mjs；脚手架：./_harness.mjs
 */
import {
  PROJECT_ROOT,
  DESIGN_SPEC,
  GATED_EMPTY,
  hotfixProcess,
  relToProject,
  writeFixture,
  check,
  writeE2e,
  clearE2e,
  writeLintPass,
  clearLint,
  writeStaticScanPass,
  clearStaticScan,
  path,
  fs,
  recordPass,
  recordFail
} from './_harness.mjs';

export function hotfixScenarios() {
  console.log('== 场景 3：Bug 修复 Hotfix（R9 设计前置 + R11 折叠）==');

  const noDesign = writeFixture('hotfix-nodesign', {
    'docs/process/process.md': hotfixProcess({ dispatch: true }),
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const noDesignProc = relToProject(path.join(noDesign, 'docs/process/process.md'));
  const noDesignGated = relToProject(path.join(noDesign, 'docs/design/gated-artifacts.json'));
  check('H1 R9：无 detail-design-spec 时发起 development-engineer', 'deny', {
    hook: 'role', role: 'development-engineer', processPath: noDesignProc, gatedPath: noDesignGated,
  });
  check('H2 R9：无 detail-design-spec 时写源码', 'deny', {
    hook: 'write', filePath: 'src/fix.js', processPath: noDesignProc, gatedPath: noDesignGated,
  });

  const ready = writeFixture('hotfix-ready', {
    'docs/process/process.md': hotfixProcess({ dispatch: true }),
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('H3 R9：补最小热修设计后发起 development-engineer', 'allow', {
    hook: 'role',
    role: 'development-engineer',
    processPath: relToProject(path.join(ready, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(ready, 'docs/design/gated-artifacts.json')),
  });

  const noJust = writeFixture('hotfix-no-justification', {
    'docs/process/process.md': hotfixProcess({ dispatch: true, withHotfixJustification: false }),
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('H3b R9：hotfix_p0_impact=none 缺「hotfix影响面」依据时发起 development-engineer', 'deny', {
    hook: 'role',
    role: 'development-engineer',
    processPath: relToProject(path.join(noJust, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(noJust, 'docs/design/gated-artifacts.json')),
  });

  const stopNoTest = writeFixture('hotfix-stop-notest', {
    'docs/process/process.md': hotfixProcess({
      dispatch: true,
      progressRows: [
        '| 开发工程师 | T-1 | 执行完成 | |',
        '| 质量工程师 | T-1 | 执行完成 | |',
      ],
    }),
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
  });
  clearE2e('batch');
  clearE2e('final');
  writeLintPass();
  writeStaticScanPass();
  check('H4 R11：QE 过但未做（唯一一次）集成测试即收尾', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopNoTest, 'docs/process/process.md')),
  });

  const stopFinal = writeFixture('hotfix-stop-final', {
    'docs/process/process.md': hotfixProcess({
      dispatch: true,
      progressRows: [
        '| 开发工程师 | T-1 | 执行完成 | |',
        '| 质量工程师 | T-1 | 执行完成 | |',
        '| 测试工程师 | 最终集成测试 | 执行完成 | |',
      ],
    }),
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
  });
  writeE2e('final', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeLintPass();
  writeStaticScanPass();
  check('H5 R11：单次集成测试 + 最终 E2E 通过后收尾', 'allow-stop', {
    hook: 'stop', processPath: relToProject(path.join(stopFinal, 'docs/process/process.md')),
  });
  clearE2e('final');
  clearLint();
  clearStaticScan();

  // P2-6 修复（R12 加强：软提醒→硬门禁）：P0 影响的 hotfix，唯一测试通道通过但本次报告
  // 缺结构化接口/存储章节时，不再仅写软性提醒放行，而是升级为 Stop 硬门禁（followup 阻断）。
  // 软性提醒仍会先写入 process.md（留痕），随后硬门禁阻断收尾。
  const stopFinalP0 = writeFixture('hotfix-stop-final-p0', {
    'docs/process/process.md': hotfixProcess({
      dispatch: true,
      p0Impact: 'p0',
      progressRows: [
        '| 开发工程师 | T-1 | 执行完成 | |',
        '| 质量工程师 | T-1 | 执行完成 | |',
        '| 测试工程师 | 最终集成测试 | 执行完成 | |',
      ],
    }),
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/test/test-report.md': ['# 测试报告', '', '## 集成测试记录', '', '全部通过。', ''].join('\n'),
  });
  const stopFinalP0ProcRel = relToProject(path.join(stopFinalP0, 'docs/process/process.md'));
  writeE2e('final', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeLintPass();
  writeStaticScanPass();
  check('H6 P2-6 硬门禁：P0 影响 hotfix 报告缺结构化接口/存储章节时阻断收尾（followup）', 'followup', {
    hook: 'stop', processPath: stopFinalP0ProcRel,
  });
  const remindedContent = fs.readFileSync(path.join(PROJECT_ROOT, stopFinalP0ProcRel), 'utf8');
  const reminderWritten =
    /## 门禁软性提醒（非阻塞）/.test(remindedContent) && /接口测试报告|存储对账记录/.test(remindedContent);
  if (reminderWritten) {
    recordPass('H6b R9 软性提醒：硬门禁阻断前 process.md 仍写入一次性非阻塞提醒记录（留痕）');
  } else {
    recordFail('H6b R9 软性提醒：process.md 未写入提醒记录', 'reminder-written', 'missing');
  }
  clearE2e('final');
  clearLint();
  clearStaticScan();

  // P2-6 正向场景：P0 影响 hotfix，本次报告含结构化接口/存储章节真实数据行时，硬门禁通过、放行收尾。
  const structuredReport = [
    '# 测试报告',
    '',
    '## 接口测试报告',
    '',
    '| 接口 | 请求方法 | 关联需求 | 关联任务包 | 是否通过 |',
    '| ---- | -------- | -------- | ---------- | -------- |',
    '| /api/hotfix | POST | R-001 | T-1 | 是 |',
    '',
    '## 存储对账记录',
    '',
    '| 场景类型 | 关联需求 | 关联任务包 | 存储介质 | 对账方式 | 预期存储结果 | 实际存储结果 | 是否通过 | 备注 |',
    '| -------- | -------- | ---------- | -------- | -------- | ------------ | ------------ | -------- | ---- |',
    '| 接口 | R-001 | T-1 | 数据库 | SELECT 1 | 有行 | 有行 | 是 | |',
    '',
  ].join('\n');
  const stopFinalP0Complete = writeFixture('hotfix-stop-final-p0-complete', {
    'docs/process/process.md': hotfixProcess({
      dispatch: true,
      p0Impact: 'p0',
      progressRows: [
        '| 开发工程师 | T-1 | 执行完成 | |',
        '| 质量工程师 | T-1 | 执行完成 | |',
        '| 测试工程师 | 最终集成测试 | 执行完成 | |',
      ],
    }),
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/test/test-report.md': structuredReport,
  });
  const stopFinalP0CompleteProcRel = relToProject(path.join(stopFinalP0Complete, 'docs/process/process.md'));
  writeE2e('final', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeLintPass();
  writeStaticScanPass();
  check('H6c P2-6 硬门禁：P0 影响 hotfix 报告含结构化接口/存储章节时放行收尾', 'allow-stop', {
    hook: 'stop', processPath: stopFinalP0CompleteProcRel,
  });
  clearE2e('final');
  clearLint();
  clearStaticScan();
}


