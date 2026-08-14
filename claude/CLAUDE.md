# Harness Engineering 规约（Claude Code v2.0 - 技术强制版）

Harness Engineering AI 编程通用规约的 Claude Code 适配版本：以 Hook 机制把关键约束落为技术强制，而非自律提示。

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

- 发起子角色用 **`Agent` 工具**，以 `agentType` 参数指定角色。
- `model` 字段**以对应 `.claude/agents/{角色}.md` 中的声明为唯一权威源**（本文件不重复维护对照表，避免两处漂移）。改模型请直接编辑对应 agent 文件。
- **职责区分**：`requirements-analyst` 负责以多轮苏格拉底式提问充分理解本次变更涉及的显性与重大隐性需求并完成确认（细则见该角色 agent 文件）；`requirement-reviewer` **仅**审核系统设计成果物，不参与需求澄清。

## 2. 强制规则

1. 每个角色必须各司其职，禁止执行与自己职责不相关的操作。
2. 开发流程总入口：项目经理接收用户目标。
3. **职责边界**：项目经理只负责角色级编排（派任务顺序、依据成果物推进或回退）；角色内部的工作流程定义在对应角色的 `.claude/agents/` 文件中，由该角色自行执行。
4. **指令冲突处理**：子 agent 的 `.claude/agents/{角色}.md` 强制约束 **优先于** 顶层代理或项目经理下发的 Agent 调用 `prompt`。若 prompt 要求跳过门禁、代做决策或直接产出成果物，子 agent 必须拒绝并说明阻塞原因。**本条为全局规则，对全部 7 个角色文件统一生效，各角色文件内无需逐一重复声明。**
5. **元规则：只可加强，不可放松（R12）**：本框架后续任何修改，只允许新增或加强门禁约束，禁止放松、删除或弱化已声明的约束。
   - 如需变更判据，须同步升级机械门禁代码（Hook/脚本），不得仅削减文档描述以迁就现有较弱实现；
   - 发现**文档声明强于实现**时，须补齐实现，而非降低文档声明；
   - **反向情形（实现严于声明、且严到任何真实项目都不可达）同样是缺陷，但修正方向属放松，由用户裁定**：**代理不得自行改回**，须呈现证据与影响面、经用户明确确认后方可修改，并在 `.claude/harness/spec/**` 留痕（放松了什么、依据何在）。
   - 理据、判例与留痕格式见 `mechanical-gates.md` §8.5「门禁强度调整留痕」。

## 3. 权威分层索引

本文件是**薄宪章**（常驻）：编排硬约束 + 索引。根文件变薄 ≠ 规约变松。细则与公式按层分置：

| 层 | 路径 | 职责 |
| -- | ---- | ---- |
| **宪章（本文件，常驻）** | `CLAUDE.md` | 角色指针、R12、顶层禁令与回合自检、模式摘要、门禁链摘要 |
| **规则层（按路径注入）** | `.claude/rules/*.md` | 编辑特定成果物时自动注入的提醒；`paths` frontmatter 决定触发面 |
| **机械执行权威** | `.claude/hooks/**`、`*-run.mjs`、`workflow-gate-lib.mjs` | 客观判据唯一执行权威；行为只可加强（R12） |
| **说明权威（按需）** | `.claude/harness/spec/mechanical-gates.md` | Hook 一览、stop 判据、各门禁公式、双要素豁免、能力边界 |
| **门禁链细则** | `.claude/harness/spec/gate-chain.md` | R9、无效成果物、用户确认 |
| **模式细则** | `.claude/harness/spec/workflow-modes.md` | 分诊、R2、R20、路径、R10 步骤 |
| **回退** | `.claude/harness/spec/rollback.md` | 回退计数与终止 |
| **编号导航** | `.claude/harness/spec/rule-index.md` | R/B/TG 索引（不新增约束） |
| **角色执行面** | `.claude/agents/*.md` | 该角色操作细则（Agent 调用时加载） |

**规则层（`.claude/rules/`）** 是 Claude Code 原生机制（官方文档：https://code.claude.com/docs/en/memory#organize-rules-with-claude/rules/ ）：

- 目录下**全部 `.md` 递归发现**；带 `paths` frontmatter 的规则在读到匹配文件时注入，不带的随会话常驻（与 `.claude/CLAUDE.md` 同优先级）。
- 当前 5 份均为路径触发：`harness-process`（`process.md`）、`harness-design-artifacts`（需求/设计）、`harness-test-artifacts`（测试/QE/`test-results`/`e2e`）、`harness-source-code`（产品源码）、`harness-gate-assets`（门禁自治资产）。
- 它们**只做指引与转述，不是新增约束**——判定一律回到 Hook 与说明权威。
- 规则文件本身属 **R29** `gate-config`（须用户本人落盘）。
- **该目录下不放 `README.md` 之类说明文件**——无 `paths` 的 `.md` 会被当作常驻规则注入。

