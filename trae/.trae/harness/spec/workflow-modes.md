# 工作流模式细则（说明权威）

> **执行权威**：Hook / `workflow-gate-lib.mjs`（含 **R20** 轻量模式确认机读）。
> **编排执行面**：`.trae/agents/project-manager.md`。
> **常驻摘要**：根目录 `AGENTS.md` §4。
> 本节承接原 `AGENTS.md` 工作流模式展开；修改须满足 R12，并与 Hook、PM agent 同步。

## 3. 工作流模式

| 模式 | 生效条件 | 简化说明 |
| ---- | -------- | -------- |
| `full` | 默认；或轻量声明未通过 R20 确认时的 fail-safe | 需求 → 架构 → 设计审核 → 开发 → QE → 测试 |
| `hotfix` | **R20** 用户确认后写入 `workflow_mode: hotfix` | 跳过完整需求分析师与系统架构师阶段，但 PM 必须完成 R9 最小影响澄清（受影响用户、既有行为、回滚条件、P0 判断）且**须已有 `detail-design-spec.md`**；无则按 R9 前置校验先补最小热修设计，见 `gate-chain.md`；测试环节按 **R11** 折叠为单次集成测试+E2E（不区分批次/最终，见 `mechanical-gates.md` §8.2/§8.3） |
| `docs-only` | **R20** 用户确认后写入 `workflow_mode: docs-only` | 仅允许修改 `docs/**/*.md`；Hook 拒绝一切源码写入 |
| `single-task` | **R20** 用户确认后写入 `workflow_mode: single-task` | 仅适用于**单文件级、不改 schema、不加新交互面**的小改动；允许项目经理在一次分派中连续编排 DE → QE → 测试，但仍须逐角色执行、不得代做（见下方 R2 收紧定义） |

> **真实浏览器 E2E 门禁**：批次 + 最终 E2E 为机械门禁（`e2e-run.mjs` 双模式判据），适用范围、`gatePassed` 公式与命令的唯一权威定义见 `mechanical-gates.md` §8.3。

工作流模式须写入当前活跃 `process.md` YAML frontmatter 的 `workflow_mode` 字段。项目经理在接收用户目标时**分诊提议**并经用户确认后记录（见 R20）；**禁止**仅凭关键词或 PM 单方面推断即落盘轻量模式并享受简化路径。

### R20（轻量模式用户确认，唯一权威定义）

轻量模式（`hotfix` / `docs-only` / `single-task`）的目的是降低小改动摩擦，但**不得**因用户不懂口令式术语而绕过确认，也**不得**由顶层/PM 单方面简化。

**生效双要素（缺一则轻量路径不生效）**：

1. **AskUserQuestion 确认**（编排义务，PM）：接收目标后，按下方分诊表提出建议模式，用 **「AskUserQuestion 固定选项文案」** 请用户确认（选项须含模式名 + 流程摘要，不得只给短标签）。用户口头已明确等价意图时，仍须用 AskUserQuestion（或等价显式确认）固化选项，不得跳过。
2. **机读确认行**（Hook，`hasLiteModeConfirmation` / `checkLiteModeConfirmed`）：`## 用户确认记录` 须有一行，确认项含「工作流模式确认」（或 `workflow_mode 确认`），摘要含与声明模式匹配的意图词：
   - `hotfix`：`hotfix` / 热修复 / 热修 / 修 bug
   - `docs-only`：`docs-only` / 只改文档 / 仅改文档 / 仅文档
   - `single-task`：`single-task` / 单任务 / 小改动  
   格式建议：`| 工作流模式确认 | YYYY-MM-DD | 确认采用 workflow_mode: hotfix；AskUserQuestion「修缺陷」 |`

#### AskUserQuestion 固定选项文案（唯一权威，PM 须原样或语义等价使用）

提问前可一句说明建议项（如「建议：修缺陷」）。选项文案如下（标题 + 流程摘要不可省略）：

| 选项标题（人话） | 对应 `workflow_mode` | 须向用户展示的流程摘要（写入选项说明） |
| ---------------- | -------------------- | -------------------------------------- |
| **完整流程** | `full` | 需求 → 架构 → 设计审核 → 开发 → QE → 测试（默认；改动面不清或新增功能时选此项） |
| **修缺陷** | `hotfix` | 跳过完整需求/架构；须已有设计（或先补最小热修设计）+ 影响面澄清 → 开发 → QE → **单次**集成测试+E2E（不区分批次/最终） |
| **只改文档** | `docs-only` | 仅改 `docs/**/*.md`；**禁止**写源码与跑开发门禁；无 DE / QE / 测试 |
| **单文件小改** | `single-task` | 仅单文件级、不改 schema、不加新交互面；角色**不省略**（仍含最小需求确认与设计），可压缩分派节奏：DE → QE → 测试（测试判据与 `full` 同严，不自动折叠为单次） |

> 升级确认（范围扩大改回 `full`）时，至少提供「完整流程」选项并展示上表对应摘要；可附一句说明为何不能继续轻量。

**Fail-safe（R12）**：frontmatter 已写轻量 `workflow_mode` 但缺确认行时：

- `getWorkflowMode()` 按 **`full`** 计算特权路径（R3 豁免、R9/R11、docs-only 禁写、门禁链简化等均不生效）；
- `gate-role-sequence` 对除 `project-manager` / `requirements-analyst` 外的角色 **拒绝** Task，并提示补确认或改回 `full`。

