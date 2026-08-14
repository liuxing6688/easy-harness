# Claude Code 适配版本

本文档从 Cursor 版本适配而来。主要变更：
- 路径从 `.cursor` 改为 `.claude`
- Hook 语法适配：Claude Code 使用 JSON 配置 + Shell 脚本，Cursor 使用不同的 API
- 功能等价：PreToolUse 可阻止工具调用，Stop 可阻止回合结束
- `Task` 改为 `Agent`，`AskQuestion` 改为 `AskUserQuestion`
- **跨平台修复**：所有路径检测函数已规范化处理 Windows 反斜杠

**技术强制验证**：
- Claude Code 官方文档：https://code.claude.com/docs/en/hooks
- 实际测试证明：PreToolUse hook 成功阻止了违规操作
- 返回 `permissionDecision: "deny"` 可直接阻止工具执行
- 模型无法绕过 hook 决策，这是引擎层面的拦截

---

# 流程门禁 Hook 与机械判据（说明权威）

> **执行权威**：`.claude/hooks/**`、`.claude/scripts/*-run.mjs`、`workflow-gate-lib.mjs`（客观判据以代码为准）。  
> **角色操作摘要**：QE → `quality-engineer.md`（R15/R16）；TE → `test-engineer.md`（R14/R17/E2E）；SA → `system-architect.md`（双要素豁免声明）。  
> **常驻摘要**：根目录 `CLAUDE.md`（禁止绕过 Hook、门禁链表、顶层自检）。  
> 本节承接原 CLAUDE.md §8；修改行为须同步升级 Hook/脚本（R12），不得仅改本文放宽判据。

## 8. 流程门禁 Hook（机械约束）

本项目通过 Claude Code Hook 对高风险操作做**确定性拦截**，与 `CLAUDE.md` §5 文字规则互补。Hook 注册的**唯一权威源**是 `.claude/settings.json`（`.claude/hooks/hooks.json` 不是 Claude Code 支持的配置位置，放在那里永不加载）。门禁路径与 Shell 模式以 `harness.config.json` 为默认，并与当前活跃 `docs/**/design/gated-artifacts.json`（可选，架构师维护）合并。活跃路径由 `.claude/harness-state.json` 或 `HARNESS_PROCESS_PATH` 决定。

### 8.1 Hook 一览

| Hook | 触发时机 | 拦截范围 | 放行条件 |
| ---- | -------- | -------- | -------- |
| `gate-dev-workflow-enhanced` | `PreToolUse`（matcher `Write|Edit`） | 源码/构建/根敏感路径（同前）+ **R6** `.claude/scripts\|agents\|hooks/**` + **`docs` 角色成果物**（`requirement`/`design`/`quality`/`test`/`process.md`，见 `isGatedRoleArtifactPath`）；`docs/` 下非文档扩展名亦按源码门禁；**R6 加强**：代码扩展名默认受门禁（豁免目录见 `gatedPaths.extensionGateExemptDirs`，§8.5）；**R29**：门禁自治资产（运行时标记 / 授权凭证 / 门禁配置与权威文本，**含 `.claude/rules/**.md`**）一律 deny。仍豁免：templates（见 `dotClaudeExemptPatterns`） | 判定顺序：**R10 cancelled** → **R29 自治资产** → **R5 身份基准健康度告警** → **R5 顶层 conversation_id** → **R5 角色↔路径** →（仅源码路径）`docs-only`/分派计划/**R3**/**R9**/阻塞 → 放行 |
| `gate-dev-shell` | `PreToolUse`（matcher `Bash|PowerShell`） | `harness.config.json` 中 `gatedShellPatterns` 及项目额外模式（项目初始化、依赖安装等）；**R22**：最近派发为 `test-engineer` 时另拦截替代 E2E 启动命令（`checkTeAlternativeE2eStartup`，见 §8.4）；**R28**：写文件类命令按目标路径套用与 Write 同等判据（§8.5） | 判定顺序：R22 TE 冒烟 → **R28 写文件意图**（R29 自治资产 / opaque 写入 / 目标路径判据）→ `gatedShellPatterns` 命中则同 `gate-dev-workflow` 放行条件（含 R3/R9/R10） |
| `gate-toolchain-install` | `PreToolUse`（matcher `Bash|PowerShell`） | `harness.config.json` 中 `toolchain.installPatterns`（winget、brew、apt、mise、asdf、nix、VS Build Tools 等） | 存在有效 `.toolchain-install-approved.json`：须 `userConfirmed: true` + 有效时间戳 + **`commandHash` 与本次命令匹配**（**R29 加强**，§8.5） |
| `gate-role-sequence`（**R13**） | `PreToolUse`（matcher `Agent`） | 发起角色 Agent 前按门禁链机械校验（同前：R19/**R33**/R18/R15/R16 等）；**R10**：活跃流程 `cancelled` 时拒绝除 `project-manager` 外的**全部**角色（先于「不在门禁表即放行」的短路）；**R20**：声明轻量模式但缺「工作流模式确认」时拒绝除 PM/RA 外角色；**放行或 fail-open 前**对可解析角色执行 `recordDispatchedRole`（供 R5 角色↔路径） | 前置条件满足；或目标角色不在门禁表中（`project-manager`/`requirements-analyst` 恒放行，但仍落盘派发记录）；或解析不到目标角色名；`failClosed: false`。**能力边界（F-27）**：本 Hook 校验的是「下一角色所需成果物是否已存在且有效」（R13 门禁链），**不校验 frontmatter `phase` 的阶段序关系**——规约未定义 `phase` 的取值域与偏序，出厂模板即处于 `phase: requirement` 且在成果物齐备时允许直接发起 system-architect（回归 `scenarios/finding1.mjs` B1）。故 **R8「不得跳过前一角色」的阶段顺序维度由 `CLAUDE.md` §5.8 文字约束承担**，机械层拦的是「前一角色成果物未落地就派后一角色」。多轮迭代下成果物恒在，此时区分度由 **F-09/F-17 轮次时效判据**（`iterationRound`）承担 |
| `gate-subagent-track`（**R5**） | `SubagentStart` | 仅记录顶层 `conversation_id`（TTL 内不覆盖、超 TTL 自愈，见 §8.5）；从不 deny | 恒 `allow`（fail-open） |
| `gate-stop-workflow` | `Stop` | 代理拟结束回合时流程未完成（含 **R15 编程规范 lint 门禁未通过**、**R16 静态代码质量门禁未通过**、**R32 生产启动冒烟无通过证据**、**R31 回退计数超上限**） | 见下方 **stop 门禁判据**；`blocking: true` 或 **`cancelled: true`（R10）** 时放行 |

Hook 解析 `## 进度列表` 时同时识别中文角色名与 `.claude/agents` 的 agent slug（如 `开发工程师` / `development-engineer`），项目经理可按 Agent 实际发起名称留痕。

### 8.2 stop 门禁判据（gate-stop-workflow）

**`gate-stop-workflow` stop 门禁判据**（按优先级顺序，命中即注入 `followup_message`）：

| 判据 | 触发条件 | followup 要点 |
| ---- | -------- | ------------- |
| 放行（不可逆取消） | `cancelled`（R10） | 已取消的流程不再被催促推进，直接放行 |
| **阻塞释放证据**（**R35**） | `blocking && !checkBlockingReleaseEvidence().ok` | 阻塞态**不再无条件放行**：须有机器起源依据（`## 门禁异常事件`有未处理行，**且**与 Hook 独占写入的旁路台账指纹对得上、尚未用过），或同时具备实质「## 阻塞原因」+「## 用户确认记录」中的阻塞决策留痕。缺证据时注入 followup 要求补齐或解除阻塞（唯一权威定义见 §8.8） |
| 放行（阻塞且证据齐备） | `blocking && checkBlockingReleaseEvidence().ok` | 等待用户决策，stop 不追加催促 |
| 放行（全流程测试闭环） | `finalTestRequired && finalTestComplete && lintPassed && staticScanPassed`（R15/R16） | 全部开发+QE+批次测试（含批次 E2E）+**最终整体集成测试**（含最终 E2E）+**编程规范 lint 门禁**+**静态代码质量门禁**均通过；`hotfix`（R11）与 `single-task`（**R37**）折叠通道下 batch 相关判据恒真（见下方 R11 / §8.8 R37） |
| 开发进行中 | `devInProgress` | 分派 QE |
| 待分派 QE | `devComplete && !hasQeRecord` | 分派 quality-engineer |
| QE 未完成 | `devComplete && hasQeRecord && !qeComplete` | 继续 QE |
| **执行证明未通过**（**R34**，非 docs-only） | `qeComplete && execProofFailedGates.length > 0` | 机读产物未通过验签（手写 / 篡改 / 未经门禁签发）。要求对应角色**重新实际运行**运行器，禁止手工编辑 `test-results/**`。**优先于**下方各门禁自身的推进文案——否则代理会被指引「再运行一次 lint」然后再手写一次（唯一权威定义见 §8.8） |
| **工具不可用**（**R38**，非 docs-only） | `qeComplete && toolUnavailableGates.length > 0` | 失败源于检查工具本身不可用（依赖拉取/网络/代理/证书/命令缺失），**不是**代码质量问题。要求 PM 标 `blocking` + AskUserQuestion 请用户在「修工具 / 配等价命令覆盖 / 走双要素豁免」间决策；**不得**按「整改质量问题」处理（唯一权威定义见 §8.8） |
| **编程规范 lint 门禁**（R15，非 docs-only） | `qeComplete && !lintPassed` | quality-engineer 运行 `lint-run.mjs`，整改至 `gatePassed=true`（机读产物 `test-results/qe/.lint-result.json`）；未通过前**不得推进测试或宣告完成** |
| **静态代码质量门禁**（R16，非 docs-only） | `qeComplete && !staticScanPassed` | quality-engineer 运行 `static-scan-run.mjs`，整改重复代码/安全扫描至均 `gatePassed=true`（机读产物 `test-results/qe/.static-scan-result.json`）；未通过前**不得推进测试或宣告完成** |
| **批次 E2E**（非折叠通道） | `qeComplete && batchTestRowComplete && !batchE2ePassed` 且处于开发阶段 | test-engineer 运行 `e2e-run.mjs --scope=batch --required-ids=<本批次P0>`；未通过前**不得推进下一批次** |
| **批次接口测试报告**（R14，非折叠通道） | `qeComplete && batchTestRowComplete && batchE2ePassed && !batchApiReportPresent` 且处于开发阶段 | test-engineer 补做接口测试并在测试报告补全非空「## 接口测试报告」章节（须含真实用例数据行）；未补全前**不得推进下一批次或最终整体集成测试** |
| **批次存储对账记录**（R17，非折叠通道） | `qeComplete && batchTestRowComplete && batchE2ePassed && !batchStorageReconPresent` 且处于开发阶段 | test-engineer 按 R17 补全非空「## 存储对账记录」（适用分类型行 + 至少一条适用行 + 描述列完备 + 介质/其他/不适用备注 + 批次任务包覆盖）；未补全前**不得推进下一批次或最终整体集成测试** |
| **批次生产启动冒烟**（**R32**，非折叠通道） | `qeComplete && batchTestRowComplete && batchE2ePassed && batchApiReportPresent && batchStorageReconPresent && !startupSmokePassed` 且处于开发阶段 | test-engineer 运行 `startup-smoke-run.mjs`（干净启动 + 强杀后再启动），机读产物 `test-results/e2e/.startup-smoke-result.json` 须 `gatePassed=true`；未通过前**不得推进下一批次或最终整体集成测试** |
| **批次集成测试**（非折叠通道） | `qeComplete && !batchTestComplete` 且处于开发阶段 | 分派 test-engineer 做**批次集成测试**（含批次 E2E、接口测试报告、存储对账与生产启动冒烟） |
| **最终 E2E** | `finalTestRequired && finalTestRowComplete && !finalE2ePassed` | test-engineer 运行 `e2e-run.mjs --scope=final --baseline=<requirement-list.md 或热修影响面>`；未通过前**禁止宣告完成** |
| **最终生产启动冒烟**（**R32**，含 hotfix / single-task 折叠通道） | `finalTestRequired && finalTestRowComplete && finalE2ePassed && !startupSmokePassed` | 同上；未通过前**禁止宣告完成**。冒烟失败属产品缺陷 ⇒ 判定不通过 + `blocking` + 回派 DE |
| **single-task 折叠通道**（**R37**） | `qeComplete && isSingleTask` 下依次判 `finalTestRowComplete` → `finalE2ePassed` → `batchApiReportPresent`（R14）→ `batchStorageReconPresent`（R17）→ `startupSmokePassed`（R32） | 单轮集成测试 + E2E；**R14/R17 并入折叠通道**（区别于 hotfix R11 的跳过，理由见 §8.8 R37） |
| **最终整体集成测试 / 折叠通道唯一测试**（独立门禁） | `finalTestRequired && !finalTestComplete` | 非折叠：分派 test-engineer 做**最终整体集成测试**（含全量 E2E）；hotfix（R11）/ single-task（**R37**）：分派 test-engineer 执行**唯一一次**集成测试+E2E（`--scope=final` 语义） |

> **R11（hotfix 批次/最终测试折叠，唯一权威定义）**：`workflow_mode=hotfix` 时不要求区分「批次集成测试」与「最终整体集成测试」两个独立环节，测试工程师**只需执行一次**集成测试+E2E（直接以 `--scope=final` 语义运行，产出即视为最终结果）。判据层面：`batchTestComplete` 恒为 `true`（跳过批次 E2E/批次接口测试报告/批次存储对账/批次集成测试判据行；R14/R17 机读判据仅约束开发窗口批次阶段，不并入 hotfix 折叠通道）；`finalTestRequired = devComplete && qeComplete`（不要求 `batchTestComplete` 参与判定）；`finalTestComplete` 计算方式不变（`finalTestRowComplete && finalE2ePassed`）。`gatePassed` 公式、Chromium headless 执行器、覆盖率判据**不因折叠而放松**，仅消除批次/最终两阶段的流程冗余，呼应需求 1「简化」精神且不违反 R12「只可加强」。
>
> **R11 与 R37 折叠通道的唯一差异（须知）**：两者都把批次/最终折叠为单轮（`foldedTestChannel`），
> 但 **hotfix 跳过 R14/R17，`single-task` 保留 R14/R17**。理由不是「热修更宽松」，而是适用面不同：
> 热修是对既有行为的修复，不新增接口面与存储写入路径，R14/R17 无对象可测；增量迭代**常常新增
> 接口与写入路径**，跳过就等于「小改动免做接口测试与存储对账」——那是放松（R12）。
> 实现见 `parseWorkflowState` 中 `finalTestComplete` 对 `isSingleTask` 的额外要求。
>
> **进度列表识别规则**：测试工程师行若含「最终整体集成测试」「最终集成测试」「TE-FINAL」「TE-最终」之一，计入最终测试；其余测试工程师行计入批次测试。`finalTestRequired` 的完整公式见 R11（hotfix）与上表（非 hotfix）。
>
> **B1 最新有效状态统计**：`gate-stop-workflow` 对 `## 进度列表` 按**任务包编号**取最新有效状态（后出现覆盖先出现）；`已作废` / `superseded` 行作为 tombstone 使该任务包退出统计。任务包编号须写在进度行「任务名称」列，使用**大写多段编号**（如 `A-DOC-1`、`B-LIB-1/2/3` 互不合并）；作废行亦须含被作废任务包编号以便精确 tombstone。

