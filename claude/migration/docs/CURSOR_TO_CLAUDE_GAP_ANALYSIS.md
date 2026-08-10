# Cursor 到 Claude 规约适配差距分析报告

**生成时间**: 2026-08-06  
**分析范围**: `cursor/` vs `claude/` 目录完整对比

---

## 执行摘要

**结论**: ❌ **cursor/ 规约内容未完全适配到 claude/**

**关键发现**:
- cursor/ 包含 **103 个文件**，claude/ 仅包含 **42 个文件**
- 缺失 **~5500 行核心 hooks 库代码** (`hooks/lib/` 目录)
- 缺失 **完整的测试框架** (selftest + scenarios，共 40+ 测试文件)
- 缺失 **rules 规则系统** (2 个 .mdc 规则文件)
- 缺失 **skills 技能系统** (project-retrospective)
- 缺失 **关键模板文件** (gated-artifacts.json)

**影响评估**: 🔴 **严重**
- claude/ 目前缺少技术强制执行能力的核心实现
- 无法进行完整的门禁自测和场景验证
- 缺少模块化的 hooks 库，维护性受限

---

## 详细差异清单

### 1. 🔴 hooks/lib 核心库 (完全缺失)

**影响**: 门禁逻辑实现的核心代码库不存在

| 文件 | 行数估算 | 职责 |
|------|---------|------|
| `hooks/lib/README.md` | - | 架构说明 |
| `hooks/lib/all.mjs` | ~50 | 统一导出 |
| `hooks/lib/core.mjs` | ~800 | 路径常量、配置、R35 阻塞释放、R36 异常裁决 |
| `hooks/lib/execproof.mjs` | ~400 | R34 执行证明签发/验签/新鲜度 |
| `hooks/lib/paths.mjs` | ~600 | R10 取消、路径门禁、R28/R29/R34/R36 |
| `hooks/lib/identity.mjs` | ~300 | R5 顶层会话 id、TTL、健康度 |
| `hooks/lib/role-path.mjs` | ~500 | 角色权限、B1 进度统计 |
| `hooks/lib/iteration.mjs` | ~900 | R3/R9/R19/R33/R34/R37/R38 迭代判据 |
| `hooks/lib/design.mjs` | ~500 | R18/R25/R31 设计审核、热修、回退 |
| `hooks/lib/qe.mjs` | ~700 | R14–R17/R22/R32 质量/测试门禁 |
| `hooks/lib/dispatch.mjs` | ~400 | R13 角色派发、R37 状态机 |
| **总计** | **~5,500 行** | **完整门禁逻辑实现** |

**cursor/ 路径**: `cursor/.cursor/hooks/lib/*.mjs`  
**claude/ 状态**: ❌ 整个目录不存在

**适配建议**: 必须移植或重写全部模块

---

### 2. 🔴 测试框架 (完全缺失)

#### 2.1 自测套件 (selftest/)

**影响**: 无法验证规约实现的正确性

cursor/ 包含 26 个自测文件，覆盖规则 R3–R38 和关键机制：

| 测试文件 | 覆盖规则 | claude/ 状态 |
|----------|---------|-------------|
| `tests/selftest/r5-identity.mjs` | R5 身份识别 | ❌ 不存在 |
| `tests/selftest/r15-lint.mjs` | R15 lint 门禁 | ❌ 不存在 |
| `tests/selftest/r32-startup-smoke.mjs` | R32 启动冒烟 | ❌ 不存在 |
| `tests/selftest/r34-exec-proof.mjs` | R34 执行证明 | ❌ 不存在 |
| `tests/selftest/r35-blocking-evidence.mjs` | R35 阻塞释放证据 | ❌ 不存在 |
| `tests/selftest/r36-gate-exception.mjs` | R36 门禁异常旁路 | ❌ 不存在 |
| `tests/selftest/r37-single-task.mjs` | R37 增量范围 | ❌ 不存在 |
| `tests/selftest/r38-tool-unavailable.mjs` | R38 工具不可用 | ❌ 不存在 |
| ... 其他 18 个测试 | ... | ❌ 不存在 |

**入口脚本**: `cursor/.cursor/scripts/gate-selftest.mjs` (claude/ ❌)

#### 2.2 场景测试 (scenarios/)

**影响**: 无法验证端到端工作流

cursor/ 包含 11 个场景测试：

| 场景 | 说明 | claude/ 状态 |
|------|------|-------------|
| `greenfield.mjs` | 新建项目完整流程 | ❌ 不存在 |
| `feature.mjs` | 功能迭代 | ❌ 不存在 |
| `hotfix.mjs` | 热修复流程 | ❌ 不存在 |
| `lint-gate.mjs` | lint 门禁场景 | ❌ 不存在 |
| `startup-smoke.mjs` | 启动冒烟场景 | ❌ 不存在 |
| ... 其他 6 个场景 | ... | ❌ 不存在 |

**入口脚本**: `cursor/.cursor/scripts/gate-scenarios.mjs` (claude/ ❌)

---

### 3. 🟡 hooks 文件差异

#### 3.1 缺失的 hooks

| 文件 | 职责 | 影响 |
|------|------|------|
| `gate-toolchain-install.mjs` | R27 工具链安装拦截 | 🔴 中等 - 无法控制工具链安装权限 |
| `workflow-gate-lib.mjs` | 统一导出 hooks/lib/* | 🔴 高 - 其他 hooks 依赖此库 |

#### 3.2 hooks.json 格式差异

- **cursor/**: 使用 Cursor 原生格式 (`preToolUse`, `beforeShellExecution` 等)
- **claude/**: 使用 Claude Code 格式 (`PreToolUse`, `PostToolUse`, `SessionStart` 等)
- **状态**: ✅ 已适配格式，但功能覆盖不完整

**关键差异**:
```json
// cursor/ 有但 claude/ 没有的 hook 绑定：
{
  "beforeShellExecution": [
    {
      "command": "node .cursor/hooks/gate-toolchain-install.mjs"  // ❌ claude/ 缺失
    }
  ]
}
```

---

### 4. 🔴 rules 规则系统 (完全缺失)

**影响**: 缺少上下文感知的规则提醒

| 文件 | 触发范围 | 职责 | claude/ 状态 |
|------|---------|------|-------------|
| `rules/harness-test-artifacts.mdc` | 测试/QE 产物目录 | 提醒 R14–R17/R34/R38 | ❌ 不存在 |
| `rules/harness-process.mdc` | `docs/**/process.md` | 提醒门禁链/模式细则 | ❌ 不存在 |

**cursor/ 路径**: `cursor/.cursor/rules/*.mdc`  
**说明**: 这些规则通过 Cursor 的 rules 系统在编辑特定文件时自动加载

---

### 5. 🔴 skills 技能系统 (完全缺失)

**影响**: 缺少项目复盘能力

| 技能 | 说明 | claude/ 状态 |
|------|------|-------------|
| `skills/project-retrospective/SKILL.md` | 项目复盘流程 (Phase 1–3) | ❌ 不存在 |
| `skills/project-retrospective/audit-checklist.md` | 合规审计清单 | ❌ 不存在 |

**功能**: 
- 对已完成项目进行合规评估
- 产出规约改进建议并执行
- 运行框架回归测试

---

### 6. 🟡 scripts 脚本差异

#### 6.1 缺失的核心脚本

| 脚本 | 职责 | 影响 |
|------|------|------|
| `gate-selftest.mjs` | 运行全部自测 | 🔴 高 - 无法验证框架正确性 |
| `gate-scenarios.mjs` | 运行全部场景测试 | 🔴 高 - 无法验证端到端流程 |
| `qe-run.mjs` | 质量工程运行器 | 🔴 中 - R14–R17 执行缺失 |

#### 6.2 缺失的库文件

| 文件 | 职责 | claude/ 状态 |
|------|------|-------------|
| `e2e-run-lib.mjs` | E2E 运行逻辑 | ❌ 不存在 (只有 e2e-run.mjs) |
| `e2e-run-lib.test.ts` | E2E 库单测 | ❌ 不存在 |
| `lint-run-lib.mjs` | lint 运行逻辑 | ❌ 不存在 (只有 lint-run.mjs) |
| `startup-smoke-lib.mjs` | 启动冒烟逻辑 | ❌ 不存在 (只有 startup-smoke-run.mjs) |
| `startup-smoke-lib.test.ts` | 启动冒烟库单测 | ❌ 不存在 |
| `static-scan-run-lib.mjs` | 静态扫描逻辑 | ❌ 不存在 (只有 static-scan-run.mjs) |
| `tool-availability-lib.mjs` | R38 工具可用性检测 | ❌ 不存在 |
| `vitest.config.ts` | 测试配置 | ❌ 不存在 |

**说明**: claude/ 只有单体脚本，缺少库化拆分和单元测试

---

### 7. 🟡 templates 差异

| 文件 | 职责 | claude/ 状态 |
|------|------|-------------|
| `gated-artifacts.json` | R29 项目级门禁强度旋钮 | ❌ 不存在 |

**影响**: 🔴 高 - 系统架构师无法配置项目特定的门禁路径

**cursor/ 内容**: 包含 `extraSourceDirs`, `e2eApplicability`, `productionStartupCommand` 等关键字段

---

### 8. 🟢 harness.config.json 差异

**状态**: ✅ 基本一致

**唯一差异**:
```json
// cursor/.cursor/harness.config.json:
"dotCursorExemptPatterns": [...]

// claude/.claude/harness.config.json:
"dotClaudeExemptPatterns": [...]
+ "_claudeCodeNotes": {
    "hookAdaptation": "Claude Code does not support Cursor-style hooks...",
    ...
  }
```

**说明**: claude/ 已将路径从 `.cursor` 改为 `.claude`，并添加了适配说明

---

### 9. ⚪ 文档与辅助文件

#### 9.1 claude/ 独有文件 (适配过程产物)

这些是适配工作的文档，不属于规约本身：

- `HOOKS_ADAPTATION_V1.md.bak`
- `HOOKS_IMPLEMENTATION_PLAN.md`
- `ADAPTATION_PROGRESS_V1.md.bak`
- `COMPLETION_REPORT_V1.md.bak`
- `COMPLETION_SUCCESS.md`
- `FINAL_REPORT.md`
- `V2_TECHNICAL_ENFORCEMENT.md`
- `scripts/batch-adapt.mjs` (适配工具)

#### 9.2 cursor/ 独有根目录文件

- `AGENTS.md` - 顶层规约文档 (claude/ 有 `CLAUDE.md` 作为对应)
- `README.md` - 安装与使用说明
- `.gitignore`
- `e2e/specs/README.md`
- `playwright.config.ts`

---

## 关键规则覆盖对比

### ✅ 已适配的核心规则 (文档层)

通过对比 `cursor/AGENTS.md` 和 `claude/CLAUDE.md`，已适配的规则：

- R1–R13: 基础流程、角色、门禁链
- R14–R17: QE 质量门禁 (文档已适配)
- R18–R25: 设计审核相关
- R27–R33: 工具链、Shell、启动冒烟 (文档已适配)

### ❌ 实现层缺失的关键规则

这些规则在文档中可能已描述，但**缺少技术强制实现**：

| 规则 | 说明 | cursor/ 实现位置 | claude/ 状态 |
|------|------|-----------------|-------------|
| **R34** | 执行证明 (execProof) | `hooks/lib/execproof.mjs` | ❌ 无实现 |
| **R35** | 阻塞释放证据 | `hooks/lib/core.mjs` | ❌ 无实现 |
| **R36** | 门禁异常旁路台账 | `hooks/lib/core.mjs`, `hooks/lib/paths.mjs` | ❌ 无实现 |
| **R37** | 增量范围与增量档 | `hooks/lib/iteration.mjs` | ❌ 无实现 |
| **R38** | 工具不可用判定 | `hooks/lib/iteration.mjs`, `scripts/tool-availability-lib.mjs` | ❌ 无实现 |
| **R5** | 顶层会话身份 | `hooks/lib/identity.mjs` | ❌ 无实现 |
| **R27** | 工具链安装拦截 | `hooks/gate-toolchain-install.mjs` | ❌ 无实现 |

---

## 适配路径建议

### 方案 A: 完整移植 (推荐)

**目标**: 将 cursor/ 的全部内容适配到 claude/

**步骤**:

1. **Phase 1: 核心库移植** (P0)
   - 移植 `hooks/lib/*.mjs` (5500 行)
   - 适配 Claude Code 的 hooks 调用方式
   - 补齐 `gate-toolchain-install.mjs`
   - 估时: 3-5 天

2. **Phase 2: 测试框架移植** (P0)
   - 移植 `scripts/tests/selftest/*.mjs` (26 个文件)
   - 移植 `scripts/tests/scenarios/*.mjs` (11 个文件)
   - 移植测试运行器 `gate-selftest.mjs`, `gate-scenarios.mjs`
   - 估时: 2-3 天

3. **Phase 3: 脚本库化** (P1)
   - 拆分 `*-run.mjs` 为 `*-run-lib.mjs` + 入口
   - 补齐 `tool-availability-lib.mjs`
   - 补齐单元测试 `.test.ts`
   - 估时: 2-3 天

4. **Phase 4: 辅助系统** (P2)
   - 移植 `rules/*.mdc`
   - 移植 `skills/project-retrospective/`
   - 补齐 `templates/gated-artifacts.json`
   - 估时: 1-2 天

**总估时**: 8-13 天

---

### 方案 B: 最小可行适配

**目标**: 仅移植关键规则的技术强制实现

**范围**:
- ✅ `hooks/lib/execproof.mjs` (R34)
- ✅ `hooks/lib/identity.mjs` (R5)
- ✅ `hooks/gate-toolchain-install.mjs` (R27)
- ✅ `templates/gated-artifacts.json` (R29)
- ✅ 核心自测 (r34, r35, r36, r38)

**跳过**:
- ❌ 完整测试套件
- ❌ 场景测试
- ❌ skills 系统

**估时**: 3-5 天

**风险**: 部分规则只有文档约束，缺少技术强制

---

### 方案 C: 文档标注 (不推荐)

**目标**: 不移植代码，仅在文档中标注差异

**操作**:
- 在 `claude/CLAUDE.md` 中为 R34/R35/R36/R37/R38 添加 "⚠️ 当前依赖自律，无技术强制" 标注
- 补充 "与 cursor/ 差异说明" 章节

**估时**: 半天

**风险**: 🔴 高 - 规约失去技术强制能力，退化为纯文档约束

---

## 优先级建议

### P0 (阻塞性缺失)

1. **hooks/lib 核心库** - 门禁逻辑的技术实现基础
2. **R34 执行证明** - 防止伪造测试结论的核心机制
3. **templates/gated-artifacts.json** - 项目配置必需

### P1 (显著影响)

4. **自测框架** - 验证规约正确性的唯一手段
5. **R5 身份识别** - 多轮对话跟踪
6. **R27 工具链拦截** - 控制环境修改

### P2 (体验增强)

7. **场景测试** - 端到端验证
8. **rules 系统** - 上下文提醒
9. **skills/project-retrospective** - 复盘能力

---

## 结论与建议

### 当前状态评估

- ✅ **文档层**: 基本完成适配 (`CLAUDE.md` vs `AGENTS.md`)
- ✅ **配置层**: 格式已适配 (`hooks.json`, `harness.config.json`)
- ⚠️ **脚本层**: 部分脚本已移植，但缺少库化
- ❌ **实现层**: 核心 hooks 库完全缺失 (5500 行代码)
- ❌ **测试层**: 测试框架完全缺失 (37 个测试文件)

### 下一步行动

**推荐执行方案 A (完整移植)**，理由：

1. **技术强制是 Harness 的核心价值** - 没有 hooks/lib，规约退化为纯文档
2. **测试是唯一的正确性保证** - 没有自测，无法验证适配的正确性
3. **当前 git 状态干净** - 适合大规模移植工作

**立即行动项**:

1. 创建任务清单 (使用本报告 §适配路径建议 中的步骤)
2. 从 P0 优先级开始逐项移植
3. 每完成一个 Phase，运行对应的测试验证
4. 最终运行完整的 `gate-selftest.mjs` + `gate-scenarios.mjs` 确认适配成功

---

## 附录：完整文件清单对比

### cursor/ 独有文件 (共 61 个)

**hooks/lib/** (12 个):
- README.md, all.mjs, core.mjs, design.mjs, dispatch.mjs, execproof.mjs, identity.mjs, iteration.mjs, paths.mjs, qe.mjs, role-path.mjs

**hooks/** (2 个):
- gate-toolchain-install.mjs, workflow-gate-lib.mjs

**rules/** (2 个):
- harness-process.mdc, harness-test-artifacts.mdc

**scripts/** (7 个):
- e2e-run-lib.mjs, e2e-run-lib.test.ts, gate-scenarios.mjs, gate-selftest.mjs, lint-run-lib.mjs, qe-run.mjs, startup-smoke-lib.mjs, startup-smoke-lib.test.ts, static-scan-run-lib.mjs, tool-availability-lib.mjs, vitest.config.ts

**scripts/tests/selftest/** (26 个):
- README.md, _fixtures.mjs, _harness.mjs, b1-taskpack.mjs, blocking-failopen.mjs, gated-artifacts-config.mjs, r10-cancel.mjs, r11-hotfix-fold.mjs, r13-dispatch.mjs, r13-qe.mjs, r14-api-test.mjs, r15-lint.mjs, r16-static-scan.mjs, r17-storage-recon.mjs, r18-design-review.mjs, r20-lite-mode.mjs, r28-r31-hardening.mjs, r3-artifacts.mjs, r32-startup-smoke.mjs, r33-ui-expectation.mjs, r34-exec-proof.mjs, r35-blocking-evidence.mjs, r36-gate-exception.mjs, r37-single-task.mjs, r38-tool-unavailable.mjs, r5-identity.mjs, r6-paths.mjs, r9-hotfix-design.mjs, r9-soft-reminder.mjs, run-all.mjs, te-smoke.mjs, templates-vs-gates.mjs, unresolved-issues.mjs

**scripts/tests/scenarios/** (12 个):
- README.md, _harness.mjs, adversarial.mjs, audit-fixes.mjs, feature.mjs, finding1.mjs, greenfield.mjs, hardening.mjs, hotfix.mjs, lint-gate.mjs, r5-conversation.mjs, run-all.mjs, startup-smoke.mjs, static-scan-gate.mjs, te-smoke.mjs

**scripts/tests/** (1 个):
- exec-proof-fixture.mjs

**skills/project-retrospective/** (2 个):
- SKILL.md, audit-checklist.md

**templates/** (1 个):
- gated-artifacts.json

**根目录** (4 个):
- AGENTS.md, README.md, .gitignore, playwright.config.ts, e2e/specs/README.md

### claude/ 独有文件 (共 8 个)

**适配过程文档** (7 个):
- HOOKS_ADAPTATION_V1.md.bak, HOOKS_IMPLEMENTATION_PLAN.md, ADAPTATION_PROGRESS_V1.md.bak, COMPLETION_REPORT_V1.md.bak, COMPLETION_SUCCESS.md, FINAL_REPORT.md, V2_TECHNICAL_ENFORCEMENT.md

**适配工具** (1 个):
- scripts/batch-adapt.mjs

---

**报告结束**
