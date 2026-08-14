## 1. 角色定义

每个角色定义为一个子 agent，项目中定义了 7 种角色：

| 角色名称 | 子 agent 名称 | Agent 定义文件 |
| -------- | ------------- | -------------- |
| 项目经理 | project-manager | `.codex/agents/project-manager.toml` |
| 需求分析师 | requirements-analyst | `.codex/agents/requirements-analyst.toml` |
| 系统架构师 | system-architect | `.codex/agents/system-architect.toml` |
| 需求评审专家 | requirement-reviewer | `.codex/agents/requirement-reviewer.toml` |
| 开发工程师 | development-engineer | `.codex/agents/development-engineer.toml` |
| 质量工程师（QE） | quality-engineer | `.codex/agents/quality-engineer.toml` |
| 测试工程师 | test-engineer | `.codex/agents/test-engineer.toml` |

发起子 agent 时以各 TOML 文件的 `name` 字段识别角色；`model` 与 `model_reasoning_effort` 指定运行配置，`developer_instructions` 是该角色执行面。**以对应 `.codex/agents/{角色}.toml` 为唯一权威源**（本文件不重复维护模型对照表）。顶层只按 PM 分派请求该自定义 agent，不得用内置 `worker` 代替业务角色。

> 若显式 `model` 不可用，角色可能无法启动；不得用未加载角色指令的普通 subagent 冒充成功。更换模型前须按当前 Codex 可用模型核验精确 slug。

**职责区分**：`requirements-analyst` 负责以多轮苏格拉底式提问充分理解本次变更涉及的显性与重大隐性需求并完成确认（细则见该角色 agent 文件）；`requirement-reviewer` **仅**审核系统设计成果物，不参与需求澄清。

## 2. 强制规则

1. 每个角色必须各司其职，禁止执行与自己职责不相关的操作。
2. 开发流程总入口：项目经理接收用户目标。
3. **职责边界**：项目经理只负责角色级编排（派任务顺序、依据成果物推进或回退）；角色内部的工作流程定义在对应角色的 `.codex/agents/` 文件中，由该角色自行执行。
4. **指令冲突处理**：子 agent 的 `.codex/agents/{角色}.toml` 强制约束 **优先于** 顶层代理或项目经理下发的 prompt。若 prompt 要求跳过门禁、代做决策或直接产出越权成果物，子 agent 必须拒绝并说明阻塞原因。**本条为全局规则，对全部 7 个角色文件统一生效。**
5. **元规则：只可加强，不可放松（R12）**：本框架后续任何修改，只允许新增或加强门禁约束，禁止放松、删除或弱化已声明的约束。如需变更判据，须同步升级机械门禁代码（Hook/脚本），不得仅削减文档描述以迁就现有较弱实现；发现文档声明强于实现时，须补齐实现，而非降低文档声明。**反向情形（实现严于声明、且严到任何真实项目都不可达）同样是缺陷，但修正方向属放松，由用户裁定**：**代理不得自行改回**，须呈现证据与影响面、经用户明确确认后方可修改，并在 `harness/spec/**` 留痕（放松了什么、依据何在）。理据、判例与留痕格式见 `mechanical-gates.md` §8.5「门禁强度调整留痕」。

## 3. 权威分层索引

本文件是**薄宪章**（常驻）：编排硬约束 + 索引。根文件变薄 ≠ 规约变松。细则与公式按层分置：

| 层 | 路径 | 职责 |
| -- | ---- | ---- |
| **宪章（本文件，常驻）** | `AGENTS.md` | 角色指针、R12、顶层禁令与回合自检、模式摘要、门禁链摘要、禁止绕过 Hook |
| **沙箱外命令策略** | `.codex/rules/*.rules` | Codex 原生 `prefix_rule`；仅裁决沙箱外命令的 `allow` / `prompt` / `forbidden`，不承担角色、路径、内容或阶段判据 |
| **机械执行权威** | `.codex/hooks/**`、`*-run.mjs`、`workflow-gate-lib.mjs` | 客观判据唯一执行权威；行为只可加强（R12） |
| **说明权威（按需）** | `.codex/harness/spec/mechanical-gates.md` | Hook 一览、stop 判据、各门禁公式、双要素豁免、能力边界；§8.5–§8.6/§8.8 审核加固项（**R28–R38**）、**§8.7 机械层实际强度边界** |
| **门禁链细则** | `.codex/harness/spec/gate-chain.md` | R9、无效成果物、用户确认 |
| **模式细则** | `.codex/harness/spec/workflow-modes.md` | 分诊、R2、R20、路径、R10 步骤 |
| **回退** | `.codex/harness/spec/rollback.md` | 回退计数与终止 |
| **编号导航** | `.codex/harness/spec/rule-index.md` | R/B/TG 索引（不新增约束） |
| **角色执行面** | `.codex/agents/*.toml` | Codex 自定义 agent 配置与该角色操作细则 |

