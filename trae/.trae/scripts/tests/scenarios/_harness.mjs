/**
 * 场景自测共享脚手架：fixture 工厂、Hook spawn、check()、E2E/lint/scan 快照。
 *
 * 框架维护用，不参与宿主项目开发。由历史 `eval/` 探针沉淀为常驻端到端回归：
 *   - 与 `gate-selftest.mjs`（库函数单元级）互补——本套件真正 spawn Hook 入口，
 *     读取 allow/deny/ask/followup；
 *   - E2E 用 `e2e-run-lib.mjs` 真实计算后写入 `test-results/e2e/`（运行前后快照还原）；
 *   - 隔离 fixture 在 `test-results/.gate-scenarios/`，经 HARNESS_PROCESS_PATH 等指向。
 *
 * 覆盖：Greenfield / Feature / Hotfix(R11) / R15 lint / R16 静态扫描 / R17 对账 /
 * R18 设计审核 / 对抗 / R5 会话 / Finding#1 / TE 冒烟(R22) / 加固(R28–R31)。
 *
 * 用法：
 *   node .trae/scripts/gate-scenarios.mjs
 *   node .trae/scripts/gate-scenarios.mjs --verbose
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseChromiumResults, computeGateResult } from '../../e2e-run-lib.mjs';
import {
  signFixtureArtifact,
  snapshotExecProofState,
  restoreExecProofState,
} from '../exec-proof-fixture.mjs';

export { snapshotExecProofState, restoreExecProofState };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
export const HOOKS_DIR = path.join(PROJECT_ROOT, '.trae/hooks');
export const SCEN_REL = 'test-results/.gate-scenarios';
export const SCEN_ROOT = path.join(PROJECT_ROOT, SCEN_REL);
const E2E_DIR = path.join(PROJECT_ROOT, 'test-results/e2e');
export const VERBOSE = process.argv.includes('--verbose');

export const HOOK_FILES = {
  role: path.join(HOOKS_DIR, 'gate-role-sequence.mjs'),
  r13: path.join(HOOKS_DIR, 'gate-r13-subagent.mjs'),
  write: path.join(HOOKS_DIR, 'gate-dev-workflow.mjs'),
  shell: path.join(HOOKS_DIR, 'gate-dev-shell.mjs'),
  toolchain: path.join(HOOKS_DIR, 'gate-toolchain-install.mjs'),
  stop: path.join(HOOKS_DIR, 'gate-stop-workflow.mjs'),
};

export let passCount = 0;
export let failCount = 0;
export const failures = [];

// ---------------------------------------------------------------------------
// 通用内容块
// ---------------------------------------------------------------------------
export const CONFIRM_SECTION = [
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 需求摘要 | 2026-01-01 | 已确认 |',
  '| 技术选型 | 2026-01-01 | 确认采用 Node.js；来源 tech-stack-options.md 方案 A |',
  // R33：界面与交互期望确认行（发起 system-architect 的机读前置）
  '| 界面与交互期望 | 2026-01-01 | 确认接受组件库默认外观，本版无独立界面期望 |',
].join('\n');

/** R20：轻量模式机读确认行 */
export const LITE_CONFIRM_HOTFIX =
  '| 工作流模式确认 | 2026-01-01 | 确认采用 workflow_mode: hotfix |';
export const LITE_CONFIRM_DOCS_ONLY =
  '| 工作流模式确认 | 2026-01-01 | 确认采用 workflow_mode: docs-only |';

/** hotfix 声明 none 时须含最小影响澄清记录（R9 机读）+ R20 模式确认 */
export const HOTFIX_CONFIRM_SECTION = [
  CONFIRM_SECTION,
  LITE_CONFIRM_HOTFIX,
  '| hotfix影响面 | 2026-01-01 | 受影响用户：管理员；既有行为：不改变任何 P0 行为；回滚条件：日志展示异常即回滚；已比对 requirement-list.md 全部 P0（R-001），本次修复仅涉及日志格式 |',
].join('\n');

/** 已 R20 确认但缺 R9 影响面（供 H3b） */
export const HOTFIX_CONFIRM_NO_JUSTIFICATION = [CONFIRM_SECTION, LITE_CONFIRM_HOTFIX].join('\n');

export const DOCS_ONLY_CONFIRM_SECTION = [CONFIRM_SECTION, LITE_CONFIRM_DOCS_ONLY].join('\n');

export const DISPATCH_SECTION = [
  '## 当前分派计划',
  '',
  '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
  '| ---------- | -------- | --------- | ---- |',
  '| T0-1 | development-engineer | 串行 | 待开发 |',
  '',
  '## 待派发角色列表',
  '',
  '| 角色 | 说明 |',
  '| ---- | ---- |',
  '| development-engineer | T0-1 |',
].join('\n');