> **任务包编号形态（唯一权威定义，全框架同源）**：**首段以大写字母开头（可含数字），其后至少一个 `-` / `/` / `.` 分隔段**，机读正则 `/\b[A-Z][A-Z0-9]*(?:[-/.][A-Z0-9]+)+\b/`。合规示例 `T0-1`、`T-DOC-1`、`A-DOC-1`、`B-LIB-1/2/3`、`INC.A-2`；不合规示例 `待补`、`todo-1`（小写）、`A`/`ABC`（无分隔段）。本条同时是 **B1 进度统计**、**R17 对账「关联任务包」**、**R18 覆盖矩阵「任务包」列**（`design.mjs` `TASK_PACK_ID_RE` / `extractTaskPackIds` / `taskPackExistsInList`）的共同判据——**T 前缀不是硬约束**。
>
> F-12（2026-08-11 审核修复）：历史实现 R18 侧为 `/\bT[\w./-]+\b/`，要求首字母必须为 T，于是本条亲自举例的 `A-DOC-1`、`B-LIB-1/2/3` 在 R18 处一律 `p0-task-id-unparseable`，理由行还只提示「如 T0-1」；同时 `taskPackExistsInList` 用同一 T 正则判 stub，导致任务清单里全是非 T 编号时交叉校验被整体跳过而**静默放行**。按 R12（文档强于实现须补实现，不得反向削减文档）对齐到本条形态，并把 stub 判据与提取判据同源。回归：`selftest/r18-design-review.mjs` F-12 组。`iterationType` 缺失时 R3 按 `full` 兜底校验四件成果物（不得因缺字段豁免，R12）；仅已确认的 `hotfix` / `docs-only` 豁免 R3。
>
> **双要素豁免机制（总则，唯一权威定义，适用于下表全部门禁）**：本框架任何机械门禁的「确不适用 / 确无法运行」豁免，**一律**须**同时**满足两项要素方可生效——**仅满足一项不生效**（防单方面弱化，R12）：
> 1. 系统架构师在活跃 `gated-artifacts.json` 中声明对应 `{gate}Applicability: "n/a"` + `{gate}ApplicabilityReason`（简述理由）；
> 2. `process.md`「## 用户确认记录」含一行对应豁免确认（行内须含下表「确认关键词」列所示词汇，供 Hook 机械识别）。
>
> | 门禁 | Applicability 字段 | 确认关键词（须含） | 判定函数（`workflow-gate-lib.mjs`） | 详细定义 |
> | ---- | ------------------- | -------------------- | ------------------------------------ | -------- |
> | E2E | `e2eApplicability` | 「E2E」+「豁免/不适用/无」 | `isE2eExempt()` | §8.3 |
> | R14 接口测试 | `apiTestApplicability` | 「接口测试」+「豁免/不适用/无接口」 | `isApiTestExempt()` | §8.3 |
> | R17 存储对账 | `storageReconciliationApplicability` | 「存储对账/对账」+「豁免/不适用/无持久化」 | `isStorageReconciliationExempt()` | §8.3 |
> | R15 lint | `lintApplicability` | 「编程规范/代码规范/lint」+「豁免/不适用/无」 | `isLintExempt()` | 本节 R15 |
> | R16 重复代码 | `dupCheckApplicability` | 「重复代码/DRY/jscpd」+「豁免/不适用/无」 | `isDupCheckExempt()` | 本节 R16 |
> | R16 安全扫描 | `securityScanApplicability` | 「安全扫描/安全静态扫描/密钥扫描」+「豁免/不适用/无」 | `isSecurityScanExempt()` | 本节 R16 |
> | **R32 生产启动冒烟** | `startupSmokeApplicability` | 「生产启动/启动冒烟」+「豁免/不适用/无启动/无常驻」 | `isStartupSmokeExempt()` | §8.6 |
> | **R22 替代 E2E 启动**（反向豁免） | `e2eAlternativeStartup: "allowed"` | 「非 dist 启动」/「替代启动」+ E2E +「允许/确认」 | `isAlternativeE2eStartupExempt()` | §8.4 |
>
> 重复代码与安全扫描**分别独立**豁免，不可一项代替另一项；下文各门禁「适用性豁免」小节均指回本表，不再重复展开机制本身。R32 与 R22 的豁免**相互独立且语义不同**：R32 豁免的是「本项目没有可冒烟的启动路径」，R22 豁免的是「允许用非生产命令跑 E2E」；**都不得**用来掩盖「生产启动确实失败」——那属产品缺陷，须回派 DE（`rollback.md`）。
>
> **R15（编程规范 lint 硬门禁，唯一权威定义）**：`full`（含 `greenfield`/`feature`/`governance-overhaul`）、`single-task` 与 `hotfix` 迭代，QE 阶段须满足：
> - 判据结构与 E2E 门禁同构（运行器写 `gatePassed` 机读产物 → lib 读入 → 门禁判定）；**执行命令与产物**：`node .claude/scripts/lint-run.mjs` → `test-results/qe/.lint-result.json`。
> - **命令解析优先级**：`harness.config.json → qe.commands.lint` 覆盖 > 构建清单自动探测 > 栈默认（Node/Python/Go/Rust/Ruby/.NET/Dart/Elixir/Swift 有默认；Maven/Gradle/PHP/CMake/Make **刻意无默认**——这些栈没有「未配插件也不会空转」的通用命令，见下条）；多数项目不必手配 config，仅 monorepo/自定义脚本名/探测不准时覆盖。`detail-design-spec.md` §5 由架构师填入与默认一致的留痕，不作为 Hook 输入。
> - **栈探测覆盖面（2026-08-03 跨栈覆盖修复，唯一权威）**：探测表 `lint-run-lib.mjs → STACK_MANIFESTS` **须覆盖** `harness.config.json → gatedPaths.buildManifests` 的全部条目（回归钉死于 `r15-lint.mjs`「栈探测清单须覆盖受门禁构建清单」）。历史实现只认 10 个根目录清单，而路径门禁早已纳管 `build.gradle.kts` / `CMakeLists.txt` / `mix.exs` / `pubspec.yaml`、R6 加强又让 `.swift` 等扩展名默认受门禁——这些项目**源码受门禁约束却永远拿不到 lint 命令**，R15 对它们是不可达红灯。两张表今后须同源演进：新增受门禁清单即在探测表登记，没有安全默认命令就登记空串，让门禁报「探测到 X 栈但无默认命令」而非含糊的 `unknown`。**探测只在项目根单层进行**：根目录无清单时递归（深度 ≤ 3）扫出子项目写进产物 `subProjects` 供用户判断，但**不推断命令**——替 monorepo 猜命令会在错误目录跑错误命令或跑出空转的「通过」。
> - **判据**：`lintPassed = readLintResult()?.gatePassed===true`（须有 lint 命令且退出码为 0）；`docs-only` 视为满足。QE 记录完成但 `lintPassed=false` 时 `gate-stop-workflow` 注入 followup，且**不得发起 test-engineer**（判定函数见 `rule-index.md`）。
> - **失败性质四分（`reason` 字段，均不放行、解法互不相同）**：`lint-failed`（真有违规 ⇒ DE/QE 整改）、`lint-tool-unavailable`（**R38** 环境缺工具 ⇒ PM 阻塞 + 用户决策）、`lint-not-configured`（命令存在但项目没配 linter，如 npm 缺 `scripts.lint` ⇒ 分派 DE 补配置，**不是**代码违规）、`no-lint-command`（探测不到默认命令 ⇒ 用户本人配覆盖或双要素豁免，重跑无用）。后两者由 `checkLintClean` 原样上浮到 `state.lintReason`，stop 门禁按性质分流文案——把「还没检查过」说成「有违规」会让 DE 去修不存在的缺陷（与 R38 同源教训）。`no-lint-command` 时产物另带 `remediation`（探测结果 + 候选命令 + 可粘贴的 config 片段）。
> - **适用性豁免**：见上表 R15 行；无默认 lint 的栈须声明等价命令或走豁免，不得静默放过。**「框架没有默认命令」不构成豁免理由**——那只说明框架不知道该跑什么，不等于本项目不适用 lint；且配置覆盖须由**用户本人**编辑 `harness.config.json`（R29 锁定，架构师亦不得代写，只能呈现片段），代理不得以「改不了 config」为由改走豁免。
>
> **R16（静态代码质量硬门禁：重复代码 DRY + 安全静态扫描，唯一权威定义）**：`full`（含 `greenfield`/`feature`/`governance-overhaul`）、`single-task` 与 `hotfix` 迭代，QE 阶段须满足：
> - 判据结构与 R15 同构，但**跨技术栈通用、不做 per-stack 探测**（本框架要求 `Node.js >= 18`，两项工具均经 `npx` 直接获取）；**执行命令与产物**：`node .claude/scripts/static-scan-run.mjs` → `test-results/qe/.static-scan-result.json`（含 `duplication`/`security` 两个子结果）。
> - **默认工具**：重复代码检测 `jscpd-rs`（`npx --yes jscpd-rs --threshold 5 ...`，5% 阈值超限退出码非 0）；安全静态扫描 `gitleaks-secret-scanner`（`npx --yes gitleaks-secret-scanner ...`，检出密钥即退出码非 0）。
> - **⚠ 默认命令禁止携带 `--exitCode`（2026-07-29 审核修复，唯一权威）**：jscpd-rs 的两个标志是**两套独立逻辑**——`--threshold N` 为「重复率 ≥ N% 时以错误码退出」（即本节声明的判据），`--exitCode N` 为「**只要检出任何重复**就用该退出码」（与阈值无关）。历史默认命令同时带 `--exitCode 1`，使 `--threshold 5` **完全失效**，R16 实际退化为**零重复容忍**——任何真实宿主项目都不可能通过，属与 R19 出厂模板缺陷同级的硬阻塞。实测（本仓库 2.78% 重复率）：`--threshold 5` 退出 0，加 `--exitCode 1` 后退出 1，`--threshold 1` 退出 1（证明阈值本身工作正常）。移除 `--exitCode` 是让实现回到**文档声明的判据**，**不是**放松门禁（R12）；反之，重新加回 `--exitCode` 属于把门禁改成一个不可达标准，等同于让 R16 永久红灯，一律禁止。机读回归：`tests/selftest/r16-static-scan.mjs`「默认命令不得含 `--exitCode`」。**命令解析优先级**：`harness.config.json → qe.commands.dupCheck`/`qe.commands.securityScan` 覆盖 > 框架默认值；多数项目不必手配 config。
> - **判据**：`staticScanPassed = (dupCheckExempt || duplication.gatePassed) && (securityScanExempt || security.gatePassed)`；`docs-only` 视为满足。QE 记录完成但 `staticScanPassed=false` 时 `gate-stop-workflow` 注入 followup，且**不得发起 test-engineer**（判定函数见 `rule-index.md`）。
> - **⚠ 重复率须「退出码 + 报告」双判（2026-08-11 审核修复 F-13，唯一权威）**：历史 `duplication.gatePassed` **只**看 `exitCode === 0`，从不把 jscpd JSON 报告里的总重复率与 `--threshold` 比对。于是只要工具因任何原因以 0 退出（版本差异、阈值标志语义变化、报告已写盘但退出码未反映），子门禁即失去判别力——实测出现过 `duplication.gatePassed = true` 而 `output` 同时列出 20 余处 `Clone found` 的组合。现改为**双判**：`exitCode === 0` **且** 报告重复率 `< --threshold` 才通过，任一判失败即失败（`static-scan-run.mjs` `applyDupReportGate`）。产物新增 `duplication.reportPercentage` / `duplication.reportThreshold` 两个机读字段。**报告缺失或不可解析时不放行**（`reason: 'dup-report-unreadable'`）——R16 的判别力依赖报告，读不到报告等于没测；这与 R38「工具确实跑不起来」是**不同出口**，后者仍由退出码通道识别并走双要素豁免。判定函数：`parseDupThreshold` / `extractDupPercentage` / `evaluateDuplicationReport`（`static-scan-run-lib.mjs`）；回归见 `r16-static-scan.mjs` F-13 四条。
> - **⚠ 默认 `--ignore` 须排除 harness 自身（2026-08-11 审核修复 F-13，唯一权威）**：历史默认值未排除 `.claude/**` 与 `migration/**`，于是门禁自身的 3 万余行（含 `.claude/scripts/tests/**` 里成片同构的 fixture 与用例）全部进入重复率**分母**。实测本仓库 `lines: 32120 / sources: 204`，49 对克隆中 48 对落在 `.claude/scripts/tests/**` 与 `migration/docs/**`，业务侧重复率被摊薄约两个数量级。规约此前只防了「把门槛调松」（禁止提高 `--threshold`），没防「把分母掺大」——两者对判别力的影响同向，故一并禁止（R12）。默认命令现固定排除 `.claude/**`；回归见 `r16-static-scan.mjs`「默认 `--ignore` 须排除 `.claude/**`」。**`migration/**` 已于 2026-08-14 移出默认排除集**（R12 加强方向，见下「门禁强度调整留痕」）：该模式当初只为排除 harness 自带的 `migration/docs/**`（移植期留痕，已迁至仓库 `docs/migration/`，不再随适配交付），留着只会盲排**接入方自己的** `migration/` 产品源码——而 `harness.config.json` `gatedPaths.sourceDirs` 明确把 `migrations` 列为受门禁的源码目录。回归见 `r16-static-scan.mjs`「默认 `--ignore` 不得排除 `migration/**`」。
> - **适用性豁免**：见上表 R16 两行（重复代码/安全扫描分别独立判定）。
> - **反弱化条款（2026-07-28 QE R16 消重复盘新增，R12 显式化）**：**禁止**以「降低打回率/减少误报体感」为由提高 `jscpd-rs --threshold`、扩大 `--ignore` 排除目录（默认排除目录——`node_modules`/`dist`/`build`/`vendor`/`target`/`coverage`/`.git`/`test-results`，以及门禁自身的 `.claude`（F-13，见上）——以外的任何收窄；**缩小**默认排除集同样禁止，删掉 `.claude` 即把分母重新掺大。**例外**：`migration` 已于 2026-08-14 有意移出默认排除集，因其只排除接入方的产品源码而非门禁自身，移除属加强；**不得**以「恢复 F-13 原样」为由把它加回）或缩减 `--reporters`，也**禁止**加回 `--exitCode`（后者不是收紧而是把门禁改成不可达标准，见上一条）。确因目录结构特殊（如 monorepo 内确需排除的生成代码目录）需要覆盖 `qe.commands.dupCheck` 时，须在质量报告与 `detail-design-spec.md` §5 写明**具体排除路径 + 排除理由**；**修改阈值**（无论升高或降低）一律视为需要用户确认的机械门禁调整，须在 `process.md`「## 用户确认记录」留痕说明理由，否则 QE 不得采用覆盖值——该调整不受本节其余「多数项目不必手配 config」的默认豁免。
>
> **R25（设计阶段「同构模块识别」章节机读，唯一权威定义，2026-07-28 QE R16 消重复盘新增）**：发起 `requirement-reviewer` 前（`full`/`single-task`，`hotfix`/`docs-only` 豁免），`checkIsomorphicModuleSectionReady()` 校验活跃 `detail-design-spec.md` 是否含「## 同构模块识别（须逐项列出）」章节：设计文档为 stub（仅标题、无正文）时跳过；非 stub 时须**要么**含「同构组名称」+「共享 Primitive 名称」两列的表格且至少一条真实数据行（每行两列均非空），**要么**显式声明「已排查，无同构资源族」并附非空排查依据（去除标点空白后不少于 4 字）。缺章节/章节为空/表格无数据行/声明缺依据时 `gate-role-sequence` 拒绝发起 `requirement-reviewer`。**背景**：R16 全仓重复代码复盘发现相似资源族（CRUD 路由、页面脚手架、测试 fixture、E2E helper）在设计阶段未被前置识别，并行开发工程师各自「复制改」导致 QE 首轮必然因 duplication 打回；本规则要求设计阶段前置排查并声明共享 primitive，从源头减少同构克隆。**能力边界**：机读只证明「该章节存在且非占位敷衍」，不证明排查是否穷尽、共享 primitive 设计是否合理——语义充分性仍由 `requirement-reviewer`「架构设计原则」维度人工审核。
>
> **R19（需求分析师隐性需求确认记录结构校验，唯一权威定义）**：发起 `system-architect` 前，`checkRequirementReady()` 除校验 `requirement-spec.md`/`requirement-list.md` 存在与 `## 用户确认记录` 非空外，须额外校验 `requirement-spec.md`「6. 隐性需求确认记录」章节存在含**真实数据行**的表格，表头必须含「类别、要点、用户确认摘要、关联需求/§7 追溯、状态、影响/决策点」；每条行均不得为空，类别仅可为「假设/边界/取舍/待决/排查结论」，状态仅可为「已确认/待决假设」，关联追溯必须同时含 `requirement-list.md` 的 `R-编号` 与 `§7`，`待决假设` 还须在影响/决策点中含责任方与最晚决策点。该校验验证结构、枚举与追溯，**不验证内容真实性**。目的是为苏格拉底式多轮追问留下可稽核、可供 SA 消费的痕迹，避免「一轮问完即自称理解充分」或用空泛占位行过门禁。缺失或任一结构条件不满足时 `gate-role-sequence` 拒绝发起 `system-architect`。**豁免**：本项不适用双要素豁免机制——需求分析师确认「排查后无隐性要点」时，也须填写合规的「排查结论」行，说明排查范围、用户确认和关联需求，而非声明豁免跳过（隐性需求排查是理解是否充分的一部分，不属于「确不适用/无法运行」的技术性豁免场景）。

### 8.3 两级集成测试与 E2E 判据（唯一权威定义，TG-D-4）

> 本节是「批次/最终 E2E」判据与命令的**唯一权威定义**；`README.md`、§3、§5、§6、`project-manager.md`、`test-engineer.md` 中出现的相关表述均须与本节保持一致，若只需引用判据请指回本节，不再复述完整公式/命令。

- **两级范围**：①**批次集成测试**——每批次 QE 通过后，对本批次新交付任务包做集成测试；②**最终整体集成测试**——全部任务包与各批次 E2E 闭环后，对整个产品做端到端集成测试。`测试判定`（最终交付依据）以**最终整体集成测试**（含最终 E2E）结论为准。
- **执行命令与产物**：批次 `node .claude/scripts/e2e-run.mjs --scope=batch --required-ids=<本批次P0>` → `test-results/e2e/.e2e-batch-result.json`；最终 `node .claude/scripts/e2e-run.mjs --scope=final --baseline=<requirement-list.md>` → `test-results/e2e/.e2e-final-result.json`。
- **Playwright 配置约束（唯一权威定义；本节承载该知识，不再只寄存于模板文件注释）**：项目根 `playwright.config.*` 是 E2E 机械门禁的运行时依赖（缺失即 `gatePassed=false, reason=missing-playwright-config`）。harness 模板在项目根**自带** `playwright.config.ts`，接入既有项目时须随 `e2e/` 一并复制。该文件按 §8.5 R6 属**受门禁产品源码**（`testConfigs` 明列），期望角色为 **development-engineer**：测试工程师**不得**自行创建或改写它（R5/R21 判 deny），需要调整时须由 PM 回派 DE。改写时必须满足：
  1. **`outputDir` 不得是门禁产物目录 `test-results/qe`、`test-results/e2e`、`test-results/recon` 的祖先或自身**（自动覆盖 `test-results/` 与仓库根这两种最危险写法）——Playwright 每次运行前**清空** `outputDir`，指向 `test-results/` 会连带删除 `.lint-result.json`（R15）、`.static-scan-result.json`（R16）、`.startup-smoke-result.json`（R32）、`recon/*.json`（R17）与上一轮 `.e2e-batch-result.json`，造成「跑一次 E2E 就要重跑整套 QE」以及批次↔最终 ping-pong 死锁。模板取 `outputDir: 'test-results/pw-artifacts/'`（与门禁产物同级隔离），自定义时须保持同等隔离性；
     - **本条已由机械层兜底（F-05 加固，唯一执行权威 `e2e-run-lib.mjs#checkPlaywrightOutputDir`，在 `e2e-run.mjs` 跑 Playwright **之前**执行）**：违规即 `gatePassed=false` 并直接退出，绝不「跑完再判」——跑完时证据已经被删了。三类拒绝理由：`playwright-outputdir-clobbers-gate-artifacts`（祖先或自身）、`playwright-outputdir-undeclared`（**未声明即拒**：Playwright 的默认值正是 `test-results/`，「没写」不等于安全）、`playwright-outputdir-not-literal`（值不是字符串字面量，静态判不了，fail-closed）。
     - 该判据**不置** `toolUnavailable`：配置违反 §8.3 是须修复的门禁问题，不得走 **R38** 双要素豁免当成环境问题放过——那正是 F-05 的失效路径（证据消失，而门禁只报得出「产物缺失」）。
     - 机械判据比本条文字**更严一档**（`test-results/qe` 这类「只清掉一部分证据」的写法同样被拒），属 R12 允许的加强；回归见 `selftest/f05-outputdir.mjs`。
  2. **JSON reporter 输出固定为 `test-results/e2e/pw-report.json`**——`e2e-run.mjs` 按此硬编码路径解析结论，改名即判为「报告未生成」；
  3. **仅声明 `chromium` project**（见下条浏览器范围），不新增 Firefox / WebKit。