**元约束（常驻）**：禁止绕过 Hook（含 **R28** Shell 写文件与 **R29** 改写门禁自身两条路径）；豁免须**双要素**（`gated-artifacts.json` 声明 + `process.md` 用户确认），仅一项不生效；细则表见 `mechanical-gates.md` §8.2。架构说明（给人读）见 `README.md`「规约权威分层」。

**机械层的实际强度（常驻，勿高估）**：Hook 只**提高抄近路的成本**，不是不可逾越的沙箱。边界**不构成放松约束的理由**——恰因机械层挡不住，下列三条才必须靠角色自律与 §5.15 自检兜底；对**全部角色**恒成立，违反者与直接改写门禁同级：

1. **不得伪造用户意志**：本规约中的 `AskQuestion` 指 Codex **直接向用户提出明确问题并等待回答**，不是一个特定工具名。Hook 只校验 `## 用户确认记录` 有无格式匹配的行，验不了问题是否真的问过。凡须确认的事项（R20/R26/R27/R33、**R35** 阻塞决策、全部双要素豁免）写了确认行却没真问，是本规约最严重的违规。
2. **不得伪造执行证明（R34）**：只在代理 Shell 通道内实跑运行器；**绝不**手工编辑 `test-results/**` 机读产物，**绝不**用旧产物冒充本次结果（改了代码就得重跑）。签名与新鲜度只抬高成本，不是不可伪造。
3. **不得无依据地标 `blocking`（R35）**：阻塞须有机器起源依据（须与 Hook 独占写入的旁路台账指纹相符，自己补一行不算）或「实质阻塞原因 + 用户决策留痕」。

另须知：Codex `Stop` Hook 的 `decision: block` 会创建一次 continuation；适配器在 `stop_hook_active=true` 时停止再次递归，防止死循环。因此 **§5.15 不是 Hook 的重复品，而是自动 continuation 用尽后的约束**。完整边界表见 `mechanical-gates.md` §8.7。

## 4. 工作流模式（摘要）

| 模式 | 生效 | 简化 |
| ---- | ---- | ---- |
| `full` | 默认；未确认的轻量声明 fail-safe 为本模式 | 需求 → 架构 → 设计审核 → 开发 → QE → 测试 |
| `hotfix` | **R20** 确认后 | 跳过 RA/SA（须已有设计或按 R9 补最小热修设计）；DE → QE → 测试；测试按 **R11** 折叠为单次通道 |
| `docs-only` | **R20** 确认后 | 仅 `docs/**/*.md`；Hook 拒绝源码写入 |
| `single-task` | **R20** 确认后 | **增量迭代档（R37）**：在**已有基线设计**的项目上加一个功能增量。**只省**测试轮次（折叠为单轮集成测试+E2E）与 R26 技术选型确认，**其余判据一条不减**——尤须注意 **R14/R17 并入折叠通道**，不得照搬 hotfix R11 的跳过。**前置**：基线 `detail-design-spec.md` + `process.md`「## 增量范围」四维声明；**涉及 schema 变更时本档失效**，须改走 `full` |

须写入活跃 `process.md` frontmatter 的 `workflow_mode`。轻量模式**禁止**仅凭口令关键词或 PM 单方面落盘生效：须 AskQuestion 确认（选项含各模式**流程摘要**）+ `## 用户确认记录`「工作流模式确认」机读行（**R20**）。**分诊表、AskQuestion 固定选项文案、R2、R20、路径、R10** 见 `.codex/harness/spec/workflow-modes.md` 与 `project-manager.toml`。

