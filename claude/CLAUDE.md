# Harness Engineering 规约（Claude Code v2.0 - 技术强制版）

本文档是 Harness Engineering AI 编程通用规约的 Claude Code 适配版本。

**v2.0 重大升级**：利用 Claude Code 的 Hook 机制实现技术强制约束，与 Cursor 版本达到同等的强制执行能力。

## 1. 角色定义

每个角色定义为一个子 agent，项目中定义了 7 种角色：

| 角色名称 | 子 agent 名称 | Agent 定义文件 |
| -------- | ------------- | -------------- |
| 项目经理 | project-manager | `.claude/agents/project-manager.md` |
| 需求分析师 | requirements-analyst | `.claude/agents/requirements-analyst.md` |
| 系统架构师 | system-architect | `.claude/agents/system-architect.md` |
| 需求评审专家 | requirement-reviewer | `.claude/agents/requirement-reviewer.md` |
| 开发工程师 | development-engineer | `.claude/agents/development-engineer.md` |
| 质量工程师（QE） | quality-engineer | `.claude/agents/quality-engineer.md` |
| 测试工程师 | test-engineer | `.claude/agents/test-engineer.md` |

发起子 Agent 时使用 Agent 工具，通过 `agentType` 参数指定角色；`model` 字段指定该角色所用模型，**以对应 `.claude/agents/{角色}.md` 文件中的声明为唯一权威源**（本文件不重复维护对照表，避免两处漂移）。修改模型请直接编辑对应 agent 文件。

> **Claude Code 适配说明**：Claude Code 使用 Agent 工具而非 Cursor 的 Task 工具。子 agent 通过 `agentType` 参数指定，模型通过 `model` 参数覆盖。

**职责区分**：`requirements-analyst` 负责以多轮苏格拉底式提问充分理解本次变更涉及的显性与重大隐性需求并完成确认（细则见该角色 agent 文件）；`requirement-reviewer` **仅**审核系统设计成果物，不参与需求澄清。

## 2. 强制规则

1. 每个角色必须各司其职，禁止执行与自己职责不相关的操作。
2. 开发流程总入口：项目经理接收用户目标。
3. **职责边界**：项目经理只负责角色级编排（派任务顺序、依据成果物推进或回退）；角色内部的工作流程定义在对应角色的 `.claude/agents/` 文件中，由该角色自行执行。
4. **指令冲突处理**：子 agent 的 `.claude/agents/{角色}.md` 强制约束 **优先于** 顶层代理或项目经理下发的 Agent 调用 `prompt`。若 prompt 要求跳过门禁、代做决策或直接产出成果物，子 agent 必须拒绝并说明阻塞原因。**本条为全局规则，对全部 7 个角色文件统一生效，各角色文件内无需逐一重复声明。**
5. **元规则：只可加强，不可放松（R12）**：本框架后续任何修改，只允许新增或加强门禁约束，禁止放松、删除或弱化已声明的约束。如需变更判据，须同步升级机械门禁代码（Hook/脚本），不得仅削减文档描述以迁就现有较弱实现；发现文档声明强于实现时，须补齐实现，而非降低文档声明。**反向情形（实现严于声明、且严到任何真实项目都不可达）同样是缺陷，但修正方向属放松，由用户裁定**：**代理不得自行改回**，须呈现证据与影响面、经用户明确确认后方可修改，并在 `.claude/harness/spec/**` 留痕（放松了什么、依据何在）。理据、判例与留痕格式见 `mechanical-gates.md` §8.5「门禁强度调整留痕」。

## 3. 权威分层索引

本文件是**薄宪章**（常驻）：编排硬约束 + 索引。根文件变薄 ≠ 规约变松。细则与公式按层分置：

