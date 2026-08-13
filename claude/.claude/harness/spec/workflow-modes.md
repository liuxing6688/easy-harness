# Claude Code 适配版本

本文档从 Cursor 版本适配而来。主要变更：
- 路径从 `.cursor` 改为 `.claude`
- Hook 机制改为文档化约束和主动自检
- `Task` 改为 `Agent`，`AskQuestion` 改为 `AskUserQuestion`

---

# 工作流模式细则（说明权威）

> **执行权威**：Hook / `workflow-gate-lib.mjs`（含 **R20** 轻量模式确认机读）。  
> **编排执行面**：`.claude/agents/project-manager.md`。  
> **常驻摘要**：根目录 `CLAUDE.md` §4。  
> 本节承接原 `CLAUDE.md` 工作流模式展开；修改须满足 R12，并与 Hook、PM agent 同步。

## 3. 工作流模式

| 模式 | 生效条件 | 简化说明 |
| ---- | -------- | -------- |
| `full` | 默认；或轻量声明未通过 R20 确认时的 fail-safe | 需求 → 架构 → 设计审核 → 开发 → QE → 测试 |
| `hotfix` | **R20** 用户确认后写入 `workflow_mode: hotfix` | 跳过完整需求分析师与系统架构师阶段，但 PM 必须完成 R9 最小影响澄清（受影响用户、既有行为、回滚条件、P0 判断）且**须已有 `detail-design-spec.md`**；无则按 R9 前置校验先补最小热修设计，见 `gate-chain.md`；测试环节按 **R11** 折叠为单次集成测试+E2E（不区分批次/最终，见 `mechanical-gates.md` §8.2/§8.3） |
| `docs-only` | **R20** 用户确认后写入 `workflow_mode: docs-only` | **禁止**写入源码与构建产物（Hook 拒绝一切受门禁开发路径，含 `e2e/**`）；文档与仓库元文件（`docs/**`、根级 `README.md`、`.gitignore` 等非源码文本）可改。无 DE / QE / 测试 |
| `single-task` | **R20** 用户确认后写入 `workflow_mode: single-task` | **增量迭代档**（2026-07-30 重构，见 **R37**）：在已有基线设计的项目上做一次功能增量。前置须有 `detail-design-spec.md` 且在 `process.md`「## 增量范围」声明**五维**影响面（**需要迁移脚本 / 破坏向后兼容**时禁用本档；数据形状虽变但兼容未破时可用，代价是须声明并落地兼容性回归用例，见 **F-08**）。测试按 **R37** 折叠为**单轮**集成测试 + E2E，但 R14 接口测试 / R17 存储对账 / R32 启动冒烟 / R15 / R16 / R18 **一条不减**；唯一的角色侧简化是豁免 R26 技术选型确认（基线项目已确认过） |

> **真实浏览器 E2E 门禁**：批次 + 最终 E2E 为机械门禁（`e2e-run.mjs` 双模式判据），适用范围、`gatePassed` 公式与命令的唯一权威定义见 `mechanical-gates.md` §8.3。

工作流模式须写入当前活跃 `process.md` YAML frontmatter 的 `workflow_mode` 字段。项目经理在接收用户目标时**分诊提议**并经用户确认后记录（见 R20）；**禁止**仅凭关键词或 PM 单方面推断即落盘轻量模式并享受简化路径。

### R20（轻量模式用户确认，唯一权威定义）

轻量模式（`hotfix` / `docs-only` / `single-task`）的目的是降低小改动摩擦，但**不得**因用户不懂口令式术语而绕过确认，也**不得**由顶层/PM 单方面简化。

**生效双要素（缺一则轻量路径不生效）**：

1. **AskUserQuestion 确认**（编排义务，PM）：接收目标后，按下方分诊表提出建议模式，用 **「AskUserQuestion 固定选项文案」** 请用户确认（选项须含模式名 + 流程摘要，不得只给短标签）。用户口头已明确等价意图时，仍须用 AskUserQuestion（或等价显式确认）固化选项，不得跳过。
2. **机读确认行**（Hook，`hasLiteModeConfirmation` / `checkLiteModeConfirmed`）：`## 用户确认记录` 须有一行，确认项含「工作流模式确认」（或 `workflow_mode 确认`），摘要含与声明模式匹配的意图词：
   - `hotfix`：`hotfix` / 热修复 / 热修 / 修 bug
   - `docs-only`：`docs-only` / 只改文档 / 仅改文档 / 仅文档
   - `single-task`：`single-task` / 单任务 / 小改动 / 增量 / 增量迭代（后两个词随 R37 重构新增；旧词保留，既有项目的确认行不失效）  
   格式建议：`| 工作流模式确认 | YYYY-MM-DD | 确认采用 workflow_mode: hotfix；AskUserQuestion「修缺陷」 |`