/**
 * 生成含指定角色的分派计划段（R39 场景测试用：被派发角色须在 PM 分派计划中）。
 * @param {string[]} roles 角色 slug 数组（如 ['system-architect']）
 * @returns {string}
 */
export function dispatchWithRoles(roles) {
  const planRows = roles.map((r) => `| T0-1 | ${r} | 串行 | 待派 |`).join('\n');
  const pendingRows = roles.map((r) => `| ${r} | T0-1 |`).join('\n');
  return [
    '## 当前分派计划',
    '',
    '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
    '| ---------- | -------- | --------- | ---- |',
    planRows,
    '',
    '## 待派发角色列表',
    '',
    '| 角色 | 说明 |',
    '| ---- | ---- |',
    pendingRows,
  ].join('\n');
}

export const EMPTY_DISPATCH_SECTION = [
  '## 当前分派计划',
  '',
  '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
  '| ---------- | -------- | --------- | ---- |',
  '',
  '## 待派发角色列表',
  '',
  '| 角色 | 说明 |',
  '| ---- | ---- |',
].join('\n');

export const ARTIFACT_REF =
  '本次已产出 requirement-spec.md、requirement-list.md、detail-design-spec.md、develop-task-list.md。';
export const BLOCK_OK = ['## 阻塞原因', '', '无'].join('\n');

export const REQ_SPEC =
  '# requirement-spec.md\n\n## 隐性需求确认记录\n\n| 类别 | 要点 | 用户确认摘要 | 关联需求/§7 追溯 | 状态 | 影响/决策点 |\n| --- | --- | --- | --- | --- | --- |\n| 排查结论 | 已排查，无额外隐性假设 | 用户确认现有描述已完整 | R-001；§7 追溯-001 | 已确认 | 已确认不影响额外范围 |\n';
export const REQ_LIST =
  '# requirement-list.md\n\n| 需求编号 | 名称 | 描述 | 模块 | 优先级 |\n| --- | --- | --- | --- | --- |\n| R-001 | 待办新增 | 新增待办项 | core | P0 |\n';
export const DESIGN_SPEC = '# detail-design-spec.md\n';
export const TASK_LIST = '# develop-task-list.md\n';
export const DPL_DIM_HEADER =
  '| 检查维度 | 问题描述 | 严重等级 | 是否存在 | 是否解决 | 关联成果物 | 关联需求编号 | 建议责任角色 | 修复建议 |';
export const DPL_DIM_SEP = '| --- | --- | --- | --- | --- | --- | --- | --- | --- |';
export const DPL_DIMS = [
  '需求覆盖度',
  '目标达成性',
  '功能',
  '体验',
  '可行性',
  'MVP 范围',
  '任务可执行性',
  '流程合规性',
  '架构设计原则',
  '成果物完整性',
  '测试可执行性',
  '安全与合规',
];
export function makeCleanDpl(p0Ids = ['R-001']) {
  const dimRows = DPL_DIMS.map((d) => `| ${d} | 无 | 低 | 否 | | | | | |`).join('\n');
  const covRows = p0Ids
    .map((id) => `| ${id} | P0 | AC-${id}-1 可创建待办 | detail-design-spec.md §2 | 用户可创建待办项 | T0-1 | 已覆盖 |`)
    .join('\n');
  return [
    '# 设计问题清单',
    '',
    '## 审核问题表',
    '',
    DPL_DIM_HEADER,
    DPL_DIM_SEP,
    dimRows,
    '',
    '## 需求覆盖矩阵',
    '',
    '| 需求编号 | 优先级 | 验收标准 | 设计落点 | 设计落点原文摘录 | 任务包 | 覆盖结论 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    covRows,
    '',
    '## 审核结论',
    '',
    '| 审核轮次 | 结论 | 说明 |',
    '| --- | --- | --- |',
    '| 1 | 通过 | 首次审核无未解决问题 |',
    '',
  ].join('\n');
}
export const DPL_CLEAN = makeCleanDpl(['R-001']);
export const DPL_UNRESOLVED = [
  '# 设计问题清单',
  '',
  '## 审核问题表',
  '',
  DPL_DIM_HEADER,
  DPL_DIM_SEP,
  ...DPL_DIMS.map((d) =>
    d === '需求覆盖度'
      ? `| ${d} | R-001 无设计落点 | 高 | 是 | 否 | detail-design-spec.md | R-001 | system-architect | 在 §4 补充接口并关联 T0-1 |`
      : `| ${d} | 无 | 低 | 否 | | | | | |`,
  ),
  '',
  '## 需求覆盖矩阵',
  '',
  '| 需求编号 | 优先级 | 验收标准 | 设计落点 | 设计落点原文摘录 | 任务包 | 覆盖结论 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| R-001 | P0 | AC-R-001-1 | | | T0-1 | 未覆盖 |',
  '',
  '## 审核结论',
  '',
  '| 审核轮次 | 结论 | 说明 |',
  '| --- | --- | --- |',
  '| 1 | 不通过 | 存在未解决覆盖问题 |',
  '',
].join('\n');
export const GATED_EMPTY = '{}\n';
// R14 + R17：含非空「## 接口测试报告」与「## 存储对账记录」（接口+E2E 行，合法介质）
export const TEST_REPORT_API = [
  '# 测试报告',
  '',
  '## 接口测试报告',
  '',
  '| 接口 | 请求方法 | 关联需求 | 关联任务包 | 是否通过 |',
  '| ---- | -------- | -------- | ---------- | -------- |',
  '| /api/todos | POST | R-001 | T0-1 | 是 |',
  '',
  '## 存储对账记录',
  '',
  '| 场景类型 | 关联需求 | 关联任务包 | 存储介质 | 对账方式 | 预期存储结果 | 实际存储结果 | 是否通过 | 备注 |',
  '| -------- | -------- | ---------- | -------- | -------- | ------------ | ------------ | -------- | ---- |',
  '| 接口 | R-001 | T0-1 | 数据库 | test-results/recon/t0-1-api.json · SELECT id FROM todos | 有行 | 有行 | 是 | |',
  '| E2E | R-001 | T0-1 | 缓存 | test-results/recon/t0-1-e2e.json · Redis GET todo:1 | 有值 | 有值 | 是 | |',
  '',
].join('\n');
// R14 有接口报告但缺 R17 存储对账（用于 G10c）
export const TEST_REPORT_API_NO_STORAGE = [
  '# 测试报告',
  '',
  '## 接口测试报告',
  '',
  '| 接口 | 请求方法 | 关联需求 | 关联任务包 | 是否通过 |',
  '| ---- | -------- | -------- | ---------- | -------- |',
  '| /api/todos | POST | R-001 | T0-1 | 是 |',
  '',
].join('\n');
// R14 豁免后仅需 E2E 对账行（G11c）
export const TEST_REPORT_STORAGE_E2E_ONLY = [
  '# 测试报告',
  '',
  '## 存储对账记录',
  '',
  '| 场景类型 | 关联需求 | 关联任务包 | 存储介质 | 对账方式 | 预期存储结果 | 实际存储结果 | 是否通过 | 备注 |',
  '| -------- | -------- | ---------- | -------- | -------- | ------------ | ------------ | -------- | ---- |',
  '| E2E | R-001 | T0-1 | 文件 | test-results/recon/t0-1-e2e.json · 读盘校验落盘文件 | 文件存在 | 文件存在 | 是 | |',
  '',
].join('\n');

