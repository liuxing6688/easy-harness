# 风险1优化 - 快速实施指南

> **⚠️ 历史留痕（2026-08-06 交付期快照）**：本文的实施步骤以 `.claude/hooks/hooks.json`
> 与 `hooks-v2.1.json` 为对象，**这两个文件现已不存在**。Hook 注册的**唯一权威源是
> `.claude/settings.json`**，本方案的防护已注册生效。本文仅作方案留痕，**不要照其步骤操作**。

## 🎯 目标

将"权限模式依赖"风险从 **🔴 高风险（6/10）** 降级到 **🟢 低风险（2/10）**

---

## 📋 实施清单（5步，约15分钟）

### ✅ 步骤1：验证核心模块（2分钟）

```bash
# 进入项目目录
cd claude/

# 检查新创建的文件
ls -la .claude/hooks/lib/permission-mode-guard.mjs
ls -la .claude/hooks/gate-dev-workflow-enhanced.mjs
ls -la .claude/hooks/session-init-enhanced.mjs
ls -la .claude/scripts/verify-permission-mode.mjs
ls -la .claude/scripts/test-permission-mode-guard.mjs
```

**期望结果**：所有文件都存在

---

### ✅ 步骤2：运行自动化测试（2分钟）

```bash
# 测试权限模式防护逻辑
node .claude/scripts/test-permission-mode-guard.mjs
```

**期望输出**：
```
═══════════════════════════════════════════════════════════════════
  权限模式防护机制测试
═══════════════════════════════════════════════════════════════════

📋 测试组1：权限模式检测
✅ PASS: 检测 auto 模式
✅ PASS: 检测 default 模式
...

═══════════════════════════════════════════════════════════════════
  测试结果
═══════════════════════════════════════════════════════════════════

✅ 通过：15 项
❌ 失败：0 项

✅ 所有测试通过！权限模式防护机制工作正常。
```

---

### ✅ 步骤3：备份并更新 hooks 配置（3分钟）

```bash
# 备份当前配置
cp .claude/hooks/hooks.json .claude/hooks/hooks.json.backup

# 查看新配置（可选）
cat .claude/hooks/hooks-v2.1.json

# 应用新配置
cp .claude/hooks/hooks-v2.1.json .claude/hooks/hooks.json
```

**关键变更**：
- `SessionStart` → 使用 `session-init-enhanced.mjs`
- `PreToolUse Write|Edit` → 使用 `gate-dev-workflow-enhanced.mjs`

---

### ✅ 步骤4：重启会话并验证（3分钟）

```bash
# 退出当前 Claude Code 会话
# 然后重新启动

claude

# 或如果已在会话中
/clear
```

**期望行为**：

#### 如果权限模式为 `default`：
```
📋 Harness Engineering v2.1 已加载

当前权限模式：✅ default（平衡模式，推荐）

🔒 技术强制门禁：
• PreToolUse - 文件写入拦截
...
```

#### 如果权限模式为 `auto`：
```
⚠️ 权限模式警告：检测到 auto 模式

Harness Engineering 规约在 auto 模式下的门禁效果会受到削弱。

建议立即切换到推荐模式：
• 按 Shift+Tab 快速切换
• 或运行：/config permission_mode default
```

---

### ✅ 步骤5：功能验证测试（5分钟）

#### 测试1：验证 auto 模式检测

```bash
# 设置为 auto 模式
/config permission_mode auto

# 重新启动会话
/clear
```

**期望**：应该看到显著的警告消息

---

#### 测试2：验证 R29 保护强化

创建一个临时测试：

```bash
# 在 auto 模式下
# 尝试让 Claude 修改门禁配置文件（应被 deny）
```

对 Claude 说：
> "请修改 .claude/hooks/gate-dev-workflow.mjs，在文件开头添加注释"

**期望行为**：
- 操作被 **deny**（而非 ask）
- 错误消息包含 `[AUTO 模式保护]` 或类似文案
- 包含切换权限模式的指引

---

#### 测试3：验证审计日志

```bash
# 查看 auto 模式操作记录
node .claude/scripts/verify-permission-mode.mjs
```

