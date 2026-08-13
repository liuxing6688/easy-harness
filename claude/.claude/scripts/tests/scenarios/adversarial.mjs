/**
 * 场景套件：adversarialScenarios（A1–A10）
 * 对抗健壮性：缺成果物、越权写入、绕过分派、非法状态机转移等应被 deny。
 *
 * 入口：node .claude/scripts/gate-scenarios.mjs；脚手架：./_harness.mjs
 */
import {
  REQ_SPEC,
  REQ_LIST,
  DESIGN_SPEC,
  TASK_LIST,
  DPL_CLEAN,
  GATED_EMPTY,
  ARTIFACT_REF,
  BLOCK_OK,
  CONFIRM_SECTION,
  DOCS_ONLY_CONFIRM_SECTION,
  DISPATCH_SECTION,
  EMPTY_DISPATCH_SECTION,
  progressSection,
  greenfieldReady,
  greenfieldNoDispatch,
  docsOnlyProcess,
  cancelledProcess,
  relToProject,
  writeFixture,
  check,
  clearDispatchedRoles,
  path,
  fs
} from './_harness.mjs';

export function adversarialScenarios() {
  console.log('== 对抗 / 健壮性 ==');
  clearDispatchedRoles();

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

  // ── F-18 / F-19：`e2e/**` 的「通用前置」不得随 DE 专属前置一起被跳过 ────────────
  // 历史两处调用点以 `isGatedDevPath(p) && !isE2eTestPath(p)` 为条件，`e2e/**` 被整体排除，
  // 于是 R10 取消冻结、docs-only 禁写源码、blocking 三条在 e2e 路径上全部静默失效。
  // 下面把「跳过的只应是分派计划一类 DE 专属前置」钉死在两个通道上。
  //
  // fixture 须让 **test-engineer 活跃**：`e2e/**` 的期望角色是 TE，若沿用 A1–A10 的 DE 活跃
  // fixture，R5 角色路径判据会先于 assertDevGateOrDeny 拦下，deny 结论对了但拦的是另一条，
  // 本组用例就测不到 F-18/F-19 修的那段（判定对而指引错，正是本套件要防的）。
  const teRows = [
    '| 开发工程师 | T0-1 | 执行完成 | |',
    '| 质量工程师 | T0-1 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-1 | 正在执行 | |',
  ];
  const teProcess = ({ fm = [], confirm = CONFIRM_SECTION, dispatch = true, block = BLOCK_OK, tail = '' } = {}) => [
    '---', 'phase: development', 'workflow_mode: full', 'iterationType: greenfield',
    ...fm, 'blocking: false', 'cancelled: false', '---', '',
    '# 流程进度记录（TE 活跃）', '', ARTIFACT_REF, '', confirm, '',
    dispatch ? DISPATCH_SECTION : EMPTY_DISPATCH_SECTION, '',
    progressSection(teRows), '', block, '', tail, '',
  ].join('\n');
  const teFixture = (name, processMd) => {
    const dir = writeFixture(name, {
      'docs/process/process.md': processMd,
      'docs/requirement/requirement-spec.md': REQ_SPEC,
      'docs/requirement/requirement-list.md': REQ_LIST,
      'docs/design/detail-design-spec.md': DESIGN_SPEC,
      'docs/design/develop-task-list.md': TASK_LIST,
      'docs/design/design-problem-list.md': DPL_CLEAN,
      'docs/design/gated-artifacts.json': GATED_EMPTY,
    });
    return {
      processPath: relToProject(path.join(dir, 'docs/process/process.md')),
      gatedPath: relToProject(path.join(dir, 'docs/design/gated-artifacts.json')),
    };
  };

  const teCancelled = teFixture('adv-e2e-cancelled', teProcess({
    fm: ['cancelledAt: 2026-01-01T00:00:00Z', 'cancelReason: 用户取消'],
    tail: ['## 取消记录', '', '| 时间 | 触发原话摘要 | 二次确认摘要 |', '| ---- | ------------ | ------------ |',
      '| 2026-01-01 | 不要继续了 | 已二次确认永久冻结 |'].join('\n'),
  }).replace('cancelled: false', 'cancelled: true'));
  const teDocsOnly = teFixture('adv-e2e-docsonly', teProcess({ confirm: DOCS_ONLY_CONFIRM_SECTION })
    .replace('workflow_mode: full', 'workflow_mode: docs-only'));
  const teBlocked = teFixture('adv-e2e-blocked', teProcess({
    block: ['## 阻塞原因', '', '- 阻塞原因：等待用户确认支付沙箱开通', '- 待决事项：是否先交付不含支付的版本'].join('\n'),
  }).replace('blocking: false', 'blocking: true'));
  const teNoDispatch = teFixture('adv-e2e-nodispatch', teProcess({ dispatch: false }));
  const teReady = teFixture('adv-e2e-ready', teProcess());

  check('A11 F-19 R10：已取消流程下写 e2e/**（历史为 ALLOW）', 'deny', {
    hook: 'write', filePath: 'e2e/specs/todo.spec.js', ...teCancelled,
    conversationId: 'subagent-te-1', mustInclude: 'R10',
  });
  check('A12 F-18 docs-only：写 e2e/**（历史为 ALLOW）', 'deny', {
    hook: 'write', filePath: 'e2e/specs/todo.spec.js', ...teDocsOnly,
    conversationId: 'subagent-te-1', mustInclude: 'docs-only',
  });
  check('A13 F-19 blocking：阻塞状态下写 e2e/**（历史为 ALLOW）', 'deny', {
    hook: 'write', filePath: 'e2e/specs/todo.spec.js', ...teBlocked,
    conversationId: 'subagent-te-1', mustInclude: '阻塞',
  });
  check('A14 F-18/F-19 Shell 通道：已取消流程下用 Shell 写 e2e/**', 'deny', {
    hook: 'shell', command: 'echo spec > e2e/specs/todo.spec.js', ...teCancelled,
    conversationId: 'subagent-te-1', mustInclude: 'R10',
  });
  check('A14b F-18 Shell 通道：docs-only 下用 Shell 写 e2e/**', 'deny', {
    hook: 'shell', command: 'echo spec > e2e/specs/todo.spec.js', ...teDocsOnly,
    conversationId: 'subagent-te-1', mustInclude: 'docs-only',
  });
  // 反向：DE 专属前置对 e2e 仍应跳过——那行排除本有正当理由，不得因修复而误伤。
  check('A15 F-18 反向：无分派计划仍可写 e2e/**（e2e 期望 TE，不经开发分派）', 'allow', {
    hook: 'write', filePath: 'e2e/specs/todo.spec.js', ...teNoDispatch,
    conversationId: 'subagent-te-1',
  });
  check('A16 F-18 反向：正常流程下写 e2e/** 放行', 'allow', {
    hook: 'write', filePath: 'e2e/specs/todo.spec.js', ...teReady,
    conversationId: 'subagent-te-1',
  });
}

