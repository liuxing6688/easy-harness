# Harness Engineering 速查卡

**一页纸快速参考** - 打印或保存书签

---

## 🎯 4 个工作流模式

| 模式 | 一句话 | 耗时 | 触发条件 |
|------|--------|------|---------|
| `full` | 完整流程，适合新功能/改 Schema | 4 天 | 默认 / 改数据模型 / 新交互面 |
| `hotfix` | 快速修 Bug，已有设计 | 4 小时 | 修缺陷 + 已有 `detail-design-spec.md` |
| `single-task` | 功能增量，不改 Schema | 2.5 天 | 加功能 + 已有设计 + 不改 Schema |
| `docs-only` | 仅改文档 | 2 小时 | 只动 `docs/**/*.md` |

### 启动命令
```
使用 Harness Engineering 规约，按 [模式] 模式 [你的目标]
```

---

## 👥 7 个角色（按顺序）

```
PM (项目经理)        → 接收目标，确认模式，编排流程
   ↓
RA (需求分析师)      → 苏格拉底式提问，澄清需求
   ↓
SA (系统架构师)      → 技术选型，设计架构
   ↓
RR (需求评审专家)    → 12 维度审核设计
   ↓
DE (开发工程师)      → 写代码，通过门禁
   ↓
QE (质量工程师)      → 代码审查，质量报告
   ↓
TE (测试工程师)      → 执行测试，生成报告
```

**简化路径**:
- `hotfix`: PM → DE → QE → TE (单次)
- `docs-only`: PM 直接操作
- `single-task`: 完整链，测试单轮

---

## 🔒 4 个核心质量门禁

| 编号 | 名称 | 检查内容 | 命令 |
|------|------|---------|------|
| **R15** | Lint | 代码风格 + 语法 | `node .claude/scripts/lint-run.mjs` |
| **R16** | 静态扫描 | 重复率 < 5% + 安全漏洞 | `node .claude/scripts/static-scan-run.mjs` |
| **R32** | 启动冒烟 | 应用启动 + 强杀重启 | `node .claude/scripts/startup-smoke-run.mjs` |
| **R34** | 执行证明 | 测试真实运行证明 | `node .claude/scripts/e2e-run.mjs` |

**状态查看**: 检查 `docs/process/process.md` 的流程状态表

---

## 📁 核心文件路径

```
.claude/
├── CLAUDE.md                   # 完整规约（常驻）
├── agents/*.md                 # 7 个角色定义
├── hooks/*.mjs                 # 技术强制 Hooks
├── scripts/
│   ├── lint-run.mjs           # Lint 门禁
│   ├── static-scan-run.mjs    # 静态扫描门禁
│   ├── startup-smoke-run.mjs  # 启动冒烟门禁
│   ├── e2e-run.mjs            # E2E 测试门禁
│   ├── mode-wizard.mjs        # 模式选择向导
│   └── health-check.mjs       # 工具链健康检查
├── harness.config.json         # 门禁配置
└── harness-state.json          # 活跃流程指针

docs/
├── process/
│   └── process.md              # 流程记录（状态机）
├── requirement-spec.md         # 需求文档
├── detail-design-spec.md       # 设计文档
├── quality-report.md           # 质量报告
└── test-report.md              # 测试报告

test-results/
├── exec-proof/*.json           # 执行证明
├── recon/*.json                # 存储对账
└── startup-smoke/*.json        # 冒烟结果
```

---

## 🚨 常用命令

### 启动流程
```bash
# 在 Claude Code 中直接说
"使用 Harness Engineering 规约，按 hotfix 模式修复 [问题]"
```

### 健康检查
```bash
node .claude/scripts/health-check.mjs
# 检查工具链是否完整（ESLint, jscpd, Playwright 等）
```

### 模式选择向导
```bash
node .claude/scripts/mode-wizard.mjs
# 交互式问答，推荐最适合的工作流模式
```

