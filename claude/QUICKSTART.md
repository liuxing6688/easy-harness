# Claude Code 版本快速开始指南

本指南帮助你快速开始使用 Claude Code 适配版的 Harness Engineering 规约。

---

## ✅ 前置条件

- [x] 已安装 Claude Code (CLI/Desktop/IDE 扩展)
- [x] 项目已使用 Git 管理
- [x] Node.js >= 18.0.0

---

## 🚀 快速验证

### 1. 验证核心库

```bash
cd claude
node test-hooks-lib.mjs
```

**预期输出**:
```
✓ workflow-gate-lib.mjs loaded
✓ All core functions exported
✓ Path adaptation successful - using .claude directory
✓ All tests passed!
```

### 2. 运行自测 (可选)

```bash
node .claude/scripts/gate-selftest.mjs
```

**预期结果**: `422 passed, 0 failed` (100% 通过率)

---

## 📦 在新项目中使用

### 方法 1: 完整复制 (推荐)

```bash
# 1. 复制 .claude 目录到你的项目根目录
cp -r easy-harness/claude/.claude /path/to/your-project/

# 2. 复制文档
cp easy-harness/claude/CLAUDE.md /path/to/your-project/

# 3. Claude Code 会自动检测并加载 hooks
```

### 方法 2: 符号链接 (开发模式)

```bash
# 在你的项目根目录创建符号链接
ln -s /path/to/easy-harness/claude/.claude .claude
ln -s /path/to/easy-harness/claude/CLAUDE.md CLAUDE.md
```

---

## 🔧 配置项目

### 1. 初始化 process.md

```bash
cd your-project
mkdir -p docs/process
cp .claude/templates/process.md docs/process/
```

### 2. 配置 gated-artifacts.json

```bash
mkdir -p docs/design
cat > docs/design/gated-artifacts.json << 'EOF'
{
  "description": "项目级门禁配置",
  "extraSourceDirs": [],
  "extraBuildManifests": [],
  "extraTestConfigs": [],
  "extraRootPatterns": [],
  "extraShellPatterns": []
}
EOF
```

### 3. 验证配置

```bash
# Claude Code 会在启动时加载配置
claude
```

---

## 🎯 使用流程

### Greenfield 项目完整流程

```bash
# 1. 启动 Claude Code
claude

# 2. 由 PM 初始化流程
"请作为 project-manager 初始化项目流程"

# 3. 派发需求分析
"派发 requirements-analyst 进行需求分析"

# 4. 后续流程自动执行门禁验证
# - 角色权限自动校验
# - 成果物路径自动验证
# - 测试门禁自动触发
```

### Hotfix 流程

```bash
# 1. 在 process.md 设置
workflow_mode: hotfix

# 2. 获取用户确认
# hooks 会要求 PM 通过 AskQuestion 确认

# 3. 简化流程自动生效
# - 豁免设计审核
# - 折叠测试通道
```

---

## 🛡️ 门禁验证

### 自动触发的门禁

Claude Code 会在以下时机自动触发门禁验证：

1. **PreToolUse Write|Edit**
   - ✅ 路径权限验证 (R6)
   - ✅ 角色权限验证 (R5)
   - ✅ 成果物前置条件 (R3, R9)

2. **PreToolUse Bash|PowerShell**
   - ✅ Shell 命令门禁
   - ✅ 工具链安装拦截 (R27)

3. **PreToolUse Agent**
   - ✅ 角色派发前置条件 (R13)
   - ✅ 门禁链顺序验证

4. **Stop**
   - ✅ 流程完整性验证
   - ✅ 测试门禁 (R14-R17, R32)

### 手动触发验证

```bash
# 运行 lint 门禁
node .claude/scripts/lint-run.mjs

# 运行静态扫描
node .claude/scripts/static-scan-run.mjs

# 运行启动冒烟
node .claude/scripts/startup-smoke-run.mjs

# 运行 E2E 测试
node .claude/scripts/e2e-run.mjs
```

---

## 🔍 故障排查

### 问题 1: Hooks 未加载

**症状**: 门禁不生效，没有拦截提示

**解决**:
```bash
# 1. 检查 hooks.json 是否存在
ls .claude/hooks/hooks.json

# 2. 检查 Claude Code 日志
# 终端模式: 查看 stderr 输出
# Desktop/IDE: 查看开发者工具控制台

# 3. 验证 hooks 配置格式
cat .claude/hooks/hooks.json | jq .
```

### 问题 2: 路径权限被拒

**症状**: Write 工具被拒，提示 "路径不在允许范围"