#### AskUserQuestion 固定选项文案（唯一权威，PM 须原样或语义等价使用）

提问前可一句说明建议项（如「建议：修缺陷」）。选项文案如下（标题 + 流程摘要不可省略）：

| 选项标题（人话） | 对应 `workflow_mode` | 须向用户展示的流程摘要（写入选项说明） |
| ---------------- | -------------------- | -------------------------------------- |
| **完整流程** | `full` | 需求 → 架构 → 设计审核 → 开发 → QE → 测试（默认；改动面不清或新增功能时选此项） |
| **修缺陷** | `hotfix` | 跳过完整需求/架构；须已有设计（或先补最小热修设计）+ 影响面澄清 → 开发 → QE → **单次**集成测试+E2E（不区分批次/最终） |
| **只改文档** | `docs-only` | **禁止**写源码与构建产物、禁止跑开发门禁；文档与仓库元文件可改；无 DE / QE / 测试 |
| **加个功能（增量迭代）** | `single-task` | 在**已有设计**的项目上加一个功能增量。角色一个不省（RA→SA→RR→DE→QE→TE），但**测试只做一轮**（不再分批次+最终），且**豁免技术选型确认**（沿用基线技术栈）。接口测试 / 存储对账 / 启动冒烟 / lint / 静态扫描 / 设计审核判据**全部保留**。须先声明「增量范围」五维；**需要迁移脚本或破坏向后兼容时本项不可用**，须选「完整流程」。若只是新增可选字段一类**向后兼容且无迁移**的形状变更，本项仍可用，但须声明并落地一条兼容性回归用例（**F-08**） |

> 升级确认（范围扩大改回 `full`）时，至少提供「完整流程」选项并展示上表对应摘要；可附一句说明为何不能继续轻量。

**Fail-safe（R12）**：frontmatter 已写轻量 `workflow_mode` 但缺确认行时：

- `getWorkflowMode()` 按 **`full`** 计算特权路径（R3 豁免、R9/R11、docs-only 禁写、门禁链简化等均不生效）；
- `gate-role-sequence` 对除 `project-manager` / `requirements-analyst` 外的角色 **拒绝** Agent，并提示补确认或改回 `full`。

**意图信号（仅用于分诊提议，不可单独落盘）**：用户说「修 bug」「紧急修复」「文档校对」「改个 typo」等，PM 可作为 AskUserQuestion 默认选中项的依据；**禁止**无确认自动写入轻量 `workflow_mode`。口令式关键词（「热修复」「只改文档」「单任务」）降级为信号之一，不再是唯一入口。

**范围扩大**：已确认轻量后若目标扩展到新交互面 / schema / 治理改动，须再经 AskUserQuestion 升级为 `full` 并留痕；禁止静默升权简化。

### 迭代分诊判定表（PM 判定，须 process.md 留痕）

项目经理接收目标时，按下表依次**提议** `workflow_mode` 与 `iterationType`，经 **R20** 确认后写入当前活跃
`process.md` frontmatter（`workflow_mode` / `iterationType`）与流程状态表中留痕：

| 判定维度 | 命中则提议 |
| -------- | ---------- |
| 新增功能 / 新交互面（新页面、新接口、新命令面） | `full` + `feature`（或首次 `greenfield`） |
| 需要迁移脚本 / 破坏向后兼容的数据模型变更 | `full`（禁止 `single-task`） |
| 数据形状变更但**向后兼容且无迁移**（如新增可选字段） | 可 `single-task`（**F-08**：须声明并落地兼容性回归用例；说不清兼容性时按上一行走 `full`） |
| 仅改治理层（AGENTS/hook/config/agent 定义） | `full` + `governance-overhaul` |
| 修复缺陷、无需求/架构变更 | `hotfix`（沿用当前 process.md；须 R20） |
| 只改文档与仓库元文件（不动源码） | `docs-only`（须 R20） |
| 在已有设计的项目上做一次功能增量（不需迁移、不破坏兼容） | 可 `single-task`（须 R20 + R37 增量范围五维声明；测试折叠为单轮，验证判据不减） |

