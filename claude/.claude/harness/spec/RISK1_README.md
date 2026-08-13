# 风险1优化 - 权限模式依赖防护（v2.1）

> **⚠️ 历史留痕（2026-08-06 交付期快照）**：本文的部署步骤以 `.claude/hooks/hooks.json`
> 与 `hooks-v2.1.json` 为对象，**这两个文件现已不存在**。Hook 注册的**唯一权威源是
> `.claude/settings.json`**，本方案的防护已随 `gate-dev-workflow-enhanced.mjs` 与
> `session-init-enhanced.mjs` 注册生效。本文仅作方案留痕，**不要照其步骤操作**。

## 🎯 优化概览

**目标**：消除 auto 权限模式绕过关键门禁的风险  
**成果**：风险等级从 🔴 6/10 降至 🟢 2/10  
**版本**：v2.1  
**状态**：✅ 已完成，可投产

---

## 📦 交付物清单

### 1. 核心防护模块
- **`.claude/hooks/lib/permission-mode-guard.mjs`**  
  核心逻辑：权限模式检测、严重程度评估、决策强化

### 2. 增强版 Hooks
- **`.claude/hooks/gate-dev-workflow-enhanced.mjs`**  
  文件写入拦截（集成权限模式防护）

- **`.claude/hooks/session-init-enhanced.mjs`**  
  会话初始化（auto 模式警告）

### 3. 工具脚本
- **`.claude/scripts/verify-permission-mode.mjs`**  
  审计报告生成器（检查配置、分析使用情况）

- **`.claude/scripts/test-permission-mode-guard.mjs`**  
  自动化测试（15项测试用例）

### 4. 配置文件
- **`.claude/hooks/hooks-v2.1.json`**  
  更新后的 hooks 配置

### 5. 文档
- **`RISK1_MITIGATION.md`** - 完整优化方案文档
- **`RISK1_QUICK_GUIDE.md`** - 5步快速实施指南
- **`RISK1_OPTIMIZATION_SUMMARY.md`** - 优化成果总结

---

## 🚀 快速开始（5分钟）

### 步骤1：验证文件
```bash
ls -la .claude/hooks/lib/permission-mode-guard.mjs
ls -la .claude/hooks/gate-dev-workflow-enhanced.mjs
ls -la .claude/scripts/verify-permission-mode.mjs
ls -la .claude/scripts/test-permission-mode-guard.mjs
```

### 步骤2：运行测试
```bash
node .claude/scripts/test-permission-mode-guard.mjs
```
期望输出：`✅ 所有测试通过！权限模式防护机制工作正常。`

### 步骤3：更新配置
```bash
cp .claude/hooks/hooks.json .claude/hooks/hooks.json.backup
cp .claude/hooks/hooks-v2.1.json .claude/hooks/hooks.json
```

### 步骤4：重启并验证
```bash
# 重启 Claude Code 会话
/clear

# 如果看到这个，说明成功了：
# ⚠️ 权限模式警告：检测到 auto 模式（如果你在 auto 模式）
# 或
# 📋 Harness Engineering v2.1 已加载（如果你在 default 模式）
```

### 步骤5：切换到推荐模式
```bash
# 方式1：快捷键
Shift+Tab

# 方式2：命令
/config permission_mode default
```

---

## 🔒 技术原理

### 防护机制

```
用户操作（Write/Edit/Bash/Agent）
    ↓
PreToolUse Hook 拦截
    ↓
检测权限模式（auto / default / careful）
    ↓
评估操作严重程度（critical / high / normal）
    ↓
[auto 模式 + critical/high] → ask 强制改为 deny
    ↓
返回决策 + 详细说明 + 切换指引
    ↓
记录审计日志
```

### 严重程度分级

| 级别 | 规则/操作 | auto 模式行为 |
|------|-----------|---------------|
| **critical** | R29, R10, R35, 工具链安装 | ask → **deny**（强制） |
| **high** | R5, R21, R28, R3, R9 | ask → **deny**（强制） |
| **normal** | 其他门禁 | ask → ask（保持，但警告） |

---

## 📊 效果对比

### 关键场景：修改门禁配置（R29）

**优化前（v2.0）**
```
auto 模式：
  Hook 返回 → ask
  Claude Code → 自动批准 ✅
  结果 → 文件被修改 ❌（高风险）
```

**优化后（v2.1）**
```
auto 模式：
  Hook 返回 → deny（强制）
  Claude Code → 操作被阻止 ❌
  用户看到 → 详细说明 + 切换指引
  结果 → 文件受保护 ✅（风险消除）
```

### 数据对比

| 指标 | v2.0 | v2.1 | 改善 |
|------|------|------|------|
| 风险等级 | 🔴 6/10 | 🟢 2/10 | **↓67%** |
| 关键门禁可绕过 | 是 | 否 | **✅** |
| 用户警告 | 无 | 多层 | **✅** |
| 审计追踪 | 无 | 完整 | **✅** |
| 自动化测试 | 0项 | 15项 | **✅** |

---

## 🧪 验证方法

### 自动化测试
```bash
node .claude/scripts/test-permission-mode-guard.mjs
```
期望：15/15 测试通过

### 手动验证：R29 保护测试
```bash
# 1. 切换到 auto 模式
/config permission_mode auto

# 2. 尝试修改门禁配置
# 对 Claude 说："请在 .claude/hooks/gate-dev-workflow.mjs 开头添加注释"

# 3. 期望行为：
# ❌ 操作被 deny（不是 ask）
# ✅ 错误消息包含 "[AUTO 模式保护]"
# ✅ 包含 "按 Shift+Tab" 等切换指引
```