- **浏览器范围**：仅需支持 **Chrome 内核浏览器（Chromium，含 Chrome/Edge 等 Chromium-based 浏览器）**，不要求 Firefox / WebKit 覆盖；执行器 Playwright Chromium headless；用例标题含 `[R-xxx]` 追溯标签。**浏览器范围是本机械门禁唯一允许简化的维度**：`gatePassed`、覆盖率、追溯标签等判据不因浏览器范围收窄而放松（需求 1）。
- **`gatePassed` 公式**：`gatePassed = allPassed && coverageComplete`（Chromium 覆盖全部 required P0 且无未解释 skip 且均通过）。`batchTestRowComplete` / `finalTestRowComplete` 仅反映进度行完成；`batchE2ePassed` / `finalE2ePassed` 读取对应结果文件的 `gatePassed`。`batchTestComplete = batchTestRowComplete && batchE2ePassed && batchApiReportPresent && batchStorageReconPresent && startupSmokePassed`（含 R14 接口测试报告、R17 存储对账与 **R32** 生产启动冒烟机读判据）；`finalTestComplete = finalTestRowComplete && finalE2ePassed && startupSmokePassed`。**`hotfix` 模式下按 R11 折叠**（见 §8.2），`batchTestComplete` 恒真，`finalTestRequired` 不依赖 `batchTestComplete`；但 **R32 并入 `finalTestComplete`，折叠通道同样须有冒烟通过证据**（与 R14/R17 不同，理由见 §8.6）。`e2e-run.mjs` 另将冒烟摘要**回显**进 E2E 结果的 `startupSmoke` 字段，仅供报告与人工审查引用，**不参与** E2E 自身的 `gatePassed`。
- **⚠ 公式已收紧为三判（2026-08-11 审核修复 F-14 / F-06，唯一权威）**：`gatePassed = playwrightExitCode === 0 && allPassed && coverageComplete`。
  - **`playwrightExitCode === 0` 为必要条件（F-14）**：历史公式只看解析出来的用例统计，于是 Playwright 自身失败（配置错误、浏览器缺失、`webServer` 起不来、就绪探测被本机代理劫持）时 `totalTests === 0` → `allPassed` 空集恒真 → `gatePassed: true`。**一次都没跑起来被判成全绿**，是 E2E 通道最危险的假通过。
  - **工具不可用须分流而非放行（F-14）**：`playwrightExitCode !== 0 && totalTests === 0` 时置 `toolUnavailable: true`，交 **R38** 双要素豁免流程处理；**不得**把它混进「测试失败」或悄悄放行。判定见 `e2e-run-lib.mjs` `computeGateResult`。
  - **`required` 集合不得为空（F-06）**：`--scope=final` 既无 `--required-ids` 也无 `--baseline` 时，历史 `loadRequiredIds()` 返回 `[]`，`coverageComplete` 对空集恒真——**零用例也能 `gatePassed: true`**。现改为**报错退出**（`e2e-run.mjs`），并在 Hook 侧 `checkE2eGate` 增判 `requiredIds` 非空；「P0 集合读不出来」等于覆盖率判据不存在，不是放行理由。
  - **Hook 侧不得只读 `gatePassed`（F-06 / F-14）**：`qe.mjs` 对结果文件额外兜底校验上述字段，防止旧版本产物或手工构造的 `{gatePassed:true}` 顶替真实结果（与 R34 执行证明互补）。
  - **本机代理成因（F-14，须知）**：`HTTP_PROXY` / `HTTPS_PROXY` 会让 Playwright 对 `http://127.0.0.1:<port>` 的就绪探测被代理劫持，表现为「服务已起但 E2E 全红」，极易被误诊成「TE 用例写少了」而去改用例。模板 `playwright.config.ts` 的 `webServer.env` 因此固定注入 `NO_PROXY: '127.0.0.1,localhost'` 并附成因注释；该文件属受门禁源码（期望角色 DE），TE 不得自行改写。
- **接口测试（R14，开发窗口批次集成测试阶段必测，唯一权威定义）**：`full`（含 `single-task`，见下方「适用范围」关于 `single-task` 的说明）模式非 hotfix 迭代，**开发窗口的批次集成测试阶段**（每批次 QE 通过后对本批次做的集成测试，**非**最终整体集成测试阶段）**必须做接口测试**，且测试报告须含**非空**的「## 接口测试报告」章节（至少一条真实表格数据行）。机读判据 `batchApiReportPresent` 由 `workflow-gate-lib.mjs` 的 `checkBatchApiTestReport()` 扫描当前活跃 docs 子树 `test/` 目录下 `*.md` 计算；缺失或为空时 `batchTestComplete=false`，`gate-stop-workflow` 注入 R14 followup，**不得推进下一批次或最终整体集成测试**。R14 仅约束批次阶段，最终整体集成测试与 hotfix 折叠通道不并入此判据。
- **接口测试适用性豁免（无对外接口项目）**：纯算法库、纯静态前端、无 HTTP/RPC/CLI 契约的组件等**无对外接口**项目，可豁免 R14 接口测试判据；判定遵循 §8.2「双要素豁免机制」表 R14 行（两项皆满足时 `isApiTestExempt()` 使 `batchApiReportPresent` 视为满足）。详见 `test-engineer.md`「接口测试适用性豁免」。
- **业务数据存储对账（R17，开发窗口批次集成测试阶段机读硬门禁，唯一权威定义）**：`full`（含 `single-task`）模式非 hotfix 迭代，**开发窗口的批次集成测试阶段**须满足机读判据 `batchStorageReconPresent`（由 `checkBatchStorageReconciliationReport()` 计算；豁免时 `isStorageReconciliationExempt()` 视为满足）。未满足时 `batchTestComplete=false`，`gate-stop-workflow` 注入 R17 followup，**不得推进下一批次或最终整体集成测试**。R17 仅约束批次阶段，最终整体集成测试与 hotfix 折叠通道不并入此判据。机读要求：
  1. 测试报告含非空「## 存储对账记录」章节（至少一条真实表格数据行；表头须含场景类型、关联任务包、存储介质、对账方式、预期存储结果、实际存储结果、是否通过）；
  2. **分类型行（仅计适用行）**：未豁免 R14（`!isApiTestExempt()`）时须含「场景类型」为接口/API **且存储介质非「不适用」** 的数据行；未豁免 E2E（`!isE2eExempt()`）时须含「场景类型」为 E2E/UI **且存储介质非「不适用」** 的数据行。「不适用」行**不计入**分类型判定；
  3. **至少一条适用行**：项目未走整体豁免时，合并全部对账行后须至少有一条介质为具名类别或「其他」的真实对账行（不得仅靠「不适用」行过门禁）；
  4. **描述列完备**：每条数据行「关联任务包」「对账方式」「预期存储结果」「实际存储结果」「是否通过」均非空；「关联任务包」须含可识别任务包编号（与 B1 同款大写多段编号）；
  5. **存储介质列**：每条数据行「存储介质」非空且匹配下表至少一类关键词（大小写不敏感）；介质仅为「其他/other」（未同时命中具名类别）时，「备注」列须非空并写明具体系统；介质为「不适用」时，「备注」列须非空说明该任务包无业务数据写入的理由；
  6. **按批次任务包覆盖**：`process.md`「## 进度列表」中测试工程师**已完成**的批次集成测试行所含任务包编号，须全部出现在对账行「关联任务包」列中至少一次（合并 `docs/test/*.md` 全部对账行判定，**含「不适用」留痕行**）。首批已填对账**不能**代替后续批次新增任务包的对账留痕。
- **R17 存储介质范围（唯一权威）**：「业务数据存储」不限于关系库；凡业务数据写入下列任一介质即触发 R17（写路径涉及几种就对几种；按 `detail-design-spec.md` §4 声明选用）：

  | 类别（机读关键词） | 典型形态（说明用，非穷尽） |
  | ------------------ | -------------------------- |
  | **数据库** / `db` / `database` | RDBMS、文档库、KV 持久库等 |
  | **文件** / `file` / `filesystem` | 本地/挂载目录、上传落盘、导出文件等 |
  | **缓存** / `cache` | Redis/Memcached 等承载业务状态或写穿/写回的缓存 |
  | **对象存储** / `object` / `blob` / `s3` / `oss` / `minio` | S3/OSS/MinIO 等 |
  | **其他** / `other` | 上表未列但 design §4 声明的业务落盘/落缓存介质；**备注列须非空**写明具体系统（机读强制）；**不得**用「其他」表示「本任务包无写入」 |
  | **不适用** / `n/a` | 项目整体有持久化、但**本任务包确无**业务数据写入时的留痕专用值；**仅计入任务包覆盖，不计入分类型真实对账**；**备注列须非空**说明理由（如「本任务包无业务数据写入，不适用对账」） |

- **存储对账适用性豁免（无业务数据持久化）**：仅内存计算、无跨请求业务状态、纯静态前端等**无**上述介质业务写入的项目，可豁免 R17；判定遵循 §8.2「双要素豁免机制」表 R17 行（两项皆满足时 `batchStorageReconPresent` 视为满足）。**不得**因「不是数据库」而跳过（文件/缓存/对象存储等同属触发范围）。**不得**用整份报告仅填「不适用」行代替项目级双要素豁免。
- **R17 对账证据文件（适用行硬门禁）**：每个适用（非「不适用」）对账行的「对账方式」单元格须包含路径 `test-results/recon/<name>.json`（正则 `test-results/recon/[A-Za-z0-9._-]+\.json`）；该文件须存在于项目根下，且为合法 JSON，含非空字符串 `command`、`summary` 与有限数值 `exitCode`（建议含 `capturedAt`）。「不适用」行不要求证据文件。缺路径 / 缺文件 / 字段不全 → `checkBatchStorageReconciliationReport` 失败（reason 如 `missing-recon-evidence-path` / `missing-recon-evidence-file` / `recon-evidence-missing-command` 等）。证据文件由测试工程师在实际查验后落盘；与 E2E/lint 产物同属 `test-results/` 受控运行产物（§8.4），不触发 `gate-dev-workflow`。
- **R17 门禁能力边界**：章节/表头存在性、分类型适用行、至少一条适用行、描述列非空、「其他」/「不适用」备注非空、存储介质类别关键词、批次任务包编号覆盖、适用行证据文件存在与字段完备为机读硬门禁；对账命令是否真正查到对应介质、预期/实际是否语义正确等，仍由 QE/PM 文字审查（§8.4），Hook 不声称已验证查验语义。
- **约束后果**：批次 `gatePassed≠true` 时视为本批次集成测试未完成，**不得推进下一批次**；最终 `gatePassed≠true` 时**不得宣告项目完成**。
- **适用范围**：适用于 `full` 模式下的 `greenfield` / `feature` / `governance-overhaul`、`single-task` 及 `hotfix` 迭代（`hotfix` 按 R11 折叠为单次通道，测试严格程度不降低）；`docs-only` 豁免；无 UI 项目按 §8.2「双要素豁免机制」表 E2E 行豁免（详见 `test-engineer.md`「E2E 适用性豁免」）。**`single-task` 说明（2026-07-30 随 R37 重构，唯一权威见 §8.8 R37 与 `workflow-modes.md`）**：`workflow_mode=single-task` 现为**增量迭代档**，测试按 **R37** 折叠为**单轮**集成测试 + E2E（进度行须含「最终整体集成测试」以便机读），不再要求批次 + 最终两条独立进度行。但折叠**只省轮次、不省判据**：该单轮仍须满足 E2E `gatePassed`、**R14 接口测试报告**、**R17 存储对账**（含适用行证据文件）与 **R32 生产启动冒烟**——这是与 `hotfix` R11 折叠通道的唯一差异（后者跳过 R14/R17，理由见 §8.2 R11 脚注）。进入折叠通道前须先通过 R37 前置校验（基线 `detail-design-spec.md` 存在 + `## 增量范围` **五维**声明 + 「需要迁移脚本 / 破坏向后兼容」为「是」时禁用本档，**F-08**）。另：走「数据形状变更＝是、迁移/破坏兼容＝否」这条 F-08 新开路径时，该单轮**额外**须落地兼容性回归用例的执行记录（`checkIncrementCompatRegressionReport`）——这是放松 schema 硬禁用换来的新增判据，缺记录即不得收尾。**不得**因为「这是 single-task」就自行再简化任何判据（R12）。
- **未解释 skip / `coverage-waivers.json`**：见 `test-engineer.md`「`coverage-waivers.json`」一节。

Hook 脚本路径：`.claude/hooks/`。修改 Hook 行为时须同步更新本节与 `README.md`。

### 8.4 自锁防护与门禁能力边界

**自锁防护（分两级，**R36** 后的现行语义）**：Hook 入口脚本（`gate-dev-workflow`、`gate-dev-shell`、`gate-toolchain-install`、`gate-stop-workflow`、`gate-role-sequence`、`gate-subagent-track`）对 `workflow-gate-lib.mjs` 使用动态 `import` + `try/catch`，执行期逻辑另包一层 `try/catch`。两层的语义**不再相同**：

| 失败级别 | 语义 | 理由 |
| -------- | ---- | ---- |
| **lib 加载失败**（`lib-load`） | **fail-open 放行**（stop 语义为不注入 followup） | 门禁整体损坏时若一律拒绝，项目会被彻底锁死且无自愈路径 |
| **判定期异常**（`runtime`） | **fail-closed**（**R36**，默认）：write/shell/task → `deny`，toolchain → `ask`，stop → `followup` | 见下方 R36 说明 |

两级都打印 stderr 告警，并尽量将异常写入活跃 `process.md` 的 `## 门禁异常事件` 且置 `blocking: true`（`recordFailOpenEvent`；cancelled 流程或无法写盘时仅保留 stderr）。写盘成功后同一条事件还会登记到 R29 保护的旁路台账，供 **R35** 校验该行确实出自门禁（见 §8.8 R35）。策略性 `deny` 不受影响。裁决文案由 `buildGateExceptionVerdict`（`core.mjs`）统一生成，各通道取舍与回归见 §8.8 R36。

> **`failClosed: true` 为何仍然不生效（背景，保留披露）**：Cursor 文档定义 `failClosed` 的触发条件为「hook 失败」——崩溃、超时、输出非法 JSON。本框架的入口脚本自行 `try/catch` 并以退出码 0 输出合法 JSON，属「Hook 成功，按其 JSON 输出执行」，**不构成失败**，因此 `hooks.json` 中的 `failClosed: true` 在当前实现下**永远不会被平台触发**。判定期异常的语义完全由脚本自己决定——**R36 正是接管了这一语义**：不再输出 allow，而是按上表输出 deny/ask/followup。也就是说收紧的实现方式是「脚本自己 fail-closed」，而非「激活平台的 failClosed」；`hooks.json` 里的该字段仅作为未来平台行为变化时的冗余声明，**不应**被当成第二层保护来依赖。
>
> **残留缺口（刻意保留）**：写文件通道对**活跃 `process.md`** 的**单独**写入在判定期异常时仍放行。判定期异常最常见的成因就是 `process.md` 结构损坏，而修复它必须能写它；一并拒绝会造成「代理无法自愈、只能人工编辑」的死局。该口子的边界由 `resolveGateRepairPaths` 定义（只认直接路径字段、只认活跃 `process.md`、不得夹带其他路径），已登记在 §8.7 边界表。

**门禁能力边界（须知）**：