**E2E / 批次·最终测试**：机械门禁；公式与命令的说明权威见 `.codex/harness/spec/mechanical-gates.md` §8.3；执行权威为 Hook/`e2e-run.mjs`。

**流程终止（不可逆，R10）**：用户明确取消/终止流程时，PM 须 `AskQuestion` 二次确认 → 写入 `cancelled: true`（含时间/原因）并追加 `## 取消记录` → Hook **永久冻结**该 `process.md`；不得恢复，须引导新流程。顶层义务见 §5.19。细则见 `workflow-modes.md`。

## 5. 流程编排代理（顶层执行者）

除上述 7 个子角色外，对话中的**顶层代理**负责**按项目经理已完成的分派**发起 Codex custom agent（执行通道）。项目 `.codex/config.toml` 将顶层设为 `read-only`，各角色 TOML 按职责设为 `workspace-write`；这是 Codex 对 R5 的主要机械隔离。顶层代理**不是**项目经理或任一业务角色，**不享有分派决策权**，必须遵守：

### 5.1–5.14 分派与推进禁令

| # | 禁令 / 义务 | 要点 |
| - | ------------ | ---- |
| 1 | **不得代行子角色职责（R5）** | 禁止直接编写业务代码/设计/需求/测试等成果物，禁止初始化/装依赖等开发行为，须经对应 custom agent。`.codex/scripts\|agents\|hooks/**`、构建/测试脚本、`package.json` scripts 等 harness 基建归 **development-engineer**；`.codex/**` 与 `.agents/**` 又受 Codex 保护路径原生只读，`hooks.json` / `harness.config.json` 属门禁自治资产，**任何代理（含 DE）都不得写**（**R29**）。受门禁路径写入必须在对应角色上下文内；即使分派计划有效，顶层也不得申请提权代写。机械化补强为：顶层 `read-only` sandbox + 角色路径校验（产品源码须 DE 活跃、`e2e/**` 归 TE）。Codex 不向 PreToolUse 暴露稳定的每次调用者 agent id，故不宣称可用 `conversation_id` 区分顶层与子 agent。见 `mechanical-gates.md` §8.4。 |
| 2 | **不得代行项目经理分派** | 禁止自行决定派谁/派什么/是否并行；须先经 PM 写入 `process.md`，再仅依 `## 当前分派计划` 与 `## 待派发角色列表` 发起 Task。 |
| 3 | **不得越权改写角色内部流程** | Task `prompt` 禁止预先指定技术栈、禁止「直接创建需求/设计/代码」等绕过角色约束的指令；**严禁附加 `model` 参数**。禁止：建议 `workflow_mode`/`iterationType`；要求非 SA 产出设计；指定任务包拆分/分派数量。仅允许：用户目标原文、路径、已有成果物、用户已确认摘要、PM 已写入的分派计划。 |
| 4 | **必须尊重阻塞** | `blocking: true` 或进度含「阻塞」时本轮结束等用户，不得同轮续派其他角色。 |
| 5 | **阻塞时的交互义务** | 展示成果物/摘要，`AskQuestion` 或明确提问；RA 的「待苏格拉底澄清」必须如实 relay 本轮问题、事实与假设，顶层不得代答，细则见 RA/PM agent。 |
| 6 | **串行接收目标** | 须先经 PM 接收并记录，再派下一角色；禁止同轮与 PM 并行派其他角色（`single-task`：PM 完成后可按列表连续派发，仍须逐 Task）。 |
| 7 | **进度由 PM 维护** | 顶层不得自行篡改 `process.md` 以跳过门禁。 |
| 8 | **禁止越级发起 Task（R8）** | 不得跳过前一角色或在门禁链未满足时派后一角色（`hotfix`/`docs-only` 按 §4 简化路径）。 |
| 9 | **角色切换必经 PM** | 除首次目标外，每角色（或并行批次）完成后须先调 PM 更新进度与下一批分派，再按列表发起 Task。 |
| 10 | **开发阶段禁止代开发** | 设计审核通过后禁止顶层直接写受门禁源码或跑初始化；须先经 PM 分派再经 DE。 |
| 11 | **多开发线多 Task** | 并行批次同轮按列表并行多个 DE Task；串行批次 1 个即可。 |
| 12 | **禁止合并开发任务包** | 不得将多任务编号合并为笼统进度或单一 DE Task。 |
| 13 | **禁止提前宣告完成** | `测试判定` 通过前禁止输出「项目已完成」等最终交付结论。 |
| 14 | **开发线完成后禁止直接收尾** | DE 返回后本回合须继续调 PM → 分派 QE。 |