### 审计报告
```bash
node .claude/scripts/verify-permission-mode.mjs
```
检查 auto 模式使用统计和警告历史

---

## 📚 文档导航

### 完整文档
- **[RISK1_MITIGATION.md](./RISK1_MITIGATION.md)**  
  完整优化方案（问题分析、多层防护、实施细节）

### 快速指南
- **[RISK1_QUICK_GUIDE.md](./RISK1_QUICK_GUIDE.md)**  
  5步实施清单、测试方法、故障排查

### 成果总结
- **[RISK1_OPTIMIZATION_SUMMARY.md](./RISK1_OPTIMIZATION_SUMMARY.md)**  
  架构图、效果对比、验收清单

### 代码文档
- **[permission-mode-guard.mjs](../hooks/lib/permission-mode-guard.mjs)**  
  核心逻辑实现（含完整注释）

---

## 💡 常见问题

### Q1: 为什么不推荐 auto 模式？
**A**: Harness Engineering 的某些门禁点（R29 自治资产、工具链安装、阻塞释放）需要用户明确决策。auto 模式会自动批准这些检查点，削弱保护效果。v2.1 已通过强制 deny 消除了这个风险，但仍建议使用 default 模式以获得最佳体验。

### Q2: 如果必须使用 auto 模式怎么办？
**A**: v2.1 已对 auto 模式做了加固：
- 关键门禁（critical/high）自动改为 deny
- 会话启动时显著警告
- 所有操作记录到审计日志
- 定期运行 `verify-permission-mode.mjs` 检查

### Q3: 优化会影响正常使用吗？
**A**: 不会。
- default/careful 模式：完全不受影响
- auto 模式：只有关键操作被强制 deny，附带详细说明
- 所有决策都有清晰的解决方案和切换指引

### Q4: 如何验证优化已生效？
**A**: 三步验证：
```bash
# 1. 运行测试
node .claude/scripts/test-permission-mode-guard.mjs

# 2. 切换到 auto 模式并重启
/config permission_mode auto
/clear

# 3. 应该看到警告消息
```

### Q5: 审计日志在哪里？
**A**: 
```
.claude/harness-state/
├── auto-mode-audit.jsonl          # auto 模式操作记录
└── permission-mode-warnings.jsonl # 警告历史
```

---

## 🔄 升级路径

### 从 v2.0 升级到 v2.1

**影响范围**：最小（向后兼容）

**变更内容**：
- 新增权限模式防护模块
- 增强 2 个 hooks（文件写入、会话初始化）
- 新增 2 个工具脚本（测试、审计）

**升级步骤**：
1. 复制新增文件到对应位置
2. 更新 hooks.json 配置
3. 重启会话验证

**回滚方案**：
```bash
# 恢复旧配置
cp .claude/hooks/hooks.json.backup .claude/hooks/hooks.json

# 重启会话
/clear
```

---

## 📈 持续改进

### 已完成 ✅
- [x] 核心防护模块实现
- [x] 多层警告机制
- [x] 审计日志系统
- [x] 自动化测试覆盖
- [x] 完整文档和指南

### 进行中 🔄
- [ ] 优化其他 hooks 到 enhanced 版本
- [ ] 收集用户反馈
- [ ] 性能优化

### 计划中 📋
- [ ] Git pre-commit hook 事后校验
- [ ] CI/CD 集成
- [ ] 自定义 criticality 规则配置
- [ ] Web 控制台（可视化审计）

---

## 🎓 最佳实践

### 推荐配置
```json
{
  "permission_mode": "default"
}
```

### 定期检查
```bash
# 每周运行一次
node .claude/scripts/verify-permission-mode.mjs
```

### 团队协作
- 在团队文档中说明推荐使用 default 模式
- 新成员入职时培训权限模式设置
- 定期审查审计日志，发现异常使用

---

## 🆘 故障排查

### 问题：测试失败
```bash
# 检查 Node.js 版本
node --version  # 需要 >= 18

# 检查文件权限
ls -la .claude/hooks/lib/permission-mode-guard.mjs
```

### 问题：会话启动无警告
```bash
# 确认配置已更新
cat .claude/hooks/hooks.json | grep "session-init-enhanced"

# 强制重启
/clear
```

### 问题：R29 保护未生效
```bash
# 检查 hook 配置
cat .claude/hooks/hooks.json | grep "gate-dev-workflow-enhanced"

# 检查权限模式
/config permission_mode
```

---

## 📞 支持

### 文档
- 完整方案：`RISK1_MITIGATION.md`
- 快速指南：`RISK1_QUICK_GUIDE.md`
- 优化总结：`RISK1_OPTIMIZATION_SUMMARY.md`

### 工具
- 测试脚本：`test-permission-mode-guard.mjs`
- 审计脚本：`verify-permission-mode.mjs`

### 社区
- GitHub Issues（如果开源）
- 团队内部技术支持

---

## ✅ 验收确认

实施完成后，请确认：

- [ ] 自动化测试全部通过（15/15）
- [ ] auto 模式下会话启动有警告
- [ ] auto 模式下 R29 操作被 deny
- [ ] 审计日志正常生成
- [ ] default 模式正常工作
- [ ] 团队成员已通知

**确认人**：_________________  
**确认日期**：_________________  
**签名**：_________________

---

**优化完成**：✅  
**版本**：v2.1  
**风险等级**：🟢 低风险（2/10）  
**投产状态**：可立即投产

---

_Harness Engineering v2.1 - 让 AI 编程更安全、更可靠_
