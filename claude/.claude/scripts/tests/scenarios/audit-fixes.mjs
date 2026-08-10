/**
 * 场景套件：auditFixesScenarios（AF1–AF19）
 *
 * 2026-07-30 规约审核加固的**端到端**验证（真正 spawn Hook 入口读 allow/deny/followup），
 * 与 `selftest/r34-r38-*.mjs` 的库函数单元级互补：
 *   - **R34** 执行证明：手写/篡改产物不得放行；真实签发+落签的产物必须放行；
 *     `.exec-proof-*` 台账与私钥目录不得被代理写入（含 Shell 通道）。
 *   - **R35** 阻塞释放证据：只写 `blocking: true` 不再能静默收尾。
 *   - **R37** single-task 折叠通道：省测试轮次，但 R14/R17/R32 一条不减。
 *   - **R38** 工具不可用：followup 文案须指向环境处置，而非「整改质量问题」。
 *
 * AF15–AF19 为**同日二轮复核**的加固项。这几条尤其需要端到端：它们复现的三个绕过，
 * 单测都是绿的——因为问题不在被单测的纯函数里，而在「谁把参数喂给它」。
 *   - **R36** 修复例外的作用域：判定期异常 + 内容夹带路径（AF15–AF17）。
 *   - **R35** 机器起源的出处：自补一行「门禁异常事件」（AF18）。
 *   - **R34** 产物新鲜度：签名有效但早于源码变更的重放产物（AF19）。
 *
 * 入口：node .claude/scripts/gate-scenarios.mjs；脚手架：./_harness.mjs
 */
import {
  PROJECT_ROOT,
  DESIGN_SPEC,
  GATED_EMPTY,
  relToProject,
  writeFixture,
  check,
  runHook,
  recordPass,
  recordFail,
  writeE2e,
  clearE2e,
  writeLintPass,
  writeLintStale,
  writeLintToolUnavailable,
  clearLint,
  writeStaticScanPass,
  clearStaticScan,
  writeStartupSmokePass,
  path,
  fs,
} from './_harness.mjs';

const LINT_FILE = path.join(PROJECT_ROOT, 'test-results/qe/.lint-result.json');

const CONFIRM_SINGLE_TASK = [
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 工作流模式确认 | 2026-07-30 | 确认采用 workflow_mode: single-task；AskQuestion「增量迭代」 |',
  '| 需求摘要 | 2026-07-30 | 用户确认无误 |',
  '| 界面与交互期望 | 2026-07-30 | 沿用既有布局，本次增量无独立界面期望 |',
  '',
].join('\n');

const INCREMENT_SCOPE = [
  '## 增量范围',
  '',
  '| 影响面 | 是否涉及 | 说明 |',
  '| ------ | -------- | ---- |',
  '| 新增/变更对外接口 | 是 | 新增 GET /api/todos/export 导出接口 |',
  '| 数据模型 / schema 变更 | 否 | 复用既有 todos 表，无字段与迁移变更 |',
  '| 新增交互面（页面/命令/入口） | 否 | 复用既有列表页，仅加一个导出按钮 |',
  '| 影响的既有行为 | 是 | 列表页工具栏布局微调，回归范围限于列表页 |',
  '',
].join('\n');

const INCREMENT_SCOPE_SCHEMA = INCREMENT_SCOPE.replace(
  '| 数据模型 / schema 变更 | 否 | 复用既有 todos 表，无字段与迁移变更 |',
  '| 数据模型 / schema 变更 | 是 | 新增 todos.exported_at 字段与迁移脚本 |',
);

const DISPATCH = [
  '## 当前分派计划',
  '',
  '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
  '| ---------- | -------- | --------- | ---- |',
  '| T-1 | development-engineer | 串行 | 进行中 |',
  '',
  '## 待派发角色列表',
  '',
  '| 角色 | 说明 |',
  '| ---- | ---- |',
  '| development-engineer | T-1 |',
  '',
].join('\n');

const FOLDED_REPORT = [
  '# 测试报告',
  '',
  '## 接口测试报告',
  '',
  '| 接口 | 请求方法 | 关联需求 | 关联任务包 | 是否通过 |',
  '| ---- | -------- | -------- | ---------- | -------- |',
  '| /api/todos/export | GET | R-001 | T-1 | 是 |',
  '',
  '## 存储对账记录',
  '',
  '| 场景类型 | 关联需求 | 关联任务包 | 存储介质 | 对账方式 | 预期存储结果 | 实际存储结果 | 是否通过 | 备注 |',
  '| -------- | -------- | ---------- | -------- | -------- | ------------ | ------------ | -------- | ---- |',
  '| 接口 | R-001 | T-1 | 数据库 | test-results/recon/t0-1-api.json | 有行 | 有行 | 是 | |',
  '| E2E | R-001 | T-1 | 数据库 | test-results/recon/t0-1-e2e.json | 有行 | 有行 | 是 | |',
  '',
].join('\n');