export function progressSection(rows = []) {
  return [
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    ...rows,
    '',
  ].join('\n');
}

export function greenfieldReady(progressRows = [], dispatchSection = DISPATCH_SECTION) {
  return [
    '---',
    'phase: development',
    'workflow_mode: full',
    'iterationType: greenfield',
    'blocking: false',
    'cancelled: false',
    '---',
    '',
    '# 流程进度记录',
    '',
    ARTIFACT_REF,
    '',
    CONFIRM_SECTION,
    '',
    dispatchSection,
    '',
    progressSection(progressRows),
    '',
    BLOCK_OK,
    '',
  ].join('\n');
}

// R14：含接口测试豁免确认行的用户确认记录 + 无对外接口的 gated-artifacts 声明
export const API_EXEMPT_CONFIRM = [
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 需求摘要 | 2026-01-01 | 已确认 |',
  '| 技术选型 | 2026-01-01 | 确认采用 Node.js |',
  '| 界面与交互期望 | 2026-01-01 | 确认接受组件库默认外观，本版无独立界面期望 |',
  '| 接口测试豁免 | 2026-01-01 | 纯算法库无对外接口，确认豁免接口测试 |',
].join('\n');
export const API_NA_GATED = '{\n  "apiTestApplicability": "n/a",\n  "apiTestApplicabilityReason": "纯算法库无对外接口"\n}\n';

export function greenfieldApiExempt(progressRows = []) {
  return [
    '---',
    'phase: development',
    'workflow_mode: full',
    'iterationType: greenfield',
    'blocking: false',
    'cancelled: false',
    '---',
    '',
    '# 流程进度记录',
    '',
    ARTIFACT_REF,
    '',
    API_EXEMPT_CONFIRM,
    '',
    DISPATCH_SECTION,
    '',
    progressSection(progressRows),
    '',
    BLOCK_OK,
    '',
  ].join('\n');
}

export function greenfieldNoDispatch() {
  return [
    '---',
    'phase: development',
    'workflow_mode: full',
    'iterationType: greenfield',
    'blocking: false',
    'cancelled: false',
    '---',
    '',
    '# 流程进度记录',
    '',
    ARTIFACT_REF,
    '',
    CONFIRM_SECTION,
    '',
    EMPTY_DISPATCH_SECTION,
    '',
    progressSection(),
    '',
    BLOCK_OK,
    '',
  ].join('\n');
}

