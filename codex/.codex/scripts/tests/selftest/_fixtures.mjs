/**
 * 自测共享 fixture / 工厂函数（跨规则套件复用）。
 *
 * 存放：R18 干净设计问题清单、轻量模式确认节、通用 process 片段等。
 * 仅被 `./_harness.mjs` 与各规则套件引用；勿在此写断言逻辑。
 */

const R18_DIMS = [
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
function makeCleanDplForSelftest(p0Ids = ['R-001']) {
  const header =
    '| 检查维度 | 问题描述 | 严重等级 | 是否存在 | 是否解决 | 关联成果物 | 关联需求编号 | 建议责任角色 | 修复建议 |';
  const sep = '| --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  const dimRows = R18_DIMS.map((d) => `| ${d} | 无 | 低 | 否 | | | | | |`).join('\n');
  const covRows = p0Ids
    .map((id) => `| ${id} | P0 | AC-${id}-1 可验证 | detail-design-spec.md §2 | 用户可创建待办项 | T0-1 | 已覆盖 |`)
    .join('\n');
  return [
    '# 设计问题清单',
    '',
    '## 审核问题表',
    '',
    header,
    sep,
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
const SELFTEST_REQ_LIST =
  '| 需求编号 | 需求名称 | 需求描述 | 验收标准 | 需求优先级 | 来源确认 | 状态 |\n| --- | --- | --- | --- | --- | --- | --- |\n| R-001 | 示例 | 描述 | Given | P0 | 确认 | 已确认 |\n';
const SELFTEST_REQ_LIST_3P0 =
  '| 需求编号 | 需求名称 | 需求描述 | 验收标准 | 需求优先级 | 来源确认 | 状态 |\n| --- | --- | --- | --- | --- | --- | --- |\n' +
  '| R-001 | 示例1 | 描述 | Given | P0 | 确认 | 已确认 |\n' +
  '| R-002 | 示例2 | 描述 | Given | P0 | 确认 | 已确认 |\n' +
  '| R-003 | 示例3 | 描述 | Given | P0 | 确认 | 已确认 |\n';
const SELFTEST_DPL_CLEAN = makeCleanDplForSelftest(['R-001']);
const SELFTEST_DPL_UNRESOLVED = [
  '# 设计问题清单',
  '',
  '## 审核问题表',
  '',
  '| 检查维度 | 问题描述 | 严重等级 | 是否存在 | 是否解决 | 关联成果物 | 关联需求编号 | 建议责任角色 | 修复建议 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...R18_DIMS.map((d) =>
    d === '功能'
      ? `| ${d} | 问题X | 高 | 是 | 否 | detail-design-spec.md | R-001 | system-architect | 补充边界说明 |`
      : `| ${d} | 无 | 低 | 否 | | | | | |`,
  ),
  '',
  '## 需求覆盖矩阵',
  '',
  '| 需求编号 | 优先级 | 验收标准 | 设计落点 | 设计落点原文摘录 | 任务包 | 覆盖结论 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| R-001 | P0 | AC-R-001-1 | detail-design-spec.md §2 | 用户可创建待办项 | T0-1 | 已覆盖 |',
  '',
  '## 审核结论',
  '',
  '| 审核轮次 | 结论 | 说明 |',
  '| --- | --- | --- |',
  '| 1 | 不通过 | 存在未解决问题 |',
  '',
].join('\n');

const SELFTEST_TECH_CONFIRM = [
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 需求摘要 | 2026-01-01 | 已确认 |',
  '| 技术选型 | 2026-01-01 | 确认采用 Node.js |',
  '',
].join('\n');

/** R20：轻量模式确认节（可拼接到 frontmatter 后） */
function liteModeConfirmSection(mode, extraRows = []) {
  return [
    '## 用户确认记录',
    '',
    '| 确认项 | 时间 | 用户原话摘要 |',
    '| ------ | ---- | ------------ |',
    `| 工作流模式确认 | 2026-01-01 | 确认采用 workflow_mode: ${mode} |`,
    ...extraRows,
    '',
  ].join('\n');
}

function hotfixProcessBody(extraFmLines = [], extraConfirmRows = []) {
  return [
    '---',
    'workflow_mode: hotfix',
    ...extraFmLines,
    '---',
    '',
    liteModeConfirmSection('hotfix', extraConfirmRows),
  ].join('\n');
}


const HOTFIX_STRUCTURED_API_STORAGE_REPORT = [
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

function makeQeDispatchProcess({ progressRows, planRole = 'quality-engineer', planPack = 'T0-1', pending = true }) {
  const pendingBlock = pending
    ? [
        '## 待派发角色列表',
        '',
        '| 角色 | 说明 |',
        '| ---- | ---- |',
        `| quality-engineer | ${planPack} |`,
        '',
      ].join('\n')
    : '';
  return [
    '---',
    'workflow_mode: full',
    '---',
    '',
    '## 当前分派计划',
    '',
    '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
    '| ---------- | -------- | --------- | ---- |',
    `| ${planPack} | ${planRole} | 串行 | 待 QE |`,
    '',
    pendingBlock,
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    ...progressRows,
    '',
  ].join('\n');
}

const R14_PROGRESS_BATCH_DONE = [
  '---',
  'workflow_mode: full',
  'iterationType: greenfield',
  '---',
  '',
  '## 进度列表',
  '',
  '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
  '| ----------- | -------- | ---- | ---- |',
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '| 质量工程师 | T0-1 | 执行完成 | |',
  '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
  '',
].join('\n');
const API_REPORT_EMPTY =
  '# 测试报告\n\n## 接口测试报告\n\n| 接口 | 是否通过 |\n| ---- | -------- |\n';
const API_REPORT_FILLED =
  '# 测试报告\n\n## 接口测试报告\n\n| 接口 | 是否通过 |\n| ---- | -------- |\n| /api/todos POST | 是 |\n';

const API_EXEMPT_CONFIRM_PROCESS = [
  '---',
  'workflow_mode: full',
  'iterationType: greenfield',
  '---',
  '',
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 接口测试豁免 | 2026-01-01 | 纯算法库无对外接口，确认豁免接口测试 |',
  '',
  '## 进度列表',
  '',
  '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
  '| ----------- | -------- | ---- | ---- |',
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '',
].join('\n');
const API_NA_GATED = '{ "apiTestApplicability": "n/a", "apiTestApplicabilityReason": "纯算法库无对外接口" }\n';

const STORAGE_RECON_HEADER =
  '| 场景类型 | 关联需求 | 关联任务包 | 存储介质 | 对账方式 | 预期存储结果 | 实际存储结果 | 是否通过 | 备注 |';
const STORAGE_RECON_SEP =
  '| -------- | -------- | ---------- | -------- | -------- | ------------ | ------------ | -------- | ---- |';
const STORAGE_RECON_BOTH = [
  '# 测试报告',
  '',
  '## 存储对账记录',
  '',
  STORAGE_RECON_HEADER,
  STORAGE_RECON_SEP,
  '| 接口 | R-001 | T0-1 | 数据库 | test-results/recon/t0-1-api.json · SELECT id FROM todos | 有行 | 有行 | 是 | |',
  '| E2E | R-001 | T0-1 | 缓存 | test-results/recon/t0-1-e2e.json · Redis GET todo:1 | 有值 | 有值 | 是 | |',
  '',
].join('\n');
const STORAGE_RECON_API_ONLY = [
  '# 测试报告',
  '',
  '## 存储对账记录',
  '',
  STORAGE_RECON_HEADER,
  STORAGE_RECON_SEP,
  '| 接口 | R-001 | T0-1 | 文件 | test-results/recon/t0-1-api.json · 读 /data/out.json | 存在 | 存在 | 是 | |',
  '',
].join('\n');
const STORAGE_RECON_E2E_ONLY = [
  '# 测试报告',
  '',
  '## 存储对账记录',
  '',
  STORAGE_RECON_HEADER,
  STORAGE_RECON_SEP,
  '| E2E | R-001 | T0-1 | 对象存储 | test-results/recon/t0-1-e2e.json · S3 headObject | 存在 | 存在 | 是 | |',
  '',
].join('\n');
const STORAGE_RECON_BAD_MEDIUM = [
  '# 测试报告',
  '',
  '## 存储对账记录',
  '',
  STORAGE_RECON_HEADER,
  STORAGE_RECON_SEP,
  '| 接口 | R-001 | T0-1 | PostgreSQL | test-results/recon/t0-1-api.json · SELECT 1 | 有行 | 有行 | 是 | |',
  '| E2E | R-001 | T0-1 | 内存变量 | test-results/recon/t0-1-e2e.json · 看变量 | 有值 | 有值 | 是 | |',
  '',
].join('\n');
const STORAGE_RECON_EMPTY = [
  '# 测试报告',
  '',
  '## 存储对账记录',
  '',
  STORAGE_RECON_HEADER,
  STORAGE_RECON_SEP,
  '',
].join('\n');

const STORAGE_EXEMPT_CONFIRM_PROCESS = [
  '---',
  'workflow_mode: full',
  'iterationType: greenfield',
  '---',
  '',
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 存储对账豁免 | 2026-01-01 | 纯算法库无持久化，确认豁免存储对账 |',
  '',
  '## 进度列表',
  '',
  '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
  '| ----------- | -------- | ---- | ---- |',
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '',
].join('\n');
const STORAGE_NA_GATED =
  '{ "storageReconciliationApplicability": "n/a", "storageReconciliationApplicabilityReason": "无业务数据持久化" }\n';

const R15_QE_DONE = [
  '---',
  'workflow_mode: full',
  'iterationType: greenfield',
  '---',
  '',
  '## 进度列表',
  '',
  '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
  '| ----------- | -------- | ---- | ---- |',
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '| 质量工程师 | T0-1 | 执行完成 | |',
  '',
].join('\n');
const LINT_PASS = { gatePassed: true, reason: 'passed', stack: 'node', command: 'npm run lint', exitCode: 0 };
const LINT_FAIL = { gatePassed: false, reason: 'lint-failed', stack: 'node', command: 'npm run lint', exitCode: 1 };
const LINT_NA_GATED = '{ "lintApplicability": "n/a", "lintApplicabilityReason": "无成熟 linter" }\n';
const LINT_EXEMPT_CONFIRM_PROCESS = [
  '---',
  'workflow_mode: full',
  'iterationType: greenfield',
  '---',
  '',
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 编程规范豁免 | 2026-01-01 | 该技术栈无可用 linter，确认豁免 lint 门禁 |',
  '',
  '## 进度列表',
  '',
  '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
  '| ----------- | -------- | ---- | ---- |',
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '| 质量工程师 | T0-1 | 执行完成 | |',
  '',
].join('\n');

const R16_QE_DONE = R15_QE_DONE;
const STATIC_SCAN_PASS = {
  gatePassed: true,
  duplication: { gatePassed: true, reason: 'passed', command: 'jscpd .', exitCode: 0 },
  security: { gatePassed: true, reason: 'passed', command: 'gitleaks-secret-scanner', exitCode: 0 },
};
const STATIC_SCAN_DUP_FAIL = {
  gatePassed: false,
  duplication: { gatePassed: false, reason: 'scan-failed', command: 'jscpd .', exitCode: 1 },
  security: { gatePassed: true, reason: 'passed', command: 'gitleaks-secret-scanner', exitCode: 0 },
};
const STATIC_SCAN_SECURITY_FAIL = {
  gatePassed: false,
  duplication: { gatePassed: true, reason: 'passed', command: 'jscpd .', exitCode: 0 },
  security: { gatePassed: false, reason: 'scan-failed', command: 'gitleaks-secret-scanner', exitCode: 1 },
};
const DUP_NA_GATED = '{ "dupCheckApplicability": "n/a", "dupCheckApplicabilityReason": "生成代码占比过高" }\n';
const SECURITY_NA_GATED = '{ "securityScanApplicability": "n/a", "securityScanApplicabilityReason": "离线环境无法拉取工具" }\n';
const DUP_EXEMPT_CONFIRM_PROCESS = [
  '---',
  'workflow_mode: full',
  'iterationType: greenfield',
  '---',
  '',
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 重复代码豁免 | 2026-01-01 | 生成代码占比过高，确认豁免重复代码检测门禁 |',
  '',
  '## 进度列表',
  '',
  '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
  '| ----------- | -------- | ---- | ---- |',
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '| 质量工程师 | T0-1 | 执行完成 | |',
  '',
].join('\n');
const SECURITY_EXEMPT_CONFIRM_PROCESS = [
  '---',
  'workflow_mode: full',
  'iterationType: greenfield',
  '---',
  '',
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 安全扫描豁免 | 2026-01-01 | 离线环境无法拉取工具，确认豁免安全静态扫描门禁 |',
  '',
  '## 进度列表',
  '',
  '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
  '| ----------- | -------- | ---- | ---- |',
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '| 质量工程师 | T0-1 | 执行完成 | |',
  '',
].join('\n');

export {
  R18_DIMS,
  makeCleanDplForSelftest,
  SELFTEST_REQ_LIST,
  SELFTEST_REQ_LIST_3P0,
  SELFTEST_DPL_CLEAN,
  SELFTEST_DPL_UNRESOLVED,
  SELFTEST_TECH_CONFIRM,
  liteModeConfirmSection,
  hotfixProcessBody,
  HOTFIX_STRUCTURED_API_STORAGE_REPORT,
  makeQeDispatchProcess,
  R14_PROGRESS_BATCH_DONE,
  API_REPORT_EMPTY,
  API_REPORT_FILLED,
  API_EXEMPT_CONFIRM_PROCESS,
  API_NA_GATED,
  STORAGE_RECON_HEADER,
  STORAGE_RECON_SEP,
  STORAGE_RECON_BOTH,
  STORAGE_RECON_API_ONLY,
  STORAGE_RECON_E2E_ONLY,
  STORAGE_RECON_BAD_MEDIUM,
  STORAGE_RECON_EMPTY,
  STORAGE_EXEMPT_CONFIRM_PROCESS,
  STORAGE_NA_GATED,
  R15_QE_DONE,
  LINT_PASS,
  LINT_FAIL,
  LINT_NA_GATED,
  LINT_EXEMPT_CONFIRM_PROCESS,
  R16_QE_DONE,
  STATIC_SCAN_PASS,
  STATIC_SCAN_DUP_FAIL,
  STATIC_SCAN_SECURITY_FAIL,
  DUP_NA_GATED,
  SECURITY_NA_GATED,
  DUP_EXEMPT_CONFIRM_PROCESS,
  SECURITY_EXEMPT_CONFIRM_PROCESS
};
