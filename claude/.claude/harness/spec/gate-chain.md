# Claude Code 适配版本

本文档从 Cursor 版本适配而来。主要变更：
- 路径从 `.cursor` 改为 `.claude`
- Hook 机制改为文档化约束和主动自检
- `Task` 改为 `Agent`，`AskQuestion` 改为 `AskUserQuestion`

---

# 成果物门禁链细则（说明权威）

> **执行权威**：`gate-role-sequence.mjs` / `workflow-gate-lib.mjs`（R13 等客观条件）。  
> **编排执行面**：`.claude/agents/project-manager.md`（R9/分派自检）。  
> **常驻摘要**：根目录 `CLAUDE.md` §6 摘要表。  
> 本节承接原 `CLAUDE.md` 门禁链展开（含 R9、无效成果物、用户确认留痕）。

派发下一角色前，须满足下列前置成果物（`full` 模式首次开发路径）。**R13**：本表中客观可判定的前置条件（成果物文件是否存在、设计问题清单/质量报告表格是否有未解决项、**R18 设计问题清单结构与 P0 需求覆盖矩阵**）已由 `gate-role-sequence.mjs` 在 Agent 发起前机械校验（见 `mechanical-gates.md` §8.1）；下表文字描述仅为可读性摘要，实际判定以 Hook 为准。调用者身份判定（是否为顶层代理越权）不可机械化，继续由 R8 文字约束承担。

> **质量工程师前置（R13 机读）**：下表「质量工程师」行「对应开发线状态为执行完成」由 `checkRoleDispatchGate('quality-engineer')` 机械校验——须在「## 当前分派计划」或「## 待派发角色列表」标明本次审查的**任务包编号**（角色列为 `quality-engineer`），并逐包核验「## 进度列表」中对应开发工程师行最新状态为「执行完成」。缺任务包编号、或任一目标包仍为「正在执行」/未找到开发行时拒绝发起。项目经理分派前与 QE 接受审查前仍应对照进度表自检；语义类问题（代码是否真完成、范围是否正确）仍由文字约束兜底。

| 下一角色 | 必须已存在且有效的成果物 | 流程状态要求 |
| -------- | ------------------------ | ------------ |
| 需求分析师 | 项目经理已记录用户目标于 `process.md` | 无阻塞 |
| 系统架构师 | `requirement-spec.md`（含结构完整、关联需求与 §7 追溯的「隐性需求确认记录」，R19 机读）、`requirement-list.md`；用户已确认需求摘要；`## 用户确认记录` 含「界面与交互期望」确认行（**R33** 机读；技术选型行不能顶替，无 UI 项目须留痕「不适用」） | 无阻塞 |
| 需求评审专家 | `detail-design-spec.md`、`develop-task-list.md`；用户已确认技术选型（须由系统架构师 AskUserQuestion 请用户确认，R26；`## 用户确认记录` 含技术选型/技术栈确认行，R18 机读）；非 stub 设计文档须含「同构模块识别」章节（同构组+共享 primitive 非空，或声明「已排查，无同构资源族」+ 依据，R25 机读） | 无阻塞 |
| 开发工程师 | 同上 + `design-problem-list.md` 设计审核通过（R18：12 维齐全、可修复字段完备、P0 覆盖矩阵含验收标准与设计落点原文摘录且全部「已覆盖」、审核结论为通过/复审通过、无未解决问题）；项目经理已完成分派 | 无阻塞 |
| 质量工程师 | 开发任务对应的功能代码与单元测试；对应开发线状态为执行完成 | 无阻塞 |
| 测试工程师（批次集成测试） | 本批次开发线对应的质量审核全部通过（质量报告无未解决高/中严重问题、`质量判定` 通过）；**R15 lint `gatePassed=true`**；**R16 静态扫描两项子检查均 `gatePassed=true`** | 无阻塞 |
| 测试工程师（最终整体集成测试） | 全部任务包的开发、QE 与**各批次集成测试**（含各批次 E2E、R14、R17）均已完成——即 `batchTestComplete` 为真 | 无阻塞 |

