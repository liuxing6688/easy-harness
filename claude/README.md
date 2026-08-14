# Harness Engineering 规约 - Claude Code v2.0

> **✅ 技术强制版本 - 与 Cursor 对等的强制执行能力**
> 
> **🔒 核心保障**：7 个 Hook 脚本在操作执行前自动拦截，模型无法绕过
> 
> **📊 强制覆盖**：文件写入 + Shell 命令 + Agent 调用 + 回合结束 + 身份追踪

## 🎉 v2.0 重大升级（已完成）

✅ **技术强制已实现**：利用 Claude Code 的 Hook 机制，从 v1.0 的"自律约束"升级到完全的"技术强制"

✅ **官方能力验证**：
- [Claude Code Hooks 官方文档](https://code.claude.com/docs/en/hooks) 确认支持
- PreToolUse Hook 返回 `deny` 可直接阻止工具执行
- 实测证明模型无法绕过 Hook 决策

## 📚 快速导航

### 🚀 新用户入口
- **[15 分钟快速上手](./QUICKSTART_15MIN.md)** ⭐ 从零开始，15 分钟上手
- **[速查卡](./REFERENCE_CARD.md)** - 一页纸快速参考（打印/书签）
- **[场景手册](./SCENARIOS_HANDBOOK.md)** - 10 个实战案例

### 🔧 实用工具
- **模式选择向导** - 运行 `node .claude/scripts/mode-wizard.mjs`
- **工具链健康检查** - 运行 `node .claude/scripts/health-check.mjs`

### 核心文档
- **[CLAUDE.md](./CLAUDE.md)** - 顶层规约文档（v2.0 已更新）
- **[settings.json](./.claude/settings.json)** - Hook 配置（唯一权威源）

### Hook 脚本（7个，均已在 `.claude/settings.json` 注册）
- [gate-dev-workflow-enhanced.mjs](./.claude/hooks/gate-dev-workflow-enhanced.mjs) - 文件写入拦截（Write/Edit）
- [gate-dev-shell.mjs](./.claude/hooks/gate-dev-shell.mjs) - Shell 命令拦截
- [gate-toolchain-install.mjs](./.claude/hooks/gate-toolchain-install.mjs) - 工具链安装审批
- [gate-role-sequence.mjs](./.claude/hooks/gate-role-sequence.mjs) - Agent 调用拦截
- [gate-stop-workflow.mjs](./.claude/hooks/gate-stop-workflow.mjs) - 回合结束拦截
- [gate-subagent-track.mjs](./.claude/hooks/gate-subagent-track.mjs) - 子代理追踪
- [session-init-enhanced.mjs](./.claude/hooks/session-init-enhanced.mjs) - 会话初始化（含 auto 模式告警）

> **⚠️ `-enhanced` 才是生效的那份**：`gate-dev-workflow.mjs` 与 `session-init.mjs` 同名非 enhanced 文件仍在盘上，但**未在 `settings.json` 注册、不生效**。修改门禁行为必须改 `-enhanced` 变体，改错文件会「看起来改了却毫无效果」。

### 配置文件
- **[harness.config.json](./.claude/harness.config.json)** - 门禁配置

### 规则层（5个，路径触发）

位于 [.claude/rules/](./.claude/rules/)。Claude Code 原生机制：目录下**全部 `.md` 递归发现**，
frontmatter `paths` 决定何时注入；**无 `paths` 的规则随会话常驻**（与 `.claude/CLAUDE.md` 同优先级）。

| 规则 | 触发面 |
| ---- | ------ |
| `harness-process.md` | `docs/**/process.md`、`.claude/harness-state.json` |
| `harness-design-artifacts.md` | `docs/**/requirement/**`、`docs/**/design/**` |
| `harness-test-artifacts.md` | `docs/**/test/**`、`docs/**/quality/**`、`test-results/**`、`e2e/**` |
| `harness-source-code.md` | 常见源码目录与构建清单 |
| `harness-gate-assets.md` | `CLAUDE.md`、`.claude/{rules,hooks,scripts,agents,harness/spec}/**` 等门禁自治资产 |

> 规则层**只做指引与转述，不新增约束**；判定一律回到 Hook。规则文件本身属 **R29** `gate-config`
> （代理禁写，须用户本人落盘）。该目录**不要放 `README.md`**——无 `paths` 的 `.md` 会被当作常驻规则。
> 细则见 [mechanical-gates.md §8.9](./.claude/harness/spec/mechanical-gates.md)；
> 官方文档：https://code.claude.com/docs/en/memory#organize-rules-with-claude/rules/

### 角色定义（7个）
- [project-manager.md](./.claude/agents/project-manager.md)
- [requirements-analyst.md](./.claude/agents/requirements-analyst.md)
- [system-architect.md](./.claude/agents/system-architect.md)
- [requirement-reviewer.md](./.claude/agents/requirement-reviewer.md)
- [development-engineer.md](./.claude/agents/development-engineer.md)
- [quality-engineer.md](./.claude/agents/quality-engineer.md)
- [test-engineer.md](./.claude/agents/test-engineer.md)

### 规格说明（5个）
- [rule-index.md](./.claude/harness/spec/rule-index.md)
- [gate-chain.md](./.claude/harness/spec/gate-chain.md)
- [workflow-modes.md](./.claude/harness/spec/workflow-modes.md)
- [mechanical-gates.md](./.claude/harness/spec/mechanical-gates.md)
- [rollback.md](./.claude/harness/spec/rollback.md)

### 模板文件（9个）
位于 [.claude/templates/](./.claude/templates/) 目录

### 脚本文件（6个）
位于 [.claude/scripts/](./.claude/scripts/) 目录

## 🆚 v1.0 vs v2.0

| 特性 | v1.0（已废弃） | v2.0（当前版本） |
|------|----------------|------------------|
| 文件写入拦截 | ❌ 依赖自律 | ✅ **PreToolUse Hook 技术强制** |
| Shell 命令拦截 | ❌ 依赖自律 | ✅ **PreToolUse Hook 技术强制** |
| Agent 调用拦截 | ❌ PM 手动检查 | ✅ **PreToolUse Hook 技术强制** |
| 回合结束拦截 | ❌ 自检清单 | ✅ **Stop Hook 技术强制** |
| 子代理追踪 | ❌ 依赖自律 | ✅ **SubagentStart Hook 追踪** |
| 执行证明 | ❌ 无验证 | ✅ **R34 ed25519 签名验证** |
| 可绕过性 | 容易 | **极难（引擎层拦截）** |
| 与 Cursor 对比 | 弱于 | **✅ 对等** |

## 🔒 技术强制的关键约束

### 自动拦截的 R 规则

- **R5**: 角色职责分离 - 顶层写入源码被拦截
- **R10**: 流程终止冻结 - `cancelled: true` 后所有操作被拦截
- **R13**: 门禁链验证 - Agent 调用前自动检查前置条件
- **R15**: Lint 门禁 - QE 完成前必须通过
- **R16**: 静态扫描 - QE 完成前必须通过
- **R18**: 设计审核 - 未解决问题时无法派发 DE
- **R20**: 轻量模式确认 - 未确认时无法使用
- **R21**: 产品源码保护 - 非 DE 无法写入
- **R22**: TE 启动命令 - 禁止用替代命令
- **R26**: 技术选型确认 - 未确认时无法派发 RR
- **R27**: 需求摘要确认 - 未确认时无法派发 SA
- **R28**: Shell 写文件 - 按目标路径套用门禁
- **R29**: 门禁自治资产 - 任何代理都无法写入
- **R32**: 启动冒烟 - 最终测试前必须通过
- **R33**: 界面期望确认 - 未确认时无法派发 SA
- **R35**: 阻塞释放证据 - 解除阻塞须有用户确认

## 🚀 快速开始

### 第一次使用？

1. **阅读快速上手指南**（15 分钟）：[QUICKSTART_15MIN.md](./QUICKSTART_15MIN.md)
2. **运行工具链检查**：`node .claude/scripts/health-check.mjs`
3. **选择工作流模式**：`node .claude/scripts/mode-wizard.mjs`
4. **开始工作**：在 Claude Code 中说 `"使用 Harness Engineering 规约，按 [模式] 模式 [目标]"`

### 快速决策：选择工作流模式

不确定用哪个模式？运行交互式向导：
```bash
node .claude/scripts/mode-wizard.mjs
```

或参考决策树：

```
你的任务是什么？

├─ 新功能/新项目
│  └─ → full 模式（完整流程，默认）
│
├─ 修 bug
│  ├─ 已有设计文档 
│  │  └─ → hotfix 模式（须 R20 用户确认）
│  └─ 无设计文档
│     └─ → full 模式
│
├─ 在已有项目上加个小功能
│  ├─ 需要改数据模型/schema
│  │  └─ → full 模式
│  └─ 不改数据模型
│     └─ → single-task 模式（须 R20 用户确认）
│
└─ 只改文档
   └─ → docs-only 模式（须 R20 用户确认）
```

**💡 提示**：轻量模式（hotfix/single-task/docs-only）必须经过用户确认（R20），不能仅凭关键词自动生效。

### 启动命令模板
```
使用 Harness Engineering 规约，按 [模式] 模式 [你的目标]
```

**示例**：
- `"使用 Harness Engineering 规约，按 hotfix 模式修复登录按钮无响应问题"`
- `"使用 Harness Engineering 规约，按 full 模式创建用户管理模块"`
- `"使用 Harness Engineering 规约，按 single-task 模式添加导出 CSV 功能"`

### 1. 安装
整个 `claude/` 目录已包含所有必要文件。Hook 配置的**唯一权威源是 `.claude/settings.json`**，Claude Code 从该文件加载。

> **注意**：`.claude/hooks/hooks.json` **不是** Claude Code 支持的 Hook 配置位置——放在那里的配置永不加载。受支持位置只有 `~/.claude/settings.json`、`.claude/settings.json`、`.claude/settings.local.json`、受管策略设置、**插件的** `hooks/hooks.json`，以及 skill/agent frontmatter。本项目用 `.claude/settings.json`；`.claude/hooks/hooks.json` 已降级为说明性存档，不再生效。
>
> 路径占位符须写 `${CLAUDE_PROJECT_DIR}`（官方仅 `CLAUDE_PROJECT_DIR` / `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA`）。自造名不会被替换，会导致路径解析失败、Hook 静默不生效。
>
> 官方参考：https://code.claude.com/docs/en/hooks

### 2. 验证 Hook
```bash
# 查看生效的 Hook 配置（权威源）
cat .claude/settings.json

# 检查 Hook 脚本
ls -la .claude/hooks/*.mjs

# 运行期确认：Hook 是否真的被注册与触发
claude --debug
```
在 Claude Code 内也可用 `/hooks` 查看已注册的 Hook。

### 3. 使用
直接使用，Hook 会自动拦截违规操作：
- 尝试顶层写入源码 → 被拒绝
- 尝试在无成果物时派发角色 → 被拒绝
- 尝试在流程未完成时结束回合 → 被阻止

### 4. 调试

**查看 Hook 执行日志：**
```bash
# Hook 错误会输出到 stderr
# 查看最近的拒绝原因
tail -f ~/.claude/logs/hooks.log  # 如果 Claude 提供日志
```

**常见问题排查：**

| 问题 | 原因 | 解决方法 |
|------|------|---------|
| 写入被拒绝 | 顶层尝试写源码 | 通过对应角色 Agent 执行 |
| Agent 调用被拒绝 | 缺少前置成果物 | 检查 `permissionDecisionReason`，补齐前置 |
| 无法结束回合 | 流程未完成 | 查看 Stop Hook 的 `reason`，完成必需步骤 |
| Lint 失败 | 代码不符合规范 | 运行 `npm run lint` 查看具体错误 |
| 启动冒烟失败 | 应用启动失败 | 这是产品缺陷，需回派 DE 修复 |

**调试 Hook 脚本：**
```javascript
// 在 Hook 脚本中添加调试输出
console.error('[DEBUG] 当前路径:', filePath);
console.error('[DEBUG] 判定结果:', verdict);
```

## ⚙️ Hook 工作原理

### PreToolUse Hook
在工具执行**前**拦截：
```javascript
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask",
    "permissionDecisionReason": "原因说明"
  }
}
```

### Stop Hook
阻止回合结束：
```javascript
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "continue": false,  // false = 阻止结束
    "reason": "流程未完成"
  }
}
```

### 返回 deny 时
操作被直接阻止，Claude 收到拒绝原因并报告给用户。

## 📖 详细文档

### 必读
1. [CLAUDE.md](./CLAUDE.md) - 完整规约

### 理解 Hook
1. `.claude/settings.json` - Hook 配置（唯一权威源；`.claude/hooks/hooks.json` 已弃用）
2. `gate-dev-workflow-enhanced.mjs` - 文件写入拦截逻辑
3. `gate-role-sequence.mjs` - 门禁链验证逻辑

### 了解流程
1. `.claude/harness/spec/gate-chain.md` - 门禁链细则
2. `.claude/harness/spec/workflow-modes.md` - 工作流模式

## ⚠️ 重要提示

### ✅ Hook 技术强制的范围

**已自动拦截（无需自律）：**
- ✅ 顶层写入源码 → `gate-dev-workflow-enhanced.mjs` deny
- ✅ 非 DE 写入产品路径 → R21 自动 deny
- ✅ Shell 写文件到受门禁路径 → R28 自动解析并拦截
- ✅ 改写门禁配置 → R29 一律 deny
- ✅ 无前置成果物时派发角色 → R13 自动拒绝
- ✅ 流程未完成时结束回合 → Stop Hook 阻止
- ✅ 测试产物伪造 → R34 验签失败

**仍需配合自律（机械层设计约束）：**
1. **用户确认的真实性** - Hook 验证确认记录存在，但须真实使用 `AskUserQuestion`
2. **阻塞原因的实质性** - R35 验证释放证据，但人类起源证据的合理性需人工审查
3. **stop 预算耗尽** - `loop_limit: 3` 用尽后仍可结束，需配合回合自检

**关键区别**：这是能力边界的坦诚披露，**不是技术能力缺失**。详见 `CLAUDE.md` §3。

### 性能考虑
- Hook 脚本应快速执行（< 100ms）
- 避免在 Hook 中进行复杂计算
- 使用缓存减少重复读取

### 调试建议
- Hook 异常时会 fail-closed（拒绝操作）
- 查看 stderr 了解拒绝原因
- 使用 `console.error` 输出调试信息

## 🎯 与 Cursor 版本的对比

| 方面 | Cursor | Claude Code v2.0 |
|------|--------|------------------|
| 文件写入拦截 | preToolUse Hook | PreToolUse Hook ✅ |
| Shell 命令拦截 | beforeShellExecution Hook | PreToolUse Hook ✅ |
| 角色调用拦截 | preToolUse Hook | PreToolUse Hook ✅ |
| 回合结束拦截 | stop Hook | Stop Hook ✅ |
| 子代理追踪 | subagentStart Hook | SubagentStart Hook ✅ |
| 技术强制程度 | 极难绕过 | 极难绕过 ✅ |

**结论**：Claude Code v2.0 与 Cursor 版本达到对等的技术强制能力。

## 📝 版本历史

### v2.0（当前版本）- 2026-08-06
- ✅ 实现完整的 Hook 机制
- ✅ 技术强制约束
- ✅ 与 Cursor 对等
- ✅ 6 个核心 Hook 脚本
- ✅ 更新所有文档

### v1.0（已过时）- 2026-08-06
- ❌ 自律约束模式
- ❌ 无技术强制
- ❌ 需要主动自检
- **已被 v2.0 取代**

## 🤝 贡献指南

如发现问题或改进建议：
1. 检查是否违反 R12（只可加强，不可放松）
2. Hook 脚本修改需要同步更新文档
3. 保持与 Cursor 版本的语义一致性
4. 测试 Hook 的正确性和性能

## 📄 许可

遵循项目根目录的许可协议。

---

**版本**：v2.0 - 技术强制版  
**发布日期**：2026-08-06  
**兼容性**：与 Cursor 版本对等  
**升级亮点**：从自律约束升级到技术强制约束