**解决**:
```bash
# 1. 检查路径是否在 sourceDirs 中
# 编辑 .claude/harness.config.json

# 2. 或在 gated-artifacts.json 添加
{
  "extraSourceDirs": ["your-custom-dir"]
}
```

### 问题 3: 角色权限被拒

**症状**: "当前角色不允许修改此路径"

**解决**:
```bash
# 1. 检查当前是否在正确的角色中
# PM 应使用 Task 工具派发角色

# 2. 查看 process.md 中的分派计划
cat docs/process/process.md | grep "当前分派计划"
```

### 问题 4: 测试门禁失败

**症状**: Stop hook 阻止收尾，要求运行测试

**解决**:
```bash
# 1. 运行缺失的测试
node .claude/scripts/lint-run.mjs        # R15
node .claude/scripts/static-scan-run.mjs # R16
node .claude/scripts/startup-smoke-run.mjs # R32

# 2. 检查测试结果
cat test-results/lint/.lint-*.json
cat test-results/startup-smoke/.startup-smoke-*.json

# 3. 确认 gatePassed: true
```

---

## 📚 核心概念

### 工作流模式

| 模式 | 说明 | 用途 |
|------|------|------|
| `full` | 完整流程 | 新功能、重构 |
| `hotfix` | 热修复 | 紧急 bug 修复 |
| `docs-only` | 仅文档 | 文档更新 |
| `single-task` | 增量迭代 | 小功能、优化 |

**注意**: 轻量模式 (hotfix/docs-only/single-task) 需要用户确认 (R20)

### 角色与权限

| 角色 | 简称 | 权限范围 |
|------|------|---------|
| project-manager | PM | process.md, 流程控制 |
| requirements-analyst | RA | docs/**/requirement/** |
| system-architect | SA | docs/**/design/**, gated-artifacts.json |
| development-engineer | DE | src/**, 产品代码 |
| test-engineer | TE | e2e/**, test-results/** |
| quality-engineer | QE | docs/**/quality/**, 质量报告 |

### 关键规则速查

| 规则 | 名称 | 触发时机 |
|------|------|---------|
| **R5** | 顶层会话身份 | 每次 Agent 调用 |
| **R6** | 路径门禁 | 每次 Write/Edit |
| **R27** | 工具链拦截 | npm install, winget install 等 |
| **R34** | 执行证明 | 读取 test-results/** |
| **R35** | 阻塞释放证据 | process.md blocking: true |
| **R36** | 门禁异常裁决 | 判定期异常 |

---

## 🎓 学习资源

### 必读文档

1. **CLAUDE.md** - 完整规约说明
2. **.claude/harness/spec/gate-chain.md** - 门禁链详解
3. **.claude/harness/spec/mechanical-gates.md** - 机械门禁判据
4. **.claude/harness/spec/workflow-modes.md** - 工作流模式

### 测试示例

查看 `.claude/scripts/tests/scenarios/` 了解完整流程示例：
- `greenfield.mjs` - 新建项目完整流程
- `feature.mjs` - 功能迭代
- `hotfix.mjs` - 热修复流程

---

## 🆘 获取帮助

### 查看文档

```bash
# 查看规约
cat CLAUDE.md

# 查看门禁说明
cat .claude/harness/spec/mechanical-gates.md

# 查看测试说明
cat .claude/scripts/tests/selftest/README.md
```

### 调试 Hooks

```bash
# 启用详细日志
export DEBUG=1
claude

# 查看 hook 执行情况
# hooks 会在 stderr 输出调试信息
```

### 运行自测

```bash
# 验证所有规则
node .claude/scripts/gate-selftest.mjs

# 运行特定场景
node .claude/scripts/tests/scenarios/greenfield.mjs
```

---

## ✅ 检查清单

启用前请确认：

- [ ] `.claude/` 目录已复制到项目根目录
- [ ] `CLAUDE.md` 已复制到项目根目录
- [ ] `docs/process/process.md` 已初始化
- [ ] `docs/design/gated-artifacts.json` 已配置
- [ ] Claude Code 已检测到 hooks (启动时有提示)
- [ ] 核心库加载测试通过 (`node test-hooks-lib.mjs`)

---

## 🎉 开始使用

一切就绪！现在可以启动 Claude Code 并按规约流程工作：

```bash
claude
> 请作为 project-manager 开始初始化项目流程
```

---

**版本**: Claude Code Adaptation v1.0  
**最后更新**: 2026-08-06  
**文档**: 更多详情请参阅 CLAUDE.md