| 层 | 路径 | 职责 |
| -- | ---- | ---- |
| **宪章（本文件，常驻）** | `CLAUDE.md` | 角色指针、R12、顶层禁令与回合自检、模式摘要、门禁链摘要 |
| **机械执行权威** | `.claude/hooks/**`、`*-run.mjs`、`workflow-gate-lib.mjs` | 客观判据唯一执行权威；行为只可加强（R12） |
| **说明权威（按需）** | `.claude/harness/spec/mechanical-gates.md` | Hook 一览、stop 判据、各门禁公式、双要素豁免、能力边界 |
| **门禁链细则** | `.claude/harness/spec/gate-chain.md` | R9、无效成果物、用户确认 |
| **模式细则** | `.claude/harness/spec/workflow-modes.md` | 分诊、R2、R20、路径、R10 步骤 |
| **回退** | `.claude/harness/spec/rollback.md` | 回退计数与终止 |
| **编号导航** | `.claude/harness/spec/rule-index.md` | R/B/TG 索引（不新增约束） |
| **角色执行面** | `.claude/agents/*.md` | 该角色操作细则（Agent 调用时加载） |

**元约束（常驻）**：禁止绕过 Hook（含 **R28** Shell 写文件与 **R29** 改写门禁自身两条路径）；豁免须**双要素**（`gated-artifacts.json` 声明 + `process.md` 用户确认），仅一项不生效；细则表见 `mechanical-gates.md` §8.2。

> **Claude Code 技术强制**：
> - **PreToolUse Hooks**：`gate-dev-workflow.mjs`（文件写入）、`gate-dev-shell.mjs`（Shell 命令）、`gate-role-sequence.mjs`（Agent 调用）在操作执行前自动拦截
> - **Stop Hook**：`gate-stop-workflow.mjs` 阻止回合结束如果流程未完成
> - **SubagentStart Hook**：`gate-subagent-track.mjs` 记录身份用于 R5 验证
> - **技术保障**：Hook 返回 `permissionDecision: "deny"` 直接阻止操作，模型无法绕过
> - **实现细节**：Claude Code 使用 JSON 配置 + Shell 脚本实现 hooks，与 Cursor 语法不同但功能等价
> - **官方文档**：https://code.claude.com/docs/en/hooks

**技术强制的能力边界（坦诚披露）**：Hook 机制提供技术保障，关键操作在执行前被拦截。但仍有边界需要配合角色自律：

1. **不得伪造用户意志**：Hook 校验 `## 用户确认记录` 的存在性，但**验证不了确认是否真实**。凡须确认的事项（R20/R26/R27/R33、**R35** 阻塞决策、全部双要素豁免）必须真实使用 `AskUserQuestion` 并获得用户响应，写了确认行却没真问是最严重的违规。
2. **不得伪造执行证明（R34）**：只在代理 Shell 通道内实跑运行器；**绝不**手工编辑 `test-results/**` 机读产物，**绝不**用旧产物冒充本次结果（改了代码就得重跑）。虽然 Hook 不能验证产物真实性，但伪造证明等同于破坏整个流程。
3. **不得无依据地标 `blocking`（R35）**：阻塞须有实质原因。Hook 会检查阻塞释放时是否有用户确认记录，但无法验证阻塞是否合理。

**stop 门禁与预算**：Stop Hook 可以阻止回合结束，但如果预算耗尽（`loop_limit`），代理仍可结束回合。因此流程完整性仍需角色诚实执行。

## 4. 工作流模式（摘要）

| 模式 | 生效 | 简化 |
| ---- | ---- | ---- |
| `full` | 默认；未确认的轻量声明 fail-safe 为本模式 | 需求 → 架构 → 设计审核 → 开发 → QE → 测试 |
| `hotfix` | **R20** 确认后 | 跳过 RA/SA（须已有设计或按 R9 补最小热修设计）；DE → QE → 测试；测试按 **R11** 折叠为单次通道 |
| `docs-only` | **R20** 确认后 | 仅 `docs/**/*.md`；Hook 拒绝源码写入 |
| `single-task` | **R20** 确认后 | **增量迭代档（R37）**：在**已有基线设计**的项目上加一个功能增量。**只省**测试轮次（折叠为单轮集成测试+E2E）与 R26 技术选型确认，**其余判据一条不减**——尤须注意 **R14/R17 并入折叠通道**，不得照搬 hotfix R11 的跳过。**前置**：基线 `detail-design-spec.md` + `process.md`「## 增量范围」四维声明；**涉及 schema 变更时本档失效**，须改走 `full` |