> **「派发前置」与「阶段完成判据」须分开看（历史表述纠正）**：本表列的是**发起该角色 Agent 前**必须满足的条件（执行权威：`checkRoleDispatchGate`）。批次 E2E、R14 接口测试报告、R17 存储对账、**R32 生产启动冒烟**都**不是**派发 test-engineer 的前置——它们正是 TE 本人要产出的东西，把它们写成派发前置会构成循环依赖（本表旧版曾如此表述，实现从未如此）。这几项的真实约束点在**该阶段完成之后**：由 `gate-stop-workflow` 在「推进下一批次 / 发起最终测试 / 宣告完成」时强制（`batchTestComplete` = 批次测试行完成 && `batchE2ePassed` && `batchApiReportPresent` && `batchStorageReconPresent` && `startupSmokePassed`），公式见 `mechanical-gates.md` §8.2/§8.3。
>
> **两级集成测试 + E2E 机械门禁**：测试工程师执行两类集成测试——①**批次集成测试**：每批次 QE 通过后对本批次新交付任务包做集成测试，`gatePassed≠true` 时视为本批次集成测试未完成，**不得推进下一批次**；②**最终整体集成测试**：全部任务包与各批次 E2E 闭环后对整个产品做端到端集成测试，`gatePassed≠true` 时**不得宣告项目完成**。`测试判定`（最终交付依据）以**最终整体集成测试**（含最终 E2E）结论为准。执行命令、产物路径、浏览器范围与 `gatePassed` 公式的唯一权威定义见 `mechanical-gates.md` §8.3。

**`hotfix` 模式门禁链**：项目经理记录目标 →（**R20** 工作流模式确认）→（**R9** 最小影响澄清 + 设计前置校验）→ 开发工程师 → QE → 测试；跳过完整需求分析师与系统架构师阶段，但**不跳过** PM 分派与 QE/测试。

> **R20（轻量模式确认）**：`hotfix`/`docs-only`/`single-task` 须 AskUserQuestion +「工作流模式确认」机读行后才生效；定义见 `workflow-modes.md`。未确认时 `getWorkflowMode` 按 `full`，且 `gate-role-sequence` 拒绝受门禁角色。

> **R34 / R38（对全部模式恒成立，不进入门禁链分支）**：R15/R16/R32 与批次+最终 E2E 的机读产物须通过**执行证明验签**（**R34**），且失败时先分辨是「检查工具不可用」还是「检查未通过」（**R38**）。两者都不新增门禁，而是给既有五项判据加了统一前置——判据链为「豁免 → 产物存在 → R34 验签 → R38 性质分类 → `gatePassed`」（`evaluateGateArtifact`）。唯一权威定义见 `mechanical-gates.md` §8.8。

> **R9（hotfix 设计/E2E 前置校验）**：hotfix 虽豁免 R3 四件成果物，但进入开发前 PM 须校验前置，任一不满足**不得**分派开发工程师，须标记 `blocking` 并 `AskUserQuestion` 请用户决策：
> 1. **设计存在性**（机械门禁，`checkHotfixDesign`）：当前活跃 `process.md` 基目录下须存在 `detail-design-spec.md`。缺失时，PM 可分派 **system-architect** 执行「最小热修设计微任务」（仅补 bug 影响面涉及的设计章节，见 `system-architect.md`），或由用户指认既有设计路径——**禁止**项目经理或顶层代理代写设计（R5）。
> 2. **E2E 适用性可解析**（文字约束，无机械兜底）：项目有 UI 且 `e2e/specs/**` 已有对应 P0 用例，**或** `gated-artifacts.json` 已声明 `e2eApplicability:"n/a"` 且 `## 用户确认记录` 含 E2E 豁免（`mechanical-gates.md` §8.3）。两者皆无时，PM 请用户确认豁免后由 **system-architect** 在同一微任务内补写 `gated-artifacts.json`。
> 3. **最小影响澄清与 P0 影响面**（机械门禁，`checkHotfixP0Impact`；**2026-07-29 起在 Agent 发起期与写入期双点校验**——历史实现只在 `checkRoleDispatchGate` 拦，导致「DE Agent 被拒但已在 DE 上下文内的源码写入照样放行」，现 `assertDevGateOrDeny` 同步校验）：frontmatter 须声明 `hotfix_p0_impact: none` 或 `p0`；**声明 `none` 时，须在 `## 用户确认记录` 补一行「hotfix影响面」记录，写明受影响用户、既有行为是否变化、回滚条件、排查的 P0 编号及排除依据，供 Hook 机读**。这是 hotfix 对完整 RA 苏格拉底澄清的最低补强，项目经理必须向用户核验，不得自行推断；若为 `p0`（热修影响 P0 行为），须改走 `full` 或先完成 R18 需求评审通过后再分派 DE。
> 4. **P0 影响的接口/存储软性提醒**（非阻塞，本次报告结构化章节检测，`checkHotfixP0InterfaceStorageMention`/`recordHotfixP0SoftReminder`）：`hotfix_p0_impact: p0` 时，R14/R17 机读硬门禁仍**不并入** hotfix 折叠通道（见 `mechanical-gates.md` §8.3 适用范围）；但 `gate-stop-workflow` 在唯一测试通道（最终 E2E `gatePassed=true`）完成后，会对**本次**测试报告（`process.md` 显式引用的 `docs/.../test/*.md`，否则规范名 `test-report.md`；**不扫描**整个 `docs/test/` 以免历史报告抑制提醒）校验是否含非空「## 接口测试报告」「## 存储对账记录」真实数据行，缺失时向 `process.md` 追加一次性「## 门禁软性提醒（非阻塞）」记录，**不阻塞收尾、不影响 `gatePassed`**，仅供 PM/人工审查时留意本次热修是否实际涉及接口或业务数据存储、是否需要补充验证记录。
>
> hotfix 只在前端省去 RA/SA，**后端 QE + 集成测试 + E2E 一律不省**（`mechanical-gates.md` §8.3 适用范围含 hotfix）；但测试环节按 **R11** 折叠为单次通道（不再区分批次集成测试与最终整体集成测试，见 `mechanical-gates.md` §8.2/§8.3），消除"一次性小改动被迫走两轮测试工程师"的流程冗余，严格程度不降低。

