/**
 * 场景套件：adversarialScenarios
 */
import {
  REQ_SPEC,
  REQ_LIST,
  DESIGN_SPEC,
  TASK_LIST,
  DPL_CLEAN,
  GATED_EMPTY,
  greenfieldReady,
  greenfieldNoDispatch,
  docsOnlyProcess,
  cancelledProcess,
  relToProject,
  writeFixture,
  check,
  path,
  fs
} from './_harness.mjs';

export function adversarialScenarios() {
  console.log('== 对抗 / 健壮性 ==');

  const cancelled = writeFixture('adv-cancelled', {
    'docs/process/process.md': cancelledProcess(),
  });
  const cancelledProc = relToProject(path.join(cancelled, 'docs/process/process.md'));
  check('A1 R10：写入已取消（冻结）的 process.md 自身', 'deny', {
    hook: 'write', filePath: cancelledProc, processPath: cancelledProc,
  });
  check('A2 R10：在已取消流程上发起角色', 'deny', {
    hook: 'role', role: 'development-engineer', processPath: cancelledProc,
  });
  check('A3 R10：已取消流程 stop 不再催促', 'allow-stop', {
    hook: 'stop', processPath: cancelledProc,
  });

  const docsOnly = writeFixture('adv-docsonly', {
    'docs/process/process.md': docsOnlyProcess(),
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const docsOnlyProc = relToProject(path.join(docsOnly, 'docs/process/process.md'));
  const docsOnlyGated = relToProject(path.join(docsOnly, 'docs/design/gated-artifacts.json'));
  check('A4 docs-only：写源码', 'deny', {
    hook: 'write', filePath: 'src/app.ts', processPath: docsOnlyProc, gatedPath: docsOnlyGated,
  });
  check('A5 docs-only：发起 development-engineer', 'deny', {
    hook: 'role', role: 'development-engineer', processPath: docsOnlyProc, gatedPath: docsOnlyGated,
  });

  check('A6 工具链安装未批准', 'ask', {
    hook: 'toolchain', command: 'winget install OpenJS.NodeJS',
  });

  const noDispatch = writeFixture('adv-nodispatch', {
    'docs/process/process.md': greenfieldNoDispatch(),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const noDispatchProc = relToProject(path.join(noDispatch, 'docs/process/process.md'));
  const noDispatchGated = relToProject(path.join(noDispatch, 'docs/design/gated-artifacts.json'));
  check('A7 无分派计划执行 npm install（项目初始化）', 'deny', {
    hook: 'shell', command: 'npm install', processPath: noDispatchProc, gatedPath: noDispatchGated,
  });

  const ready = writeFixture('adv-ready', {
    'docs/process/process.md': greenfieldReady(),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const readyProc = relToProject(path.join(ready, 'docs/process/process.md'));
  const readyGated = relToProject(path.join(ready, 'docs/design/gated-artifacts.json'));
  check('A8 有分派计划执行 npm install', 'allow', {
    hook: 'shell', command: 'npm install', processPath: readyProc, gatedPath: readyGated,
  });
  check('A9 Finding #2：有分派计划时写 docs/ 非文档扩展名（受门禁源码，放行）', 'allow', {
    hook: 'write', filePath: 'docs/design/notes.py', processPath: readyProc, gatedPath: readyGated,
  });
  check('A10 Finding #2：无分派计划时写 docs/ 非文档扩展名（拦截）', 'deny', {
    hook: 'write', filePath: 'docs/design/notes.py', processPath: noDispatchProc, gatedPath: noDispatchGated,
  });
}