**意图信号（仅用于分诊提议，不可单独落盘）**：用户说「修 bug」「紧急修复」「文档校对」「改个 typo」等，PM 可作为 AskUserQuestion 默认选中项的依据；**禁止**无确认自动写入轻量 `workflow_mode`。口令式关键词（「热修复」「只改文档」「单任务」）降级为信号之一，不再是唯一入口。

**范围扩大**：已确认轻量后若目标扩展到新交互面 / schema / 治理改动，须再经 AskUserQuestion 升级为 `full` 并留痕；禁止静默升权简化。

### 迭代分诊判定表（PM 判定，须 process.md 留痕）

项目经理接收目标时，按下表依次**提议** `workflow_mode` 与 `iterationType`，经 **R20** 确认后写入当前活跃
`process.md` frontmatter（`workflow_mode` / `iterationType`）与流程状态表中留痕：

| 判定维度 | 命中则提议 |
| -------- | ---------- |
| 新增功能 / 新交互面（新页面、新接口、新命令面） | `full` + `feature`（或首次 `greenfield`） |
| 修改数据模型 / schema / 新增迁移 | `full`（禁止 `single-task`） |
| 仅改治理层（AGENTS/hook/config/agent 定义） | `full` + `governance-overhaul` |
| 修复缺陷、无需求/架构变更 | `hotfix`（沿用当前 process.md；须 R20） |
| 仅改 `docs/**/*.md` 文档 | `docs-only`（须 R20） |
| 单文件级、不改 schema、不加新交互面的小改动 | 可 `single-task`（须 R20；仍走完整角色职责，见 R2） |

> `iterationType` 取值仅限：`greenfield` / `feature` / `governance-overhaul` / `hotfix` / `docs-only`；
> 与 `workflow_mode` 协同（如 `governance-overhaul` 通常配 `full`）。缺省判定为 `full` + 对应 `iterationType`。

> **`single-task` 收紧定义（R2）**：仅适用于**单文件级、不改 schema、不加新交互面**的小改动。即便为 `single-task`：
> 1. **必须**保留需求确认记录（`## 用户确认记录` 至少一行）；
> 2. 最小设计**必须由 system-architect 产出**，或体现为 `detail-design-spec.md` 增量；**禁止项目经理代写设计**；
> 3. `single-task` 只压缩**分派节奏**（PM 可一次预写 DE→QE→测试列表），**不跳过任何角色职责**。
> 4. 需求分析师仍须按风险完成最小澄清集：目标、精确改动范围与非目标、可验收结果；若现有行为、受影响用户或约束存在不确定性，必须退出最小集并按苏格拉底罗盘继续澄清，不能以「小改动」免除。

### 迭代模式（文档路径）

| 模式 | `process.md` 路径 | 适用场景 |
| ---- | ----------------- | -------- |
| Greenfield | `docs/process/process.md` | 首次从零开发 |
| Feature | `docs/{feature-名称}/process/process.md` | 功能迭代；需求/设计文档同目录子树 |
| Hotfix | 沿用当前活跃 `process.md` | 紧急修复；`workflow_mode: hotfix`（须 R20） |

并行开发多个 feature 时，各 feature 维护独立 `process.md`，顶层代理仅推进用户当前指定的活跃 feature。

**活跃流程指针**：Hook 默认读取 `docs/process/process.md`；若使用 Feature 迭代，项目经理须执行 `node .trae/scripts/bootstrap-docs.mjs --feature=<feature-名称>` 或等价创建目录，并写入 `.trae/harness-state.json`：

```json
{
  "activeProcessPath": "docs/<feature-名称>/process/process.md",
  "activeFeature": "<feature-名称>"
}
```

临时覆盖可使用环境变量 `HARNESS_PROCESS_PATH` 与 `HARNESS_GATED_ARTIFACTS_PATH`。

### 流程终止（不可逆，R10）

用户可随时明确表达终止某一流程（关键词如「取消」「终止流程」「不要继续了」「放弃这个迭代」，**不含**「取消当前这一步」之类的局部撤回）。触发后：

1. **项目经理必须先用 `AskQuestion` 做不可逆二次确认**，明确告知用户后果：该 `process.md` 将被永久冻结、无法恢复，若之后要继续相关工作须发起新的流程/迭代（新的 `process.md`）。
2. 用户确认后，项目经理在该 `process.md` frontmatter 写入 `cancelled: true`（含 `cancelledAt`、`cancelReason`），并在 `## 取消记录` 追加一行（时间、触发原话摘要、二次确认摘要）。
3. 写入后，该 `process.md` 即被 Hook **永久冻结**（机械门禁，见 `mechanical-gates.md` §8.1）：任何角色（含项目经理本人）均不得再修改/删除该文件；针对该流程的任何开发/初始化操作一律被拒绝；`gate-stop-workflow` 检测到 `cancelled: true` 时直接放行、不再催促推进。
4. 项目经理与顶层代理**不得**、也**无法**（有 Hook 兜底）恢复已取消的流程；用户若要求恢复，须引导其发起新的 feature/迭代，不得声称「已恢复」。
5. 顶层代理对应义务（禁止对已 `cancelled` 流程发起任何角色 Task）见 `AGENTS.md` §5.19。

`cancelled` 语义强于 `blocking`：`blocking` 可由用户确认后解除并继续推进；`cancelled` 不可逆。
