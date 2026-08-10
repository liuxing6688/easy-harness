/**
 * 场景套件：门禁约束演示（DEMO1–DEMO7）
 * 目的：真实模拟开发场景，验证规约门禁能否有效约束违规操作
 *
 * 测试覆盖：
 * - R10: 已取消流程的冻结
 * - R5: 顶层代理直接写源码的拦截
 * - R29: 门禁自治资产的保护
 * - R3: 缺少成果物时的拦截
 * - R13: 角色派发的前置条件校验
 */
import {
  REQ_SPEC,
  REQ_LIST,
  DESIGN_SPEC,
  TASK_LIST,
  DPL_CLEAN,
  GATED_EMPTY,
  writeFixture,
  check,
  clearDispatchedRoles,
  relToProject,
  path,
  fs
} from './_harness.mjs';

export function gateEnforcementDemo() {
  console.log('\n=== 门禁约束演示测试 ===\n');
  console.log('测试目标：验证规约门禁能否有效约束开发中的违规操作\n');

  clearDispatchedRoles();

  // ========================================
  // 场景 1: R10 - 尝试在已取消的流程上继续工作
  // ========================================
  console.log('📋 场景 1: R10 - 已取消流程的冻结');
  const cancelledProcess = `---
workflow_mode: full
iterationType: greenfield
cancelled: true
blocking: false
---

# 项目流程记录

## 项目目标
测试项目（已取消）

## 进度列表
| 角色 | 任务名称 | 状态 | 开始时间 | 完成时间 |
|------|---------|------|---------|---------|
| 项目经理 | 项目初始化 | 执行完成 | 2024-01-01 | 2024-01-01 |

## 当前分派计划
无
`;

  const root1 = writeFixture('cancelled', {
    'docs/process/process.md': cancelledProcess,
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
  });
  const proc1 = relToProject(path.join(root1, 'docs/process/process.md'));

  check('DEMO1-1 已取消流程：禁止写入源码', 'deny', {
    hook: 'write',
    filePath: 'src/app.js',
    processPath: proc1,
    expectedReason: /R10.*cancelled|流程已取消/i
  });

  check('DEMO1-2 已取消流程：禁止派发开发工程师', 'deny', {
    hook: 'role',
    role: 'development-engineer',
    processPath: proc1,
    expectedReason: /R10.*cancelled|流程已取消/i
  });

  console.log('✅ R10 验证完成：已取消流程被成功冻结\n');

  // ========================================
  // 场景 2: R5 - 顶层代理直接写源码
  // ========================================
  console.log('📋 场景 2: R5 - 顶层代理身份约束');

  const normalProcess = `---
workflow_mode: full
iterationType: greenfield
cancelled: false
blocking: false
---

# 项目流程记录

本次已产出 requirement-spec.md、requirement-list.md、detail-design-spec.md、develop-task-list.md。

## 用户确认记录
| 确认项 | 时间 | 用户原话摘要 |
|--------|------|-------------|
| 需求确认 | 2024-01-02 | 确认需求摘要，符合预期 |
| 技术选型确认 | 2024-01-03 | 确认采用 Node.js + Express + PostgreSQL |
| 界面与交互期望 | 2024-01-03 | 采用现代简洁风格，参考 GitHub 注册流程 |

## 当前分派计划
| 任务包编号 | 分派角色 | 并行/串行 | 状态 |
|-----------|---------|----------|------|
| A-USER-1 | development-engineer | 串行 | 待开发 |

## 待派发角色列表
| 角色 | 说明 |
|------|------|
| development-engineer | A-USER-1 |

## 进度列表
| 角色/开发线 | 任务名称 | 状态 | 说明 |
|-----------|---------|------|------|
| 项目经理 | 项目初始化 | 执行完成 | |
| 需求分析师 | 需求分析 | 执行完成 | |
| 系统架构师 | 系统设计 | 执行完成 | |
| 需求评审专家 | 设计审核 | 执行完成 | |

## 阻塞原因
无
`;

  // 用于测试顶层代理拦截的 process（无派发计划）
  const noDispatchProcess = `---
workflow_mode: full
iterationType: greenfield
cancelled: false
blocking: false
---

# 项目流程记录

本次已产出 requirement-spec.md、requirement-list.md、detail-design-spec.md、develop-task-list.md。

## 用户确认记录
| 确认项 | 时间 | 用户原话摘要 |
|--------|------|-------------|
| 需求确认 | 2024-01-02 | 确认需求摘要，符合预期 |
| 技术选型确认 | 2024-01-03 | 确认采用 Node.js + Express + PostgreSQL |
| 界面与交互期望 | 2024-01-03 | 采用现代简洁风格，参考 GitHub 注册流程 |

## 当前分派计划
| 任务包编号 | 分派角色 | 并行/串行 | 状态 |
|-----------|---------|----------|------|

## 待派发角色列表
| 角色 | 说明 |
|------|------|

## 进度列表
| 角色/开发线 | 任务名称 | 状态 | 说明 |
|-----------|---------|------|------|
| 项目经理 | 项目初始化 | 执行完成 | |
| 需求分析师 | 需求分析 | 执行完成 | |
| 系统架构师 | 系统设计 | 执行完成 | |
| 需求评审专家 | 设计审核 | 执行完成 | |

## 阻塞原因
无
`;

  const root2 = writeFixture('top-level', {
    'docs/process/process.md': noDispatchProcess,
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
  });
  const proc2 = relToProject(path.join(root2, 'docs/process/process.md'));

  check('DEMO2-1 顶层代理：禁止直接写源码', 'deny', {
    hook: 'write',
    filePath: 'src/user/register.js',
    processPath: proc2,
    agentId: null, // 模拟顶层代理（无 agentId）
    expectedReason: /R5.*顶层|不得直接写入|分派计划/i
  });

  const root2b = writeFixture('with-dispatch', {
    'docs/process/process.md': normalProcess,
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
  });
  const proc2b = relToProject(path.join(root2b, 'docs/process/process.md'));

  check('DEMO2-2 子代理(DE)：允许写源码', 'allow', {
    hook: 'write',
    filePath: 'src/user/register.js',
    processPath: proc2b,
    // 不传 conversationId，依赖派发记录判定（C4 模式）
    agentType: 'development-engineer'
  });

  console.log('✅ R5 验证完成：顶层代理被成功约束\n');

  // ========================================
  // 场景 3: R29 - 门禁自治资产保护
  // ========================================
  console.log('📋 场景 3: R29 - 门禁自治资产保护');

  check('DEMO3-1 禁止修改：hooks.json', 'deny', {
    hook: 'write',
    filePath: '.claude/hooks.json',
    processPath: proc2,
    agentId: 'agent-123',
    agentType: 'development-engineer',
    expectedReason: /R29.*自治资产|门禁配置/i
  });

  check('DEMO3-2 禁止修改：harness.config.json', 'deny', {
    hook: 'write',
    filePath: '.claude/harness.config.json',
    processPath: proc2,
    agentId: 'agent-123',
    agentType: 'development-engineer',
    expectedReason: /R29.*自治资产|门禁配置/i
  });

  check('DEMO3-3 禁止修改：CLAUDE.md', 'deny', {
    hook: 'write',
    filePath: 'CLAUDE.md',
    processPath: proc2,
    agentId: 'agent-123',
    agentType: 'development-engineer',
    expectedReason: /R29.*自治资产|权威文档/i
  });

  console.log('✅ R29 验证完成：门禁配置被成功保护\n');

  // ========================================
  // 场景 4: R3 - 缺少成果物时的拦截
  // ========================================
  console.log('📋 场景 4: R3 - 成果物完整性校验');

  const incompleteProcess = `---
workflow_mode: full
iterationType: greenfield
cancelled: false
blocking: false
---

# 项目流程记录

## 项目目标
开发用户管理系统

## 当前分派计划
| 角色 | 任务包编号 | 任务描述 | 预计工作量 |
|------|-----------|---------|-----------|
| 开发工程师 | A-USER-1 | 用户注册功能 | 2天 |
`;

  const root4 = writeFixture('incomplete', {
    'docs/process/process.md': incompleteProcess,
    // 故意缺少 requirement-spec.md 等文件
  });
  const proc4 = relToProject(path.join(root4, 'docs/process/process.md'));

  check('DEMO4-1 缺少成果物：禁止写源码', 'deny', {
    hook: 'write',
    filePath: 'src/user.js',
    processPath: proc4,
    agentId: 'agent-123',
    agentType: 'development-engineer',
    expectedReason: /R3.*成果物|缺少必要/i
  });

  console.log('✅ R3 验证完成：成果物完整性被成功校验\n');

  // ========================================
  // 场景 5: R13 - 角色派发前置条件
  // ========================================
  console.log('📋 场景 5: R13 - 角色派发门禁链');

  const noConfirmProcess = `---
workflow_mode: full
iterationType: greenfield
cancelled: false
blocking: false
---

# 项目流程记录

## 项目目标
开发 API 网关

## 进度列表
| 角色 | 任务名称 | 状态 | 开始时间 | 完成时间 |
|------|---------|------|---------|---------|
| 项目经理 | 项目初始化 | 执行完成 | 2024-01-01 | 2024-01-01 |
| 需求分析师 | 需求分析 | 执行完成 | 2024-01-02 | 2024-01-02 |

## 用户确认记录
| 确认项 | 时间 | 用户原话摘要 |
|--------|------|-------------|
| 需求确认 | 2024-01-02 | 确认需求摘要 |
`;

  const root5 = writeFixture('no-ui-confirm', {
    'docs/process/process.md': noConfirmProcess,
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
  });
  const proc5 = relToProject(path.join(root5, 'docs/process/process.md'));

  check('DEMO5-1 缺少界面期望确认：禁止派发架构师', 'deny', {
    hook: 'role',
    role: 'system-architect',
    processPath: proc5,
    expectedReason: /R33.*界面.*期望|用户确认/i
  });

  console.log('✅ R13/R33 验证完成：角色派发前置条件被成功校验\n');

  // ========================================
  // 场景 6: 正常流程 - 验证放行路径
  // ========================================
  console.log('📋 场景 6: 正常流程验证（应该全部放行）');

  // DEMO6-1: 开发工程师写源码的 process
  const validProcessDev = `---
workflow_mode: full
iterationType: greenfield
cancelled: false
blocking: false
---

# 项目流程记录

本次已产出 requirement-spec.md、requirement-list.md、detail-design-spec.md、develop-task-list.md。

## 用户确认记录
| 确认项 | 时间 | 用户原话摘要 |
|--------|------|-------------|
| 需求确认 | 2024-01-02 | 确认需求摘要，包括任务增删改查功能 |
| 技术选型确认 | 2024-01-03 | 确认采用 React + Node.js + MongoDB 技术栈 |
| 界面与交互期望 | 2024-01-03 | 界面参考 Trello，卡片式布局，拖拽排序 |

## 当前分派计划
| 任务包编号 | 分派角色 | 并行/串行 | 状态 |
|-----------|---------|----------|------|
| A-TASK-1 | development-engineer | 串行 | 待开发 |

## 待派发角色列表
| 角色 | 说明 |
|------|------|
| development-engineer | A-TASK-1 |

## 进度列表
| 角色/开发线 | 任务名称 | 状态 | 说明 |
|-----------|---------|------|------|
| 项目经理 | 项目初始化 | 执行完成 | |
| 需求分析师 | 需求分析 | 执行完成 | |
| 系统架构师 | 系统设计 | 执行完成 | |
| 需求评审专家 | 设计审核 | 执行完成 | |

## 阻塞原因
无
`;

  // DEMO6-2: 质量工程师派发的 process
  const validProcess = `---
workflow_mode: full
iterationType: greenfield
cancelled: false
blocking: false
---

# 项目流程记录

本次已产出 requirement-spec.md、requirement-list.md、detail-design-spec.md、develop-task-list.md。

## 用户确认记录
| 确认项 | 时间 | 用户原话摘要 |
|--------|------|-------------|
| 需求确认 | 2024-01-02 | 确认需求摘要，包括任务增删改查功能 |
| 技术选型确认 | 2024-01-03 | 确认采用 React + Node.js + MongoDB 技术栈 |
| 界面与交互期望 | 2024-01-03 | 界面参考 Trello，卡片式布局，拖拽排序 |

## 当前分派计划
| 任务包编号 | 分派角色 | 并行/串行 | 状态 |
|-----------|---------|----------|------|
| A-TASK-1 | quality-engineer | 串行 | 待审核 |

## 待派发角色列表
| 角色 | 说明 |
|------|------|
| quality-engineer | A-TASK-1 |

## 进度列表
| 角色/开发线 | 任务名称 | 状态 | 说明 |
|-----------|---------|------|------|
| 项目经理 | 项目初始化 | 执行完成 | |
| 需求分析师 | 需求分析 | 执行完成 | |
| 系统架构师 | 系统设计 | 执行完成 | |
| 需求评审专家 | 设计审核 | 执行完成 | |
| 开发工程师 | A-TASK-1 任务创建功能 | 执行完成 | |

## 阻塞原因
无
`;

  const root6Dev = writeFixture('valid-dev', {
    'docs/process/process.md': validProcessDev,
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const proc6Dev = relToProject(path.join(root6Dev, 'docs/process/process.md'));

  const root6 = writeFixture('valid', {
    'docs/process/process.md': validProcess,
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const proc6 = relToProject(path.join(root6, 'docs/process/process.md'));

  check('DEMO6-1 正常流程：允许开发工程师写源码', 'allow', {
    hook: 'write',
    filePath: 'src/task/create.js',
    processPath: proc6Dev,
    // 不传 conversationId，依赖派发记录判定
    agentType: 'development-engineer'
  });

  check('DEMO6-2 正常流程：允许派发质量工程师', 'allow', {
    hook: 'role',
    role: 'quality-engineer',
    processPath: proc6
  });

  check('DEMO6-3 正常流程：允许写文档', 'allow', {
    hook: 'write',
    filePath: 'docs/design/api-spec.md',
    processPath: proc6,
    agentId: 'agent-sa-1',
    agentType: 'system-architect'
  });

  console.log('✅ 正常流程验证完成：合法操作被正确放行\n');

  // ========================================
  // 测试总结
  // ========================================
  console.log('='.repeat(60));
  console.log('📊 门禁约束演示测试总结');
  console.log('='.repeat(60));
  console.log('测试场景：');
  console.log('  ✓ R10: 已取消流程冻结');
  console.log('  ✓ R5:  顶层代理身份约束');
  console.log('  ✓ R29: 门禁自治资产保护');
  console.log('  ✓ R3:  成果物完整性校验');
  console.log('  ✓ R13: 角色派发前置条件');
  console.log('  ✓ 正常流程验证');
  console.log('\n如果以上测试通过，说明规约门禁能够有效约束开发流程。');
  console.log('='.repeat(60));
}