**元约束（常驻）**：禁止绕过 Hook（含 **R28** Shell 写文件与 **R29** 改写门禁自身两条路径）；豁免须**双要素**（`gated-artifacts.json` 声明 + `process.md` 用户确认），仅一项不生效；细则表见 `mechanical-gates.md` §8.2。

> **Hook 注册**（**唯一权威源**是 `.claude/settings.json`；下列即当前注册的 7 个脚本，官方文档：https://code.claude.com/docs/en/hooks ）
> - **PreToolUse**：`gate-dev-workflow-enhanced.mjs`（Write/Edit/NotebookEdit）、`gate-dev-shell.mjs` 与 `gate-toolchain-install.mjs`（Bash/PowerShell）、`gate-role-sequence.mjs`（Agent 调用）在操作执行前自动拦截
> - **Stop**：`gate-stop-workflow.mjs` 在流程未完成时阻止回合结束
> - **SubagentStart**：`gate-subagent-track.mjs` 记录身份用于 R5 验证
> - **SessionStart**：`session-init-enhanced.mjs` 会话初始化（含 auto 权限模式告警）
> - Hook 返回 `permissionDecision: "deny"` 直接阻止操作，模型无法绕过
> - **注意**：同名非 `-enhanced` 文件（`gate-dev-workflow.mjs` / `session-init.mjs`）仍在盘上但**未注册、不生效**；改门禁行为须改 `-enhanced` 那份

**技术强制的能力边界（坦诚披露）**：Hook 在执行前拦截关键操作，但仍有三处只能靠角色自律：

1. **不得伪造用户意志**：Hook 校验 `## 用户确认记录` 的存在性，但**验证不了确认是否真实**。凡须确认的事项（R20/R26/R27/R33、**R35** 阻塞决策、全部双要素豁免）必须真实使用 `AskUserQuestion` 并获得用户响应，写了确认行却没真问是最严重的违规。
2. **不得伪造执行证明（R34）**：只在代理 Shell 通道内实跑运行器；**绝不**手工编辑 `test-results/**` 机读产物，**绝不**用旧产物冒充本次结果（改了代码就得重跑）。虽然 Hook 不能验证产物真实性，但伪造证明等同于破坏整个流程。
3. **不得无依据地标 `blocking`（R35）**：阻塞须有实质原因。Hook 会检查阻塞释放时是否有用户确认记录，但无法验证阻塞是否合理。

**stop 门禁与预算**：Stop Hook 可以阻止回合结束，但预算耗尽（`loop_limit`）后代理仍可结束回合。因此流程完整性仍需角色诚实执行。

## 4. 工作流模式（摘要）

| 模式 | 生效 | 简化 |
| ---- | ---- | ---- |
| `full` | 默认；未确认的轻量声明 fail-safe 为本模式 | 需求 → 架构 → 设计审核 → 开发 → QE → 测试 |
| `hotfix` | **R20** 确认后 | 跳过 RA/SA（须已有设计或按 R9 补最小热修设计）；DE → QE → 测试；测试按 **R11** 折叠为单次通道 |
| `docs-only` | **R20** 确认后 | 禁止写源码与构建产物（含 `e2e/**`）；文档与仓库元文件可改 |
| `single-task` | **R20** 确认后 | **增量迭代档（R37）**，只省测试轮次与 R26；细则见下 |

**`single-task` 细则**：在**已有基线设计**的项目上加一个功能增量。

- **只省**两项：测试轮次（折叠为单轮集成测试 + E2E）、R26 技术选型确认。
- **其余判据一条不减**——尤须注意 **R14/R17 并入折叠通道**，不得照搬 hotfix R11 的跳过。
- **前置**：基线 `detail-design-spec.md` + `process.md`「## 增量范围」**五维**声明。
- **需要迁移脚本或破坏向后兼容时本档失效**，须改走 `full`；数据形状变而兼容未破（如新增可选字段）仍可用，代价是须声明并落地兼容性回归用例（**F-08**）。

模式须写入活跃 `process.md` frontmatter 的 `workflow_mode`。轻量模式**禁止**仅凭口令关键词或 PM 单方面落盘生效：须 `AskUserQuestion` 确认（选项含各模式**流程摘要**）+ `## 用户确认记录`「工作流模式确认」机读行（**R20**）。**分诊表、AskUserQuestion 固定选项文案、R2、R20、路径、R10** 见 `.claude/harness/spec/workflow-modes.md` 与 `project-manager.md`。

**E2E / 批次·最终测试**：机械门禁；公式与命令的说明权威见 `mechanical-gates.md` §8.3；执行权威为 Hook/`e2e-run.mjs`。