须写入活跃 `process.md` frontmatter 的 `workflow_mode`。轻量模式**禁止**仅凭口令关键词或 PM 单方面落盘生效：须 AskUserQuestion 确认（选项含各模式**流程摘要**）+ `## 用户确认记录`「工作流模式确认」机读行（**R20**）。**分诊表、AskUserQuestion 固定选项文案、R2、R20、路径、R10** 见 `.claude/harness/spec/workflow-modes.md` 与 `project-manager.md`。

**E2E / 批次·最终测试**：机械门禁；公式与命令的说明权威见 `.claude/harness/spec/mechanical-gates.md` §8.3；执行权威为 Hook/`e2e-run.mjs`。

**流程终止（不可逆，R10）**：用户明确取消/终止流程时，PM 须 `AskUserQuestion` 二次确认 → 写入 `cancelled: true`（含时间/原因）并追加 `## 取消记录` → Hook **永久冻结**该 `process.md`；不得恢复，须引导新流程。顶层义务见 §5.19。细则见 `workflow-modes.md`。

## 5. 流程编排代理（顶层执行者）

除上述 7 个子角色外，对话中的**顶层代理**负责**按项目经理已完成的分派**代为发起子角色 Agent（执行通道）。顶层代理**不是**项目经理或任一业务角色，**不享有分派决策权**，必须遵守：

### 5.1–5.14 分派与推进禁令

| # | 禁令 / 义务 | 要点 |
| - | ------------ | ---- |
| 1 | **不得代行子角色职责（R5）** | 禁止直接编写业务代码/设计/需求/测试等成果物，禁止初始化/装依赖等开发行为，须经对应子 agent。`.claude/scripts\|agents\|hooks/**`、构建/测试脚本、`package.json` scripts 等 harness 基建归 **development-engineer**；`hooks.json` / `harness.config.json` 属门禁自治资产，**任何代理（含 DE）都不得写**（**R29**）。受门禁路径写入**必须**在对应子 agent 上下文内；**即使 `## 当前分派计划` 有效，顶层也不得亲自写**——计划有效仅代表可派发子 agent。 |
| 2 | **不得代行项目经理分派** | 禁止自行决定派谁/派什么/是否并行；须先经 PM 写入 `process.md`，再仅依 `## 当前分派计划` 与 `## 待派发角色列表` 发起 Agent。 |
| 3 | **不得越权改写角色内部流程** | Agent `prompt` 禁止预先指定技术栈、禁止「直接创建需求/设计/代码」等绕过角色约束的指令；**严禁附加 `model` 参数**（除非角色定义文件明确指定）。禁止：建议 `workflow_mode`/`iterationType`；要求非 SA 产出设计；指定任务包拆分/分派数量。仅允许：用户目标原文、路径、已有成果物、用户已确认摘要、PM 已写入的分派计划。 |
| 4 | **必须尊重阻塞** | `blocking: true` 或进度含「阻塞」时本轮结束等用户，不得同轮续派其他角色。 |
| 5 | **阻塞时的交互义务** | 展示成果物/摘要，`AskUserQuestion` 或明确提问；RA 的「待苏格拉底澄清」必须如实 relay 本轮问题、事实与假设，顶层不得代答，细则见 RA/PM agent。 |
| 6 | **串行接收目标** | 须先经 PM 接收并记录，再派下一角色；禁止同轮与 PM 并行派其他角色（`single-task`：PM 完成后可按列表连续派发，仍须逐 Agent）。 |
| 7 | **进度由 PM 维护** | 顶层不得自行篡改 `process.md` 以跳过门禁。 |
| 8 | **禁止越级发起 Agent（R8）** | 不得跳过前一角色或在门禁链未满足时派后一角色（`hotfix`/`docs-only` 按 §4 简化路径）。 |
| 9 | **角色切换必经 PM** | 除首次目标外，每角色（或并行批次）完成后须先调 PM 更新进度与下一批分派，再按列表发起 Agent。 |
| 10 | **开发阶段禁止代开发** | 设计审核通过后禁止顶层直接写受门禁源码或跑初始化；须先经 PM 分派再经 DE。 |
| 11 | **多开发线多 Agent** | 并行批次同轮按列表并行多个 DE Agent；串行批次 1 个即可。 |
| 12 | **禁止合并开发任务包** | 不得将多任务编号合并为笼统进度或单一 DE Agent。 |
| 13 | **禁止提前宣告完成** | `测试判定` 通过前禁止输出「项目已完成」等最终交付结论。 |
| 14 | **开发线完成后禁止直接收尾** | DE 返回后本回合须继续调 PM → 分派 QE。 |