export function greenfieldEmpty() {
  return [
    '---',
    'phase: requirement',
    'workflow_mode: full',
    'iterationType: greenfield',
    'blocking: false',
    'cancelled: false',
    '---',
    '',
    '# 流程进度记录',
    '',
    '## 用户确认记录',
    '',
    '| 确认项 | 时间 | 用户原话摘要 |',
    '| ------ | ---- | ------------ |',
    '',
    EMPTY_DISPATCH_SECTION,
    '',
    BLOCK_OK,
    '',
  ].join('\n');
}

export function featureReady(progressRows = []) {
  return [
    '---',
    'phase: development',
    'workflow_mode: full',
    'iterationType: feature',
    'blocking: false',
    'cancelled: false',
    '---',
    '',
    '# 流程进度记录（filter feature）',
    '',
    ARTIFACT_REF,
    '',
    CONFIRM_SECTION,
    '',
    DISPATCH_SECTION,
    '',
    progressSection(progressRows),
    '',
    BLOCK_OK,
    '',
  ].join('\n');
}

export function hotfixProcess({
  dispatch = true,
  progressRows = [],
  withHotfixJustification = true,
  p0Impact = 'none',
} = {}) {
  return [
    '---',
    'phase: development',
    'workflow_mode: hotfix',
    'iterationType: hotfix',
    `hotfix_p0_impact: ${p0Impact}`,
    'blocking: false',
    'cancelled: false',
    '---',
    '',
    '# 流程进度记录（hotfix）',
    '',
    withHotfixJustification ? HOTFIX_CONFIRM_SECTION : HOTFIX_CONFIRM_NO_JUSTIFICATION,
    '',
    dispatch ? DISPATCH_SECTION : EMPTY_DISPATCH_SECTION,
    '',
    progressSection(progressRows),
    '',
    BLOCK_OK,
    '',
  ].join('\n');
}

export function docsOnlyProcess() {
  return [
    '---',
    'phase: development',
    'workflow_mode: docs-only',
    'blocking: false',
    'cancelled: false',
    '---',
    '',
    '# 流程进度记录（docs-only）',
    '',
    DOCS_ONLY_CONFIRM_SECTION,
    '',
    BLOCK_OK,
    '',
  ].join('\n');
}

export function cancelledProcess() {
  return [
    '---',
    'phase: development',
    'workflow_mode: full',
    'iterationType: greenfield',
    'blocking: false',
    'cancelled: true',
    'cancelledAt: 2026-01-01T00:00:00Z',
    'cancelReason: 用户取消',
    '---',
    '',
    '# 流程进度记录（已取消）',
    '',
    CONFIRM_SECTION,
    '',
    DISPATCH_SECTION,
    '',
    progressSection(['| 开发工程师 | T0-1 | 正在执行 | |']),
    '',
    BLOCK_OK,
    '',
    '## 取消记录',
    '',
    '| 时间 | 触发原话摘要 | 二次确认摘要 |',
    '| ---- | ------------ | ------------ |',
    '| 2026-01-01 | 停止此流程 | 已二次确认 |',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// fixture / hook 驱动
// ---------------------------------------------------------------------------
export function relToProject(abs) {
  return path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
}

/**
 * Windows 上 fs.rmSync(recursive) 有时会静默失败（文件句柄延迟释放 / 索引服务占用），
 * 导致残留文件污染后续测试。改用逐文件删除 + 重试机制确保清理彻底。
 */
function rmSyncRobust(target) {
  if (!fs.existsSync(target)) return;
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    /* 忽略，下面逐文件重试 */
  }
  if (!fs.existsSync(target)) return;
  function walkAndDelete(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkAndDelete(full);
        try { fs.rmdirSync(full); } catch { /* ignore */ }
      } else {
        for (let i = 0; i < 3; i++) {
          try {
            fs.unlinkSync(full);
            break;
          } catch {
            // 重试：可能被索引服务短暂占用
          }
        }
      }
    }
  }
  walkAndDelete(target);
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* best-effort */ }
}