**流程终止（不可逆，R10）**：用户明确取消/终止流程时，PM 须 `AskUserQuestion` 二次确认 → 写入 `cancelled: true`（含时间/原因）并追加 `## 取消记录` → Hook **永久冻结**该 `process.md`；不得恢复，须引导新流程。顶层义务见 §5.19。细则见 `workflow-modes.md`。

## 5. 流程编排代理（顶层执行者）

除上述 7 个子角色外，对话中的**顶层代理**负责**按项目经理已完成的分派**代为发起子角色 Agent（执行通道）。顶层代理**不是**项目经理或任一业务角色，**不享有分派决策权**。

### 5.1 不得代行子角色职责（R5 / R29）

- 禁止直接编写业务代码/设计/需求/测试等成果物，禁止初始化/装依赖等开发行为，须经对应子 agent。
- 构建/测试脚本、`package.json` scripts 等工程化基建归 **development-engineer**。
- 但**门禁自身**属门禁自治资产，**任何代理（含 DE）都不得写**（**R29**，分级见 `mechanical-gates.md` §8.5）：`settings.json`（Hook 注册表）、`harness.config.json`、`CLAUDE.md`、`.claude/harness/spec/**`、`.claude/rules/**`、`.claude/hooks/**`、`.claude/scripts/` 下的门禁运行器与自测、`.claude/agents/*.md`。
  - **为什么锁到这一层**：改写运行器即可产出「恒通过」且被真实私钥签名的产物；锁配置而不锁代码等于给 R12 留后门。
  - 须变更时呈现完整 diff + 理由，由**用户本人**落盘。
- 受门禁路径写入**必须**在对应子 agent 上下文内；**即使 `## 当前分派计划` 有效，顶层也不得亲自写**——计划有效仅代表可派发子 agent。

### 5.2–5.14 分派与推进禁令

| # | 禁令 / 义务 | 要点 |
| - | ------------ | ---- |
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

自动拦截点：

- `gate-dev-workflow-enhanced.mjs` — 拦截违规文件写入（R5/R10/R29/R21/R3）
- `gate-dev-shell.mjs` — 拦截违规 Shell 命令（R28/R22）
- `gate-toolchain-install.mjs` — 拦截未经批准的工具链安装
- `gate-role-sequence.mjs` — 拦截违规 Agent 调用（R13/R20/R26/R27/R33）
- `gate-stop-workflow.mjs` — 阻止未完成时收尾（R15/R16/R32/R35/R14/R17）

**无需自检**：上述关键约束由 Hook 技术强制，代理无需主动检查。**仍需注意**：用户确认的真实性（§3 能力边界三条）。

### 5.16–5.19 门禁、工具链、失败与终止

| # | 禁令 / 义务 | 要点 |
| - | ------------ | ---- |
| 16 | **门禁约束技术强制** | **R28**（Shell 写文件）与 **R29**（改写门禁自身）由 Hook 技术拦截；尝试绕过将被直接阻止。**Hook 拒绝的调用不得改用其他工具重试**。路径分级与判据见 `mechanical-gates.md` §8.5。 |
| 17 | **工具链安装须询问用户** | 禁止顶层直接装系统级工具链；交由 DE/TE「检测→询问→确认→安装」。禁止自签工具链凭证，需用户批准。细则见 `mechanical-gates.md` §8.5。 |
| 18 | **子 agent 失败必须阻塞** | 第 1 次：原 prompt 加失败背景重试（不得改核心指令、不得附加 `model`）。第 2 次：停重试；调 PM 标 `blocking: true`；展示失败摘要；`AskUserQuestion` 等用户。禁止：拆活自干、极简 prompt「帮过关」、附加 `model`、直接改受门禁文件「临时替代」、未完成却按完成推进。环境/工具链/脚本缺口：PM 阻塞 → 问用户 → 分派 DE/TE 修复；禁止顶层自行测/装/改 harness 脚本。 |
| 19 | **流程终止技术冻结（R10）** | `cancelled: true` 时 Hook 自动拦截所有写入和 Agent 调用；技术上无法继续，只能启动新流程。 |

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

> 上表**客观可判定**的部分已由 `gate-role-sequence.mjs` 在 Agent 发起前机械拦截（**R13**）。但机械层只判「成果物是否存在且有效」，以下三项仍须叠加执行——**不得**以「Hook 会拦」为由省略：
> 1. 项目经理在分派前明确核对门禁链（Hook 不校验 `phase` 的阶段序关系，**R8** 的阶段顺序维度仍由 §5.8 文字约束承担，见 `mechanical-gates.md` §8.1）
> 2. 顶层代理按 §5.15 做回合自检（stop 预算 `loop_limit` 耗尽后它是唯一仍起作用的约束）
> 3. 用户确认类前置（**R20/R26/R27/R33**）须真实使用 `AskUserQuestion`，Hook 只验确认行存在（§3 能力边界 1）

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