- Hook 对**源码 / 构建产物 / 根目录敏感产物 / `.claude/scripts|agents|hooks/**` 三目录 / `docs` 下角色成果物（需求/设计/质量/测试/`process.md`）/ 受门禁 Shell 命令 / Agent 发起前的角色前置成果物（R13）**做确定性拦截。`.claude/hooks.json`、`.claude/harness.config.json` 不走 DE 源码门禁，但**已纳入 R29 门禁自治资产分级**（写入须人工批准，见 §8.5），不再仅由文字约束覆盖。
- **R5 调用者身份（部分机械化）**：①顶层 vs 子代理——`subagentStart`（`gate-subagent-track`）记录顶层 `conversation_id`，`gate-dev-workflow` / `gate-dev-shell` 用 `isRootConversationCaller` 拒绝顶层亲自写受门禁路径或跑受门禁 Shell；②**R21** 角色↔路径——`gate-role-sequence` 在 Agent 放行时 `recordDispatchedRole`，写入期 `checkRolePathPermission` 按**两级**判据裁决：**①调用者身份优先（F-01，2026-08-11 补齐）**——payload 的 `agent_type`（Claude Code 子代理上下文可用）能归一化为角色时即为**唯一**判据，与路径期望角色不符一律 deny（`caller-role-mismatch`）；**②** 仅在调用者身份不可判时，才退回校验路径期望角色与「进度正在执行 / 分派计划 / 待派发 / 最近派发」并集是否匹配。**为何必须分两级**：并集在流程中后期几乎覆盖全部 7 个角色（PM 会把待派发列表一次写满），只看并集等于「只要该角色在流程里出现过就能写任何成果物」——`requirement-reviewer` 可改写 `detail-design-spec.md`、`quality-engineer` 可改写 `process.md`，判据对文档成果物实际失效。两个通道同源：Shell 侧 `classifyShellWriteIntent` 的 targets 亦收 `isGatedDocArtifactPath`（**F-01**：历史只收源码类，`echo … > docs/design/detail-design-spec.md` 解析出空 targets，整条角色判据在 Shell 通道静默失效）。判据细节：**产品源码**（`isGatedDevPath` 且非 `e2e/**`）收紧为须 DE 活跃，且**最近派发角色若为 TE/QE 等非 DE 则直接 deny**（不因进度表残留 DE 行而放行）；**R23**：**`e2e/**`** 纳入 `isGatedDevPath`，期望角色为 `test-engineer`（非 TE 含 DE 默认 deny），不走 DE 分派计划门禁；③**R22** TE 冒烟（替代启动）——最近派发为 `test-engineer` 时，`gate-dev-shell` 经 `checkTeAlternativeE2eStartup` 拒绝 `E2E_WEB_SERVER_COMMAND=` / `npx vite-node`+e2e 等替代启动（除非 `e2eAlternativeStartup:"allowed"` + 用户确认「允许非 dist 启动」双要素）。文字约束（R21/R22 语义补充，语义不可机械化）：TE 禁止改产品源码、禁止用替代启动掩盖生产冒烟失败；**R24**（纯文字约束，语义不可机械化）：TE 禁止为测绿随意改已生成用例（见 `test-engineer.md`）。**局限（坦诚披露）**：Cursor 当前子代理 hooks 无可靠 parent 回链，故无法用子代理 `conversation_id` 直接映射角色；首次 Agent 前或字段缺失时 identity 判据 fail-open（仍受分派计划等既有门禁约束）；「子代理是否越权写了分派范围外细节 / 用例变更是否真属用例缺陷」的语义部分仍靠文字 + §5.15 自检。**「冒烟是否真实执行」已由 R32 补为正向机读门禁**（§8.6）——本条曾把它列为纯文字约束，2026-07-29 复盘证明该缺口被实际踩中，按 R12 补齐实现；残留的语义部分（所用命令是否确为设计声明的生产路径）见 §8.6 能力边界。
- **批次 + 最终 E2E**（`batchE2ePassed` / `finalE2ePassed`）；**R15 lint**；**R16 静态扫描**；**R14 接口测试报告**；**R17 存储对账**（含适用行 `test-results/recon/*.json` 证据文件）；**R32 生产启动冒烟**（含强杀后重启段与结果新鲜度，§8.6）；**R33 界面与交互期望确认行**（§8.6）；**R18 设计审核**（含摘录最短长度、设计原文存在性、**设计落点 §N 章节窗口**、跨行去重）。**目标达成性 / 验收标准与摘录的深层语义对齐 / 对账查验语义 / 界面期望是否被忠实落地 / SRP 等**仍不可机械判定，由 RR/QE/PM 文字审查兜底。R18 设计落点/任务包交叉校验仍为弱匹配；摘录「是否与验收标准语义相关」仍靠人工核验——机读只证明文字真实、定位正确、不过度雷同。
- **`test-results/` 受控运行产物例外**：E2E / lint / 静态扫描 / QE 留痕 / **R17 对账证据（`test-results/recon/*.json`）** / **R32 启动冒烟结果（`test-results/e2e/.startup-smoke-result.json`）** / Playwright trace 等由运行器或测试工程师进程内写盘，**不触发** `gate-dev-workflow`；`.gitignore` 已忽略 `test-results/`。
- Shell 门禁为正则匹配，属「尽力而为」：可绕过手段无法穷尽拦截。**R28** 已把「写文件类命令」纳入与 Write 同等判据（见 §8.5），且经 **F-26** 修正后主判据为「命令行提到受门禁路径即裁决」而非命令名枚举，但仍不可穷尽（如变量拼接路径、Base64 解码后写入）；子 agent 不得主动利用（`CLAUDE.md` §5.16）。
- **hotfix 折叠通道下 R14/R17 无硬门禁的部分缓解**：见 `gate-chain.md` R9 脚注第 4 条（非阻塞软性提醒）。

### 8.5 审核加固项（R28–R31 与 R5/R6 加强）

本节对应一次外部审核中**实测可复现**的绕过链与静默失效。每条都配有回归用例：单元级见
`.claude/scripts/tests/selftest/r28-r31-hardening.mjs`，Hook 端到端见
`.claude/scripts/tests/scenarios/hardening.mjs`。

#### R28：Shell 侧写文件门禁

**问题**：`gate-dev-shell` 原先只匹配 `gatedShellPatterns`（包管理/脚手架），未命中即
`allow()` 早退——连 R5 身份判定都在其后。实测 `Set-Content src/app.ts`、`echo x > src/app.ts`、
`node -e "...writeFileSync..."`、`cp`、`curl -o`、`sed -i`、`git apply`、`rm -rf src/` 等
写文件命令 **100% 放行**，即 R5/R3/R9/R21/R23 仅覆盖 Write 类工具。

**判据**（`classifyShellWriteIntent`，执行权威为 Hook/脚本）：

| 分类 | 判定 | 裁决 |
| ---- | ---- | ---- |
| `targets` 非空 | 命令写入的目标可静态解析且命中受门禁路径——源码（`isGatedDevPath`）、**docs 文档成果物**（`isGatedDocArtifactPath`，**F-01** 补齐）、`process.md`、`harness-state.json`、`gated-artifacts.json` | 套用与 Write **完全相同**的判据：R5 顶层身份 → R5 角色↔路径（调用者身份优先，见 §上文 R5 两级判据）→ （非 `e2e/**`）分派计划/R3/R9/阻塞。通用前置（R10/docs-only/R3/阻塞）对 `e2e/**` 同样执行，仅 DE 专属前置按 e2e 跳过（**F-18/F-19**） |
| `selfGoverned` 非空 | 目标为门禁自治资产 | 按 R29 分级（`deny` / `ask`） |
| `opaqueWrite` | 内联解释器（`node -e`/`python -c`…）含写文件语义但目标不可解析 | `deny`，要求改用 Write 类工具以便门禁裁决 |
| `opaqueWorktree` | `git apply` / `reset --hard` / `stash pop` 等可任意改写工作树 | `ask`（交人类判断） |
| 其余 | 只读 / 构建 / 框架运行器 / 写非门禁路径 | 沿用既有逻辑 |

**能力边界**：仍是正则「尽力而为」，目标是把随手绕过的成本从 0 提高到「必须刻意构造」，
不声称不可绕过。框架自带运行器（`e2e-run` / `lint-run` / `static-scan-run` / `qe-run` /
`bootstrap-docs` / `gate-*`）显式豁免，避免自锁。

**从「枚举命令名」到「路径出现即裁决」（F-26 修正，2026-08-11）**：上表第一列的前提是
「写入意图已被识别」，而历史 `SHELL_MUTATION_RE` 是一张**命令名黑名单**——只枚举了
`sed -i` 一类。同类工具换个名字即整条判据失效，实测 ALLOW：`perl -pi -e`、`yq -i`、
`dasel -i`、`npx json -I -f`、`npx replace-in-file`、`ex -sc wq`、`npm pkg set`、`npm version`。
其中 `npx json -I -f docs/design/gated-artifacts.json` 可**单方面**取得 R22 双要素之一
（该文件 Write 通道期望角色为 `system-architect`），危害等同直接改写门禁强度。

修正分三层，方向是把判据从「用了哪个工具」倒转为「哪个文件可能被改」：

| 层 | 判据 | 说明 |
| -- | ---- | ---- |
| 命令名（保留） | `SHELL_MUTATION_RE` 补入上述已知同类命令 | 只负责抬高成本；枚举法不可穷尽，本层**不是**兜底 |
| **路径敏感兜底（新增）** | 命令行参数里出现受门禁路径 / 门禁自治资产 ⇒ 一律按「可能改写」进入裁决，**不再要求先命中命令名** | 真正的兜底层。未来出现的新工具无需登记即被覆盖 |
| 只读白名单 | `cat` / `type` / `head` / `tail` / `grep` / `rg` / `find` / `ls` / `wc` / `diff` / `stat` / `jq` / `node --check` / `git diff\|log\|show\|status\|blame\|ls-files` 等 | 避免把「看一眼受门禁文件」也拦成写入 |

隐含目标另行补出：`npm pkg set` / `npm version` 的目标是 `package.json`、
`npm|yarn|pnpm config set` 的目标是 `.npmrc`，二者都不出现在命令行里，若不补就会落进
「`mutates` 为真但 `targets` 为空」的缝里被放行。回归见 `r28-r31-hardening.mjs`「F-26」11 例
（8 条绕过链 + gated-artifacts.json 专项 + 只读命令与正常构建/运行器两条反向断言）。

**豁免只覆盖「调用」，不覆盖「改写」（F-21 同源修正）**：历史实现仅匹配命令中是否**出现**
运行器路径，于是 `Set-Content .claude/scripts/lint-run.mjs -Value x` 命中豁免并在 R29 归类
**之前**早退——同一改写走 Write 通道被 deny、走 Shell 通道 100% 放行，正是本节要消除的
双通道判据不一致。现要求运行器路径前必须是解释器/包管理器调用形式（`node` / `npx` /
`bun` / `deno` / `npm` / `pnpm` / `yarn`）；`Set-Content` / `echo >` / `cp` / `rm` 等改写或删除
运行器的命令一律落回 R29 `gate-code`（deny）。回归见 `r28-r31-hardening.mjs`「R28 加强（F-21）」两例。

#### R29：门禁自治资产

**问题**：`hooks.json`、`harness.config.json` 与三个运行时标记原先全在
`dotClaudeExemptPatterns` 中，等于「被约束方可自由改写约束自身」。实测一步可达：
伪造 `.dispatched-roles.json` 即获任意角色身份（deny → allow）；自写
`.toolchain-install-approved.json` 即自签安装授权（ask → allow）且**一份凭证泛用于任意
安装命令**；把 `qe.commands.lint` 设为 `exit 0` 即令 R15 空转（`gatePassed=true`）；
清空 `sourceDirs` 即令 R6 全面失效。这使 R12「只可加强」失去机械基础。

| 分级 | 路径 | 裁决 | 理由与解法 |
| ---- | ---- | ---- | ---- |
| `runtime-marker` | `.claude/hooks/.root-conversation-id.json`、`.claude/hooks/.dispatched-roles.json` | **deny** | 只应由 Hook 进程自身落盘；代理写入即等于自签身份。解法：走正常 Agent 派发让 Hook 自行落盘 |
| `approval-marker` | `.claude/hooks/.toolchain-install-approved.json` | **deny** | 代表「用户已批准」，代理写入即自签授权。解法：直接执行安装命令，由 `gate-toolchain-install` 在 `PreToolUse`（`Bash|PowerShell`）上 `ask` 请用户批准；如需批量预授权，由**用户本人**创建该凭证 |
| `gate-config` | `.claude/settings.json`、`.claude/settings.local.json`（Claude Code 的 Hook 注册表）、`.claude/hooks.json`（历史路径，R12 保留）、`.claude/harness.config.json`、`CLAUDE.md`、`.claude/harness/spec/**.md`、`.claude/rules/**.md` | **deny** | 门禁强度旋钮与权威文本；「是否放宽门禁」不能由被约束方自行决定。摘掉 `settings.json` 里任一条 Hook 注册即令对应门禁整体消失，强度高于任何 config 旋钮。解法：代理呈现 diff/理由，由**用户本人**编辑 |
| `gate-code` | `.claude/hooks/*.mjs`、`.claude/hooks/lib/**`、`.claude/scripts/{*-run*,*-lib,gate-*,exec-proof*,tool-availability*,startup-smoke*}.mjs`、`.claude/agents/*.md`、`.claude/scripts/tests/**` | **deny** | **F-21 补齐**：历史清单只锁配置文本，于是门禁**代码**、机读证据**运行器**、角色**强制约束**三类只受「角色↔路径」约束——而 §5.1 明文把 harness 基建授权给 DE。合起来即：DE 在合法分派下改写 `lint-run.mjs` 让它恒写 `gatePassed: true`，产物随后由**真实**私钥签名、R34 验签通过，stop 门禁收下一份「合法签名背书的假结果」。锁配置而不锁代码等于给 R12 留后门。解法同 `gate-config`：呈现完整 diff + 理由，由**用户本人**落盘；即使是加强方向亦然 |
| 角色门禁 | `.claude/harness-state.json` | 期望 `project-manager` | 它决定所有门禁读哪一份 `process.md`；保留 PM bootstrap 窗口 |
| 角色门禁 | `docs/[{feature}/]design/gated-artifacts.json` | 期望 `system-architect` | **2026-07-29 审核补齐**：它是 `harness.config.json` 的 merge 另一半（`extra*` 收紧项、各 `{gate}Applicability` 豁免第一要素、`productionStartupCommand`）。历史实现把它整体排除在门禁外（`isGatedDevPath` 直接 return false 且不在角色成果物判据内），等于**任何角色、任何阶段都能改写门禁强度**——R29 锁死了 `harness.config.json` 却放开了它。现纳入角色门禁（`isGatedArtifactsConfigPath`），Write 与 Shell（R28 `targets`）两通道同判；仍不走 DE 分派计划/R3/R9，避免 SA 在开发前产出它时死锁 |

**放松型旋钮回收（R12 显式化，2026-07-29 审核）**：`getMergedGatedPaths()` 合并
`gated-artifacts.json` 的 `extra*` 字段时，**只合并收紧型**（`extraSourceDirs` /
`extraBuildManifests` / `extraTestConfigs` / `extraRootPatterns`——它们只会扩大受门禁范围）。
放松型的 **`extraExtensionGateExemptDirs` 不再被合并**：该字段写入 `["src"]` 即可让 R6
代码扩展名门禁对整个 `src/` 失效，属「被约束方自行放宽约束」。确需新增扩展名豁免目录时，
改 `harness.config.json → gatedPaths.extensionGateExemptDirs`（R29 锁定，须**用户本人**编辑）。

**为什么一律 `deny` 而不是 `ask`（重要，勿回改）**：Claude Code 的 `PreToolUse` 确实支持
`permissionDecision: "ask"`，但 `ask` 在 **auto 权限模式**下会被自动批准——`permission_mode: 'auto'`
正是为「免打断」而设，于是「须用户确认」的保护会**静默退化**为放行，正是本次审核要消除的失效模式
（这也是 `permission-mode-guard.mjs` 把 critical/high 的 `ask` 一律升级为 `deny` 的原因，见 R1 加固）。
Shell 通道同理刻意用 `deny`：否则「Write 被拒 → 改用 Shell → 用户顺手点批准」会成为标准绕过路径，
与 `CLAUDE.md` §5.16 冲突。唯一保留 `ask` 的是 `gate-toolchain-install`——它本就以「请用户批准安装」
为语义，且凭证须带 `commandHash` 二次校验。

**工具链授权加强**：`commandHash` 由「可选」改为**必需**，且须 `userConfirmed: true` 与
有效时间戳（`expiresAt` 或 `approvedAt`）。历史行为下一份无 `commandHash` 的凭证可放行
任意安装命令，现要求凭证与本次命令一一绑定。凭证本身已禁止代理创建（见上表），
故常态路径是每条系统级安装命令都经 `gate-toolchain-install` 的 `ask` 由用户批准。

**残留缺口（坦诚披露）**：`.claude/templates/**` 仍为豁免——它不被 Hook 直接读取（门禁读
`docs/` 成果物），但被污染的模板会向下游传播错误结构，仍需人审。另：`gated-artifacts.json`
现已收敛到 SA，但 SA 仍是 AI 角色——它声明的 `{gate}Applicability:"n/a"` 只是双要素豁免的
**第一**要素，第二要素（`process.md` 用户确认行）同样由 AI 书写，故整套豁免机制的最终强度受
§8.7 边界 1 约束。

**`.claude/rules/**` 豁免回收（2026-08-14，R12 加强方向）**：该目录原与 `templates/` 并列
豁免，理由是「Claude Code 不加载 `.mdc` 规则，此目录仅为冗余留痕」。这个前提已不成立——
Claude Code 原生支持 `.claude/rules/`（递归发现全部 `.md`；`paths` frontmatter 决定注入时机），
适配层已把两份 `.mdc` 改写为真正生效的 `.md` 并新增三份（见 §8.9）。规则一旦真正注入代理
上下文，它与 `CLAUDE.md` 同属「写给代理看的强制文本」：可写等于可把「禁止手工编辑
`test-results`」改成「必要时可补字段」，再按改后的规则行事。故按 R12 只可加强的方向收回
豁免，归 `gate-config`（`classifyHarnessSelfGovernedPath`；Write 与 Shell 两通道同判）。
回归见 `r28-r31-hardening.mjs`「R29: 规则层 …」两条（已做反事实对照：去掉判据即转红）。

#### R30：门禁输入编码鲁棒性

**问题**：所有门禁读盘原先硬编码 `fs.readFileSync(p, 'utf8')`。实测**一个 UTF-8 BOM 就能
解冻 R10 的「不可逆冻结」**——BOM 顶开 `^---`，`parseProcessFrontmatter` 整体失配，
`cancelled` / `blocking` / `workflow_mode` / `iterationType` 全部静默丢失；UTF-16LE 更严重
（连 PM Agent 也被放行）。触发路径完全现实：PowerShell 5.1 的 `>` 与 `Out-File` 默认输出
UTF-16LE，`Set-Content -Encoding UTF8` 与 Windows 记事本产出 UTF-8 BOM，而本规约示例命令
以 PowerShell 为主。