### 5.15 流程完整性验证（技术强制）

Claude Code 通过 Hook 机制自动验证流程完整性：

**自动拦截点**：
- **gate-dev-workflow.mjs** - 拦截违规文件写入（R5/R10/R29/R21/R3）
- **gate-dev-shell.mjs** - 拦截违规 Shell 命令（R28/R22/工具链）
- **gate-role-sequence.mjs** - 拦截违规 Agent 调用（R13/R20/R26/R27/R33）
- **gate-stop-workflow.mjs** - 阻止未完成时收尾（R15/R16/R32/R35/R14/R17）

**无需自检**：关键约束由 Hook 技术强制，代理无需主动检查。

**仍需注意**：用户确认的真实性（§上方三条自律约束）。

### 5.16–5.19 门禁、工具链、失败与终止

| # | 禁令 / 义务 | 要点 |
| - | ------------ | ---- |
| 16 | **门禁约束技术强制** | Claude Code 通过 Hook 机制强制执行门禁约束。**R28**（Shell 写文件）与 **R29**（改写门禁自身）由 Hook 技术拦截；尝试绕过将被直接阻止。路径分级与判据见 `mechanical-gates.md` §8.5。 |
| 17 | **工具链安装须询问用户** | 禁止顶层直接装系统级工具链；交由 DE/TE「检测→询问→确认→安装」。禁止自签工具链凭证，需用户批准。细则见 `mechanical-gates.md` §8.5。 |
| 18 | **子 agent 失败必须阻塞** | 第 1 次：原 prompt 加失败背景重试（不得改核心指令、不得附加 `model`）。第 2 次：停重试；调 PM 标 `blocking: true`；展示失败摘要；`AskUserQuestion` 等用户。禁止：拆活自干、极简 prompt「帮过关」、附加 `model`、直接改受门禁文件「临时替代」、未完成却按完成推进。环境/工具链/脚本缺口：PM 阻塞 → 问用户 → 分派 DE/TE 修复；禁止顶层自行测/装/改 harness 脚本。 |
| 19 | **流程终止技术冻结（R10）** | `cancelled: true` 时 Hook 自动拦截所有写入和 Agent 调用。技术上无法继续，只能启动新流程。 |

## 6. 成果物门禁链（摘要）

派发下一角色前须满足前置成果物（`full` 首次路径）。**R13**：客观可判定条件需要机械校验；下表为可读摘要。完整表、R9、无效成果物清单见 `.claude/harness/spec/gate-chain.md`。

| 下一角色 | 必须已存在且有效 | 状态 |
| -------- | ---------------- | ---- |
| 需求分析师 | PM 已记录用户目标于 `process.md` | 无阻塞 |
| 系统架构师 | `requirement-spec.md`、`requirement-list.md`；用户已确认需求摘要；界面与交互期望确认（**R33**） | 无阻塞 |
| 需求评审专家 | `detail-design-spec.md`、`develop-task-list.md`；技术选型已确认（**R26**）；含「同构模块识别」章节（**R25**） | 无阻塞 |
| 开发工程师 | 同上 + `design-problem-list.md` 设计审核通过（R18 全要件）；PM 已分派 | 无阻塞 |
| 质量工程师 | 对应功能代码与单元测试；对应开发线「执行完成」；分派须标明任务包编号 | 无阻塞 |
| 测试工程师（批次） | 本批次 QE 全通过；lint（**R15**）与静态扫描（**R16**）均通过 | 无阻塞 |
| 测试工程师（最终） | 全部任务包开发+QE+各批次集成测试完成（含批次 E2E、**R14**、**R17**、**R32**） | 无阻塞 |

> **Claude Code 适配说明**：由于没有自动化 Hook 校验，这些前置条件需要：
> 1. 在项目经理角色中明确检查
> 2. 在顶层代理的自检中验证
> 3. 提供验证脚本供主动调用

**模式链**：`hotfix` = PM →（**R20**）→（R9）→ DE → QE → 测试（R11 单次通道，不省 QE/测试）；`docs-only` =（**R20**）文档角色按需，无 DE/QE/测试。