/** 写入一组 fixture 文件，返回该 fixture 根目录绝对路径 */
export function writeFixture(name, files) {
  const root = path.join(SCEN_ROOT, name);
  rmSyncRobust(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return root;
}

export function buildPayload(hook, { role, filePath, command, conversationId, agentId, content }) {
  let payload;
  if (hook === 'role') payload = { tool_name: 'Task', tool_input: { subagent_type: role } };
  else if (hook === 'r13') {
    // gate-r13-subagent（matcher:"*"）：读 agent_id 判定角色，任意 tool_name 即可触发
    payload = { tool_name: 'Read', tool_input: {} };
  }
  else if (hook === 'write') {
    // `content` 供 R36 修复通道作用域用例构造「写入内容里夹带 ApplyPatch 路径」的形态
    payload = {
      tool_name: 'Write',
      tool_input: { path: filePath, ...(content === undefined ? {} : { content }) },
    };
  }
  else if (hook === 'shell' || hook === 'toolchain') payload = { command, tool_input: { command } };
  else payload = {};
  // R5 身份判定（2026-07-29 修复）：agent_id 是 Trae PreToolUse stdin 的标准字段，
  // solo_agent=顶层（deny），其他=子代理（放行）。未传时 agent_id 缺失 -> fail-open。
  if (agentId !== undefined) payload.agent_id = agentId;
  // 保留 session_id 供向后兼容测试（生产门禁已改用 agent_id）
  if (conversationId !== undefined) payload.session_id = conversationId;
  return payload;
}

export function runHook({
  hook, role, filePath, command, processPath, gatedPath, conversationId, agentId, content,
}) {
  const env = { ...process.env };
  delete env.HARNESS_PROCESS_PATH;
  delete env.HARNESS_GATED_ARTIFACTS_PATH;
  if (processPath) env.HARNESS_PROCESS_PATH = processPath;
  if (gatedPath) env.HARNESS_GATED_ARTIFACTS_PATH = gatedPath;

  const res = spawnSync('node', [HOOK_FILES[hook]], {
    cwd: PROJECT_ROOT,
    input: JSON.stringify(buildPayload(hook, { role, filePath, command, conversationId, agentId, content })),
    encoding: 'utf8',
    env,
  });

  let verdict;
  try {
    verdict = JSON.parse((res.stdout || '').trim() || '{}');
  } catch {
    verdict = { _raw: res.stdout };
  }

  let outcome;
  // Trae stdout 契约：PreToolUse 用 hookSpecificOutput.permissionDecision，Stop 用 decision:'block'
  if (hook === 'stop') outcome = verdict.decision === 'block' ? 'followup' : 'allow-stop';
  else outcome = verdict?.hookSpecificOutput?.permissionDecision ?? 'unknown';

  return { outcome, verdict, stderr: res.stderr };
}

export function check(label, expect, opts) {
  const { outcome, verdict } = runHook(opts);
  const ok = outcome === expect;
  if (ok) {
    passCount += 1;
    console.log(`  PASS  expect=${expect} got=${outcome} :: ${label}`);
  } else {
    failCount += 1;
    failures.push({ label, expect, outcome, reason: verdict?.hookSpecificOutput?.permissionDecisionReason || verdict?.reason || '' });
    console.error(`  FAIL  expect=${expect} got=${outcome} :: ${label}`);
  }
  if (VERBOSE) {
    const detail = verdict?.hookSpecificOutput?.permissionDecisionReason || verdict?.reason;
    if (detail) console.log(`          ↳ ${String(detail).split('\n')[0].slice(0, 160)}`);
  }
}

// ---------------------------------------------------------------------------
// E2E 结果产物（快照 / 计算 / 还原）
// ---------------------------------------------------------------------------
const E2E_FILES = {
  batch: path.join(E2E_DIR, '.e2e-batch-result.json'),
  final: path.join(E2E_DIR, '.e2e-final-result.json'),
};
const e2eSnapshot = {};

export function snapshotE2e() {
  for (const [scope, file] of Object.entries(E2E_FILES)) {
    e2eSnapshot[scope] = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }
}

export function restoreE2e() {
  for (const [scope, file] of Object.entries(E2E_FILES)) {
    const snap = e2eSnapshot[scope];
    if (snap === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, snap, 'utf8');
  }
}

// R15：编程规范（lint）门禁机读产物（test-results/qe/.lint-result.json）——
// 与 E2E 产物同为受控运行产物，快照/还原避免污染宿主运行时。
const LINT_FILE = path.join(PROJECT_ROOT, 'test-results/qe/.lint-result.json');
let lintSnapshot = null;

export function snapshotLint() {
  lintSnapshot = fs.existsSync(LINT_FILE) ? fs.readFileSync(LINT_FILE, 'utf8') : null;
}

export function restoreLint() {
  if (lintSnapshot === null) fs.rmSync(LINT_FILE, { force: true });
  else fs.writeFileSync(LINT_FILE, lintSnapshot, 'utf8');
}

/**
 * 合成 lint 产物。**R34**：默认走真实签发+落签，使场景测的是门禁判据本身
 * 而不是「验签缺失」这一个原因（`sign: false` 用于专门构造未签名场景）。
 */
function writeLintResultFixture(result, { sign = true } = {}) {
  fs.mkdirSync(path.dirname(LINT_FILE), { recursive: true });
  const payload = { ...result, _note: 'Synthesized by gate-scenarios.mjs for regression only.' };
  if (sign) signFixtureArtifact('lint', payload);
  fs.writeFileSync(LINT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function writeLintPass(options) {
  writeLintResultFixture(
    {
      gatePassed: true,
      reason: 'passed',
      stack: 'node',
      command: 'npm run lint',
      exitCode: 0,
      executedAt: new Date().toISOString(),
    },
    options,
  );
}

export function writeLintFail(options) {
  writeLintResultFixture(
    {
      gatePassed: false,
      reason: 'lint-failed',
      stack: 'node',
      command: 'npm run lint',
      exitCode: 1,
      executedAt: new Date().toISOString(),
    },
    options,
  );
}

/**
 * **R34 新鲜度**：一份签名完全有效、但产出于最后一次源码变更之前的绿产物。
 * 复现「代码还绿时真跑一次、存下来、改坏代码后原样放回」这条不必抢私钥的重放路径。
 */
export function writeLintStale() {
  writeLintResultFixture({
    gatePassed: true,
    reason: 'passed',
    stack: 'node',
    command: 'npm run lint',
    exitCode: 0,
    executedAt: '2020-01-01T00:00:00.000Z',
  });
}

/** R38：lint 工具不可用（离线拉不到 linter）——与「真有 lint 问题」须走不同处置路径 */
export function writeLintToolUnavailable() {
  writeLintResultFixture({
    gatePassed: false,
    reason: 'lint-tool-unavailable',
    toolUnavailable: true,
    toolUnavailableCategory: 'dependency-fetch',
    toolUnavailableDetail: 'npm ERR! code E404',
    stack: 'node',
    command: 'npm run lint',
    exitCode: 1,
    executedAt: new Date().toISOString(),
  });
}

export function clearLint() {
  fs.rmSync(LINT_FILE, { force: true });
}

// R16：静态代码质量门禁机读产物（test-results/qe/.static-scan-result.json）——
// 与 lint 产物同为受控运行产物，快照/还原避免污染宿主运行时。
const STATIC_SCAN_FILE = path.join(PROJECT_ROOT, 'test-results/qe/.static-scan-result.json');
let staticScanSnapshot = null;

export function snapshotStaticScan() {
  staticScanSnapshot = fs.existsSync(STATIC_SCAN_FILE) ? fs.readFileSync(STATIC_SCAN_FILE, 'utf8') : null;
}

export function restoreStaticScan() {
  if (staticScanSnapshot === null) fs.rmSync(STATIC_SCAN_FILE, { force: true });
  else fs.writeFileSync(STATIC_SCAN_FILE, staticScanSnapshot, 'utf8');
}

// R5 机械化补强：顶层会话 id 落盘于 .trae/hooks/.root-conversation-id.json——
// 与 lint/静态扫描产物同为受控运行产物，快照/还原避免污染宿主运行时。
const ROOT_CONVERSATION_FILE = path.join(HOOKS_DIR, '.root-conversation-id.json');
let rootConversationSnapshot = null;

export function snapshotRootConversation() {
  rootConversationSnapshot = fs.existsSync(ROOT_CONVERSATION_FILE)
    ? fs.readFileSync(ROOT_CONVERSATION_FILE, 'utf8')
    : null;
}

export function restoreRootConversation() {
  if (rootConversationSnapshot === null) fs.rmSync(ROOT_CONVERSATION_FILE, { force: true });
  else fs.writeFileSync(ROOT_CONVERSATION_FILE, rootConversationSnapshot, 'utf8');
}

export function writeRootConversation(id) {
  fs.mkdirSync(path.dirname(ROOT_CONVERSATION_FILE), { recursive: true });
  fs.writeFileSync(ROOT_CONVERSATION_FILE, JSON.stringify({ rootConversationId: id }), 'utf8');
}

export function clearRootConversation() {
  fs.rmSync(ROOT_CONVERSATION_FILE, { force: true });
}

// R17：对账证据 test-results/recon/*.json——快照/还原 + 场景默认证据
const RECON_DIR = path.join(PROJECT_ROOT, 'test-results/recon');
let reconSnapshot = null;

export function snapshotRecon() {
  reconSnapshot = fs.existsSync(RECON_DIR)
    ? Object.fromEntries(
        fs.readdirSync(RECON_DIR).map((f) => [f, fs.readFileSync(path.join(RECON_DIR, f), 'utf8')]),
      )
    : null;
}

export function restoreRecon() {
  rmSyncRobust(RECON_DIR);
  if (reconSnapshot && Object.keys(reconSnapshot).length > 0) {
    fs.mkdirSync(RECON_DIR, { recursive: true });
    for (const [f, content] of Object.entries(reconSnapshot)) {
      fs.writeFileSync(path.join(RECON_DIR, f), content, 'utf8');
    }
  }
}

export function writeReconEvidence(name) {
  fs.mkdirSync(RECON_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RECON_DIR, name),
    `${JSON.stringify(
      {
        command: 'echo recon-check',
        exitCode: 0,
        summary: 'row exists',
        capturedAt: '2026-01-01T00:00:00.000Z',
        _note: 'Synthesized by gate-scenarios.mjs for regression only.',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

export function ensureScenarioReconEvidence() {
  writeReconEvidence('t0-1-api.json');
  writeReconEvidence('t0-1-e2e.json');
}

const DISPATCHED_ROLES_FILE = path.join(HOOKS_DIR, '.dispatched-roles.json');
let dispatchedRolesSnapshot = null;

export function snapshotDispatchedRoles() {
  dispatchedRolesSnapshot = fs.existsSync(DISPATCHED_ROLES_FILE)
    ? fs.readFileSync(DISPATCHED_ROLES_FILE, 'utf8')
    : null;
}

export function restoreDispatchedRoles() {
  if (dispatchedRolesSnapshot === null) fs.rmSync(DISPATCHED_ROLES_FILE, { force: true });
  else fs.writeFileSync(DISPATCHED_ROLES_FILE, dispatchedRolesSnapshot, 'utf8');
}

export function clearDispatchedRoles() {
  fs.rmSync(DISPATCHED_ROLES_FILE, { force: true });
}

// R40：闭环锁 marker（.trae/hooks/.workflow-closure-pending.json）——与派发角色、
// 根会话同为宿主真实路径下的运行时状态，快照/还原避免污染。
const CLOSURE_LOCK_FILE = path.join(HOOKS_DIR, '.workflow-closure-pending.json');
let closureLockSnapshot = null;

export function snapshotClosureLock() {
  closureLockSnapshot = fs.existsSync(CLOSURE_LOCK_FILE)
    ? fs.readFileSync(CLOSURE_LOCK_FILE, 'utf8')
    : null;
}

export function restoreClosureLock() {
  if (closureLockSnapshot === null) fs.rmSync(CLOSURE_LOCK_FILE, { force: true });
  else fs.writeFileSync(CLOSURE_LOCK_FILE, closureLockSnapshot, 'utf8');
}

export function clearClosureLock() {
  fs.rmSync(CLOSURE_LOCK_FILE, { force: true });
}

export function readClosureLockFile() {
  return fs.existsSync(CLOSURE_LOCK_FILE)
    ? fs.readFileSync(CLOSURE_LOCK_FILE, 'utf8')
    : null;
}

/** 直接写一份 marker（构造跨回合约束的起始态，绕过 stop hook） */
export function writeClosureLockFile(stage, missingGates = [], reason = '') {
  fs.writeFileSync(
    CLOSURE_LOCK_FILE,
    JSON.stringify({ stage, missingGates, reason, pendingSince: new Date().toISOString() }, null, 2),
    'utf8',
  );
}

export function writeStaticScanResult(result, { sign = true } = {}) {
  fs.mkdirSync(path.dirname(STATIC_SCAN_FILE), { recursive: true });
  if (sign) signFixtureArtifact('static-scan', result);
  fs.writeFileSync(STATIC_SCAN_FILE, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

export function writeStaticScanPass() {
  writeStaticScanResult({
    gatePassed: true,
    duplication: { gatePassed: true, reason: 'passed', command: 'jscpd-rs .', exitCode: 0 },
    security: { gatePassed: true, reason: 'passed', command: 'gitleaks-secret-scanner', exitCode: 0 },
    executedAt: new Date().toISOString(),
    _note: 'Synthesized by gate-scenarios.mjs for regression only.',
  });
}

export function writeStaticScanDupFail() {
  writeStaticScanResult({
    gatePassed: false,
    duplication: { gatePassed: false, reason: 'scan-failed', command: 'jscpd-rs .', exitCode: 1 },
    security: { gatePassed: true, reason: 'passed', command: 'gitleaks-secret-scanner', exitCode: 0 },
    executedAt: new Date().toISOString(),
    _note: 'Synthesized by gate-scenarios.mjs for regression only.',
  });
}

export function writeStaticScanSecurityFail() {
  writeStaticScanResult({
    gatePassed: false,
    duplication: { gatePassed: true, reason: 'passed', command: 'jscpd-rs .', exitCode: 0 },
    security: { gatePassed: false, reason: 'scan-failed', command: 'gitleaks-secret-scanner', exitCode: 1 },
    executedAt: new Date().toISOString(),
    _note: 'Synthesized by gate-scenarios.mjs for regression only.',
  });
}

export function clearStaticScan() {
  fs.rmSync(STATIC_SCAN_FILE, { force: true });
}

// R32：生产启动冒烟机读产物（test-results/e2e/.startup-smoke-result.json）——
// 与 E2E/lint 产物同为受控运行产物，快照/还原避免污染宿主运行时。
const STARTUP_SMOKE_FILE = path.join(E2E_DIR, '.startup-smoke-result.json');
let startupSmokeSnapshot = null;

export function snapshotStartupSmoke() {
  startupSmokeSnapshot = fs.existsSync(STARTUP_SMOKE_FILE)
    ? fs.readFileSync(STARTUP_SMOKE_FILE, 'utf8')
    : null;
}

export function restoreStartupSmoke() {
  if (startupSmokeSnapshot === null) fs.rmSync(STARTUP_SMOKE_FILE, { force: true });
  else fs.writeFileSync(STARTUP_SMOKE_FILE, startupSmokeSnapshot, 'utf8');
}

function writeStartupSmokeResult(result, { sign = true } = {}) {
  fs.mkdirSync(E2E_DIR, { recursive: true });
  const payload = { ...result, _note: 'Synthesized by gate-scenarios.mjs for regression only.' };
  if (sign) signFixtureArtifact('startup-smoke', payload);
  fs.writeFileSync(STARTUP_SMOKE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function writeStartupSmokePass() {
  writeStartupSmokeResult({
    gatePassed: true,
    reason: 'passed',
    command: 'npm run start',
    commandSource: 'package.json.scripts.start',
    cleanStart: { passed: true, exited: false, exitCode: null, healthOk: null, elapsedMs: 8000 },
    restartAfterKill: { passed: true, exited: false, exitCode: null, healthOk: null, elapsedMs: 8000 },
    capturedAt: new Date().toISOString(),
  });
}

/** 干净启动就失败（复盘 1a：dist 起不来） */
export function writeStartupSmokeFail() {
  writeStartupSmokeResult({
    gatePassed: false,
    reason: 'clean-start-failed',
    command: 'npm run start',
    commandSource: 'package.json.scripts.start',
    cleanStart: { passed: false, exited: true, exitCode: 1, healthOk: null, elapsedMs: 320 },
    restartAfterKill: { passed: false, skipped: true, reason: 'clean-start-failed' },
    capturedAt: new Date().toISOString(),
  });
}

/** 干净启动过、强杀后再启动失败（复盘 1c：DATA_DIRECTORY_LOCKED 类陈旧锁） */
export function writeStartupSmokeRestartFail() {
  writeStartupSmokeResult({
    gatePassed: false,
    reason: 'restart-after-kill-failed',
    command: 'npm run start',
    commandSource: 'gated-artifacts.productionStartupCommand',
    cleanStart: { passed: true, exited: false, exitCode: null, healthOk: true, elapsedMs: 8000 },
    restartAfterKill: { passed: false, exited: true, exitCode: 1, healthOk: false, elapsedMs: 410 },
    capturedAt: new Date().toISOString(),
  });
}

export function clearStartupSmoke() {
  fs.rmSync(STARTUP_SMOKE_FILE, { force: true });
}

export function specFor(id, status) {
  return { title: `[${id}] e2e`, tests: [{ projectName: 'chromium', results: [{ status }] }] };
}

export function writeE2e(scope, { requiredIds, passed = [], failed = [], skipped = [], sign = true }) {
  const report = {
    suites: [
      {
        file: 'e2e/specs/scenario.spec.js',
        specs: [
          ...passed.map((id) => specFor(id, 'passed')),
          ...failed.map((id) => specFor(id, 'failed')),
          ...skipped.map((id) => specFor(id, 'skipped')),
        ],
      },
    ],
  };
  const gate = computeGateResult(parseChromiumResults(report), requiredIds, new Set());
  const result = {
    scope,
    ...gate,
    requiredIds,
    waivedIds: [],
    playwrightExitCode: gate.allPassed ? 0 : 1,
    executedAt: new Date().toISOString(),
    _note: 'Synthesized by gate-scenarios.mjs via real e2e-run-lib for regression only.',
  };
  fs.mkdirSync(E2E_DIR, { recursive: true });
  if (sign) signFixtureArtifact(scope === 'final' ? 'e2e-final' : 'e2e-batch', result);
  fs.writeFileSync(E2E_FILES[scope], `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

export function clearE2e(scope) {
  fs.rmSync(E2E_FILES[scope], { force: true });
}

// ---------------------------------------------------------------------------
// 场景
// ---------------------------------------------------------------------------
export const QUALITY_REPORT_CLEAN = [
  '# 质量报告',
  '',
  '## 审查结论',
  '',
  '| 检查维度 | 要点 | 是否存在问题 | 严重等级 | 是否解决 | 说明 |',
  '| -------- | ---- | ------------ | -------- | -------- | ---- |',
  '| 代码规范 | 符合设计文档 §5 | 否 | 低 | | |',
  '',
  '## 审查结论汇总',
  '',
  '- 质量判定：通过',
  '',
].join('\n');

export const QE_DONE_ROWS = [
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '| 质量工程师 | T0-1 | 执行完成 | |',
];

/** 套件内手动记账（避免对 import 的 live binding 赋值） */
export function recordPass(label) {
  passCount += 1;
  console.log(`  PASS  :: ${label}`);
}
export function recordFail(label, expect, outcome) {
  failCount += 1;
  failures.push({ label, expect, outcome });
  console.error(`  FAIL  :: ${label}`);
}

export function getScenarioStats() {
  return { passCount, failCount, failures };
}

export { path, fs };