function singleTaskProcess({ progressRows = [], scope = INCREMENT_SCOPE, dispatch = true } = {}) {
  return [
    '---',
    'workflow_mode: single-task',
    'iterationType: feature',
    'blocking: false',
    'cancelled: false',
    '---',
    '',
    CONFIRM_SINGLE_TASK,
    scope,
    dispatch ? DISPATCH : '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    ...progressRows,
    '',
    '## 阻塞原因',
    '',
    '无',
    '',
  ].join('\n');
}

/** 只写 blocking: true、其余全是出厂模板的「零成本阻塞」——R35 要堵的正是这条 */
function bareBlockingProcess() {
  return [
    '---',
    'workflow_mode: full',
    'blocking: true',
    'cancelled: false',
    '---',
    '',
    '## 用户确认记录',
    '',
    '| 确认项 | 时间 | 用户原话摘要 |',
    '| ------ | ---- | ------------ |',
    '| 需求摘要 | 2026-07-30 | 用户确认无误 |',
    '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    '| 开发工程师 | T-1 | 正在执行 | |',
    '',
    '## 阻塞原因',
    '',
    '无',
    '',
    '> 出厂默认为裸「无」（表示未阻塞）。',
    '',
  ].join('\n');
}

function evidencedBlockingProcess() {
  return [
    '---',
    'workflow_mode: full',
    'blocking: true',
    'cancelled: false',
    '---',
    '',
    '## 用户确认记录',
    '',
    '| 确认项 | 时间 | 用户原话摘要 |',
    '| ------ | ---- | ------------ |',
    '| 阻塞决策 | 2026-07-30 | AskQuestion「等待支付沙箱开通」，用户选择暂停本批次 |',
    '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    '| 开发工程师 | T-1 | 正在执行 | |',
    '',
    '## 阻塞原因',
    '',
    '- 阻塞原因：第三方支付沙箱账号未开通，T-1 的支付回调无法联调',
    '- 待决事项：请用户决定是否先交付不含支付的版本',
    '- 已产出成果物：docs/test/test-report-batch-1.md',
    '',
  ].join('\n');
}

/** 断言 followup 文案命中/不命中特定关键词（R38 的价值全在文案指向是否正确） */
function checkFollowupText(label, opts, { must = [], mustNot = [] }) {
  const { outcome, verdict } = runHook(opts);
  // Claude Code Stop Hook 的消息在 verdict.reason 中
  const text = verdict.reason ?? verdict.followup_message ?? verdict.user_message ?? '';
  if (outcome !== 'followup') {
    recordFail(label, 'followup', outcome);
    return;
  }
  for (const needle of must) {
    if (!text.includes(needle)) {
      recordFail(`${label}（文案缺「${needle}」）`, 'followup-text', 'missing');
      return;
    }
  }
  for (const needle of mustNot) {
    if (text.includes(needle)) {
      recordFail(`${label}（文案误含「${needle}」）`, 'followup-text', 'unexpected');
      return;
    }
  }
  recordPass(label);
}