> `iterationType` 取值仅限：`greenfield` / `feature` / `governance-overhaul` / `hotfix` / `docs-only`；
> 与 `workflow_mode` 协同（如 `governance-overhaul` 通常配 `full`）。缺省判定为 `full` + 对应 `iterationType`。说不清或触达上表强制 `full` 维度时，不得提议轻量模式。

#### `iterationRound`（轮次时效性，**F-09 / F-17** 机读，2026-08-11 v2 评审新增）

`hotfix` 与 `single-task` 都「沿用当前活跃 `process.md`」，而 `## 用户确认记录`、`## 进度列表`、
`design-problem-list.md` 的 `## 审核结论` 都是**单表累积**结构。历史实现只判「表里存在一行合规行」，
于是**第 2 轮起，上一轮的留痕直接为本轮背书**——同一套门禁越往后越松：用户从未为本轮的模式选择
表过态，审核也从未看过本轮的增量设计。

判据（`core.mjs` `getIterationRound` / `mentionsIterationRound` 为执行权威）：

| 项 | 规则 |
| -- | ---- |
| frontmatter | `iterationRound: <正整数>`，缺省 / 非法值一律兜底为 `1` |
| PM 义务 | 同一份 `process.md` 复用于新一轮迭代时，**须**递增本字段（这是「本轮开始」的机读信号） |
| **R20 确认行**（`iterationRound ≥ 2`） | 「工作流模式确认」行须自带本轮轮次标识（`第2轮` / `轮次 2` / `round 2`），否则按未确认处理，fail-safe 回 `full` |
| **R18 审核结论**（`iterationRound ≥ 2`） | `## 审核结论` 最新行须标注本轮轮次，否则拒绝进入开发（`review-conclusion-stale-round`） |
| **R37 增量范围 ↔ 需求编号交叉校验**（`single-task` 且 `iterationRound ≥ 2`） | `## 增量范围` 每个「是否涉及」=`是` 的维度（迁移维除外）须在「说明」列引用至少一个**本轮**新立的 `R-` 编号；`requirement-list.md` 本轮零编号即拒派（`increment-no-round-requirement-ids`），有编号但某维度未引用则拒派（`increment-scope-requirement-unlinked`）。执行权威 `design.mjs#checkIncrementScopeRequirementCrossCheck`，在 **SA 与 DE 两个派发分支**同时生效（只挂 SA 则「跳过 SA 直接派 DE」即可绕过） |

**交叉校验的判据形状（与 R18 需求覆盖矩阵同构）**：本轮编号的认定见 `design.mjs#extractRoundRequirementIds`——
`requirement-list.md` 有 `轮次` / `迭代` 列时取该列，无该列（含出厂模板）时按**行内任一格**带本轮轮次
标识判定（常见写法：「来源确认」列写「第2轮用户确认」）。迁移维（`需要迁移脚本 / 破坏向后兼容`）
不参与本判据：该维为「是」时增量档本就整体失效（`increment-scope-breaking-change`），
再要求它承载需求编号只会给出方向错误的指引。全维皆「否」时不要求本轮编号——没声明改动即无须承载。

该判据要拦的是增量档最典型的失效形态：**声明了「本轮新增对外接口」，需求清单里却没有任何本轮
新立的需求**——即改动绕过了需求澄清与用户确认，直接从「PM 觉得要做」跳到设计与开发。

轮次标识只认「轮次语义 + 数字」的组合，需求编号 `R-002`、年份 `2026`、`第22轮` 都不会被误判为第 2 轮。
`iterationRound: 1`（即绝大多数单轮项目）的判据与历史逐字一致——本条只在多轮场景**加强**，不放松任何既有约束（R12）。

#### `single-task` = 增量迭代档（**R37**，唯一权威定义，2026-07-30 重构）

