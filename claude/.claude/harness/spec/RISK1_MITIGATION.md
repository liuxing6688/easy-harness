# 风险1优化方案：权限模式依赖防护

> **⚠️ 历史留痕（2026-08-06 交付期快照）**：本文「步骤2：更新 hooks.json 配置」等部署章节
> 已过时——`.claude/hooks/hooks.json` 与 `hooks-v2.1.json` **现已不存在**，Hook 注册的
> **唯一权威源是 `.claude/settings.json`**，防护已注册生效。方案的**设计理据仍然有效**
> （为何 auto 模式下须把 ask 升级为 deny），但**部署步骤不要照做**。

## 问题描述

**原始风险**：用户在 `auto` 权限模式下，Claude Code 会自动批准所有操作，导致 Hook 返回的 `ask` 决策被自动接受，削弱规约门禁效果。

**风险场景**：
- R29 自治资产保护的 `ask` 决策被自动批准 → 代理可能改写门禁配置
- 工具链安装确认的 `ask` 决策被自动批准 → 未经用户同意安装软件
- R35 阻塞释放的 `ask` 决策被自动批准 → 绕过用户决策流程

## 优化方案（多层防护）

### 第1层：Hook 层强制 deny（核心防护）

#### 原理
在 Hook 脚本中检测当前权限模式，对关键决策点强制使用 `deny` 而非 `ask`。

#### 实现位置
- **核心模块**：`.claude/hooks/lib/permission-mode-guard.mjs`
- **应用位置**：所有 PreToolUse hooks
  - `gate-dev-workflow.mjs` → `gate-dev-workflow-enhanced.mjs`
  - `gate-dev-shell.mjs` 
  - `gate-toolchain-install.mjs`
  - `gate-role-sequence.mjs`

#### 决策强化逻辑

```javascript
// 严重程度分级
critical:  R29, R10, 工具链安装, 阻塞释放 → 强制 deny
high:      R5, R21, R28, R3, R9           → 强制 deny
normal:    其他门禁                        → 保持 ask + 警告
```

**关键点**：
- `auto` 模式下，`critical` 和 `high` 级别的 `ask` 决策改为 `deny`
- `deny` 决策附加详细说明和切换指引
- `additionalContext` 包含完整的解决方案

#### 代码示例

```javascript
// 使用强化决策
function deny(hookInput, reason, ruleId = null) {
  const criticality = assessCriticality(ruleId);
  const hardened = hardenDecisionForAutoMode(
    hookInput,
    'deny',
    reason,
    criticality
  );
  returnDecision(hardened.decision, hardened.reason, hardened.additionalContext);
}
```

### 第2层：会话启动警告

#### 实现位置
`session-init-enhanced.mjs` (替代原 `session-init.mjs`)

#### 功能
1. **会话启动时检测** `auto` 模式
2. **显著警告**：系统消息 + additionalContext
3. **记录到审计日志**：`.claude/harness-state/permission-mode-warnings.jsonl`

#### 警告内容

```
⚠️ 权限模式警告：检测到 auto 模式

Harness Engineering 规约在 auto 模式下的门禁效果会受到削弱。

建议立即切换到推荐模式：
• 按 Shift+Tab 快速切换
• 或运行：/config permission_mode default

影响说明：
- ❌ 关键门禁的 ask 决策会被自动批准
- ❌ R29 自治资产保护等需要用户明确决策的检查点将被绕过
- ✅ deny 决策仍然有效（会被阻止）
```

### 第3层：操作审计日志

#### 审计内容
所有在 `auto` 模式下触发门禁的操作都会记录到：
- **审计日志**：`.claude/harness-state/auto-mode-audit.jsonl`
- **警告日志**：`.claude/harness-state/permission-mode-warnings.jsonl`

#### 日志格式

```json
{
  "timestamp": "2026-08-07T10:30:00.000Z",
  "sessionId": "abc123",
  "toolName": "Write",
  "agentType": "development-engineer",
  "targetPath": "src/app.ts",
  "originalDecision": "ask",
  "hardenedDecision": "deny",
  "ruleId": "R29"
}
```

### 第4层：验证和审计脚本

#### 脚本位置
`.claude/scripts/verify-permission-mode.mjs`

#### 功能
1. 检查当前权限模式配置
2. 分析历史 `auto` 模式使用情况
3. 生成审计报告

#### 运行方式

```bash
# 检查权限模式配置
node .claude/scripts/verify-permission-mode.mjs

# 输出示例：
# ═══════════════════════════════════════════════════════════════════
#   Harness Engineering - 权限模式审计报告
# ═══════════════════════════════════════════════════════════════════
# 
# 📋 当前权限模式配置：
#   ⚠️  auto       - .claude/settings.json
# 
# ⚠️  **警告：检测到 auto 模式**
# 
# 📊 Auto 模式使用统计（历史记录）：
#   总操作次数：15
#   按工具分类：
#     Write: 10 次
#     Bash: 5 次
```