**判据**：统一走 `readTextFileSafe` / `readJsonFileSafe`（`decodeTextBuffer`）——识别
UTF-8 BOM、UTF-16LE/BE BOM，并按「0x00 字节的奇偶优势比」探测无 BOM 的 UTF-16；
`parseProcessFrontmatter` 另行防御性剥离前导 BOM。探测**不得**要求「另一侧严格为 0」：
中日韩文本中 U+xx00 形式的字符（如「一」U+4E00）会在另一侧贡献 0x00，严格判据会整份漏判。

**R30 加强（F-10）：表格单元格内竖线的机读契约**

**问题**：编码之外，机读格式还有第二个静默失配面——**GFM 表格单元格内的竖线必须转义为
`\|`**（需求描述里写枚举 `status=all\|active\|done` 是唯一正确写法），而历史判据一律裸
`line.split('|')`：转义竖线被当作列分隔符，该行列数变多、**后续列整体右移**。实测后果：
`parseRequirementP0Ids` 从 `cells[4]` 取优先级时取到 `"done"`，`/^P0$/i` 失配 → 一条如实
标注 P0 的需求**静默**退出 E2E 必测集合，`gatePassed: true`、签名有效、零提示；R18 P0 覆盖
矩阵、R14 接口测试映射、`## 增量范围` 五维声明、`## 当前分派计划` / `## 待派发角色列表` /
`## 回退计数` / `## 用户确认记录` 同属受影响面。触发方式毫不刻意，且规约原先全篇未声明
单元格内竖线该怎么写。

**判据**：
1. **书写侧契约**：表格单元格内的竖线**须**转义为 `\|`（GFM 规范要求）；成果物模板与
   角色文件按此书写，判据**须**能正确还原为字面量 `|`。
2. **判定侧唯一切分器**：所有表格判据统一走 `core.mjs#splitTableRow`（配套
   `isTableSeparatorLine`）——按「未被反斜杠转义的 `|`」切分，再把 `\|` 还原为 `|`，
   并去掉首尾空壳列；禁止新增裸 `split('|')` 表格解析。运行器侧 `e2e-run-lib.mjs`
   刻意不依赖 `hooks/lib/**`，故同语义各留一份，**两处口径必须一致**，改一处须同步另一处。
3. **回归**：`tests/selftest/r30-table-escape.mjs` 锁定切分器、`parseRequirementP0Ids`、
   `parseMarkdownTables`、`collectActiveRoleSlugs`、`sectionHasDataRow` 五条链路；
   连续转义 `\|\|` 与行尾转义同样覆盖。

**章节聚合（F-11）：同名 / 多轮章节只取第一节**

`extractSection` 历史实现返回**首个**匹配章节即止。在多轮迭代下，成果物里常见
`## 需求覆盖矩阵` 与 `## 第二轮需求覆盖矩阵` 并存（或同名章节追加两次），于是**新轮次的表格
整段不入判据视野**——R18 的 12 维充分性、P0 覆盖矩阵、`sectionHasDataRow` 全部只看第一节，
第 2 轮起等于自动沿用第一轮的审核充分性。修复：新增 `extractSectionAll`（返回全部匹配节），
`extractSection` 改为**聚合全部同名节**（以空行分隔，避免后一节表头被并入前一节表格）；
标题行余下文字（如「（须逐项列出）」）仍不计入正文，故「缺章节 / 空章节」判据不变——
只把更多内容纳入判据，属加强。回归见 `tests/selftest/f09-f11-f17-round.mjs`。

**规范写法（R18 侧的配套约束）**：聚合解决的是「新轮次的表整段消失」，但它按**并集**判定
——第 2 轮若另起一节只写两三个维度，12 维充分性会被第 1 轮的维度行补齐。故多轮审核的规范写法是
**合并进同一张表并在「审核轮次」列标注轮次**，而非每轮另起章节；该义务写在
`.claude/agents/requirement-reviewer.md`「多轮迭代」一节（角色执行面），此处仅说明判据成因。
「本轮维度是否齐全」属语义充分性，与「摘录是否与验收标准相关」同类——落在
§8.4 的能力边界内，由 `requirement-reviewer` 如实执行。

**成果物与确认的轮次时效性（F-09 / F-17）**

`hotfix` / `single-task` 沿用同一份 `process.md` 与同一份 `design-problem-list.md`，而这些
都是单表累积结构。历史判据只问「表里有没有一行合规行」，不问「那一行是不是本轮的」：
第 2 轮起，上一轮的 R20 模式确认行与上一轮的 R18 审核结论行**直接为本轮背书**。修复引入
frontmatter `iterationRound`（缺省 1）：`≥ 2` 时，R20 确认行与 `## 审核结论` 最新行都须
自带本轮轮次标识，否则分别 fail-safe 回 `full` 与拒绝进入开发。唯一权威定义与判据表见
`workflow-modes.md`「`iterationRound`（轮次时效性）」；单轮项目判据与历史逐字一致。

#### R31：回退计数上限机械化

**问题**：`rollback.md` 声称开发回退由「stop Hook 与 `## 回退计数` 双重约束」，但
`gate-stop-workflow` 从不读取该章节——文档强于实现，按 R12 须补齐实现。

**判据**：`checkRollbackLimit` 解析 `## 回退计数` 的 `| 对象类型 | 对象编号 | 回退次数 |` 表；
任一对象 `回退次数 > rollback.limit`（默认 3）即由 stop 门禁注入 followup，要求 PM 置
`blocking: true`、写明反复回退根因并 `AskUserQuestion` 请用户决策。置于「全流程闭环放行」判据
**之后**——已跑完且全绿的流程不因历史回退次数被倒扣；空表/缺章节/非数字占位不误判。

#### R5 加强：身份基准 TTL 自愈

**问题**：`recordRootConversationId` 原先「文件存在即永不覆盖」，本意是防嵌套子代理误写基准，
但作用域被放大成「整个仓库永久只记一次」。实测后果：基准一旦被遗留夹具值或跨会话陈旧值占据，
`isRootConversationCaller` 恒 false，**顶层代写拦截永久静默失效**（审核时该仓库工作树即处于此态）。

**判据**：区分两个谓词——「可被覆盖（stale，无时间戳或超 TTL）」用于**自愈**决策；
「已确定过期（expired，有合法时间戳且超 TTL）」用于**身份判定**决策。TTL 内不覆盖（保留防嵌套语义），
超 TTL 由新会话首个 `SubagentStart` 覆盖。降级态不再静默：`inspectIdentityBaseline` 判定为
`baseline-missing` / `baseline-expired` 时写 stderr 告警并在 `process.md` 留一次性
**非阻塞**提醒（`recordIdentityBaselineNotice`，幂等、cancelled 流程不写）。

**保留的 fail-open**：基准缺失时仍放行（避免 `SubagentStart` 不可用导致硬死锁），
但已从「静默」变为「有告警 + 有留痕」。

#### R6 加强：代码扩展名默认受门禁

**问题**：路径门禁原先是 `sourceDirs` 目录名**白名单**，实测 14 类主流布局完全不受保护：
`Sources/`（SwiftPM）、`myapp/`（Python 根包）、`MyApp/`（.NET）、`functions/`（Serverless）、
`R/`、`Modules/`、`assets/`、`charts/`、`ansible/`、根目录 `main.py` / `index.js` 等——
与「跨技术栈通用」的定位直接冲突。原缓解手段（架构师在 `gated-artifacts.json` 声明
`extraSourceDirs`）既无机械校验，又晚于 T0 阶段的首批代码写入。

**判据**：改为**黑名单**——凡 `CODE_EXTENSIONS` 内的扩展名一律受门禁，除非位于
`gatedPaths.extensionGateExemptDirs`（依赖/构建产物/工具目录，如 `node_modules`、`dist`、
`target`、`.venv`、`test-results` 等）。`.claude/`、`docs/`、`e2e/` 分支优先级不变。

#### 实现与声明不一致的确定性缺陷修复（2026-07-29 规约审核）

四处「文档/模板与实现对不上」的确定性缺陷。前三处属 R12 意义上的**实现弱于声明**；第四处相反，
属**实现严于声明到不可达**——两个方向都是缺陷，因为「永久红灯的门禁」与「静默放行的门禁」
一样无法约束流程，且更容易诱导团队整体摘除该门禁。均已补齐：

| 缺陷 | 后果 | 修复 | 回归 |
| ---- | ---- | ---- | ---- |
| `extractSection` 要求 `##` 后紧跟标题 | 出厂模板 `requirement-spec.md` 的 `## 6. 隐性需求确认记录` 永远定位不到 ⇒ RA 照模板填写也过不了 **R19**，且 Hook 报「缺少真实数据行」这一**指向错误**的理由，代理会反复补行而非改标题 | 标题允许编号前缀（`## 6.` / `## 3.4、`），并要求标题**位于行首**（正文中提及 `## X` 不再构成章节，顺带堵掉一条伪造章节的路径）。**章节内容判据完全未变**，故不构成放松 | `tests/selftest/templates-vs-gates.mjs` |
| `gate-role-sequence` 用未归一化的原始角色名查 `GATED_ROLES` | Agent 若以中文角色名（`开发工程师`）发起，命中 `fail-open('not-gated-role')`，**整条 R13 门禁链被静默跳过**；同文件的 R10 判定却已在用 slug，前后不一致 | 统一改用 `normalizeRoleSlug` 结果判定与传参 | 既有 `r13-dispatch.mjs` 覆盖 slug 路径；中文名路径由本次改动收敛为同一分支 |
| R9 `hotfix_p0_impact` 仅在 Agent 发起期校验 | 「DE Agent 被拒」但**已在 DE 上下文内的源码写入照样放行** | `assertDevGateOrDeny` 补同一判据（见 `gate-chain.md` R9 第 3 条） | `r9-hotfix-design.mjs` / scenarios `hotfix.mjs` |
| R16 默认重复代码命令带 `--exitCode 1` | 与 `--threshold 5` 是两套逻辑，前者「检出任何重复即失败」使 5% 阈值**完全失效** ⇒ R16 退化为零重复容忍，**任何真实项目都不可能通过**（框架自身亦然） | 移除 `--exitCode`，回到文档声明的 5% 阈值判据（见 §8.2 R16 ⚠ 条） | `r16-static-scan.mjs`「默认命令不得含 `--exitCode`」 |

##### 门禁强度调整留痕（R16 生效阈值 0% → 5%，2026-07-29）

上表第四行是本次审核中**唯一放松了实际执行强度**的改动，按 R12 反向情形条款留痕如下。

| 项 | 内容 |
| -- | ---- |
| **放松了什么** | 通过 R16 重复代码子门禁的代码集合，从「重复率 = 0」扩大到「重复率 < 5%」。这在任何定义下都是放松，不因「修的是 bug」而改变性质 |
| **声明层是否变化** | **无**。§8.2 声明的判据一直是 5% 阈值，数字未动；改动只是让实现回到声明值 |
| **为何需要用户确认** | R12 原文只单向规定「文档强于实现 → 补实现」，对「实现严于声明」沉默，故本方向**不被 R12 自动授权**；且 R16 反弱化条款要求「修改阈值（无论升高或降低）须经用户确认并留痕」，而本次改的是**所有宿主项目的默认值**，影响面大于该条款原本约束的单项目覆盖 |
| **判定「5% 才是原意」的证据** | ① §8.2 明文写 5% 且标为唯一权威定义；② 反弱化条款禁止**提高** `--threshold`——只有阈值是生效旋钮时该句才有意义；③ R25 的引入背景写「并行开发各自复制改导致 QE 首轮**必然**因 duplication 打回」，前提是重复率为可控在阈值内的量而非零；④ 双要素豁免的适用条件是「确无法运行」，不含「无法达标」；⑤ 框架自身 9.56% 即红灯，若零重复是原意，作者首次运行就会发现 |
| **决策** | 经用户于 2026-07-29 明确确认后保持生效阈值 5%（与声明一致）。备选的「回滚为零重复容忍」被否决——它会使 R16 对任何真实项目永久红灯，实践后果是被整体豁免掉，等于门禁失效 |
| **后续禁止事项** | 不得以本条为先例放松其它门禁；加回 `--exitCode` 一律禁止（见 §8.2 ⚠ 条）；机读回归 `r16-static-scan.mjs`「默认命令不得含 `--exitCode`」双向钉死（既禁 `--exitCode`，也要求保留 `--threshold 5`） |

**顺带清理**：借修复 R16 的机会消除了框架自身的重复代码——19 个自测套件各自复制了同一份
84 名 `_harness.mjs` + 38 名 `_fixtures.mjs` 的巨型 import 清单（69 行 × 17 处字节完全相同），
而每个套件实际只用 3–18 个符号。裁剪为按实际用量导入后，全仓重复率 **9.56% → 2.78%**
（token 9.37% → 3.47%）。这也让每个套件的 import 列表本身成为「该套件测什么」的可读声明。
新增套件时请只导入实际使用的符号——照抄他人的 import 块会立刻把重复率推回门禁线。

**方法论教训（比单个缺陷更重要）**：R19 这一条能在 394 条回归全绿的情况下逃逸，是因为
**所有夹具都是套件内自拼的 Markdown 字符串，从不加载 `.claude/templates/` 下的真实文件**——
测的是「解析器对夹具的行为」，而非「出厂模板能否通过出厂门禁」。
`tests/selftest/templates-vs-gates.mjs` 补上这一层并登记「模板章节 ↔ 门禁判据」对照表；
**今后新增任何「Hook 解析某章节」的规则，须同时在该表登记**，否则同类漂移会再次逃逸。

#### 跨技术栈 lint 覆盖缺口修复（2026-08-03 规约审核）

**问题定性**：R15 声称「跨技术栈」，实现却只认 10 个根目录构建清单，且四个栈的默认命令为空。
与之相对，路径门禁（`gatedPaths.buildManifests` + R6 代码扩展名门禁）**早已**把 Kotlin DSL
Gradle、CMake、Elixir、Flutter、Swift 等纳管。两层口径不一致的后果不是「少查一点」，而是
**这些项目的源码受门禁约束、却拿不到任何 lint 命令**——R15 对它们是永久红灯，而唯一的出路
（配 `qe.commands.lint` 覆盖）又被 R29 锁给了用户本人。实践后果只会是整体走豁免，等于门禁失效。

| 缺陷 | 后果 | 修复 | 回归 |
| ---- | ---- | ---- | ---- |
| 探测表只有 10 个根目录清单，不含 `build.gradle.kts` / `CMakeLists.txt` / `mix.exs` / `pubspec.yaml` / `Package.swift` / `*.csproj` | 这些栈一律 `stack: unknown` ⇒ `no-lint-command` 永久红灯；Gradle 项目改用 Kotlin DSL 即静默掉出探测 | 探测表迁入 `lint-run-lib.mjs → STACK_MANIFESTS`（`lint-run.mjs` / `qe-run.mjs` 共用一张表，不再各抄一份），补齐上述清单并要求 ⊇ `gatedPaths.buildManifests` | `r15-lint.mjs`「栈探测清单须覆盖受门禁构建清单」（双向钉死，今后新增受门禁清单不登记即红） |
| Maven / Gradle / PHP / .NET 默认命令为空，而 `harness.config.json` 受 **R29** deny | 唯一补救手段对**所有代理**关闭，流程必然停在 QE；`system-architect.md` §5 第 3 条却仍指示架构师去写该文件——**规约给出的处方，执行层会直接拒绝** | ①为工具链自带分析器的栈补默认（见下方留痕）；②Maven/Gradle/PHP/CMake/Make 仍留空但产出 `remediation`（候选命令 + 可粘贴片段）；③改写 `system-architect.md` §5、`detail-design-spec.md` §5 与 `quality-engineer.md` R15 节：架构师**呈现片段、请用户本人粘贴**，不再指示其写 config | `r15-lint.mjs` 新栈默认值与 `remediation` 用例 |
| monorepo 根目录无清单时只报 `unknown` | 用户拿不到「框架到底看见了什么」，代理倾向反复重跑或试探绕过 | 根目录探测失败时递归（深度 ≤ 3、跳过豁免目录、上限 20 条）扫出子项目写入 `subProjects`；**只诊断不猜命令**——替 monorepo 猜会在错误目录跑错误命令，或跑出空转的「通过」（R12） | `r15-lint.mjs`「monorepo 诊断」用例 |
| npm `Missing script: "lint"` 被判为 `lint-failed` | 项目**根本没配 linter**（一条规则都没检查过）却被门禁描述成「代码有 lint 违规」，DE 被派去修一个不存在的缺陷——与 **R38** 要消除的错误指引同源 | 新增 `lint-not-configured` 判据（包管理器明确说找不到脚本时命中，宁漏不误），经 `checkLintClean` 原样上浮到 `state.lintReason`，stop 门禁改为按性质三路分流 | `r15-lint.mjs`「lint-not-configured 不得与违规/工具不可用混淆」 |

##### 门禁强度调整留痕（R15 新增栈默认 lint 命令，2026-08-03）

上表第二行中「补默认命令」一项会把若干原本必然失败的状态变成可通过状态，按 R12 反向情形条款留痕。