**重构缘由（须知，决定了下面每一条取舍）**：重构前 `single-task` 在代码里与 `full` **完全等价**
（`workflow-gate-lib.mjs` 只对 `docs-only`/`hotfix` 做特判），本节因此只能写一段
「本模式不省任何验证、若你想少做几步请不要选本项」的劝阻文案——**一个规约自己劝人别用的模式**。
后果是真实可选档位只剩三个：`full`（极重）、`hotfix`（要求已有设计且是缺陷修复）、`docs-only`。
一个已有设计的项目要加个小功能，没有任何可用路径，只能走全量。这不是约束强度问题，是**档位设计缺一层**。

R37 把它重构成名副其实的**增量迭代档**。设计原则只有一条：**省重复劳动，不省验证**。

##### 省什么（两项）

| 简化项 | 内容 | 为什么这样省是安全的 |
| ------ | ---- | -------------------- |
| **测试轮次折叠** | 批次集成测试 + 最终整体集成测试 → **单轮**（`--scope=final` 语义，进度行须含「最终整体集成测试」以便机读） | 一个增量本来就只有一个批次，「先按批次测一遍、再按最终测一遍」测的是同一批改动。折叠消除的是流程冗余，不是覆盖面——与 `hotfix` 的 R11 同一论证 |
| **豁免 R26 技术选型确认** | 不再要求「## 用户确认记录」含技术选型确认行 | 技术栈在基线项目里已经过 AskUserQuestion 确认并落痕，增量迭代不换栈。这是真正「已经做过」的事，不是「跳过没做」 |

##### 不省什么（一条不减）

| 判据 | 在增量档中的状态 |
| ---- | ---------------- |
| **R14 接口测试报告** | **保留**，并入折叠后的单轮判据。与 `hotfix` 的关键差异——热修不新增接口面所以 R11 能跳过，增量功能**常常新增或改动接口**，跳过就等于「小改动免做接口测试」（放松，R12） |
| **R17 存储对账** | **保留**，同上理由（含适用分类型行与 `test-results/recon/*.json` 证据文件） |
| **R32 生产启动冒烟** | 保留（沿用 R11 的并入口径） |
| **R15 lint / R16 静态扫描** | 保留，强度不减 |
| **R18 设计审核**（12 维 + P0 覆盖矩阵 + 摘录锚点窗口） | 保留。增量的设计审核**恰恰**是防止「复制既有实现改两行」的地方 |
| **R25 同构模块识别** | 保留。增量最容易克隆既有代码，本判据在增量场景比在 greenfield 更有价值 |
| **R19 隐性需求记录 / R27 需求摘要确认 / R33 界面期望确认** | 保留（R33 不因「沿用既有界面」自动豁免，须留痕「本次增量无独立界面期望」） |
| **R34 执行证明 / R38 工具不可用分类** | 保留（与模式无关） |
| **兼容性回归用例**（**F-08** 新增） | 走「数据形状变更：是 + 需要迁移/破坏兼容：否」路径时**新增**本判据：声明侧须写进增量范围说明列，执行侧须在本轮唯一测试落地用例行。这是 schema 硬禁用被分档放松所换取的对价，缺失即回退为禁用增量档 |

##### 新增前置（**R37** 机读，缺一不得进入开发）

1. **基线设计存在**：活跃 docs 子树下须有 `detail-design-spec.md`。没有说明这其实是首次开发，
   应走 `full`（判定函数 `checkSingleTaskBaseDesign`）。此条与 `hotfix` 的 R9 设计前置同构——
   目的是防止用增量档绕过基线设计与 R26 选型确认。
2. **`## 增量范围` 五维声明**：`process.md` 须含该章节，五维齐全、「是否涉及」为「是/否」、
   「说明」有实质内容（去标点后 ≥ 4 字）：

   | 影响面 | 机读关键词 | 作用 |
   | ------ | ---------- | ---- |
   | 新增/变更对外接口 | 接口 / `api` | 决定 R14 是否必须落地新用例 |
   | 数据形状变更（新增/修改字段、表、集合） | 数据形状 / 数据模型 / `schema` | 填「是」**不**单独禁用增量档；与下一维组合判定（**F-08**） |
   | 需要迁移脚本 / 破坏向后兼容 | 迁移 / `migration` / 向后兼容 / 破坏性 | **填「是」即禁用增量档**（见下） |
   | 新增交互面（页面/命令/入口） | 交互面 / 新增页面 / 新增入口 / 新增命令 | 决定 E2E 覆盖面 |
   | 影响的既有行为 | 既有行为 / 回归范围 | 决定回归范围 |