### 手动运行门禁
```bash
# Lint 检查
node .claude/scripts/lint-run.mjs

# 静态扫描（重复率 + 安全）
node .claude/scripts/static-scan-run.mjs

# 启动冒烟测试
node .claude/scripts/startup-smoke-run.mjs

# E2E 测试
node .claude/scripts/e2e-run.mjs --scope=batch    # 批次测试
node .claude/scripts/e2e-run.mjs --scope=final    # 最终测试
```

### 初始化新 Feature
```bash
node .claude/scripts/bootstrap-docs.mjs --feature=user-auth
# 创建 docs/user-auth/ 目录结构
```

---

## 📋 决策树（30 秒选模式）

```
改什么？
├─ 只改文档 → docs-only
├─ 修 Bug
│  ├─ 有设计文档 → hotfix
│  └─ 无设计文档 → full
└─ 加功能
   ├─ 改数据库 Schema → full
   ├─ 新交互面（新页面/API） → full
   ├─ 有设计 + 不改 Schema → single-task
   └─ 无设计 → full
```

---

## ⚡ 核心规则（务必记住）

### R5: 角色分离
- 顶层代理不能写代码，必须通过 DE 角色
- PM 不能代写设计，必须通过 SA 角色

### R12: 只可加强，不可放松
- 不能关闭质量门禁
- 不能跳过必需的用户确认

### R20: 轻量模式必须确认
- 选择 hotfix/docs-only/single-task 必须用户确认
- 必须写入 `process.md` 的 `## 用户确认记录`

### R34: 执行证明
- 测试必须真实运行，不能伪造
- 每次改代码必须重新运行测试

---

## 🔧 故障排查

### 问题：工具链缺失
```bash
# 症状：门禁失败，提示工具未找到
# 解决：
node .claude/scripts/health-check.mjs --fix
# 或手动安装：
npm install -g eslint jscpd-rs playwright
```

### 问题：不知道选哪个模式
```bash
# 运行向导
node .claude/scripts/mode-wizard.mjs
```

### 问题：门禁不通过
```bash
# 查看详细错误
node .claude/scripts/[gate-name]-run.mjs

# 常见原因：
# - R15: 代码风格问题 → 运行 linter 自动修复
# - R16: 代码重复率 > 5% → 重构重复代码
# - R32: 启动失败 → 检查依赖和配置
```

### 问题：流程卡住了
```bash
# 查看当前状态
cat docs/process/process.md

# 检查是否有 blocking: true
# 解决用户确认后，PM 会继续推进
```

---

## 📊 成功指标

完成后检查这些：

- [ ] `docs/process/process.md` 有完整流程记录
- [ ] 所有门禁状态为 `✅ gatePassed: true`
- [ ] `docs/quality-report.md` 质量评分 ≥ 4/5
- [ ] `test-results/exec-proof/` 有最新测试证明
- [ ] 代码重复率 < 5%
- [ ] 无安全漏洞

---

## 🎓 进阶学习

| 需求 | 文档 |
|------|------|
| 15 分钟快速上手 | [QUICKSTART_15MIN.md](./QUICKSTART_15MIN.md) |
| 常见场景实战 | [SCENARIOS_HANDBOOK.md](./SCENARIOS_HANDBOOK.md) |
| 完整规约详解 | [CLAUDE.md](./CLAUDE.md) |
| 门禁机制详解 | [.claude/harness/spec/mechanical-gates.md](./.claude/harness/spec/mechanical-gates.md) |
| 工作流模式详解 | [.claude/harness/spec/workflow-modes.md](./.claude/harness/spec/workflow-modes.md) |

---

## 💡 一句话总结

> **小改动用 hotfix/single-task，大改动用 full，只改文档用 docs-only**

---

**打印提示**: 此页面设计为单页 A4 打印，建议缩放 90% 以适应边距  
**版本**: v2.0  
**最后更新**: 2026-08-10