| 项 | 内容 |
| -- | ---- |
| **放松了什么** | .NET / Dart / Elixir / Swift 四栈原本 `no-lint-command` 必然红灯，现分别以 `dotnet build -warnaserror`、`dart analyze`、`mix compile --warnings-as-errors`、`swiftlint` 实际执行 lint——命令通过即门禁通过。判据本身（须有命令且退出码为 0）未变，但**能通过的项目集合扩大了**，性质上属放松 |
| **声明层是否变化** | **有**。§8.2 R15 原文列举「Java/PHP/.NET 等无默认」，本次把 .NET 移出该列表并新增三栈，故不同于 R16 那次「实现回到既有声明」，本次是声明与实现同时变更 |
| **为何需要用户确认** | R12 只单向授权「文档强于实现 ⇒ 补实现」；本方向不被自动授权，须呈现证据与影响面并由用户裁定。影响面为**所有宿主项目**的默认行为，大于单项目覆盖 |
| **选取默认命令的口径** | 只收「工具链自带、且不会空转」的分析器：`dart analyze` / `mix compile --warnings-as-errors` / `dotnet build -warnaserror` 随 SDK 分发，无额外配置也按默认规则真检查；`swiftlint` 需单独安装，但它是 SwiftPM 生态事实标准，未装时由 R38 报 `lint-tool-unavailable` 并给出正确指引，**不会**静默通过 |
| **为何 Maven / Gradle / PHP / CMake / Make 仍留空** | 这些栈没有「未配插件也能真检查」的通用命令。典型反例 `gradle check -x test`：未启用 checkstyle/ktlint/detekt 时**静默通过**——空转放行比红灯更坏（红灯至少会被发现）。它们改由 `remediation.suggestedCommand` 给候选，由用户确认本项目确已配置后再写覆盖 |
| **决策** | 经用户于 2026-08-03 明确确认后采用上述四条默认命令；备选的「一律不补默认、维持红灯」被否决——它会把这些栈推向整体豁免，与 R16 那次「不可达门禁终被摘除」的判例同理 |
| **后续禁止事项** | 不得以本条为先例，给「可能空转」的命令配默认（尤禁 `gradle check`、`make lint`、`exit 0` 类）；不得把「框架无默认命令」当作 `lintApplicability:"n/a"` 的理由；新增默认命令须同时说明「未配置时是否会静默通过」，无法说明的一律留空 |

##### 门禁强度调整留痕（R37 增量范围 schema 维拆分，F-08，2026-08-11）

`SPEC_REVIEW_V2.md` F-08 / 建议 #18 指出：R37 的 schema 维是一刀切硬禁用，
不区分「加一个向后兼容的可选字段」与「重命名主键、拆表、改类型」。按 R12 反向情形条款留痕。

| 项 | 内容 |
| -- | ---- |
| **放松了什么** | 「## 增量范围」原单一 `schema` 维（填「是」即禁用增量档）拆为「数据形状变更」+「需要迁移脚本 / 破坏向后兼容」两维，**仅后者**填「是」时硬禁用。原被一律拒绝的「形状变、兼容未破」类增量现可走 `single-task`，能通过的项目集合扩大，性质上属放松 |
| **声明层是否变化** | **有**。`workflow-modes.md` 迭代分诊表「修改数据模型 / schema / 新增迁移 ⇒ 禁止 `single-task`」细化为按兼容性分档；R20 固定选项文案、四维→五维表述、`templates/process.md` 同步变更。故与 R16 那次「实现回到既有声明」不同，本次声明与实现同时变更 |
| **为何需要用户确认** | R12 只单向授权「文档强于实现 ⇒ 补实现」，本方向不被自动授权。且 `EVIDENCE_LOG.md` F-08 自己写明「规约既未定义『非破坏性字段新增』这一豁免，被约束方就不得自行论证『我这个 schema 变更很小所以不算』——那正是 R12 要防的放松」，故须由用户裁定而非代理自行改回 |
| **证据** | ① `SPEC_REVIEW_V2.md` F-08、建议 #18；② `EVIDENCE_LOG.md` F-08 实测：用户原话「就加个字段，别动数据库结构那些」被 `increment-scope-schema-change` 拒并要求改走 `full`；③ 加字段是最常见的增量形态，一刀切使增量档适用面被压到「纯 UI 微调 / 纯行为调整 / 纯读取侧变更」，与 R37 引入增量档的初衷（「已有设计的项目加个小功能没有任何可用路径」）直接冲突 |
| **换取的新增判据（非纯放松）** | 「形状变、兼容未破」路径须①在两维说明列声明**兼容性回归用例**（`increment-scope-missing-compat-regression`）；②在折叠通道唯一测试轮次落地该用例执行记录（`checkIncrementCompatRegressionReport`，进入 `finalTestComplete`）。缺任一条即拒绝，等价于旧的硬禁用——放松的是「哪类变更可用增量档」，不是「验证可以少做」 |
| **决策** | 经用户于 2026-08-11 明确确认（「剩下两项按照审查报告中提到的建议进行修复」）后按建议 #18 实施。备选的「维持一刀切」被否决——它使增量档在最常见的增量形态上永久不可用，与 R16 那次「不可达门禁终被摘除」同理 |
| **后续禁止事项** | 不得由任何代理判定「我这个变更算兼容」——「是否需要迁移 / 是否破坏兼容」是一次如实声明，声明「否」却实际提交迁移脚本按**虚假声明**处理（复盘清单 B13）；不得以本条为先例把其它硬禁用改为「按性质分档」；兼容性回归用例缺失时**不得**走双要素豁免绕过，只能改走 `full` |

##### 门禁强度调整留痕（R16 默认 `--ignore` 移出 `migration/**`，2026-08-14）

移植期留痕 `migration/docs/**` 迁出本适配（移至仓库 `docs/migration/`）后，复核 F-13 的
`--ignore` 默认值发现该模式已与其立论脱钩。**方向为加强**，按 R12 自动授权实施，此处留痕备查。

| 项 | 内容 |
| -- | ---- |
| **收紧了什么** | 默认排除集去掉 `**/migration/**`，接入方仓库的 `migration/` 目录自此进入重复率检测的**分子与分母**。受检代码集合扩大，能通过 R16 的项目集合缩小 |
| **为什么原模式失效** | F-13 加它的唯一理由是「排除门禁自身」——当时 49 对克隆中 48 对落在 `.claude/scripts/tests/**` 与 `migration/docs/**`，后者是 harness 自带的移植报告。该目录已不随适配交付，模式在本目录树内不再命中任何文件，剩下的全部效果就是盲排**接入方自己的** `migration/` |
| **为何属加强而非放松** | `harness.config.json` `gatedPaths.sourceDirs` 明确列入 `migrations`，即规约**已声明**数据库迁移目录属受门禁的产品源码。默认 `--ignore` 却把它整体排除——属「实现宽于声明」，补齐即 R12「文档声明强于实现 ⇒ 补实现」的自动授权方向，不需用户裁定。与 F-13 修的「掺大分母」相比：一个虚增分母、一个把真实业务代码移出分子分母，**同为削弱判别力**，故同向禁止 |
| **证据** | ① `git ls-files claude/migration` 迁移前仅 7 个 `.md`，全为 2026-08-06/07 自述式完成报告，无产品源码；② 迁移后 `easy-harness/claude/` 内 `**/migration/**` 命中数为 0；③ `harness.config.json` `gatedPaths.sourceDirs` 含 `migrations`，与该排除项直接冲突 |
| **替代出口（未收窄可覆盖性）** | 确有仓库的 `migration/` 是生成式产物（如工具生成的 SQL 迁移、逐版本快照式脚本），仍可覆盖 `qe.commands.dupCheck` 排除之——但须按本节既有要求在质量报告与 `detail-design-spec.md` §5 写明**具体排除路径 + 排除理由**，不再享有「默认就排除」的静默待遇 |
| **后续禁止事项** | **不得**以「恢复 F-13 原样」「与 cursor/trae/codex 适配对齐」为由把 `**/migration/**` 加回默认排除集——那是把已声明的产品源码重新移出检测面；`.claude/**` 的排除**必须保留**（它才是「门禁自身」那一半，删除即 F-13 原缺陷复发） |

### 8.6 交付可用性与体验验收（R32–R33）

本节对应 **2026-07-29 启动报错与界面不符复盘**。两条规则针对同一类系统性盲区：
**流程主链机读全绿，但「交付物能不能起得来」「长得是不是用户要的样子」没有任何机械判据**。
回归用例：单元级见 `.claude/scripts/tests/selftest/r32-startup-smoke.mjs` 与
`r33-ui-expectation.mjs`，Hook 端到端见 `.claude/scripts/tests/scenarios/startup-smoke.mjs`
（SS0–SS7），纯函数另见 `.claude/scripts/startup-smoke-lib.test.ts`。

#### R32：生产启动冒烟硬门禁（正向证据，唯一权威定义）

**问题**：既有 **R22** 只拦「用 `E2E_WEB_SERVER_COMMAND` / `vite-node` 等替代命令掩盖生产启动
失败」这一条**负向**路径。实测复盘显示真实失效路径是**更简单的那条**：测试工程师干脆
**不做**生产启动冒烟——Playwright 的 `webServer` 会自己拉起 dev server，E2E 因此全绿，
`gatePassed=true`，机械层完全无感。批次 3 已知 `npm run start` exit 1，仍一路收尾到宣告完成；
用户按设计约定方式启动即崩。§8.4 当时如实披露过「冒烟是否真实执行仍靠文字 + 自检」——
按 **R12**（文档强于实现须补齐实现）现补为机读硬门禁。

**为什么必须含第二段（强杀后再启动）**：yaml 问题修好后立刻暴露 `DATA_DIRECTORY_LOCKED`
（陈旧数据目录锁）。这类「第二次才炸」的缺陷在一次性启动验证下**必然漏网**，只能在用户
强杀/掉电后的现场暴露。故冒烟固定两段，第二段以 `SIGKILL` / `taskkill /T /F` 构造异常退出现场。

| 项 | 内容 |
| -- | ---- |
| **执行命令与产物** | `node .claude/scripts/startup-smoke-run.mjs` → `test-results/e2e/.startup-smoke-result.json` |
| **命令解析优先级** | `harness.config.json → te.startupSmoke.command` > `gated-artifacts.json → productionStartupCommand` > `package.json → scripts.start`；三者皆无 ⇒ `no-startup-command`（**不**回退 dev/preview：猜错的启动路径比不冒烟更危险） |
| **段 1 干净启动** | 进程须在 `stabilizeMs`（默认 8000ms）内不退出；声明 `productionStartupHealthUrl` 时另须在 `readyTimeoutMs`（默认 60s）内取得状态码 < 500 的响应 |
| **段 2 强杀后再启动** | 强杀段 1 进程 → 等 `restartDelayMs`（默认 1500ms）→ 同参数再启动一次并同样判定 |
| **运行器判据** | `gatePassed = 有启动命令 && cleanStart.passed && restartAfterKill.passed`（`computeStartupSmokeGate`） |
| **门禁判据** | `startupSmokePassed`（`checkStartupSmoke` → `evaluateStartupSmokeResult`）：产物存在、`command` 非空、`gatePassed=true`、含 `restartAfterKill.passed=true`、`capturedAt` 可解析且未超 `te.startupSmoke.maxAgeHours`（默认 24h）。`docs-only` 视为满足 |
| **并入范围** | **批次与最终两级**：`batchTestComplete` 与 `finalTestComplete` 均含该项（§8.3 公式）。与 R14/R17 不同，**hotfix R11 折叠通道也并入**——复盘中两次热修恰恰都是启动缺陷修复，折叠通道更不能少这道 |
| **适用性豁免** | §8.2 双要素表 R32 行（`startupSmokeApplicability:"n/a"` + 用户确认）。**限于「本项目确无可冒烟常驻启动路径」**（纯算法库、纯静态资源包）；**「暂时起不来」不是豁免理由** |
| **失败后果** | 属**产品缺陷**：TE 判定测试不通过 + `blocking: true` + 建议 PM 回派 DE（`rollback.md` 回退触发条件）。PM 的「接受带已知缺陷交付」AskUserQuestion **不能**解除本机读门禁 |

**新鲜度为何要卡**：否则一次冒烟通过即可为后续所有批次充当证据，与 R14/R17「按批次补留痕」
的精神冲突。默认 24 小时足够宽松，跨天续跑的流程只需重跑一次冒烟（约 20 秒）。

**能力边界（坦诚披露）**：
- 机读只证明「冒烟跑过、两段都过、结果不陈旧」。**不证明**所用命令确为设计声明的生产路径
  （运行器按优先级解析，但架构师可以声明一个假的），也不证明健康检查语义正确——须由
  QE/PM 对照 `detail-design-spec.md` §4 与测试报告「## 生产启动冒烟」章节人工核验。
- 段 1「进程存活即通过」对**启动即挂但退出码为 0** 的极端实现无效；这类项目须声明 `healthUrl`。
- 与 E2E/lint 产物同理，`test-results/**` 属受控运行产物、不触发 `gate-dev-workflow`，
  因此**手改产物**在机械层不可拦（既有风险，非本次新增；R28 已覆盖 Shell 通道的随手改写）。

#### R33：界面与交互期望确认（唯一权威定义）

**问题**：用户目标含强体验锚点（「类似 Apifox 的 B/S 工具」），需求分析师 13 轮苏格拉底澄清
把**功能**问透了——能力范围、断言、变量、环境、Mock、鉴权……却**从未**追问布局、导航、
信息架构、密度、参考截图，也未把「类似」钉死为功能像 / 流程像 / 外观像。RA 罗盘原有六维
（产品目标 / 用户痛点 / MVP / 差异化 / 非功能 / 约束假设）**没有 UX 维**，因此 RA 可以在
形式完全合规的前提下漏掉决定满意度的那一维；用户「确认」的是**功能摘要**，界面则被默认
交给组件库默认样式。注意「React 18 + Ant Design」是**技术栈确认**（R26/R18 那条链），
**不是**界面期望确认——这正是当时被混为一谈的地方。

| 项 | 内容 |
| -- | ---- |
| **罗盘第 7 维** | `requirements-analyst.md` §1.3 新增「交互与界面期望」；§1.3.1 规定必聊条件：greenfield / 引入新交互面 / 目标点名竞品或参照物 / 用户表达过任何外观偏好 |
| **对标钉死** | 目标含「类似 XX」时须用苏格拉底「对标钉死」手法拆成功能像 / 流程像 / 外观像并逐项取得表态；禁止用竞品默认、组件库默认或「留给设计阶段」代替用户确认 |
| **需求文档落点** | `requirement-spec.md`「3.4 界面与交互期望」（对标参照 / 布局与关键工作区 / 导航与信息架构 / 信息密度与视觉风格 / 参考图或可验收描述 / 非目标 + §7 追溯）；界面类假设/边界/取舍同时并入 §6（R19）；可验收的界面期望须在 `requirement-list.md` 立编号与验收标准 |
| **机读判据** | `checkUiExpectationConfirmed`（`hasUiExpectationConfirmation`）：`process.md`「## 用户确认记录」须有一行**按列**满足两侧条件——「确认项」列命中界面类词（界面/UI/交互/视觉/外观/布局），**且**摘要列命中表态词（期望/对标/参考/风格/导航/信息架构/默认/不适用/无 UI/确认/接受）**且**摘要去标点后 ≥ 4 字。并入 `checkRequirementReady()`，**缺失时 `gate-role-sequence` 拒绝发起 `system-architect`** |
| **按列判定（F-28，2026-08-11 加强）** | 历史实现对**整行**同时测两个正则，而 `布局` / `默认` 同属两个词表，于是 `\| 备注 \| … \| UI 布局稍后再定 \|`——一行明说「还没定」的无关备注——反而满足判据；摘要留空的 `\| 界面与交互期望 \| … \|  \|` 同样过关。现两列各管一段：确认项列决定「这一行**是**界面维度的确认」，摘要列决定「用户**真表了态**」，彼此不能顶替。回归：`selftest/r33-ui-expectation.mjs` F-28 三例 |
| **两种合规形态** | ①有期望：写明对标/布局/导航等；②明确无独立期望：「接受组件库默认外观」，或无 UI 项目「本项目为 CLI/纯后端，界面期望不适用」。**技术选型确认行不能顶替** |
| **豁免** | 与 R19 同——**不适用**双要素豁免机制。「本次无界面期望」本身就是一种须留痕的用户表态，属澄清充分性的一部分，而非「确不适用/无法运行」的技术性豁免场景 |
| **下游消费** | SA 将 §3.4 作为设计输入（`system-architect.md` 输入第 1 条）；RR「体验」维以 §3.4 为审核基线（`requirement-reviewer.md`） |
| **适用范围** | `full` / `single-task`（发起 SA 的路径）；`hotfix` / `docs-only` 不走 RA→SA，随既有 `${mode}-exempt` 分支豁免 |

**能力边界（坦诚披露）**：机读只证明「界面这一维被摆到用户面前并留了痕」，**不证明**追问是否
充分、期望是否具体可验收、设计与实现是否忠实落地。语义部分由 RA 的苏格拉底协议（§1.3.1）、
RR「体验」维人工审核，以及界面期望立编号后的 E2E 追溯共同承担。

### 8.7 机械层的实际强度边界（唯一权威定义）

本节回答一个容易被本文件其余章节的措辞误导的问题：**「机械门禁」到底强到什么程度。**
结论：Hook 的作用是**把抄近路的成本从 0 抬高到「必须刻意构造」**，它**不是**安全边界，
也**不是**可以替代角色自律的裁判。§8.4 已披露 fail-open 与 Shell 正则的「尽力而为」性质；
本节汇总其余边界。

> **本表随 2026-07-30 审核加固更新**：边界 2（证据产物不设防）与边界 3 的一个未列项
> （阻塞释放阀比 `loop_limit` 便宜得多）已分别由 **R34**、**R35** 收紧，**但都没有消失**——
> 收紧后的残余部分仍列在本表，并新增边界 4/5。这正是本节的用法：**加了门禁不等于风险消除**，
> 每条都要重新回答「判据读的输入是谁写的、拦不住时谁兜底」。
>
> **同日复核二轮更新**：对 R34–R38 的逐项复核发现边界 2/4/5 的**实际防护范围小于本表当时的
> 描述**，三处均已用 PoC 复现并修复（见各条「二轮修正」）：R34 的产物可原样重放（验签不含
> 新鲜度）、R35 的机器起源分支可由代理写一行表格自行满足、R36 的修复通道例外可用写入内容
> 夹带任意路径来触发。这三处恰好印证了本节的推论：**边界表本身也会漂移**，须以实现为准逐条复核。