### 5.15 回合结束前自检（强制）

| 自检项 | 不满足时的动作 |
| ------ | -------------- |
| 本回合是否由**顶层代理亲自**写入受门禁路径（源码 / `.codex/scripts\|agents\|hooks/**` / 构建产物）？（R5） | 属越权代写（门禁按分派计划放行≠授权顶层代写），须撤销并改由对应子 agent 执行 |
| 本回合是否修改了受门禁保护的源码/构建产物？ | 若无有效 `## 当前分派计划`，属代开发违规，不得收尾 |
| `process.md` 中是否存在开发工程师任务为「正在执行」？ | 须先调 PM 更新状态并分派 QE |
| 是否存在 DE「执行完成」但尚无对应 QE 记录？ | 须先调 PM 分派 `quality-engineer` |
| QE 已完成但 lint 未通过（`lintPassed=false`，R15）？ | 须由 QE 跑 `lint-run.mjs` 至 `gatePassed=true`；**不得发起 TE 或收尾** |
| QE 已完成但静态扫描未通过（`staticScanPassed=false`，R16）？ | 须由 QE 跑 `static-scan-run.mjs` 至均 `gatePassed=true`；**不得发起 TE 或收尾** |
| 本批次 QE 已通过，但该批次集成测试未执行？ | 须先调 PM 分派 TE 做**批次集成测试** |
| 批次测试行已完成，但批次 E2E 未 `gatePassed`（`batchE2ePassed=false`）？ | 须由 TE 跑 `e2e-run.mjs --scope=batch`；**不得推进下一批次** |
| 所有任务包已开发+QE+各批次集成测试完成，但**最终整体集成测试**未执行？ | 须先调 PM 分派 TE 执行**最终整体集成测试** |
| 最终测试行已完成，但最终 E2E 未 `gatePassed`（`finalE2ePassed=false`）？ | 须由 TE 跑 `e2e-run.mjs --scope=final`；**不得收尾或宣告完成** |
| 测试环节已完成，但生产启动冒烟无通过证据（`startupSmokePassed=false`，**R32**）？ | 须由 TE 跑 `startup-smoke-run.mjs`（干净启动 + 强杀后再启动）至 `gatePassed=true`；冒烟失败属产品缺陷 ⇒ 回派 DE，**不得**以「非阻塞、延后」收尾 |
| 是否拟宣告项目/全流程完成？ | 须确认最终整体集成测试 `测试判定` 已通过，且最终 E2E / lint(R15) / 静态扫描(R16) / 启动冒烟(R32) 均 `gatePassed=true` |
| `## 回退计数` 中是否有对象回退次数超过 3？（**R31**） | 须先调 PM 标 `blocking: true`、写明反复回退根因并 `AskQuestion` 请用户决策；**不得**在未阻塞下继续推进或收尾 |
| 本回合是否手工创建/编辑过 `test-results/**` 机读产物，或用了改代码之前跑出来的产物？（**R34**，见 §3 元约束 2） | 须撤销该改动，并由对应角色**在代理 Shell 通道内**重跑运行器；产物报 `exec-proof-*`（含 `exec-proof-stale-artifact`）时唯一出路是重跑，不是再改一次 |
| stop 门禁是否报出「工具不可用」（**R38**）？ | 这是**环境/工具**问题，不是代码质量问题。**不得**回派 DE 整改一个不存在的缺陷；须由 PM 标 `blocking`（按 R35 备齐证据）并 `AskQuestion` 请用户在「修工具 / 用户配等价命令覆盖 / 双要素豁免」间决策 |
| 本回合是否为了摆脱 followup 而标了 `blocking: true`？（**R35**，见 §3 元约束 3） | 须补齐实质「## 阻塞原因」与「## 用户确认记录」阻塞决策留痕（Hook 自写、且在旁路台账里有出处的 fail-open 阻塞除外——那一行不是你能自己补的） |
| `workflow_mode: single-task` 时是否已填「## 增量范围」四维、且未涉及 schema 变更？（**R37**） | 缺声明或涉及 schema 变更时门禁拒绝派发；后者须 `AskQuestion` 改回 `full`。折叠通道仍须 R14/R17/R32 齐备，**不得**照搬 hotfix R11 的跳过 |
| 本回合是否试图改写门禁自身（`hooks.json` / `harness.config.json` / `.codex/rules/*.rules` / R5 运行时标记 / 工具链凭证 / `AGENTS.md` / `harness/spec/**`）？（**R29**） | 一律不得由代理写入（含改用 Shell）；须把 diff 与「加强了什么」呈现给用户，由用户本人编辑（R12） |
| 目标流程是否已 `cancelled: true`？（R10） | 禁止再在其上推进任何工作；除引导新流程的 PM 外不得发起角色 Task；不得改写该 `process.md` |