**用户确认留痕**：凡须确认的事项，PM 须在 `## 用户确认记录` 追加一行（确认项、时间、原话摘要）。

**阶段编排**：每角色或并行批次完成后**必先经 PM 更新进度与下一批分派**，再按 `## 待派发角色列表` 发起下一角色（§5.9）。完整阶段图见 `project-manager.md` 流程图。

## 7. 文档目录定义

| 目录 | 描述 |
| ---- | ---- |
| docs/requirement | 需求 |
| docs/design | 系统设计（含可选 `gated-artifacts.json`） |
| docs/quality | 代码质量 |
| docs/test | 测试 |
| docs/process | 任务进度 |

模板见 `.claude/templates/`。用户无需手动初始化；PM 首次接收目标时须执行 `node .claude/scripts/bootstrap-docs.mjs`（或等价创建）。Harness/工程化基建归属见 §5.1（DE 执行，顶层不得代写）。

---

## Claude Code 技术强制实现

### 关键特性

1. **Agent 调用机制**
   - Cursor: `Task` 工具，frontmatter 中的 `name` 作为角色标识
   - Claude Code: `Agent` 工具，使用 `agentType` 参数指定角色

2. **Hook 机制（完全支持）**
   - **PreToolUse Hook**: 拦截 Write/Edit/Bash/PowerShell/Agent
   - **Stop Hook**: 阻止回合结束
   - **SubagentStart Hook**: 追踪子代理
   - **SessionStart Hook**: 会话初始化
   - **技术强制**：与 Cursor 达到同等的强制执行能力

3. **用户确认机制**
   - Cursor: `AskQuestion` 工具
   - Claude Code: `AskUserQuestion` 工具
   - **适配策略**：两者语义相近，直接映射使用

4. **模型指定**
   - Cursor: 在 agent 文件的 frontmatter 中通过 `model` 字段指定
   - Claude Code: 在 Agent 工具调用时通过 `model` 参数覆盖
   - **适配策略**：在各角色文件 frontmatter 中声明推荐模型，顶层代理在调用 Agent 时传递

5. **文件操作门禁（技术强制）**
   - Cursor: `gate-dev-workflow` Hook 拦截 Write/Edit 等操作
   - Claude Code: **完全支持** - `gate-dev-workflow.mjs` PreToolUse Hook 拦截 Write/Edit/Delete 等操作
   - **技术强制**：返回 `permissionDecision: "deny"` 直接阻止违规操作，模型无法绕过

6. **Shell 命令门禁（技术强制）**
   - Cursor: `gate-dev-shell` Hook 拦截 Shell 命令
   - Claude Code: **完全支持** - `gate-dev-shell.mjs` PreToolUse Hook 拦截 Bash/PowerShell 命令
   - **技术强制**：在命令执行前自动拦截，支持 R28 写文件解析和工具链安装审批

### v2.0 技术强制能力

**✅ 已实现与 Cursor 对等的强制执行：**

1. **自动拦截机制**：6 个 Hook 脚本在操作执行前技术强制拦截
2. **多层防护**：PreToolUse（文件/Shell/Agent）+ Stop（回合结束）+ SubagentStart（身份追踪）
3. **无法绕过**：Hook 返回 deny 时操作被引擎层直接阻止，不依赖模型自律
4. **执行证明**：R34 通过 ed25519 签名验证测试产物真实性

**官方文档确认**：
> "PreToolUse hook can return `permissionDecision: "deny"` to prevent the tool from executing. The model cannot bypass this decision."
> 
> 参考：https://code.claude.com/docs/en/hooks

### 能力边界（坦诚披露）

虽然实现了技术强制，仍有三个维度需要配合角色自律（详见 §3 技术强制的能力边界）：

1. **用户确认的真实性** - Hook 验证确认记录存在，但无法验证是否真实使用 AskUserQuestion
2. **阻塞原因的合理性** - R35 验证阻塞释放有证据，但人类起源证据的实质性仍需人工审查
3. **stop 预算耗尽** - `loop_limit: 3` 用尽后代理可结束回合，需配合 §5.15 自检

**关键区别**：这些边界是机械层的设计约束（如何平衡自愈与防护），**不是技术能力缺失**。