> **本节不得被当作放松依据（R12）**：披露边界的目的是让「靠自律的那部分」被显式认领，
> 而不是承认「挡不住即可做」。下列各类行为一律定性为**严重违规**，与直接改写门禁同级。

| # | 边界 | 机械层能做的 | 机械层做不到的 | 兜底 |
| - | ---- | ------------ | -------------- | ---- |
| 1 | **用户确认是自述** | 校验 `## 用户确认记录` 中确认行的**结构性存在**与关键词匹配（`hasLiteModeConfirmation` / `hasUiExpectationConfirmation` / 各 `is*Exempt`） | **无法验证 AskUserQuestion 真的问过用户**。确认行由 PM（被约束方）书写，双要素豁免的两个要素（`gated-artifacts.json` 与 `process.md`）**同样都由 AI 写** | 角色文件的 AskUserQuestion 义务（R20/R26/R27/R33）；复盘 skill 抽查确认行与实际对话是否对得上 |
| 2 | **证据产物的执行证明可被绕过（**R34 后已大幅收紧，但仍非安全边界**）** | **R34**：产物须带 Hook 签发 nonce + ed25519 签名，签名覆盖除 `execProof` 外的全部字段；台账与私钥交接目录纳入 R29 禁写。手写 `{"gatePassed":true}`、落签后改字段、Hook 通道外运行、nonce 伪造/错配、私钥未被消费——六类形态均被识破。**二轮修正**：再加新鲜度判据（`checkArtifactFreshness`），产物时间戳须晚于最后一次源码变更 | **私钥交接文件在被运行器消费前对代理是可读的**。伪造需要：抢在运行器消费前读到私钥、自行完成规范化序列化与 ed25519 签名。新鲜度建立在文件 mtime 上，代理有能力改 mtime。成本已从「改一个 JSON 字段」抬到多步刻意构造，但**不是**密码学安全边界 | 该多步链路在会话记录里清晰可见；QE/PM 核验时应关注 `execProof.reason`；改 mtime 须走 Shell，由 R28 部分兜底；伪造执行证明视同伪造测试结论，与直接改写门禁同级 |
| 3 | **stop 门禁有次数预算** | 流程未闭环时注入 `followup_message`（§8.2 判据表） | `gate-stop-workflow` **从不 deny**，只能提醒；stop hook 自动追加 followup 的次数由引擎的 stop 循环预算（本框架按 3 轮设计）限定，用尽后代理**可以**在流程未完成时正常结束回合 | `CLAUDE.md` §5.15 回合结束前自检——预算耗尽后它是**唯一**还在起作用的约束，故不得以「Hook 会拦」为由省略 |
| 4 | **阻塞释放阀（**R35 后已收紧**）** | **R35**：`blocking: true` 不再无条件释放 stop 门禁，须有机器起源依据或「实质阻塞原因 + 用户决策留痕」双证据。**二轮修正**：机器起源分支须与 Hook 独占写入的旁路台账对上指纹，且每条只能释放一次 | 与边界 1 同源：**人类起源**的两项证据仍由 PM（被约束方）书写，机读只证明「阻塞被写清楚了、并声称问过用户」，**不证明真的问过** | 与边界 1 相同的兜底；复盘 skill 抽查阻塞决策留痕与实际对话是否对得上 |
| 5 | **判定期异常的修复通道例外（**R36 的刻意残留**）** | **R36**：判定期异常由 fail-open 改为 fail-closed（write/shell/task → deny，toolchain → ask，stop → followup）。**二轮修正**：修复例外只在「整次调用就是对活跃 `process.md` 的直接写入」时给（`resolveGateRepairPaths`），夹带任何其他路径一律 deny | 单独写活跃 `process.md` 在异常时仍放行。理论上「先制造判定期异常、再借该例外写 process.md」可绕过 R5 角色↔路径对 `process.md` 的约束——但已**不能**借它写入 process.md 以外的任何路径 | 该例外必然伴随 `## 门禁异常事件` 落盘与 `blocking: true`（对用户可见）；关闭它会造成代理无法自愈的死局，故取舍为「可见的窄例外」优于「不可修复的死锁」 |

**补充：`PreToolUse` 的覆盖面**。`.claude/settings.json` 的写文件 matcher 为
`Write|Edit|NotebookEdit`（入口脚本已解析 `file_path` / `path` / `target_file` /
`notebook_path` / `target_notebook` 五个字段）。此列表之外的写入通道（MCP 工具的写操作、
未来新增的写文件工具等）**不经 `gate-dev-workflow-enhanced`**；Shell 通道由 R28 部分兜底（§8.5），
但同样是正则「尽力而为」。新增写入通道时须同步扩充 matcher，否则等于开了一条无门禁旁路。

**推论（给规约维护者）**：由于以上各点，**「加一条机械门禁」并不等于「该风险已消除」**。
新增门禁时应同时问：判据读的输入是谁写的？证据是谁产出的？拦不住时谁来兜底？
把答案写进对应规则的「能力边界」段落，而不是默认机械化即闭环。
R34/R35 是这条推论的正面例证——它们把两条边界从「零成本绕过」收紧到「须刻意构造」，
但**都没有把边界消掉**，故仍留在上表而不是被删除。

### 8.8 审核加固项（R34–R38，2026-07-30 规约审核）

本节是 **R34–R38** 的**唯一权威定义**。这五条来自一次整体规约审核指出的五个承重问题：
证据产物不设防、阻塞释放阀过于便宜、`failClosed` 是死配置、缺可用的轻量档、
工具不可用与代码不合格不可区分。回归用例：单元级见 `.claude/scripts/tests/selftest/r34-exec-proof.mjs`、
`r35-blocking-evidence.mjs`、`r36-gate-exception.mjs`、`r37-single-task.mjs`、`r38-tool-unavailable.mjs`；
Hook 端到端见 `.claude/scripts/tests/scenarios/audit-fixes.mjs`（AF1–AF14）。

#### R34：证据产物执行证明（唯一权威定义）

**问题**：R15/R16/R32 与批次/最终 E2E 共五项硬门禁，判据都是读 `test-results/**` 下的
`gatePassed`。该目录**必须**豁免写门禁（否则运行器自身会被 R6/R28 拦住，§8.4「受控运行产物例外」），
于是产物无签名、无执行证明——**手写 `{"gatePassed":true}` 与真跑一遍对门禁完全等价**。
这是全套规约最大的承重缺口：五项门禁的判据全部由被约束方产出。

**机制（三步）**：

| 步骤 | 执行者 | 内容 |
| ---- | ------ | ---- |
| **签发** | `gate-dev-shell`（`PreToolUse` / `Bash\|PowerShell`） | 识别本次命令为框架运行器时生成 ed25519 密钥对：**公钥**写入台账 `.claude/hooks/.exec-proof-ledger.json`，**私钥**写入交接文件 `.claude/hooks/.exec-proof-pending/<nonce>.json` |
| **落签** | 运行器（`*-run.mjs`） | 写产物**之前**调用 `attachExecutionProof()`：领取并**立即删除**交接文件（私钥单次使用），对「产物去掉 `execProof` 后的规范化 JSON + kind + nonce」签名，写入 `execProof: { kind, algo, nonce, signature, signedAt }` |
| **验签** | 门禁（`evaluateGateArtifact`） | 用台账公钥验签，并要求交接文件**已被消费**（仍存在 ⇒ 私钥未被运行器取走 ⇒ 该 nonce 作废） |
| **验新鲜度** | 门禁（`checkArtifactFreshness`） | 产物 `capturedAt`/`executedAt` 须不早于最后一次源码变更（`latestSourceChangeMs`，容差 2 秒） |

**产物类别（`kind`）与命令识别**：`lint` / `static-scan` / `e2e-batch` / `e2e-final` / `startup-smoke`；
`e2e-run.mjs` 按 `--scope=final` 分流（`detectRunnerExecProofKind`，兼容 Windows 反斜杠路径）。

**判据顺序（关键）**：`docs-only`/双要素豁免 → 产物存在性 → **R34 验签** → **R34 新鲜度**
→ **R38 工具不可用** → `gatePassed`。验签**先于** `toolUnavailable`，否则手写一份
`{"toolUnavailable":true}` 就能把失败改写成「环境问题」这条措辞更宽松的叙事；新鲜度紧跟验签，
因为它读的时间戳只有在签名有效时才可信。

**失败理由（均以 `exec-proof-` 前缀，便于与质量问题区分）**：`exec-proof-missing`（无字段，旧版或手写）、
`exec-proof-no-nonce`（运行器未取到签发，通常是在门禁通道外执行）、`exec-proof-unknown-nonce`、
`exec-proof-kind-mismatch`、`exec-proof-key-not-consumed`、`exec-proof-signature-mismatch`（落签后被改动）、
`exec-proof-stale-artifact`（产物早于最后一次源码变更）。

**新鲜度判据（`checkArtifactFreshness`，2026-07-30 复核补入）**

复核实测：验签只证明「这份产物被真运行器跑出来过」，**不证明它对应现在这份代码**——nonce
不设过期、验签也不标记消费，同一份签名产物连验三次都通过，`executedAt: 2020-01-01` 同样通过；
而 R15 / R16 / 批次 E2E / 最终 E2E 四项都没有任何新鲜度判据（当时只有 R32 有 24h 上限）。
于是存在一条**不需要抢私钥**的重放路径：代码还绿时真跑一次、把产物存一份，改坏代码后原样放回
（`test-results/**` 必须豁免写门禁，这是设计前提）。

- **基准**：`gatedPaths.sourceDirs`（含 `gated-artifacts.json` 的收紧项）加 `e2e/` 下全部文件的最大
  mtime；刻意**不含** `.claude/**`——改 Hook 不应让全部质量产物失效。遍历跳过依赖/构建/受控运行
  产物目录，并有 20000 条目上限（巨型仓库上宁可判据偏松也不让门禁卡住，R12）。
- **判定**：产物时间戳 + 2 秒容差 ≥ 基准即通过。时间戳落在签名覆盖范围内，改它即签名失配，
  故刷新的唯一办法是**真的重跑一次**。
- **防死锁**：无源码树（新项目/纯文档项目）时不判；`execProof.requireFreshArtifacts: false` 是
  **用户级**逃生开关（`harness.config.json` 受 R29 锁定）。R32 的 24h 上限保留——两者是不同判据，
  「24 小时内」不等于「这份代码」。

**R29 联动**：台账与私钥交接目录（前缀匹配 `.claude/hooks/.exec-proof-pending`）纳入
`classifyHarnessSelfGovernedPath` 的 `runtime-marker`，代理写入一律 deny（含 Shell 通道）——
可写台账等于可自签任意产物，可删交接文件等于抹掉「未消费即作废」这一条件。

**防死锁（R12：新增门禁不得制造不可达标准）**：

- 台账条目**按 kind 各保留最近 N 条**（默认 8），不做全局淘汰，避免「产物还在用、nonce 已被挤掉」；
- nonce **不设过期**（新鲜度由各门禁自己的规则管，如 R32 的 24h），过期只作用于**私钥交接文件**（默认 15 分钟，任意 Hook 运行时清扫）；
- 签发失败**绝不阻断 Shell**（否则门禁故障 = 运行器全跑不了），代价是该次产物验签失败、由 followup 指引重跑；
- `execProof.enforce: false` 是**用户级**逃生开关（`harness.config.json` 受 R29 锁定，代理改不了），供「用户自己在外部终端跑运行器」「Hook 未生效」等受限环境使用。

**能力边界**：见 §8.7 边界 2。**这不是密码学安全边界**——私钥交接文件在被消费前对代理可读，
新鲜度判据也建立在文件 mtime 上（代理有能力改 mtime，但须走 Shell 通道，由 R28 部分兜底）。
它把伪造成本从「改一个 JSON 字段」抬到「抢读私钥 + 自行完成规范化序列化与 ed25519 签名」，
一条需要刻意构造、且在会话记录里清晰可见的多步链路。

#### R35：阻塞释放证据（唯一权威定义）

**问题**：`gate-stop-workflow` 判据链最前面有一个无条件放行分支——`blocking: true` 即当轮放行。
§8.7 曾把 stop 门禁的强度上限归结为 `loop_limit: 3`，但实际释放成本只是**一行 frontmatter**，
比三个回合的预算便宜得多；更微妙的是 **R31** 回退上限注入的 followup **本身就在指示代理去写这一行**。

**判据（`checkBlockingReleaseEvidence`，二者之一即放行）**：

1. **机器起源**：`## 门禁异常事件` 有未处理行（`处理状态` 不含「已处理/已关闭/已解决」），
   **且**该行在旁路台账里有同指纹、尚未用过的条目 ⇒ 确实是 Hook 自己写的
   （§8.4 `recordFailOpenEvent`），不是代理自述；
2. **人类起源**：`## 阻塞原因` 有**实质内容**（`hasSubstantiveBlockingReason`：排除引用块与
   「无 / — / - / 待补 / TBD / （占位）」，去标点后 ≥ 4 字）**且** `## 用户确认记录` 有一行阻塞决策留痕
   （`hasBlockingDecisionTrace`：行内同时含阻塞类主题「阻塞/待决/暂停/挂起/决策」与
   「问过用户」的表态「AskUserQuestion/用户/确认/决策/答复/裁决」；`AskQuestion`（Cursor 时代
   工具名）亦保留为可接受形态，供从 Cursor 版迁移的接入方仓库沿用）。

不满足时 stop **不放行**，注入 followup 要求补齐证据或把 `blocking` 改回 `false`。
`blocking` 对**派发**的阻断语义不变（`checkRoleDispatchGate` 仍拒绝派发），故补齐证据的唯一执行者是
PM 写 `process.md`——该写入正常放行，不构成死锁；`loop_limit: 3` 仍为上限。

**配套修复**：`recordFailOpenEvent` 写入阻塞原因的逻辑由整段正则改为逐行定位。历史正则
`/## 阻塞原因\s*\n+无\s*(?=\n## |\n*$)/` **匹配不上出厂模板**（「无」后紧跟两行 `>` 使用说明），
导致 fail-open 时只置了 `blocking: true` 却没写阻塞原因——与本判据配合会出现
「门禁自己写的阻塞过不了门禁自己的证据校验」这种自相矛盾。回归：`r35-blocking-evidence.mjs`。

**工具名漂移修复（2026-08-13，`hasBlockingDecisionTrace` 接受 `AskUserQuestion`）**

`stanceRe` 历史上只认 Cursor 时代的 `askquestion`，但**它不是 `AskUserQuestion` 的子串**
（`AskUser` + `Question`）。而本节声明层与全部角色文案要求的确认工具正是 `AskUserQuestion`，
于是出现「按规约照做、留痕反而不被承认」：纯英文留痕行
`| blocking decision | … | AskUserQuestion: … |` 被判为「没问过用户」，stop 门禁不放行。
中文项目因 `用户`/`确认`/`决策` 兜底而未暴露，故长期潜伏。

| 项 | 内容 |
| -- | ---- |
| **是否属放松** | **否**。§8.8 R35 判据 2 的声明层**一直**把 `AskUserQuestion` 列为可接受表态，实现却不认——属 R12「文档声明强于实现 ⇒ 补齐实现」的**自动授权**方向，不适用反向情形条款，无需按「门禁强度调整留痕」走用户裁定 |
| **改了什么** | `stanceRe` 增列 `askuserquestion`；保留 `askquestion`（从 Cursor 版迁移的接入方仓库里已有该形态，撤销既有可接受形态才是放松）。声明层同步补注「`AskQuestion` 亦保留」，使文档与实现一致 |
| **判据强度是否下降** | 否。`topicRe`（阻塞类主题）与「须两者同时命中」的结构未动；新增的只是**规约自己要求的那个工具名**。上文「没问过用户」的反例（`postponed to the next sprint`）仍为 `false` |
| **回归与判别力** | `r35-blocking-evidence.mjs` 新增三例（英文 `AskUserQuestion` 认可 / 同形态无表态仍拒 / 旧 `AskQuestion` 不被反向打破）。三例**刻意全英文**：去掉 `askuserquestion` 后第一例立即转红（中文备选不会替它兜底），已做反事实对照确认有判别力 |

**机器起源的出处校验（2026-07-30 复核补入）**

复核 PoC 复现：该分支原本只看 `process.md` 里有没有一行「待处理」，而这一章节恰由被约束方（PM）
书写——代理自补一行表格即可解除 stop 门禁的全部推进判据，**比它本该补强的双证据分支更便宜**。
也就是说 R35 只是把「一行 frontmatter 静默收尾」换成了「一行 frontmatter + 一行表格静默收尾」，
`core.mjs` 注释里那句「不是代理自述，本身即为可信依据」在实现上并不成立。

- **旁路台账** `.claude/hooks/.gate-exception-ledger.json`：由 `recordFailOpenEvent` 在 `process.md`
  **落盘成功之后**登记（顺序反过来会留下可被抄用的无主条目）。纳入 R29 `runtime-marker`，
  写文件与 Shell 两条通道均 deny。
- **指纹**：`sha256(时间 | Hook | 上下文 | 异常摘要)` 取前 32 位——即表格那四列。改任一列都失配，
  凭空补一行更是查无出处。
- **一次性**：释放成功后由 `gate-stop-workflow` 调 `consumeGateExceptionRelease()` 在台账标
  `releasedAt`。否则一条真实发生过的历史异常可以被反复抄回表格，变成永久免死金牌。
- **不构成死锁**：`gate-stop-workflow` 的 R36 fail-closed 分支每次都会记一条**新**事件，
  故「门禁反复抛异常」时每轮都有新的可用条目；台账写失败只是退回人类起源双证据（收紧方向）。

