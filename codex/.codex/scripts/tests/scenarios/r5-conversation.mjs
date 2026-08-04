/**
 * 场景套件：r5ConversationScenarios（C1–C17）
 * 覆盖 R5：顶层 conversation_id 代写拦截、角色↔路径、派发记录与身份基准。
 *
 * 入口：node .codex/scripts/gate-scenarios.mjs；脚手架：./_harness.mjs
 */
import {
  CONFIRM_SECTION,
  ARTIFACT_REF,
  BLOCK_OK,
  REQ_SPEC,
  REQ_LIST,
  DESIGN_SPEC,
  TASK_LIST,
  DPL_CLEAN,
  GATED_EMPTY,
  progressSection,
  greenfieldReady,
  relToProject,
  writeFixture,
  check,
  writeRootConversation,
  clearRootConversation,
  clearDispatchedRoles,
  writeLintPass,
  writeStaticScanPass,
  clearLint,
  clearStaticScan,
  QUALITY_REPORT_CLEAN,
  path,
  fs
} from './_harness.mjs';

export function r5ConversationScenarios() {
  console.log('== R5 机械化补强：顶层会话 id 与调用者身份（conversation_id）==');
  const ready = writeFixture('r5-ready', {
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

  clearRootConversation();
  clearDispatchedRoles();
  check('C1 未记录顶层会话 id 时（fail-open）有效分派计划写源码仍放行', 'allow', {
    hook: 'write', filePath: 'src/app.ts', processPath: readyProc, gatedPath: readyGated,
    conversationId: 'whatever-id',
  });

  writeRootConversation('root-scn-abc');
  clearDispatchedRoles();
  check('C2 conversation_id 等于顶层会话 id 时，即便分派计划有效仍拒绝写源码', 'deny', {
    hook: 'write', filePath: 'src/app.ts', processPath: readyProc, gatedPath: readyGated,
    conversationId: 'root-scn-abc',
  });
  check('C3 conversation_id 为子代理自己的 id（≠顶层）时，有效分派计划写源码正常放行', 'allow', {
    hook: 'write', filePath: 'src/app.ts', processPath: readyProc, gatedPath: readyGated,
    conversationId: 'subagent-scn-xyz',
  });
  check('C4 payload 缺失 conversation_id 字段时（旧行为兼容）仍按既有分派计划判定放行', 'allow', {
    hook: 'write', filePath: 'src/app.ts', processPath: readyProc, gatedPath: readyGated,
  });
  check('C5 Shell 场景同理：conversation_id 等于顶层会话 id 时拒绝受门禁初始化命令', 'deny', {
    hook: 'shell', command: 'npm install', processPath: readyProc, gatedPath: readyGated,
    conversationId: 'root-scn-abc',
  });
  check('C6 Shell 场景：conversation_id 为子代理 id 时按既有分派计划判定放行', 'allow', {
    hook: 'shell', command: 'npm install', processPath: readyProc, gatedPath: readyGated,
    conversationId: 'subagent-scn-xyz',
  });

  clearDispatchedRoles();
  check('C7 顶层代理写需求文档被拒（R5 docs 写入身份）', 'deny', {
    hook: 'write',
    filePath: 'docs/requirement/requirement-spec.md',
    processPath: readyProc,
    gatedPath: readyGated,
    conversationId: 'root-scn-abc',
  });
  writeRootConversation('root-scn-abc');
  check('C8 无活跃角色时子代理写需求文档被拒（R5 角色路径）', 'deny', {
    hook: 'write',
    filePath: 'docs/requirement/requirement-spec.md',
    processPath: readyProc,
    gatedPath: readyGated,
    conversationId: 'subagent-ra-1',
  });
  // 经 role hook 放行后会 recordDispatchedRole(requirements-analyst)
  check('C9 派发 requirements-analyst 后子代理可写需求文档', 'allow', {
    hook: 'role',
    role: 'requirements-analyst',
    processPath: readyProc,
    gatedPath: readyGated,
  });
  check('C10 最近派发 RA 后子代理写需求文档放行', 'allow', {
    hook: 'write',
    filePath: 'docs/requirement/requirement-spec.md',
    processPath: readyProc,
    gatedPath: readyGated,
    conversationId: 'subagent-ra-2',
  });

  const qeOnly = writeFixture('r5-qe-only', {
    'docs/process/process.md': [
      '---',
      'phase: development',
      'workflow_mode: full',
      'iterationType: greenfield',
      'blocking: false',
      'cancelled: false',
      '---',
      '',
      CONFIRM_SECTION,
      '',
      '## 当前分派计划',
      '',
      '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
      '| ---------- | -------- | --------- | ---- |',
      '| T0-1 | quality-engineer | 串行 | 待 QE |',
      '',
      '## 待派发角色列表',
      '',
      '| 角色 | 说明 |',
      '| ---- | ---- |',
      '| quality-engineer | T0-1 |',
      '',
      progressSection([
        '| 开发工程师 | T0-1 | 执行完成 | |',
        '| 质量工程师 | T0-1 | 正在执行 | |',
      ]),
      BLOCK_OK,
      '',
      ARTIFACT_REF,
      '',
    ].join('\n'),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  clearDispatchedRoles();
  check('C11 QE 活跃阶段写源码被拒（R5 角色路径，须 DE）', 'deny', {
    hook: 'write',
    filePath: 'src/app.ts',
    processPath: relToProject(path.join(qeOnly, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(qeOnly, 'docs/design/gated-artifacts.json')),
    conversationId: 'subagent-qe-1',
  });

  // TE 越权写产品源码 / e2e 角色路径（补强项 2+4）
  const tePhase = writeFixture('r5-te-phase', {
    'docs/process/process.md': [
      '---',
      'phase: development',
      'workflow_mode: full',
      'iterationType: greenfield',
      'blocking: false',
      'cancelled: false',
      '---',
      '',
      CONFIRM_SECTION,
      '',
      '## 当前分派计划',
      '',
      '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
      '| ---------- | -------- | --------- | ---- |',
      '| T0-1 | test-engineer | 串行 | 批次测试 |',
      '',
      '## 待派发角色列表',
      '',
      '| 角色 | 说明 |',
      '| ---- | ---- |',
      '| test-engineer | 批次集成测试 T0-1 |',
      '',
      progressSection([
        '| 开发工程师 | T0-1 | 执行完成 | |',
        '| 质量工程师 | T0-1 | 执行完成 | |',
        '| 测试工程师 | 批次集成测试 T0-1 | 正在执行 | |',
      ]),
      BLOCK_OK,
      '',
      ARTIFACT_REF,
      '',
    ].join('\n'),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
    'docs/quality/quality-report.md': QUALITY_REPORT_CLEAN,
  });
  const teProc = relToProject(path.join(tePhase, 'docs/process/process.md'));
  const teGated = relToProject(path.join(tePhase, 'docs/design/gated-artifacts.json'));
  clearDispatchedRoles();
  writeLintPass();
  writeStaticScanPass();
  check('C12 派发 test-engineer', 'allow', {
    hook: 'role',
    role: 'test-engineer',
    processPath: teProc,
    gatedPath: teGated,
  });
  check('C13 TE 写 web/src 产品源码被拒', 'deny', {
    hook: 'write',
    filePath: 'web/src/app/App.tsx',
    processPath: teProc,
    gatedPath: teGated,
    conversationId: 'subagent-te-1',
  });
  check('C14 TE 写 e2e/specs 放行', 'allow', {
    hook: 'write',
    filePath: 'e2e/specs/batch.spec.ts',
    processPath: teProc,
    gatedPath: teGated,
    conversationId: 'subagent-te-1',
  });

  // DE 活跃时写 e2e 默认 deny
  clearDispatchedRoles();
  check('C15 派发 development-engineer（DE 写 e2e 前置）', 'allow', {
    hook: 'role',
    role: 'development-engineer',
    processPath: readyProc,
    gatedPath: readyGated,
  });
  check('C16 DE 写 e2e/specs 被拒（期望 TE）', 'deny', {
    hook: 'write',
    filePath: 'e2e/specs/batch.spec.ts',
    processPath: readyProc,
    gatedPath: readyGated,
    conversationId: 'subagent-de-e2e',
  });
  check('C17 DE 写 src 仍放行', 'allow', {
    hook: 'write',
    filePath: 'src/app.ts',
    processPath: readyProc,
    gatedPath: readyGated,
    conversationId: 'subagent-de-src',
  });

  clearLint();
  clearStaticScan();
  clearRootConversation();
  clearDispatchedRoles();
}