3. **破坏性变更硬禁用（原 schema 一刀切，**F-08** 2026-08-11 分档）**：第三维填「是」时
   `checkIncrementScopeDeclared` 直接拒绝（`increment-scope-breaking-change`），须经 AskUserQuestion
   改回 `full`。这条承接本文件「迭代分诊判定表」里**早就写着、但实现里从未校验过**的
   「修改数据模型 / schema ⇒ 禁止 `single-task`」（R12：文档强于实现须补实现），但判据由
   「碰没碰数据」改为「**破没破坏兼容**」——理由：迁移与不兼容变更的兼容面与回滚面超出单轮
   折叠测试的覆盖能力，而「新增一个可选字段」并不。分档属放松方向，已按 R12 经用户确认并在
   `mechanical-gates.md` §8.5 留痕。

4. **「形状变、兼容未破」路径的对价（**F-08** 新增判据）**：第二维「是」+ 第三维「否」时增量档
   **可用**，但须①在这两维的「说明」列写明**兼容性回归用例**（缺则
   `increment-scope-missing-compat-regression` 拒绝派发）；②在折叠通道的唯一测试轮次里落地该
   用例的执行记录（`checkIncrementCompatRegressionReport`，进入 `finalTestComplete`，缺则 stop
   门禁不放行收尾）。**不得**由被约束方自行论证「我这个 schema 变更很小所以不算」——「是否需要
   迁移 / 是否破坏兼容」是一次如实声明；声明「否」却实际提交迁移脚本属虚假声明。

> 判定函数：`checkSingleTaskPreconditions` / `checkIncrementScopeDeclared` / `checkSingleTaskBaseDesign`
> （`iteration.mjs`）；折叠判据见 `parseWorkflowState` 的 `foldedTestChannel`
> （`dispatch.mjs`）与 `mechanical-gates.md` §8.2/§8.3。回归：`selftest/r37-single-task.mjs`、
> `scenarios/audit-fixes.mjs` AF11–AF14。

> **`single-task` 角色职责底线（R2，保留）**：折叠的是**测试轮次与编排节奏**，不是角色职责。即便为 `single-task`：
> 1. **必须**保留需求确认记录（`## 用户确认记录` 至少一行）；
> 2. 增量设计**必须由 system-architect 产出**（体现为 `detail-design-spec.md` 增量或增量小节）；**禁止项目经理代写设计**；
> 3. PM 可一次预写 DE→QE→测试列表以减少编排往返，但**不跳过任何角色**；
> 4. 需求分析师仍须按风险完成最小澄清集：目标、精确改动范围与非目标、可验收结果；若现有行为、受影响用户或约束存在不确定性，必须退出最小集并按苏格拉底罗盘继续澄清，不能以「改动小」免除。

##### 选型速查

- 加功能、已有设计、不改 schema ⇒ **`single-task`**（单轮测试，判据全留）。
- 加功能、但要改 schema / 首次开发 / 改动面说不清 ⇒ **`full`**。
- 修既有缺陷 ⇒ **`hotfix`**（R11 折叠，且跳过 R14/R17，代价是须已有设计 + R9 影响面澄清）。
- 只动文档与仓库元文件（不碰源码、构建产物与 `e2e/**`）⇒ **`docs-only`**。

### 迭代模式（文档路径）

| 模式 | `process.md` 路径 | 适用场景 |
| ---- | ----------------- | -------- |
| Greenfield | `docs/process/process.md` | 首次从零开发 |
| Feature | `docs/{feature-名称}/process/process.md` | 功能迭代；需求/设计文档同目录子树 |
| Hotfix | 沿用当前活跃 `process.md` | 紧急修复；`workflow_mode: hotfix`（须 R20） |
| Single-task（增量档） | 沿用当前活跃 `process.md`，或按 Feature 建独立子树 | 增量迭代；`workflow_mode: single-task`（须 R20） |
| Docs-only | 沿用当前活跃 `process.md` | 只动文档与仓库元文件；`workflow_mode: docs-only`（须 R20） |