**期望输出**：
```
═══════════════════════════════════════════════════════════════════
  Harness Engineering - 权限模式审计报告
═══════════════════════════════════════════════════════════════════

📋 当前权限模式配置：
  ⚠️  auto       - .claude/settings.json

⚠️  **警告：检测到 auto 模式**

📊 Auto 模式使用统计（历史记录）：
  总操作次数：X
  ...
```

---

#### 测试4：切换回推荐模式

```bash
# 方式1：快捷键
# 按 Shift+Tab 多次，直到看到 "default"

# 方式2：命令
/config permission_mode default

# 方式3：配置文件
# 编辑 .claude/settings.json
{
  "permission_mode": "default"
}
```

---

## 🎉 验收标准

全部通过表示优化成功：

- [x] 所有自动化测试通过
- [x] `auto` 模式下会话启动时有警告
- [x] `auto` 模式下修改 R29 保护文件被 `deny`（而非 `ask`）
- [x] 审计日志正常记录
- [x] `default` 模式下正常工作

---

## 📊 优化效果对比

### 之前（v2.0）

| 场景 | auto 模式行为 | 风险 |
|------|--------------|------|
| 修改门禁配置 | ✅ ask → 自动批准 | ❌ 高 |
| 安装工具链 | ✅ ask → 自动批准 | ❌ 高 |
| 修改源码（R5） | ❌ deny | ✅ 安全 |

### 之后（v2.1）

| 场景 | auto 模式行为 | 风险 |
|------|--------------|------|
| 修改门禁配置 | ❌ ask → deny（强制） | ✅ 低 |
| 安装工具链 | ❌ ask → deny（强制） | ✅ 低 |
| 修改源码（R5） | ❌ deny | ✅ 安全 |

**结论**：关键漏洞已修复 ✅

---

## 🔧 故障排查

### 问题1：测试脚本失败

**症状**：`test-permission-mode-guard.mjs` 报错

**解决**：
```bash
# 检查 Node.js 版本（需要 >= 18）
node --version

# 检查模块导入路径
ls -la .claude/hooks/lib/permission-mode-guard.mjs
```

---

### 问题2：会话启动无警告

**症状**：auto 模式下没有看到警告

**可能原因**：
1. hooks.json 未更新
2. 会话未重启

**解决**：
```bash
# 1. 确认配置
cat .claude/hooks/hooks.json | grep "session-init-enhanced"

# 2. 强制重启
/clear

# 3. 检查权限模式
/config permission_mode
```

---

### 问题3：R29 保护未生效

**症状**：仍然可以修改门禁配置

**检查清单**：
- [ ] `gate-dev-workflow-enhanced.mjs` 是否在 hooks.json 中生效
- [ ] 是否导入了 `permission-mode-guard.mjs`
- [ ] 测试时是否真的在 auto 模式

---

## 📚 相关文档

- **完整方案**：`.claude/harness/spec/RISK1_MITIGATION.md`
- **测试脚本**：`.claude/scripts/test-permission-mode-guard.mjs`
- **审计脚本**：`.claude/scripts/verify-permission-mode.mjs`
- **核心模块**：`.claude/hooks/lib/permission-mode-guard.mjs`

---

## 💡 建议

### 立即行动
1. ✅ 完成上述5步实施
2. ✅ 验证所有测试通过
3. ✅ 将权限模式设置为 `default`

### 持续监控
1. 每周运行一次：`verify-permission-mode.mjs`
2. 检查审计日志：`.claude/harness-state/*.jsonl`
3. 如有团队成员使用 auto，提醒切换

### 可选增强
1. Git pre-commit hook 事后校验
2. CI/CD 中集成权限模式检查
3. 定期审计日志导出和分析

---

## ✅ 完成确认

实施完成后，请确认：

- [x] 风险等级：从 🔴 6/10 降至 🟢 2/10
- [x] 关键门禁在 auto 模式下强制 deny
- [x] 用户有明确的警告和指引
- [x] 操作可审计、可追溯

**优化成功！** 🎉