**反向对账：台账 → 表格行（F-22，2026-08-12 v2 评审补入）**

上面三条都是「表格行 → 台账」正向校验：防的是**凭空补一行**。反向的窟窿一直敞着——
把 `## 门禁异常事件` 里的行**整段删掉**、只留 `blocking: true`，正向校验无从触发，而 stop 门禁的
`blocking` 分支在证据校验前是无条件放行区间（人类起源双证据也可另行编造）。也就是说
「门禁自己记下的异常」可以被被约束方静默抹掉，§8.4 承诺的 fail-open 留痕形同自愿。

判据 `checkGateExceptionLedgerReconciled`（`core.mjs`，stop 侧在 `cancelled` 之后、
`blocking` 分支**之前**调用——放在 blocking 之后就正好落进那段无条件放行区间）：

- **孤儿条目** = 台账中 `processPath` 指向当前活跃 `process.md`、尚未 `releasedAt`、
  且指纹在 `## 门禁异常事件` 表中找不到对应行的条目；命中即 `gate-exception-ledger-orphan`，阻断收尾。
- **归属**（`recordGateExceptionLedgerEntry` 落 `processPath` + `recordedAt`）：不按 process 归属的话，
  每次迭代切换子树都会把上一份 process 的条目变成**无法消解**的孤儿——补不回来，因为那张表已不在。
- **升级兼容**：历史条目无 `processPath` 字段，一律排除在孤儿判定外；否则升级当天所有存量条目一起爆。
- **处置**：须由 PM **按版本历史逐字恢复**该行（重新概括一句会与指纹失配，恢复不了），
  或将该条目走正常释放流程消解掉——不接受「重写一条差不多的」。

至此两个方向闭合：补行被指纹拦，删行被反向对账拦。回归见 `tests/selftest/blocking-failopen.mjs`
（`findOrphanGateExceptionLedgerEntries` / `checkGateExceptionLedgerReconciled` 两组断言，
含「删整行」「改摘要」「已释放条目不再追究」「历史无 processPath 条目不误判」四类形态）。

**能力边界**：见 §8.7 边界 4。**人类起源**的两项证据仍由 PM 书写，机读只证明「阻塞被写清楚了、
并声称问过用户」。

#### R36：判定期异常 fail-closed（唯一权威定义）

**问题**：§8.4 长期自认——入口脚本自行 `try/catch` 并以退出码 0 输出合法 allow JSON，属「Hook 成功」，
故 `failClosed: true` 永不触发，判定期异常的语义完全由脚本的 fail-open 决定，等于
**任何能让判定逻辑抛异常的 `process.md` 都能打开门禁**，而 `process.md` 恰由被约束方书写。
§8.4 早已写出修法（区分「lib 加载失败」与「判定期异常」）但一直未实施；R36 即该修法的落地。

**各通道裁决（`buildGateExceptionVerdict`，取「最小可用的收紧语义」）**：

| 通道 | Hook | 裁决 | 取舍理由 |
| ---- | ---- | ---- | -------- |
| `write` | `gate-dev-workflow` | `deny`；**但对活跃 `process.md` 的单独写入放行** | 判定期异常最常见成因就是 `process.md` 损坏，修它必须能写它。一并拒绝会造成代理无法自愈、只能人工编辑的死局 |
| `shell` | `gate-dev-shell` | `deny`（无修复例外） | 修 `process.md` 应走 Write 通道，那边已有例外，此处再开只增绕过面 |
| `task` | `gate-role-sequence` | `deny` | 否则「让判定逻辑抛异常」即可跳过整条 R13 门禁链；PM 仍可维护 `process.md`，代价最小 |
| `toolchain` | `gate-toolchain-install` | `ask`（**不用 deny**） | 该 Hook 的正常拦截语义本就是 ask；deny 会把一台缺工具链的机器彻底锁死，而 ask 已达到「不静默放行」 |
| `stop` | `gate-stop-workflow` | `followup` | stop 通道无 deny 语义，收紧即等于不放行收尾 |

`gate-subagent-track` 是纯记录器、从不 deny，保持 fail-open。
**lib 加载失败仍一律 fail-open**——门禁整体损坏时若也拒绝，项目会被彻底锁死且无自愈路径。

**修复通道的作用域（`resolveGateRepairPaths`，2026-07-30 复核收窄）**

复核 PoC 复现了一条完整绕过：`repairPaths` 原本取自 `filePaths.filter(isProcessFilePath)`，而
`filePaths` 里混着从**写入内容**解析出的 ApplyPatch 目标路径（`extractToolPaths` 会扫
`content` / `patch` / `diff`）。三处叠加即成通路——
①写 `src/app.ts` 时在内容里夹一行 `*** Update File: docs/process/process.md` 就能凭空造出「修复路径」；
②`buildGateExceptionVerdict` 只要看到 `repairPaths` 非空就对**整次调用**放行，不过滤其余路径；
③`isProcessFilePath` 匹配任意 `process.md`，并不限于活跃的那份。
而触发条件也在代理手里：`gated-artifacts.json` 由 SA 书写，写入 `"extraSourceDirs": 5` 即可让
`getMergedGatedPaths` 的展开在判定期抛 `TypeError`。于是 R36 声称修掉的「抛异常就能打开门禁」
实际变成了「抛异常 + 在文件里加一行注释就能打开门禁」。

现要求三条同时成立才给例外：

1. 只认**直接路径字段**（`path` / `file_path` / `target_file` …）——内容里的路径由代理完全掌控；
2. 只认**活跃** `process.md`（`isActiveProcessFilePath`，历史/其他 feature 的流程文件不算）；
3. 本次调用涉及的**全部**路径都必须是它，夹带任何其他路径一律 deny。

另限定工具类型为 `Write` / `StrReplace` / `EditNotebook`：`ApplyPatch` 只有内容路径，`Delete`
在异常态下没有正当需求。回归：`r36-gate-exception.mjs`「修复通道的作用域」一组。

**逃生开关**：`harness.config.json → gateException.onJudgmentError: "allow"` 可回退到历史 fail-open。
该文件受 R29 锁定，**只有用户本人能改**（R12：放松型旋钮一律回收到人类手中）。全部通道的裁决文案
都必须指向这条唯一放松路径并强调「须用户本人」，`r36-gate-exception.mjs` 有专项断言。

**能力边界**：见 §8.7 边界 5（修复通道例外是刻意保留的窄缺口）。

#### R37：`single-task` = 增量迭代档（判据权威见 `workflow-modes.md`）

**问题**：重构前 `single-task` 在代码里与 `full` **完全等价**，`workflow-modes.md` 因此只能写一段
「本模式不省任何验证、若你想少做几步请不要选本项」的劝阻文案——一个规约自己劝人别用的模式。
真实可选档位只剩 `full`（极重）、`hotfix`（须是缺陷修复且已有设计）、`docs-only`，
**一个已有设计的项目要加个小功能没有任何可用路径**。这不是约束强度问题，是档位设计缺一层。

**机械判据（本节只列门禁侧，完整定义与选型指引见 `workflow-modes.md`「`single-task` = 增量迭代档」）**：

- **前置**（`checkSingleTaskPreconditions`，发起 SA / DE 前校验）：基线 `detail-design-spec.md` 存在
  （`checkSingleTaskBaseDesign`）+ `process.md`「## 增量范围」**五维**声明合规
  （`checkIncrementScopeDeclared`）+ **「需要迁移脚本 / 破坏向后兼容」维填「是」直接拒绝**
  （`increment-scope-breaking-change`；把分诊表里早有、实现里从未有的「修改数据模型 ⇒ 禁止
  `single-task`」补成机械判据，R12——**F-08** 后判据落在破坏性而非「碰没碰数据」上）。
- **F-08 分档（2026-08-11，放松方向，留痕见 §8.5）**：原单一 `schema` 维拆为「数据形状变更」+
  「需要迁移脚本 / 破坏向后兼容」两维。前者填「是」**不再**单独禁用增量档；仅后者填「是」硬禁用。
  「形状变、兼容未破」这条新路径以一条**新增**判据换取：两维说明列须声明**兼容性回归用例**
  （`increment-scope-missing-compat-regression`），且本轮唯一测试须落地该用例的执行记录
  （`checkIncrementCompatRegressionReport`，`qe.mjs`）。缺任一条即回退为拒绝，等价于旧的硬禁用。
- **折叠**（`parseWorkflowState`）：`foldedTestChannel = isHotfix || isSingleTask` ⇒ `batchTestComplete`
  恒真、`finalTestRequired = devComplete && qeComplete`；但 `finalTestComplete` 对 `single-task`
  **额外要求** `batchApiReportPresent && batchStorageReconPresent`（R14/R17 并入折叠通道），
  并在 `compatOnlySchemaChange` 为真时**再加** `incrementCompatRegressionPresent`（F-08）。
- **唯一角色侧简化**：发起 `requirement-reviewer` / `development-engineer` 时豁免 **R26** 技术选型确认
  （基线项目已 AskUserQuestion 确认并落痕，增量不换栈）。**R25 同构模块识别不豁免**——增量最容易
  「复制既有实现改两行」，正是 R25 要拦的场景。
- **多轮交叉校验（F-09，`iterationRound ≥ 2`）**：`checkIncrementScopeRequirementCrossCheck`
  （`design.mjs`）要求「## 增量范围」每个「是」维度（**迁移维除外**——该维为「是」时增量档整体
  已失效）在说明列引用至少一个**本轮**新立的 `R-` 编号；本轮零编号 → `increment-no-round-requirement-ids`，
  某维度未引用 → `increment-scope-requirement-unlinked`。挂在 **SA 与 DE 两个派发分支**
  （只挂 SA 则「跳过 SA 直接派 DE」即可绕过）。本轮编号的认定见 `extractRoundRequirementIds`：
  有 `轮次`/`迭代` 列时取该列，无该列（含出厂模板）时按行内任一格的轮次标识判定。
  拦的是增量档最典型的失效形态——声明了「本轮新增对外接口」，需求清单里却没有任何本轮新立需求，
  即改动绕过需求澄清与用户确认直接进入设计与开发。判据表见 `workflow-modes.md`「`iterationRound`」。
- **R20 意图词扩展**：`single-task` 的确认关键词新增「增量 / 增量迭代」，旧词（单任务 / 小改动）保留，
  既有项目的确认行不失效（R12：不得因改口径回退门禁）。

#### R38：工具不可用 vs 检查未通过（唯一权威定义）

**问题**：R16 的两个默认命令都靠 `npx --yes` 在线获取非主流包（`jscpd-rs` / `gitleaks-secret-scanner`）。
历史实现只看退出码，于是「离线/代理环境下拉不到包」与「代码里真有 8% 重复」产出**完全相同**的
`{ gatePassed: false, reason: 'scan-failed' }`，门禁给出的指引是「请整改重复代码」——用户第一次在
受限网络里用本框架就会卡死在 QE 阶段，并被指向完全错误的修复方向。

**判定口径（`classifyCommandFailure`，`tool-availability-lib.mjs`；宁漏不误）**：仅在证据明确时判为
工具不可用——命中「命令不存在」类退出码（127 / 9009），或输出含五类信号之一：
`command-not-found`（含中文 PowerShell「无法将…识别为」）、`dependency-fetch`
（`npm ERR! code E4xx` / `could not determine executable to run` / `Cannot find module`）、
`network`（`ENOTFOUND` / `EAI_AGAIN` / `ECONNREFUSED` / `getaddrinfo`）、`proxy-or-tls`
（自签证书 / `407 Proxy Authentication Required` / 隧道建立失败）、`browser-binary-missing`
（Playwright 浏览器二进制缺失）。检查工具**正常运行并报出问题**（真实 lint 报错、重复率超阈值、
检出密钥、用例失败）绝不会命中这些信号——`r38-tool-unavailable.mjs` 有专门的「不得误判」样本组。

**产物字段**：`toolUnavailable` / `toolUnavailableCategory` / `toolUnavailableDetail`；
`reason` 改为门禁专属值（`lint-tool-unavailable` / `tool-unavailable` / `startup-tool-unavailable`）。
`computeStaticScanGate` 在任一子项因工具不可用失败时上浮 `toolUnavailable`。

**门禁语义（关键）**：工具不可用**不放行**门禁——那会变成「网络一断就自动免检」的放松（R12）。
它改变的是**失败的性质与解法**：stop 门禁注入专门的 followup，要求 PM 标 `blocking` 并用 AskUserQuestion
请用户在三条路径中决策——①修复工具/网络（含企业代理、证书、离线镜像）；②由**用户本人**在
`harness.config.json` 配置可离线执行的等价命令覆盖（`qe.commands.*` / `te.startupSmoke.command`）；
③确认确不适用，走对应门禁的双要素豁免。**代理不得自行选择其中任何一条。**

**信号来源不对称（2026-07-30 复核修正）**：`ENOENT`（及中文「系统找不到指定的文件」）只在
`launchError`（进程压根没被拉起来，如 `spawn ruff ENOENT`）时才算数，**不匹配命令输出**。
原实现把它直接写在 `command-not-found` 正则里、对任意输出生效，结果在 R32 上把门禁语义完全反转：
被测应用自己 `open('/app/config/production.json')` 失败输出 `ENOENT`，会被判成「工具不可用」，
指引用户去修环境——而那正是 R32 立场里最典型的**产品缺陷**（配置路径写错），也正是 2026-07-29
复盘里两次热修撞上的那类 bug。调用方须把 spawn/exec 抛出的错误传 `launchError` 而不是拼进
`output`（`startup-smoke-run.mjs` 的 `runStartupPhase` 已单独留一份）。

**R32 的刻意收窄**：启动冒烟只在 shell 报「启动命令本身不存在」时判为工具不可用。R32 的立场是
「应用起不来属**产品缺陷**，须回派 DE，不得据此豁免」，故网络失败、依赖拉取失败、端口占用、
配置解析崩溃一概**不**归入工具不可用——它们恰恰是本门禁要抓的东西。唯一例外是解释器/包管理器
压根没装，那不是产品的问题。实现上表现为只采信 `category === 'command-not-found'`：
`dependency-fetch`（应用缺自身依赖）、`network`（应用连不上数据库）等一律回落为产品缺陷。

### 8.9 规则层（`.claude/rules/`，2026-08-14 适配）

**背景**：Cursor 版以 `.cursor/rules/*.mdc` 承载「编辑特定文件时自动注入的提醒」。移植期
认为 Claude Code 不支持该机制，故把两份规则的内容**分散复制**进 `project-manager.md` /
`quality-engineer.md` / `test-engineer.md` 的开篇提醒块，并在 `.claude/rules/` 留下两份
`.mdc` 作为「待兼容冗余」。

**事实修正**：Claude Code 原生支持 `.claude/rules/`（官方文档
`https://code.claude.com/docs/en/memory#organize-rules-with-claude/rules/`）。要点：

| 事项 | 官方口径 | 原 `.mdc` 的问题 |
| ---- | -------- | ---------------- |
| 扩展名 | 递归发现目录下**全部 `.md`** | `.mdc` 不被发现，两份规则**从未生效** |
| 触发字段 | frontmatter `paths`（glob 数组） | 写的是 Cursor 的 `globs`（逗号分隔字符串） |
| 常驻与否 | 无 `paths` ⇒ 随会话常驻，与 `.claude/CLAUDE.md` 同优先级；有 `paths` ⇒ 读到匹配文件时注入 | `alwaysApply: false` 不是官方字段 |
| 优先级 | 用户级 `~/.claude/rules/` 先于项目级加载 | — |
| 压缩行为 | 路径触发的规则**不随 `/compact` 自动重注入**，须再次读到匹配文件 | — |

**本次改动**：两份 `.mdc` 改写为生效的 `.md`（`globs` → `paths`），删除三个 agent 文件里的
分散副本，并新增三份规则。当前 5 份**全部**带 `paths`（路径触发）：

| 规则 | 触发面 | 承载内容 |
| ---- | ------ | -------- |
| `harness-process.md` | `docs/**/process.md`、`.claude/harness-state.json` | 门禁链/模式/R10/双要素/确认真实性指引 |
| `harness-design-artifacts.md` | `docs/**/requirement/**`、`docs/**/design/**` | 角色↔路径、结构硬要件（R18/R25/R32/R33）、R26 确认 |
| `harness-test-artifacts.md` | `docs/**/test/**`、`docs/**/quality/**`、`test-results/**`、`e2e/**` | R14–R17、R32、R34、R38、F-23 |
| `harness-source-code.md` | 常见源码目录与构建清单 | R5/R21/R23/R3/R28/R29 写入通道 |
| `harness-gate-assets.md` | `CLAUDE.md`、`.claude/{rules,hooks,scripts,agents,harness/spec}/**`、注册表与配置 | R29 四级分类与「用户本人落盘」通道、R12 方向铁律 |

**三条硬约束**：

1. **规则层不新增约束**，只做指引与转述。任何判定回到 Hook（机械执行权威）与 §8 各节
   （说明权威）。规则文本与说明权威冲突时以说明权威为准，且须按 R12 补齐弱的一侧。
2. **规则层不承担唯一权威**。路径触发的规则不保证在写入前一定已注入（须先读到匹配文件），
   且不随 `/compact` 重注入。故**硬禁令必须同时存在于** `CLAUDE.md`（常驻）、对应
   `.claude/agents/*.md`（分派即注入）或 Hook 判据中——本次删除三个 agent 文件里的分散副本
   前已逐条核对：R34/R38/双要素/gatePassed 的实质条文在 QE/TE 文件正文中均有独立留存，
   删除的只是开篇的重复摘要。
3. **该目录下不放 `README.md`**。无 `paths` 的 `.md` 会被当作常驻规则注入上下文，一份说明
   文件会白白占用每个会话的常驻预算——规则层的说明写在本节。

**规则文件属 `gate-config`**（R29）：见 §8.5「`.claude/rules/**` 豁免回收」。