**`single-task` 模式门禁链（增量迭代档，**R37**）**：项目经理记录目标 →（**R20** 工作流模式确认）→（**R37** 前置：基线 `detail-design-spec.md` 存在 + `## 增量范围` 五维声明 + 破坏性变更禁用 + F-08 兼容性回归对价）→ 需求分析师（最小澄清集，仍含 R19/R27/**R33**）→ 系统架构师（增量设计，**跳过阶段 1 技术选型**）→ 需求评审专家（R18 全量 + R25，**豁免 R26 选型确认**）→ 开发工程师 → QE（R15/R16）→ 测试工程师（**单轮**集成测试 + E2E + R14 + R17 + R32）。

> **R37（`single-task` 增量档前置校验）**：与 R9 同构地在 **Agent 发起期**校验（`checkSingleTaskPreconditions`，对 `system-architect` 与 `development-engineer` 生效）：
> 1. **基线设计存在**（`checkSingleTaskBaseDesign`）：活跃 docs 子树须有 `detail-design-spec.md`。缺失说明这其实是首次开发，须改走 `full`——不得用增量档绕过基线设计与 R26 选型确认；
> 2. **增量范围五维声明**（`checkIncrementScopeDeclared`）：`process.md`「## 增量范围」须五维齐全、「是否涉及」为「是/否」、「说明」有实质内容。这张表是「折叠成一轮测试」的论证依据；
> 3. **破坏性变更硬禁用**：「需要迁移脚本 / 破坏向后兼容」维填「是」时直接拒绝派发（`increment-scope-breaking-change`），须 `AskUserQuestion` 改回 `full`（承接 `workflow-modes.md` 分诊表早有、实现里从未校验的规则，R12）；
> 4. **兼容性回归对价**（**F-08**）：「数据形状变更：是 + 需要迁移/破坏兼容：否」时增量档可用，但两维说明列须声明**兼容性回归用例**（缺则 `increment-scope-missing-compat-regression` 拒绝派发），且本轮唯一测试须落地该用例（stop 门禁机读 `checkIncrementCompatRegressionReport`）。
>
> 与 hotfix 的关键区别：`single-task` 的折叠通道**保留** R14 接口测试与 R17 存储对账（增量常新增接口与写入路径），只有 hotfix 才跳过这两项。唯一的角色侧简化是豁免 R26 技术选型确认。完整定义见 `workflow-modes.md`「`single-task` = 增量迭代档」。

**`docs-only` 模式门禁链**：项目经理记录目标 → 需求/设计文档角色（按需）→ 无开发/QE/测试。

**无效成果物**（视为未产出，不得用于推进流程）：

- `design-problem-list.md` 设计审核未通过：存在未解决问题，或缺 R18 机读要件（12 维/可修复字段/`## 需求覆盖矩阵` 含验收标准/P0 全部「已覆盖」/`## 审核结论` 为通过或复审通过）
- 未经用户确认的需求文档
- `requirement-spec.md`「6. 隐性需求确认记录」缺少完整、枚举合法、关联 `R-编号` 与 §7 追溯的真实数据行，或待决假设未注明责任方与最晚决策点（R19，`gate-role-sequence` 拒绝发起 system-architect）
- `process.md`「## 用户确认记录」缺少「界面与交互期望」确认行——即用户只确认了功能摘要、对交付物「长什么样」零表态（**R33**，`gate-role-sequence` 拒绝发起 system-architect；`hotfix`/`docs-only` 豁免）
- 测试环节缺生产启动冒烟通过证据：`test-results/e2e/.startup-smoke-result.json` 缺失、`gatePassed≠true`、缺「强杀后再启动」段，或结果超出新鲜度上限（**R32**，`gate-stop-workflow` 拒绝推进下一批次与收尾）
- 仅有 `tech-stack-options.md` 而无 `detail-design-spec.md`
- 设计文档技术栈未经用户明确确认（`## 用户确认记录` 无技术选型/技术栈确认行）
- 非 stub 的 `detail-design-spec.md` 缺少「同构模块识别」章节，或章节为空、表格无真实数据行、或「已排查，无同构资源族」声明缺排查依据（R25，`gate-role-sequence` 拒绝发起 requirement-reviewer；`hotfix`/`docs-only` 豁免）
- `process.md` 处于阻塞状态
- 开发任务未经项目经理分派即已有业务代码
- `process.md` 缺少 `## 当前分派计划`、表中仅有空白占位行（无真实分派数据行），或任务包编号无法对应 `develop-task-list.md`
- 开发尚未开始时，`process.md` 缺少有效 `## 待派发角色列表`；开发工程师已处于「正在执行」后，可视为待派发列表已被消费，但 `## 当前分派计划` 仍须保留有效数据行
- `develop-task-list.md` 缺少 §3 分派方式分析或「整体分派模式」
- 通过 Shell 重定向、`tee`、脚本批量写入等方式绕过 Hook
- 在 `docs/` 下写入非文档扩展名文件（`.md/.mdx/.txt` 之外，`docs/**/design/gated-artifacts.json` 例外）——**按受门禁源码路径处理**：无有效分派计划或流程阻塞/取消时 `gate-dev-workflow` 拒绝；开发阶段存在有效分派计划时，与其它受门禁源码同等放行（非无条件拦截）
- 一个 QE Agent 覆盖多条开发线，但 `## 当前分派计划` 未显式标注为「批量/全量审查」并列明全部任务包编号，或未对每个任务包分别给出结论与对应 `quality-report` 章节
- 质量审核以**抽样**方式核查单元测试（未对任务包功能单元逐一核查、未运行该任务包**全量**单元测试套件）
- QE 记录完成但编程规范 lint 门禁未通过（`test-results/qe/.lint-result.json` 缺失或 `gatePassed≠true`，且未满足 R15 双要素豁免）
- QE 记录完成但静态代码质量门禁未通过（`test-results/qe/.static-scan-result.json` 缺失或重复代码/安全扫描任一 `gatePassed≠true`，且未满足 R16 对应双要素豁免）
- 仅完成各批次集成测试、未执行**最终整体集成测试**即据以宣告项目完成
- 批次/最终 E2E 缺结果产物（`.e2e-batch-result.json` / `.e2e-final-result.json`）、`gatePassed≠true`、或任一浏览器 `missingIds` 非空 / 存在未解释 skip
- 非 `hotfix`/`docs-only` 迭代缺任一四件成果物（`requirement-spec.md`、`requirement-list.md`、`detail-design-spec.md`、`develop-task-list.md`）或未被 `process.md` 引用时，`gate-dev-workflow` / `gate-dev-shell` 机制拒绝（R3）
- 试图在 `cancelled: true` 的 `process.md` 上继续推进流程或将其作为分派依据（R10，机制拒绝：`isCancelledProcessFile` 冻结写入；`gate-role-sequence` 另拒绝对该流程发起除 `project-manager` 外的**全部**角色 Agent）