### 5.16–5.19 门禁、工具链、失败与终止

| # | 禁令 / 义务 | 要点 |
| - | ------------ | ---- |
| 16 | **Hook 门禁不得绕过** | Hook 拒绝的调用不得改用其他工具绕过。**R28**（Shell 写文件）与 **R29**（改写门禁自身）为硬禁令；禁止以「便于通过」为由放宽门禁或摘除 Hook（R12）。路径分级与判据见 `mechanical-gates.md` §8.5。 |
| 17 | **工具链安装须询问用户** | 禁止顶层直接装系统级工具链；交由 DE/TE「检测→询问→确认→安装」。`.codex/rules/harness.rules` 对固定安装前缀增加沙箱外 `prompt`；但 Codex `PreToolUse` 不支持 `ask`，Hook 的旧 `ask` 判据仍在适配层保守降级为 `deny`，Rules 不得被解释为绕过该拒绝。授权须走真实对话确认 + 原生 sandbox / `approval_policy=on-request`，不得靠重试绕过。细则见 `mechanical-gates.md` §8.5。 |
| 18 | **子 agent Task 失败必须阻塞** | 第 1 次：原 prompt 加失败背景重试（不得改核心指令、不得附加 `model`）。第 2 次：停重试；调 PM 标 `blocking: true`；展示失败摘要；`AskQuestion` 等用户。禁止：拆活自干、极简 prompt「帮过关」、附加 `model`、直接改受门禁文件「临时替代」、未完成却按完成推进。环境/工具链/脚本缺口：PM 阻塞 → 问用户 → 分派 DE/TE 修复；禁止顶层自行测/装/改 harness 脚本。 |
| 19 | **必须尊重流程终止（R10）** | `cancelled: true` 时禁止再**在该流程上**推进任何工作：Hook 冻结该 `process.md` 的一切写入，并拒绝对其发起除 `project-manager` 外的全部角色 Task。PM Task 仅作为「引导用户建立新流程」的逃生口放行，**PM 同样不得改写或试图恢复该流程**。须提示不可逆并引导新流程；例外理由见 `gate-chain.md`。 |

## 6. 成果物门禁链（摘要）

派发下一角色前须满足前置成果物（`full` 首次路径）。**R13**：客观可判定条件由 `gate-role-sequence.mjs` 机械校验；下表为可读摘要，**实际判定以 Hook 为准**。调用者身份（顶层是否越权）不可机械化，由 R8/§5 文字约束承担。完整表、R9、无效成果物清单见 `.codex/harness/spec/gate-chain.md`。

| 下一角色 | 必须已存在且有效 | 状态 |
| -------- | ---------------- | ---- |
| 需求分析师 | PM 已记录用户目标于 `process.md` | 无阻塞 |
| 系统架构师 | `requirement-spec.md`（含结构完整、可追溯的隐性需求确认记录，R19）、`requirement-list.md`；用户已确认需求摘要（须先经 **R27** AskQuestion 粗判断）；`## 用户确认记录` 含「界面与交互期望」确认行（**R33**，技术选型行不顶替） | 无阻塞 |
| 需求评审专家 | `detail-design-spec.md`（非 stub 时须含「同构模块识别」章节，**R25** 机读）、`develop-task-list.md`；技术选型已确认（须先经 **R26** AskQuestion；R18 机读） | 无阻塞 |
| 开发工程师 | 同上 + `design-problem-list.md` 设计审核通过（R18 全要件）；PM 已分派 | 无阻塞 |
| 质量工程师 | 对应功能代码与单元测试；对应开发线「执行完成」；分派须标明任务包编号 | 无阻塞 |
| 测试工程师（批次） | 本批次 QE 全通过（质量报告清洁）；lint（**R15**）与静态扫描（**R16**）均 `gatePassed=true` | 无阻塞 |
| 测试工程师（最终） | 全部任务包开发+QE+各批次集成测试完成（`batchTestComplete`：含批次 E2E、**R14**、**R17**、**R32**） | 无阻塞 |