### 第5层：文档和用户指导

#### 更新位置
1. **README.md** - 添加权限模式推荐章节
2. **CLAUDE.md** - 在顶部添加权限模式说明
3. **V2_TECHNICAL_ENFORCEMENT.md** - 补充 auto 模式风险说明

#### 建议内容

```markdown
## ⚠️ 重要：权限模式配置

**推荐模式**：
- ✅ **default** - 平衡模式，关键操作需确认（推荐）
- ✅ **careful** - 谨慎模式，所有操作需确认

**不推荐**：
- ⚠️ **auto** - 自动批准模式

**为什么不推荐 auto？**
Harness Engineering 的某些门禁点（R29 自治资产、工具链安装、阻塞释放）
需要用户明确决策。auto 模式会自动批准这些检查点，削弱保护效果。

**如何切换**：
1. 快捷键：Shift+Tab
2. 命令：`/config permission_mode default`
3. 配置文件：`.claude/settings.json`
```

## 实施步骤

### 步骤1：部署核心防护模块

```bash
# 已创建的文件：
.claude/hooks/lib/permission-mode-guard.mjs           # 核心防护逻辑
.claude/hooks/gate-dev-workflow-enhanced.mjs          # 增强版文件门禁
.claude/hooks/session-init-enhanced.mjs               # 增强版会话初始化
.claude/scripts/verify-permission-mode.mjs            # 验证脚本
```

### 步骤2：更新 hooks.json 配置

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": [
              "${CLAUDE_PROJECT_ROOT}/.claude/hooks/session-init-enhanced.mjs"
            ]
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": [
              "${CLAUDE_PROJECT_ROOT}/.claude/hooks/gate-dev-workflow-enhanced.mjs"
            ]
          }
        ]
      }
      // ... 其他 hooks 保持不变
    ]
  }
}
```

### 步骤3：更新文档

在 `README.md` 顶部添加：

```markdown
## ⚠️ 使用前必读：权限模式配置

**强烈推荐使用 `default` 或 `careful` 权限模式，不要使用 `auto` 模式。**

详见下方"权限模式说明"章节。
```

### 步骤4：测试验证

```bash
# 1. 测试 auto 模式检测
claude --permission-mode=auto
# 应该看到会话启动时的警告

# 2. 测试关键门禁强化
# 尝试修改 .claude/hooks/gate-dev-workflow.mjs
# 应该被 deny 而非 ask

# 3. 查看审计报告
node .claude/scripts/verify-permission-mode.mjs
```

## 防护效果对比

### 优化前

| 操作 | 原决策 | auto 模式结果 | 风险 |
|------|--------|---------------|------|
| 修改门禁配置 | `ask` | ✅ 自动批准 | ❌ 高风险 |
| 安装工具链 | `ask` | ✅ 自动批准 | ❌ 高风险 |
| 阻塞释放 | `ask` | ✅ 自动批准 | ❌ 高风险 |
| 角色路径冲突 | `deny` | ❌ 拒绝 | ✅ 安全 |

### 优化后

| 操作 | 原决策 | auto 模式结果 | 防护效果 |
|------|--------|---------------|----------|
| 修改门禁配置 | `ask` → `deny` | ❌ 强制拒绝 | ✅ 已防护 |
| 安装工具链 | `ask` → `deny` | ❌ 强制拒绝 | ✅ 已防护 |
| 阻塞释放 | `ask` → `deny` | ❌ 强制拒绝 | ✅ 已防护 |
| 角色路径冲突 | `deny` | ❌ 拒绝 | ✅ 安全 |

## 残留风险评估

### 风险1：用户坚持使用 auto 模式
**概率**：低  
**影响**：中  
**缓解**：
- 会话启动时的显著警告
- 关键门禁强制 deny
- 操作记录到审计日志

### 风险2：绕过 Hook（理论上）
**概率**：极低  
**影响**：高  
**缓解**：
- Hook 在引擎层执行，模型无法绕过
- Git pre-commit hook 事后校验（可选）

### 风险3：审计日志被删除
**概率**：低  
**影响**：低（不影响门禁执行）  
**缓解**：
- `.gitignore` 已排除审计日志
- 可选：定期备份到外部存储

## 总结

### 优化前风险等级：🔴 高（6/10）
- auto 模式可绕过关键确认点
- 无审计追踪
- 无用户警告

### 优化后风险等级：🟢 低（2/10）
- 关键门禁在 auto 模式下强制 deny
- 完整审计日志
- 多层警告机制
- 验证脚本支持

### 残留风险：可接受
- 用户明确选择 auto 模式后的自担风险
- 非关键门禁仍可能被自动批准（设计意图）
- 有完整审计追踪和事后检查能力

---

**建议**：立即部署此优化方案，将风险1从"高风险"降级为"可接受风险"。