> **R10 的 `project-manager` 例外（必要逃生口）**：取消后 `.claude/harness-state.json` 仍指向已冻结的 `process.md`，若连 PM Agent 也拒绝，用户将无法建立新流程 → 死锁。故机械层只放行 PM，且 PM 对该文件本身的任何写入仍被冻结拦死（PM 只能引导并创建**新**流程/迭代的 `process.md`）。`CLAUDE.md` §5.19 的「含 PM」应理解为「PM 同样不得在该流程上继续推进或改写它」，而非「PM Agent 不可发起」。

**用户确认留痕**：凡须用户确认的事项（需求摘要、**界面与交互期望（R33）**、技术选型、**工作流模式（R20）**等），项目经理须在 `process.md` 的 `## 用户确认记录` 表中追加一行，含确认项、时间、用户原话摘要。**界面与交互期望须独立成行**——技术栈/组件库确认不等于界面期望确认（`mechanical-gates.md` §8.6）。轻量模式另须满足 `workflow-modes.md` R20 机读格式，否则 Hook 按 `full` 处理并拒绝受门禁角色 Agent。**收敛型用户确认须用 AskUserQuestion**：技术选型（**R26**，system-architect 阶段 1）、需求摘要「确认/需要修改」粗判断（**R27**，requirements-analyst 阶段二）与工作流模式（R20）三处均不得仅以自由文本代替选项化确认；AskUserQuestion 的实际使用不可机械化，仅确认记录的结构性存在由 Hook 校验。