> **F-07（2026-08-11 审核修复）**：本表历史上只有前三行，**没有 `single-task` 行**，于是 R37 前置
> 「活跃 docs 子树下须有 `detail-design-spec.md`」与「Feature 迭代新建独立子树」两条规约互相打死：
> 新建的 feature 子树刚 bootstrap 出来必然没有设计文档，增量档在它最该适用的场景里 100% 不可用。
> 现两种路径都合法：**沿用活跃 `process.md`**（与 hotfix 同构，进度表混叠但零额外配置），
> 或**新建 feature 子树**——后者的基线设计可来自父级 greenfield 子树，
> `checkSingleTaskBaseDesign()` 在活跃子树缺失时回落判 `docs/design/detail-design-spec.md`。
> 判据未放松（R12）：两处都没有基线设计仍判 `single-task-base-design-missing` 并要求改走 `full`。
>
> **回落范围限定（实现侧，须知）**：父级回落**只对 Feature 布局生效**——活跃流程须形如
> `…/docs/<feature>/process/process.md`（即活跃 docs 子树的父目录名恰为 `docs`），父级基线取
> 同一 docs 树的 `…/docs/design/detail-design-spec.md`。非 feature 布局（含 greenfield 根子树、
> 自定义路径）**不给回落**，否则任意路径的流程文件都能借用仓库根的设计文档。调用方可据
> `reason` 区分基线来源：`checked`（活跃子树自有）/ `checked-parent-baseline`（来自父级）。
> 执行权威 `iteration.mjs#checkSingleTaskBaseDesign`。
>
> **F-07 加固（本表缺行已机械化）**：F-07 的根因是「代码里有这个模式、本表里没有这一行」。
> 该漂移现由 `selftest/templates-vs-gates.mjs` 的「模式 ↔ 文档路径表」用例拦截：
> `core.mjs#LITE_WORKFLOW_MODES` 的每个取值加 `full`，都必须在本表中有对应行，
> 新增模式而不补行即红。`docs-only` 行就是本轮据此补上的——它此前与 `single-task` 同属缺行。

并行开发多个 feature 时，各 feature 维护独立 `process.md`，顶层代理仅推进用户当前指定的活跃 feature。

**活跃流程指针**：Hook 默认读取 `docs/process/process.md`；若使用 Feature 迭代，项目经理须执行 `node .claude/scripts/bootstrap-docs.mjs --feature=<feature-名称>` 或等价创建目录，并写入 `.claude/harness-state.json`：

```json
{
  "activeProcessPath": "docs/<feature-名称>/process/process.md",
  "activeFeature": "<feature-名称>"
}
```

临时覆盖可使用环境变量 `HARNESS_PROCESS_PATH` 与 `HARNESS_GATED_ARTIFACTS_PATH`。

### 流程终止（不可逆，R10）

用户可随时明确表达终止某一流程（关键词如「取消」「终止流程」「不要继续了」「放弃这个迭代」，**不含**「取消当前这一步」之类的局部撤回）。触发后：

1. **项目经理必须先用 `AskUserQuestion` 做不可逆二次确认**，明确告知用户后果：该 `process.md` 将被永久冻结、无法恢复，若之后要继续相关工作须发起新的流程/迭代（新的 `process.md`）。
2. 用户确认后，项目经理在该 `process.md` frontmatter 写入 `cancelled: true`（含 `cancelledAt`、`cancelReason`），并在 `## 取消记录` 追加一行（时间、触发原话摘要、二次确认摘要）。
3. 写入后，该 `process.md` 即被 Hook **永久冻结**（机械门禁，见 `mechanical-gates.md` §8.1）：任何角色（含项目经理本人）均不得再修改/删除该文件；针对该流程的任何开发/初始化操作一律被拒绝；`gate-stop-workflow` 检测到 `cancelled: true` 时直接放行、不再催促推进。
4. 项目经理与顶层代理**不得**、也**无法**（有 Hook 兜底）恢复已取消的流程；用户若要求恢复，须引导其发起新的 feature/迭代，不得声称「已恢复」。
5. 顶层代理对应义务（禁止对已 `cancelled` 流程发起任何角色 Agent）见 `CLAUDE.md` §5.19。

`cancelled` 语义强于 `blocking`：`blocking` 可由用户确认后解除并继续推进；`cancelled` 不可逆。