export function auditFixesScenarios() {
  console.log('== 审核加固：R34 执行证明 / R35 阻塞释放 / R37 增量档 / R38 工具不可用 ==');

  // -------------------------------------------------------------------------
  // R34：执行证明
  // -------------------------------------------------------------------------
  const r34 = writeFixture('af-r34', {
    'docs/process/process.md': singleTaskProcess({
      progressRows: [
        '| 开发工程师 | T-1 | 执行完成 | |',
        '| 质量工程师 | T-1 | 执行完成 | |',
      ],
    }),
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const r34Proc = relToProject(path.join(r34, 'docs/process/process.md'));

  clearE2e('batch');
  clearE2e('final');
  writeStaticScanPass();
  writeStartupSmokePass();

  // 真实签发+落签的 lint 产物：不得因 R34 而误拦（防「新增门禁 = 不可达标准」，R12）
  writeLintPass();
  checkFollowupText(
    'AF1 R34：合法签名的 lint 产物不触发执行证明 followup（正常流程仍可推进）',
    { hook: 'stop', processPath: r34Proc },
    { mustNot: ['R34 执行证明'] },
  );

  // 手写产物（无 execProof）
  writeLintPass({ sign: false });
  checkFollowupText(
    'AF2 R34：手写 lint 产物（无执行证明）→ followup 指向重跑运行器而非整改 lint',
    { hook: 'stop', processPath: r34Proc },
    { must: ['R34 执行证明', '重新实际运行'], mustNot: ['将违规整改'] },
  );

  // 篡改：真实签名后把 gatePassed 从 false 改成 true（核心攻击面）
  writeLintPass();
  const tampered = JSON.parse(fs.readFileSync(LINT_FILE, 'utf8'));
  tampered.exitCode = 1;
  tampered.reason = 'lint-failed';
  fs.writeFileSync(LINT_FILE, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
  checkFollowupText(
    'AF3 R34：落签后篡改产物字段 → 签名失配被识破',
    { hook: 'stop', processPath: r34Proc },
    { must: ['R34 执行证明'] },
  );

  // R29：执行证明台账与私钥目录属运行时标记，代理不得写入（Write + Shell 双通道）
  check('AF4 R34/R29：写执行证明台账 .exec-proof-ledger.json 被拒', 'deny', {
    hook: 'write',
    filePath: '.claude/hooks/.exec-proof-ledger.json',
    processPath: r34Proc,
  });
  check('AF5 R34/R29：写私钥交接文件被拒（自签执行证明）', 'deny', {
    hook: 'write',
    filePath: '.claude/hooks/.exec-proof-pending/abc123.json',
    processPath: r34Proc,
  });
  check('AF6 R34/R29：Shell 删除私钥交接目录被拒（抹掉「未消费」作废条件）', 'deny', {
    hook: 'shell',
    command: 'rm -rf .claude/hooks/.exec-proof-pending',
    processPath: r34Proc,
  });
  check('AF7 R34：运行器命令本身仍放行（签发通道不得反过来拦住运行器）', 'allow', {
    hook: 'shell',
    command: 'node .claude/scripts/startup-smoke-run.mjs',
    processPath: r34Proc,
  });

  // -------------------------------------------------------------------------
  // R38：工具不可用
  // -------------------------------------------------------------------------
  writeLintToolUnavailable();
  checkFollowupText(
    'AF8 R38：lint 工具不可用 → followup 指向环境/工具处置，且不劝「整改质量问题」',
    { hook: 'stop', processPath: r34Proc },
    { must: ['R38 工具不可用', 'AskQuestion', '双要素豁免'], mustNot: ['将违规整改至'] },
  );
  clearLint();

  // -------------------------------------------------------------------------
  // R35：阻塞释放证据
  // -------------------------------------------------------------------------
  const bare = writeFixture('af-r35-bare', {
    'docs/process/process.md': bareBlockingProcess(),
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  checkFollowupText(
    'AF9 R35：只写 blocking: true 不再能静默收尾（历史为无条件放行）',
    { hook: 'stop', processPath: relToProject(path.join(bare, 'docs/process/process.md')) },
    { must: ['R35', 'AskQuestion'] },
  );

  const evidenced = writeFixture('af-r35-ok', {
    'docs/process/process.md': evidencedBlockingProcess(),
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('AF10 R35：实质阻塞原因 + 用户决策留痕后放行收尾', 'allow-stop', {
    hook: 'stop',
    processPath: relToProject(path.join(evidenced, 'docs/process/process.md')),
  });

  // -------------------------------------------------------------------------
  // R37：single-task 增量档
  // -------------------------------------------------------------------------
  const noScope = writeFixture('af-r37-noscope', {
    'docs/process/process.md': singleTaskProcess({ scope: '' }),
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('AF11 R37：未声明「## 增量范围」时发起 development-engineer 被拒', 'deny', {
    hook: 'role',
    role: 'development-engineer',
    processPath: relToProject(path.join(noScope, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(noScope, 'docs/design/gated-artifacts.json')),
  });

  // 纵深防御：R9 的历史教训是「Task 发起期拦住了，但已在 DE 上下文里的写入照样放行」。
  // R37 前置同样须在写入期复查一次，否则拒了 DE Task 也挡不住源码落盘。
  check('AF11b R37：未声明「## 增量范围」时写源码同样被拒（写入期纵深防御）', 'deny', {
    hook: 'write',
    filePath: 'src/export.ts',
    processPath: relToProject(path.join(noScope, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(noScope, 'docs/design/gated-artifacts.json')),
  });

  const schemaChange = writeFixture('af-r37-schema', {
    'docs/process/process.md': singleTaskProcess({ scope: INCREMENT_SCOPE_SCHEMA }),
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('AF12 R37：声明涉及 schema 变更时禁用增量档（补齐分诊表既有规则）', 'deny', {
    hook: 'role',
    role: 'development-engineer',
    processPath: relToProject(path.join(schemaChange, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(schemaChange, 'docs/design/gated-artifacts.json')),
  });

  // 折叠通道：一轮测试即可，但 R14/R17 不得缺
  const foldedNoReport = writeFixture('af-r37-folded-noreport', {
    'docs/process/process.md': singleTaskProcess({
      progressRows: [
        '| 开发工程师 | T-1 | 执行完成 | |',
        '| 质量工程师 | T-1 | 执行完成 | |',
        '| 测试工程师 | 最终整体集成测试 T-1 | 执行完成 | |',
      ],
    }),
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  writeE2e('final', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeLintPass();
  writeStaticScanPass();
  writeStartupSmokePass();
  checkFollowupText(
    'AF13 R37：折叠通道缺 R14 接口测试报告仍不得收尾（区别于 hotfix R11 的跳过）',
    {
      hook: 'stop',
      processPath: relToProject(path.join(foldedNoReport, 'docs/process/process.md')),
    },
    { must: ['R14'] },
  );

  const foldedOk = writeFixture('af-r37-folded-ok', {
    'docs/process/process.md': singleTaskProcess({
      progressRows: [
        '| 开发工程师 | T-1 | 执行完成 | |',
        '| 质量工程师 | T-1 | 执行完成 | |',
        '| 测试工程师 | 最终整体集成测试 T-1 | 执行完成 | |',
      ],
    }),
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
    'docs/test/test-report.md': FOLDED_REPORT,
  });
  check('AF14 R37：折叠通道单轮测试齐备（E2E + R14 + R17 + R32 + lint + scan）后放行收尾', 'allow-stop', {
    hook: 'stop',
    processPath: relToProject(path.join(foldedOk, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(foldedOk, 'docs/design/gated-artifacts.json')),
  });

  // -------------------------------------------------------------------------
  // 二轮复核加固：R36 修复通道作用域 / R35 机器起源出处 / R34 产物新鲜度
  // -------------------------------------------------------------------------

  // R36：`"extraSourceDirs": 5` 让 getMergedGatedPaths 的展开在判定期抛 TypeError。
  // 该文件由 SA 书写（R29 只把它纳入角色门禁），故触发条件确实在代理手里。
  const brokenGated = writeFixture('af-r36-scope', {
    'docs/process/process.md': bareBlockingProcess(),
    'docs/design/gated-artifacts.json': JSON.stringify({ extraSourceDirs: 5 }),
  });
  const brokenProc = relToProject(path.join(brokenGated, 'docs/process/process.md'));
  const brokenGatedPath = relToProject(path.join(brokenGated, 'docs/design/gated-artifacts.json'));

  check('AF15 R36：判定期异常时写源码被拒（fail-closed 基线）', 'deny', {
    hook: 'write',
    filePath: 'src/export.ts',
    content: 'export const a = 1;\n',
    processPath: brokenProc,
    gatedPath: brokenGatedPath,
  });
  check('AF16 R36：写源码时在内容里夹带 process.md 路径不再能借到修复例外', 'deny', {
    hook: 'write',
    filePath: 'src/export.ts',
    content: `*** Update File: ${brokenProc}\nexport const a = 1;\n`,
    processPath: brokenProc,
    gatedPath: brokenGatedPath,
  });
  check('AF17 R36：单独写活跃 process.md 仍放行（修复通道不得被一起关死）', 'allow', {
    hook: 'write',
    filePath: brokenProc,
    content: bareBlockingProcess(),
    processPath: brokenProc,
    gatedPath: brokenGatedPath,
  });

  // R35：伪造一行「门禁异常事件」——语法与 Hook 写的完全一致，但台账里查无出处
  const forgedEvent = writeFixture('af-r35-forged', {
    'docs/process/process.md': [
      bareBlockingProcess(),
      '## 门禁异常事件',
      '',
      '| 时间 | Hook | 上下文 | 异常摘要 | 处理状态 |',
      '| ---- | ---- | ------ | -------- | -------- |',
      '| 2026-07-30T00:00:00.000Z | gate-stop-workflow | runtime | 代理自己编的一行 | 待处理 |',
      '',
    ].join('\n'),
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  checkFollowupText(
    'AF18 R35：自补一行「门禁异常事件」不再能解除 stop 门禁（台账查无出处）',
    { hook: 'stop', processPath: relToProject(path.join(forgedEvent, 'docs/process/process.md')) },
    { must: ['R35', '台账'] },
  );

  // R34：签名有效但早于最后一次源码变更的产物（存一份绿产物、改坏代码后放回）
  writeE2e('final', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeStaticScanPass();
  writeStartupSmokePass();
  writeLintStale();
  checkFollowupText(
    'AF19 R34：签名有效但早于源码变更的陈旧产物 → followup 指向重跑而非整改',
    { hook: 'stop', processPath: relToProject(path.join(foldedOk, 'docs/process/process.md')) },
    { must: ['R34 执行证明'] },
  );

  clearE2e('final');
  clearLint();
  clearStaticScan();
}