> **注意区分**「派发前置」与「阶段完成判据」：批次 E2E、R14、R17、**R32** 都是 TE 要**产出**的成果，不是派发 TE 的前置（否则循环依赖）；它们由 stop 门禁在「推进下一批次 / 发起最终测试 / 宣告完成」时强制（自检见 §5.15，公式见 `mechanical-gates.md` §8.3）。

**模式链**：`hotfix` = PM →（**R20**）→（R9）→ DE → QE → 测试（R11 单次通道，不省 QE/测试）；`docs-only` =（**R20**）文档角色按需，无 DE/QE/测试。R20 见 `workflow-modes.md`；R9 见 `gate-chain.md` 与 `project-manager.toml`。

**用户确认留痕**：凡须确认的事项，PM 须在 `## 用户确认记录` 追加一行（确认项、时间、原话摘要）。

**阶段编排**：每角色或并行批次完成后**必先经 PM 更新进度与下一批分派**，再按 `## 待派发角色列表` 发起下一角色（§5.9）。完整阶段图见 `project-manager.toml` 流程图。

## 7. 文档目录定义

| 目录 | 描述 |
| ---- | ---- |
| docs/requirement | 需求 |
| docs/design | 系统设计（含可选 `gated-artifacts.json`） |
| docs/quality | 代码质量 |
| docs/test | 测试 |
| docs/process | 任务进度 |

模板见 `.codex/templates/`。用户无需手动初始化；PM 首次接收目标时须执行 `node .codex/scripts/bootstrap-docs.mjs`（或等价创建）。Harness/工程化基建归属见 §5.1（DE 执行，顶层不得代写）。

## 8. 路径触发提醒（Cursor `.mdc` 迁移）

Codex 原生 Rules 是沙箱外命令策略，不支持 Cursor `.mdc` 的 glob 提示词注入。以下规则以路径条件常驻；只有命中对应路径时才执行相关核对。

### 8.1 编辑 `docs/**/process.md`

- 编排硬约束以本文件的顶层禁令、回合自检和门禁链摘要为准。
- 模式分诊、R2、R10：`.codex/harness/spec/workflow-modes.md` 与 `project-manager.toml`。
- R9、无效成果物：`.codex/harness/spec/gate-chain.md`。
- 客观公式与 stop 判据：`.codex/harness/spec/mechanical-gates.md`。机械判据以 Hook 为准；禁止绕过 Hook；豁免须同时具备 `gated-artifacts.json` 声明与 `## 用户确认记录`。

### 8.2 编辑 `docs/**/test/**`、`docs/**/quality/**`、`e2e/**`、`test-results/qe/**` 或 `test-results/e2e/**`

- R15/R16（lint / 静态扫描）的执行面见 `quality-engineer.toml`，说明权威见 `mechanical-gates.md` §8.2。
- R14/R17/E2E 与 `gatePassed` 的执行面见 `test-engineer.toml`，说明权威见 `mechanical-gates.md` §8.3。
- `gatePassed != true` 时不得推进下一批次或宣告完成；豁免须满足双要素，仅一项不生效。
- R34：禁止手工创建、编辑或复用 `test-results/**` 机读产物；须在代理 Shell 通道内重跑对应 `*-run.mjs` 取得新的 `execProof`。仅 `test-results/recon/*.json` 可由 TE 基于实际查验手写。
- R38：`toolUnavailable: true` 表示工具/依赖/网络/代理/证书问题，不等于代码质量失败；不得编造违规项或缺陷，须回报 PM，按 R35 标记有据阻塞并询问用户决策。
- 执行权威始终是 Hook / `*-run.mjs`，文档不得单独放宽（R12）。
