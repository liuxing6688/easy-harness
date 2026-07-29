# 流程门禁 Hook 与机械判据（说明权威）

> **执行权威**：`.trae/hooks/**`、`.trae/scripts/*-run.mjs`、`workflow-gate-lib.mjs`（客观判据以代码为准）。
> **角色操作摘要**：QE → `quality-engineer.md`（R15/R16）；TE → `test-engineer.md`（R14/R17/E2E）；SA → `system-architect.md`（双要素豁免声明）。
> **常驻摘要**：根目录 `AGENTS.md`（禁止绕过 Hook、门禁链表、顶层自检）。
> 本节承接原 AGENTS.md §8；修改行为须同步升级 Hook/脚本（R12），不得仅改本文放宽判据。

## 8. 流程门禁 Hook（机械约束）

本项目通过 Trae 原生 Hook 对高风险操作做**确定性拦截**，与 `AGENTS.md` §5 文字规则互补。`.trae/hooks.json` 遵循 Trae 标准格式（`PreToolUse` / `Stop` PascalCase 事件 + `name`/`enabled`/`command`/`matcher` 字段），Trae 客户端自动加载并执行。同时，`.trae/rules/gate-protocol.md`（`alwaysApply: true`）强制顶层代理手动调用 `node .trae/scripts/gate-check.mjs <子命令>` 作为兜底自检。两层机制共用同一套判定逻辑（`workflow-gate-lib.mjs` + 5 个 `gate-*.mjs`）。门禁路径与 Shell 模式以 `harness.config.json` 为默认，并与当前活跃 `docs/**/design/gated-artifacts.json`（可选，架构师维护）合并。活跃路径由 `.trae/harness-state.json` 或 `HARNESS_PROCESS_PATH` 决定。

### 8.1 Hook 一览

| Hook | 触发时机 | 拦截范围 | 放行条件 |
| ---- | -------- | -------- | -------- |
| `gate-dev-workflow` | `PreToolUse`（Write / Edit / MultiEdit / Delete / DeleteFile） | `harness.config.json` 中 `sourceDirs`、`buildManifests`、`testConfigs`、`rootPatterns` 及项目 `gated-artifacts.json` 额外路径；**`.trae/scripts/**`、`.trae/agents/**`、`.trae/hooks/**` 三目录**（R6，白名单豁免见 `gatedPaths.dotTraeExemptPatterns`）；`docs/` 下非 `.md/.mdx/.txt` 文件（`docs/**/design/gated-artifacts.json` 例外，始终放行）——**作为受门禁源码路径纳入拦截范围，实际放行与否遵循右侧「放行条件」，并非无条件拦截**；**R6 加强**：代码扩展名默认受门禁（豁免目录见 `gatedPaths.extensionGateExemptDirs`，§8.5）；**R29**：门禁自治资产（运行时标记 / 授权凭证 / 门禁配置与权威文本）一律 deny。仍豁免：`.trae/templates/**`、`.trae/rules/**`（见 `gatedPaths.dotTraeExemptPatterns`） | 判定顺序：**R10 目标文件本身 `cancelled: true` 拒绝**（不可逆，优先于一切）→ **R29 自治资产**拒绝 → `docs-only` 拒绝 → 无有效分派计划拒绝 → **R3 迭代成果物**（非 `hotfix`/`docs-only` 且 `iterationType` 已设时，四件成果物须存在且被 `process.md` 引用）→ **R9 hotfix 设计前置**拒绝 → 阻塞拒绝 → 放行。开发尚未开始：须含有效 `## 当前分派计划` 与 `## 待派发角色列表`；开发已开始：`## 当前分派计划` 有效即可 |
| `gate-dev-shell` | `PreToolUse`（RunCommand / Bash） | `harness.config.json` 中 `gatedShellPatterns` 及项目额外模式（项目初始化、依赖安装等）；**R22**：最近派发为 `test-engineer` 时另拦截替代 E2E 启动命令（`checkTeAlternativeE2eStartup`，见 §8.4）；**R28**：写文件类命令按目标路径套用与 Write 同等判据（§8.5）；`hooks.json` 使用宽 matcher，脚本内部判定 | 判定顺序：R22 TE 冒烟 → **R28 写文件意图**（R29 自治资产 / opaque 写入 / 目标路径判据）→ `gatedShellPatterns` 命中则同 `gate-dev-workflow` 放行条件（含 R3/R9/R10） |
| `gate-toolchain-install` | `PreToolUse`（RunCommand / Bash） | `harness.config.json` 中 `toolchain.installPatterns`（winget、brew、apt、mise、asdf、nix、VS Build Tools 等） | 存在有效 `.toolchain-install-approved.json`：须 `userConfirmed: true` + 有效时间戳 + **`commandHash` 与本次命令匹配**（**R29 加强**，§8.5） |
| `gate-role-sequence`（**R13**） | `PreToolUse`（Agent / Task / general_purpose_task） | 发起角色 Task 前按门禁链机械校验（同前：R19/R18/R15/R16 等，含 **R32** 分派计划匹配）；**R10**：活跃流程 `cancelled` 时拒绝除 `project-manager` 外的**全部**角色（先于「不在门禁表即放行」的短路）；**R20**：声明轻量模式但缺「工作流模式确认」时拒绝除 PM/RA 外角色；**放行或 fail-open 前**对可解析角色执行 `recordDispatchedRole`（供 R5 角色↔路径）。**Trae 实测不路由 Task 进 PreToolUse**（见本节上方「已实测验证」），此 Hook 在 Trae 下不触发；R13 由下方 `gate-r13-subagent`（`matcher:"*"`）自动承担 | 前置条件满足；或目标角色不在门禁表中（`project-manager`/`requirements-analyst` 恒放行，但仍落盘派发记录）；或解析不到目标角色名；`failClosed: false` |
| `gate-r13-subagent`（**R13 自动，Trae 适配**） | `PreToolUse`（`matcher:"*"`，全部工具） | 子代理首次工具调用时基于 `agent_id` 自动执行 R13 前置校验（含 **R32** 分派计划匹配）+ `recordDispatchedRole`（不再依赖手动 `gate-check role`）。**短路**：`solo_agent`/缺失 `agent_id` 快速放行（顶层由 gate-dev-workflow/gate-dev-shell 处理）；非 GATED_ROLES 放行 + 记录角色；GATED_ROLES 做 R13 校验 + R10 cancelled 检查 | `agent_id` 不在 GATED_ROLES；或 R13 前置条件满足；或 `agent_id` 缺失/solo_agent（快速放行）；`failClosed: false` |
| `gate-subagent-track`（**R5**） | `SessionStart` | 仅记录顶层 `session_id`（TTL 内不覆盖、超 TTL 自愈，见 §8.5）；从不 deny | 恒 `allow`（fail-open） |
| `gate-stop-workflow` | `Stop` | 代理拟结束回合时流程未完成（含 **R15 编程规范 lint 门禁未通过**、**R16 静态代码质量门禁未通过**、**R31 回退计数超上限**） | 见下方 **stop 门禁判据**；`blocking: true` 或 **`cancelled: true`（R10）** 时放行 |

Hook 解析 `## 进度列表` 时同时识别中文角色名与 `.trae/agents` 的 agent slug（如 `开发工程师` / `development-engineer`），项目经理可按 Task 实际发起名称留痕。

### 8.2 stop 门禁判据（gate-stop-workflow）

**`gate-stop-workflow` stop 门禁判据**（按优先级顺序，命中即注入 Stop 阻断 `{ decision: 'block', reason }`，`reason` 作为新 Query 注入；**不**用 Cursor 的 `followup_message` 字段，Trae 不识别）：

| 判据 | 触发条件 | followup 要点 |
| ---- | -------- | ------------- |
| 放行（不可逆取消） | `cancelled`（R10） | 已取消的流程不再被催促推进，直接放行 |
| 放行（全流程测试闭环） | `finalTestRequired && finalTestComplete && lintPassed && staticScanPassed`（R15/R16） | 全部开发+QE+批次测试（含批次 E2E）+**最终整体集成测试**（含最终 E2E）+**编程规范 lint 门禁**+**静态代码质量门禁**均通过；`hotfix` 模式下 batch 相关判据恒真（见下方 R11） |
| 开发进行中 | `devInProgress` | 分派 QE |
| 待分派 QE | `devComplete && !hasQaRecord` | 分派 quality-engineer |
| QE 未完成 | `devComplete && hasQaRecord && !qaComplete` | 继续 QE |
| **编程规范 lint 门禁**（R15，非 docs-only） | `qaComplete && !lintPassed` | quality-engineer 运行 `lint-run.mjs`，整改至 `gatePassed=true`（机读产物 `test-results/qe/.lint-result.json`）；未通过前**不得推进测试或宣告完成** |
| **静态代码质量门禁**（R16，非 docs-only） | `qaComplete && !staticScanPassed` | quality-engineer 运行 `static-scan-run.mjs`，整改重复代码/安全扫描至均 `gatePassed=true`（机读产物 `test-results/qe/.static-scan-result.json`）；未通过前**不得推进测试或宣告完成** |
| **批次 E2E**（非 hotfix） | `qaComplete && batchTestRowComplete && !batchE2ePassed` 且处于开发阶段 | test-engineer 运行 `e2e-run.mjs --scope=batch --required-ids=<本批次P0>`；未通过前**不得推进下一批次** |
| **批次接口测试报告**（R14，非 hotfix） | `qaComplete && batchTestRowComplete && batchE2ePassed && !batchApiReportPresent` 且处于开发阶段 | test-engineer 补做接口测试并在测试报告补全非空「## 接口测试报告」章节（须含真实用例数据行）；未补全前**不得推进下一批次或最终整体集成测试** |
| **批次存储对账记录**（R17，非 hotfix） | `qaComplete && batchTestRowComplete && batchE2ePassed && !batchStorageReconPresent` 且处于开发阶段 | test-engineer 按 R17 补全非空「## 存储对账记录」（适用分类型行 + 至少一条适用行 + 描述列完备 + 介质/其他/不适用备注 + 批次任务包覆盖）；未补全前**不得推进下一批次或最终整体集成测试** |
| **批次集成测试**（非 hotfix） | `qaComplete && !batchTestComplete` 且处于开发阶段 | 分派 test-engineer 做**批次集成测试**（含批次 E2E、接口测试报告与存储对账） |
| **最终 E2E** | `finalTestRequired && finalTestRowComplete && !finalE2ePassed` | test-engineer 运行 `e2e-run.mjs --scope=final --baseline=<requirement-list.md 或热修影响面>`；未通过前**禁止宣告完成** |
| **最终整体集成测试 / hotfix 唯一测试通道**（独立门禁） | `finalTestRequired && !finalTestComplete` | 非 hotfix：分派 test-engineer 做**最终整体集成测试**（含全量 E2E）；hotfix（R11）：分派 test-engineer 执行**唯一一次**集成测试+E2E（`--scope=final` 语义） |
| **hotfix P0 报告结构化章节硬门禁**（R9 升级·P2-6） | `workflow_mode=hotfix && finalTestRowComplete && finalE2ePassed && hotfix_p0_impact=p0 && 本次测试报告缺非空「## 接口测试报告」「## 存储对账记录」真实数据行` | test-engineer 在测试报告补全结构化接口/存储章节（须含真实数据行）后重新发起收尾；阻断前 `gate-stop-workflow` 仍**先**写一次性软性提醒到 `process.md` 留痕（R9 脚注第 4 条），随后注入 followup 阻断收尾 |

> **R11（hotfix 批次/最终测试折叠，唯一权威定义）**：`workflow_mode=hotfix` 时不要求区分「批次集成测试」与「最终整体集成测试」两个独立环节，测试工程师**只需执行一次**集成测试+E2E（直接以 `--scope=final` 语义运行，产出即视为最终结果）。判据层面：`batchTestComplete` 恒为 `true`（跳过批次 E2E/批次接口测试报告/批次存储对账/批次集成测试判据行；R14/R17 机读判据仅约束开发窗口批次阶段，不并入 hotfix 折叠通道）；`finalTestRequired = devComplete && qaComplete`（不要求 `batchTestComplete` 参与判定）；`finalTestComplete` 计算方式不变（`finalTestRowComplete && finalE2ePassed`）。`gatePassed` 公式、Chromium headless 执行器、覆盖率判据**不因折叠而放松**，仅消除批次/最终两阶段的流程冗余，呼应需求 1「简化」精神且不违反 R12「只可加强」。
>
> **进度列表识别规则**：测试工程师行若含「最终整体集成测试」「最终集成测试」「TE-FINAL」「TE-最终」之一，计入最终测试；其余测试工程师行计入批次测试。`finalTestRequired` 的完整公式见 R11（hotfix）与上表（非 hotfix）。
>
> **B1 最新有效状态统计**：`gate-stop-workflow` 对 `## 进度列表` 按**任务包编号**取最新有效状态（后出现覆盖先出现）；`已作废` / `superseded` 行作为 tombstone 使该任务包退出统计。任务包编号须写在进度行「任务名称」列，使用**大写多段编号**（如 `A-DOC-1`、`B-LIB-1/2/3` 互不合并）；作废行亦须含被作废任务包编号以便精确 tombstone。`iterationType` 缺失时 R3 跳过（legacy 兼容）；`hotfix` / `docs-only` 豁免 R3。
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
>
> 重复代码与安全扫描**分别独立**豁免，不可一项代替另一项；下文各门禁「适用性豁免」小节均指回本表，不再重复展开机制本身。
>
> **R15（编程规范 lint 硬门禁，唯一权威定义）**：`full`（含 `greenfield`/`feature`/`governance-overhaul`）、`single-task` 与 `hotfix` 迭代，QE 阶段须满足：
> - 判据结构与 E2E 门禁同构（运行器写 `gatePassed` 机读产物 → lib 读入 → 门禁判定）；**执行命令与产物**：`node .trae/scripts/lint-run.mjs` → `test-results/qe/.lint-result.json`。
> - **命令解析优先级**：`harness.config.json → qe.commands.lint` 覆盖 > 构建清单自动探测 > 栈默认（Node/Python/Go/Rust/Ruby 等有默认；Java/PHP/.NET 等无默认）；多数项目不必手配 config，仅 monorepo/自定义脚本名/探测不准时覆盖。`detail-design-spec.md` §5 由架构师填入与默认一致的留痕，不作为 Hook 输入。
> - **判据**：`lintPassed = readLintResult()?.gatePassed===true`（须有 lint 命令且退出码为 0）；`docs-only` 视为满足。QE 记录完成但 `lintPassed=false` 时 `gate-stop-workflow` 注入 followup，且**不得发起 test-engineer**（判定函数见 `rule-index.md`）。
> - **适用性豁免**：见上表 R15 行；无默认 lint 的栈须声明等价命令或走豁免，不得静默放过。
>
> **R16（静态代码质量硬门禁：重复代码 DRY + 安全静态扫描，唯一权威定义）**：`full`（含 `greenfield`/`feature`/`governance-overhaul`）、`single-task` 与 `hotfix` 迭代，QE 阶段须满足：
> - 判据结构与 R15 同构，但**跨技术栈通用、不做 per-stack 探测**（本框架要求 `Node.js >= 18`，两项工具均经 `npx` 直接获取）；**执行命令与产物**：`node .trae/scripts/static-scan-run.mjs` → `test-results/qe/.static-scan-result.json`（含 `duplication`/`security` 两个子结果）。
> - **默认工具**：重复代码检测 `jscpd-rs`（`npx --yes jscpd-rs --threshold 5 --exitCode 1 ...`，5% 阈值超限退出码非 0）；安全静态扫描 `gitleaks-secret-scanner`（`npx --yes gitleaks-secret-scanner ...`，检出密钥即退出码非 0）。**命令解析优先级**：`harness.config.json → qe.commands.dupCheck`/`qe.commands.securityScan` 覆盖 > 框架默认值；多数项目不必手配 config。
> - **判据**：`staticScanPassed = (dupCheckExempt || duplication.gatePassed) && (securityScanExempt || security.gatePassed)`；`docs-only` 视为满足。QE 记录完成但 `staticScanPassed=false` 时 `gate-stop-workflow` 注入 followup，且**不得发起 test-engineer**（判定函数见 `rule-index.md`）。
> - **适用性豁免**：见上表 R16 两行（重复代码/安全扫描分别独立判定）。
> - **反弱化条款（2026-07-28 QE R16 消重复盘新增，R12 显式化）**：**禁止**以「降低打回率/减少误报体感」为由提高 `jscpd-rs --threshold`、扩大 `--ignore` 排除目录（默认排除目录——`node_modules`/`dist`/`build`/`vendor`/`target`/`coverage`/`.git`/`test-results`——以外的任何收窄）或缩减 `--reporters`。确因目录结构特殊（如 monorepo 内确需排除的生成代码目录）需要覆盖 `qe.commands.dupCheck` 时，须在质量报告与 `detail-design-spec.md` §5 写明**具体排除路径 + 排除理由**；**修改阈值**（无论升高或降低）一律视为需要用户确认的机械门禁调整，须在 `process.md`「## 用户确认记录」留痕说明理由，否则 QE 不得采用覆盖值——该调整不受本节其余「多数项目不必手配 config」的默认豁免。
>
> **R25（设计阶段「同构模块识别」章节机读，唯一权威定义，2026-07-28 QE R16 消重复盘新增）**：发起 `requirement-reviewer` 前（`full`/`single-task`，`hotfix`/`docs-only` 豁免），`checkIsomorphicModuleSectionReady()` 校验活跃 `detail-design-spec.md` 是否含「## 同构模块识别（须逐项列出）」章节：设计文档为 stub（仅标题、无正文）时跳过；非 stub 时须**要么**含「同构组名称」+「共享 Primitive 名称」两列的表格且至少一条真实数据行（每行两列均非空），**要么**显式声明「已排查，无同构资源族」并附非空排查依据（去除标点空白后不少于 4 字）。缺章节/章节为空/表格无数据行/声明缺依据时 `gate-role-sequence` 拒绝发起 `requirement-reviewer`。**背景**：R16 全仓重复代码复盘发现相似资源族（CRUD 路由、页面脚手架、测试 fixture、E2E helper）在设计阶段未被前置识别，并行开发工程师各自「复制改」导致 QE 首轮必然因 duplication 打回；本规则要求设计阶段前置排查并声明共享 primitive，从源头减少同构克隆。**能力边界**：机读只证明「该章节存在且非占位敷衍」，不证明排查是否穷尽、共享 primitive 设计是否合理——语义充分性仍由 `requirement-reviewer`「架构设计原则」维度人工审核。

> **R19（需求分析师隐性需求确认记录结构校验，唯一权威定义）**：发起 `system-architect` 前，`checkRequirementReady()` 除校验 `requirement-spec.md`/`requirement-list.md` 存在与 `## 用户确认记录` 非空外，须额外校验 `requirement-spec.md`「6. 隐性需求确认记录」章节存在含**真实数据行**的表格，表头必须含「类别、要点、用户确认摘要、关联需求/§7 追溯、状态、影响/决策点」；每条行均不得为空，类别仅可为「假设/边界/取舍/待决/排查结论」，状态仅可为「已确认/待决假设」，关联追溯必须同时含 `requirement-list.md` 的 `R-编号` 与 `§7`，`待决假设` 还须在影响/决策点中含责任方与最晚决策点。该校验验证结构、枚举与追溯，**不验证内容真实性**。目的是为苏格拉底式多轮追问留下可稽核、可供 SA 消费的痕迹，避免「一轮问完即自称理解充分」或用空泛占位行过门禁。缺失或任一结构条件不满足时 `gate-role-sequence` 拒绝发起 `system-architect`。**豁免**：本项不适用双要素豁免机制——需求分析师确认「排查后无隐性要点」时，也须填写合规的「排查结论」行，说明排查范围、用户确认和关联需求，而非声明豁免跳过（隐性需求排查是理解是否充分的一部分，不属于「确不适用/无法运行」的技术性豁免场景）。

### 8.3 两级集成测试与 E2E 判据（唯一权威定义，TG-D-4）

> 本节是「批次/最终 E2E」判据与命令的**唯一权威定义**；`README.md`、§3、§5、§6、`project-manager.md`、`test-engineer.md` 中出现的相关表述均须与本节保持一致，若只需引用判据请指回本节，不再复述完整公式/命令。

- **两级范围**：①**批次集成测试**——每批次 QE 通过后，对本批次新交付任务包做集成测试；②**最终整体集成测试**——全部任务包与各批次 E2E 闭环后，对整个产品做端到端集成测试。`测试判定`（最终交付依据）以**最终整体集成测试**（含最终 E2E）结论为准。
- **执行命令与产物**：批次 `node .trae/scripts/e2e-run.mjs --scope=batch --required-ids=<本批次P0>` → `test-results/e2e/.e2e-batch-result.json`；最终 `node .trae/scripts/e2e-run.mjs --scope=final --baseline=<requirement-list.md>` → `test-results/e2e/.e2e-final-result.json`。
- **浏览器范围**：仅需支持 **Chrome 内核浏览器（Chromium，含 Chrome/Edge 等 Chromium-based 浏览器）**，不要求 Firefox / WebKit 覆盖；执行器 Playwright Chromium headless；用例标题含 `[R-xxx]` 追溯标签。**浏览器范围是本机械门禁唯一允许简化的维度**：`gatePassed`、覆盖率、追溯标签等判据不因浏览器范围收窄而放松（需求 1）。
- **`gatePassed` 公式**：`gatePassed = allPassed && coverageComplete`（Chromium 覆盖全部 required P0 且无未解释 skip 且均通过）。`batchTestRowComplete` / `finalTestRowComplete` 仅反映进度行完成；`batchE2ePassed` / `finalE2ePassed` 读取对应结果文件的 `gatePassed`。`batchTestComplete = batchTestRowComplete && batchE2ePassed && batchApiReportPresent && batchStorageReconPresent`（含 R14 接口测试报告与 R17 存储对账机读判据）；`finalTestComplete = finalTestRowComplete && finalE2ePassed`。**`hotfix` 模式下按 R11 折叠**（见 §8.2），`batchTestComplete` 恒真，`finalTestRequired` 不依赖 `batchTestComplete`。
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
- **R17 门禁能力边界**：章节/表头存在性、分类型适用行、至少一条适用行、描述列非空、「其他」/「不适用」备注非空、存储介质类别关键词、批次任务包编号覆盖为机读硬门禁；对账方式是否真正查到对应介质、预期/实际是否语义正确等，仍由 QE/PM 文字审查（§8.4），Hook 不声称已验证语义。
- **约束后果**：批次 `gatePassed≠true` 时视为本批次集成测试未完成，**不得推进下一批次**；最终 `gatePassed≠true` 时**不得宣告项目完成**。
- **适用范围**：适用于 `full` 模式下的 `greenfield` / `feature` / `governance-overhaul`、`single-task` 及 `hotfix` 迭代（`hotfix` 按 R11 折叠为单次通道，测试严格程度不降低）；`docs-only` 豁免；无 UI 项目按 §8.2「双要素豁免机制」表 E2E 行豁免（详见 `test-engineer.md`「E2E 适用性豁免」）。**`single-task` 说明**：`workflow_mode=single-task` 未被 R11 折叠（R11 仅对 `hotfix` 生效），代码判定（`workflow-gate-lib.mjs` 仅对 `docs-only`/`hotfix` 做特判，其余按 `full` 同等严格处理）与 `full` 完全一致——即仍须产出「批次集成测试」与「最终整体集成测试」两条独立进度行（各自的 E2E/接口测试报告/存储对账判据同 §8.2/§8.3 全量要求），**不会**因为是小改动而自动折叠为一次测试。若确需单次测试通道，须与用户确认后改用 `hotfix` 模式（承担其设计前置校验 R9），不得自行按 `single-task` 语义简化两阶段测试判据（R12：不可仅凭「单任务」字面含义放松机械门禁）。
- **未解释 skip / `coverage-waivers.json`**：见 `test-engineer.md`「`coverage-waivers.json`」一节。

Hook 脚本路径：`.trae/hooks/`。修改 Hook 行为时须同步更新本节与 `README.md`。

### 8.4 自锁防护与门禁能力边界

**自锁防护（fail-open）**：全部**五个** hook 入口脚本（`gate-dev-workflow`、`gate-dev-shell`、`gate-toolchain-install`、`gate-stop-workflow`、`gate-role-sequence`）对 `workflow-gate-lib.mjs` 使用动态 `import` + `try/catch`，且执行期逻辑同样包裹在 `try/catch` 中；lib 不可加载或运行期出现未预期异常时 **fail-open 放行**（`gate-stop-workflow` 语义为不注入 followup）并打印 stderr 告警，同时尽量将异常写入活跃 `process.md` 的 `## 门禁异常事件` 并将 `blocking: true`（`recordFailOpenEvent`；cancelled 流程或无法写盘时仅保留 stderr），避免门禁自身损坏导致全流程硬死锁，同时防止静默绕过。策略性 `deny` 不受影响。

> **无 `failClosed` 双层保护（Trae 已知局限，勿误以为有兜底）**：Trae Hook 定义层不支持 Cursor 的 `failClosed` 字段（见下「Trae Hook 工具名适配」），全部 Hook 仅以代码级 `try/catch` + 动态 `import` 实现 fail-open——**没有第二层兜底**。本框架的入口脚本自行 `try/catch` 并以退出码 0 输出合法的 `hookSpecificOutput`（`permissionDecision: 'allow'`），属「Hook 成功，按其 JSON 输出执行」，**不构成失败**。换言之，判定期异常的最终语义完全由脚本自己的 fail-open 决定。这是刻意的防死锁取舍，但代价是：**任何能让判定逻辑抛异常的 `process.md` 都能打开门禁**，而 `process.md` 恰由被约束方书写。若要收紧，应区分「lib 加载失败」（继续 fail-open）与「判定期异常」（改为 `deny` 或让其真的失败以激活失败语义）。

**Trae Hook 工具名适配（对照 `hooks.json` matcher）**：Trae PreToolUse 的 `tool_name` 使用标准化名称——终端命令为 `RunCommand`（Cursor 兼容名 `Bash`，`hooks.json` matcher 用 `Bash|RunCommand` 覆盖两个命名面）、文件写入/编辑为 `Write|Edit|MultiEdit`、文件删除为 `Delete|DeleteFile`（matcher 已合并覆盖）。**Trae 顶层代理确有 `Task` 工具**（参数含 `subagent_type`，与 `gate-role-sequence.mjs` 的 `extractTargetRole` 读取字段完全吻合），`hooks.json` 用 `matcher:"Task"` 拦截角色分派。**已实测验证（2026-07-29）**：Trae **不**把 `Task` 调用路由进 PreToolUse 事件（实测方法：挂 `matcher:"*"` 日志 Hook，发起一次角色 Task，Task 调度前后无 `tool_name:"Task"` 条目；但子代理内部的 Glob/Read 等工具调用会触发 PreToolUse，agent_id 由 `solo_agent` 变为子代理类型）。因此 R13 角色前置校验与 `recordDispatchedRole` 在 Trae 下**经 `gate-r13-subagent.mjs`（`matcher:"*"`）自动生效**--子代理首次工具调用时，该 Hook 从 `agent_id` 识别角色并执行 R13 校验与角色记录，不再依赖手动 `gate-check role`。原生 `matcher:"Task"` Hook 为前瞻性保留。手动 `gate-check role` 仍作为兜底（`alwaysApply` 规则强制），但不再是唯一路径。Trae Hook 定义层仅支持 `type`/`command`/`timeout`，不支持 Cursor 的 `failClosed` 字段——全部 Hook 均以代码级 `try/catch` + 动态 `import` 实现 fail-open。

**门禁能力边界（须知）**：

- Hook 对**源码 / 构建产物 / 根目录敏感产物 / `.trae/scripts|agents|hooks/**` 三目录 / `docs` 下角色成果物（需求/设计/质量/测试/`process.md`）/ 受门禁 Shell 命令 / Task 发起前的角色前置成果物（R13）**做确定性拦截。`.trae/hooks.json`、`.trae/harness.config.json` 不走 DE 源码门禁，但**已纳入 R29 门禁自治资产分级**（写入须人工批准，见 §8.5），不再仅由文字约束覆盖。
- **R5 调用者身份（部分机械化）**：①顶层 vs 子代理--基于 `agent_id` 判定（2026-07-29 修复：实测 Trae 子代理与顶层共享 session_id，`isRootConversationCaller(session_id)` 无法区分顶层 vs 子代理；改用 `isTopLevelAgent(agent_id)`：`solo_agent`=顶层 deny，其他=子代理放行；`agent_id` 缺失时 fail-open）；`SessionStart`（`gate-subagent-track`）仍记录顶层 `session_id`（供跨会话隔离与向后兼容）；②**R21** 角色↔路径--`gate-r13-subagent`（`matcher:"*"`）在子代理首次工具调用时基于 `agent_id` 自动 `recordDispatchedRole`（**Trae 适配**：`gate-role-sequence` 的 `matcher:"Task"` 不触发，角色记录由 `gate-r13-subagent` 自动承担，见本节上方「已实测验证」），写入期 `checkRolePathPermission` 校验路径期望角色与「进度正在执行 / 分派计划 / 待派发 / 最近派发」是否匹配：**产品源码**（`isGatedDevPath` 且非 `e2e/**`）收紧为须 DE 活跃，且**最近派发角色若为 TE/QE 等非 DE 则直接 deny**（不因进度表残留 DE 行而放行）；**R23**：**`e2e/**`** 纳入 `isGatedDevPath`，期望角色为 `test-engineer`（非 TE 含 DE 默认 deny），不走 DE 分派计划门禁；③**R22** TE 冒烟（替代启动）——最近派发为 `test-engineer` 时，`gate-dev-shell` 经 `checkTeAlternativeE2eStartup` 拒绝 `E2E_WEB_SERVER_COMMAND=` / `npx vite-node`+e2e 等替代启动（除非 `e2eAlternativeStartup:"allowed"` + 用户确认「允许非 dist 启动」双要素）。文字约束（R21/R22 语义补充，语义不可机械化）：TE 禁止改产品源码、禁止用替代启动掩盖生产冒烟失败；**R24**（纯文字约束，语义不可机械化）：TE 禁止为测绿随意改已生成用例（见 `test-engineer.md`）。**局限（坦诚披露）**：Trae 当前子代理 hooks 无可靠 parent 回链，故无法用子代理 `session_id` 直接映射角色；首次 Task 前或字段缺失时 identity 判据 fail-open（仍受分派计划等既有门禁约束）；「子代理是否越权写了分派范围外细节 / 用例变更是否真属用例缺陷 / 冒烟是否真实执行」的语义部分仍靠文字 + §5.15 自检。**跨会话状态隔离（P2-2/P2-3 修复）**：`gate-subagent-track` 在 `SessionStart` 同时将顶层 `session_id` 写入 `$TRAE_ENV_FILE`（`ROOT_SESSION_ID` 键）与持久化文件（`.trae/harness-state.json` 中 `rootConversationId`），`readRootConversationId` 采用「env var 优先 + 持久化文件兜底」双源策略——新会话的 env var 覆盖旧持久化值，消除跨会话陈旧状态导致 R5 误判为 fail-open 的风险；非 SessionStart 上下文（无 `$TRAE_ENV_FILE`，如手动跑测试）仍回退至持久化文件，行为与改造前兼容。
- **批次 + 最终 E2E 均有机读判据**（`batchE2ePassed` / `finalE2ePassed`）；**编程规范 lint 门禁**亦有机读判据（`lintPassed`，R15，读取 `test-results/qe/.lint-result.json`）；**静态代码质量门禁**亦有机读判据（`staticScanPassed`，R16，读取 `test-results/qe/.static-scan-result.json`）；**批次接口测试报告章节存在性**亦有机读判据（`batchApiReportPresent`，R14，检查「## 接口测试报告」章节非空）；**批次存储对账**亦有机读判据（`batchStorageReconPresent`，R17，检查「## 存储对账记录」非空、适用分类型行、至少一条适用行、描述列完备、「其他」/「不适用」备注、存储介质关键词与批次任务包覆盖）；**设计审核 R18**亦有机读判据（`checkDesignReviewClean`：12 维齐全、未解决行可修复字段完备、P0 覆盖矩阵含验收标准与**设计落点原文摘录**且全部「已覆盖」、审核结论通过/复审通过、技术选型确认；非 stub 时交叉校验设计章节与任务包编号）；**目标达成性/架构原则是否真正合理、验收标准与设计的深层语义对齐、交互断言、接口用例语义正确性、存储对账查验语义、SRP/SOLID/清晰命名等语义类规范**因不可机械判定而由需求评审专家/QE/PM 文字审查兜底。R18 覆盖矩阵的设计落点/任务包交叉校验（`designAnchorResolvable`/`taskPackExistsInList`）**仅做弱正则/子串匹配**（章节号或任务包编号在设计文档/任务清单中出现即视为可解析，不校验该章节/任务包内容与本条 P0 需求是否真实相关）——这是已知且被本文件坦诚披露的机械判定局限（不属隐藏漏洞）；「设计落点原文摘录」列为 R18 **机读必填且非空**（不校验摘录是否语义相关），供需求评审专家自查、QE/PM 复核时快速人工核验。
- **`test-results/` 受控运行产物例外**：E2E 机读结果（`test-results/e2e/.e2e-batch-result.json`、`.e2e-final-result.json`）、**编程规范 lint 机读结果**（`test-results/qe/.lint-result.json`）、**静态代码质量机读结果**（`test-results/qe/.static-scan-result.json`）、QE 运行留痕（`test-results/qe/qe-run-result.json`）及 Playwright trace/截图/video 由 `e2e-run.mjs` / `lint-run.mjs` / `static-scan-run.mjs` / `qe-run.mjs` / Playwright **进程内 `writeFileSync` 写盘**，不在 `sourceDirs` / `buildManifests` / `testConfigs` / `rootPatterns` 内，**不触发** `gate-dev-workflow`；`.gitignore` 已忽略 `test-results/`。此为**受控运行产物**，非绕过门禁；QE/测试阶段不得据此判定「脚本绕过 Hook」。
- Shell 门禁为正则匹配，属「尽力而为」：可绕过手段（如管道安装 `curl ... | sh`、`iwr ... | iex`、先写脚本再执行、未列出的包管理器别名）无法穷尽拦截。**R28** 已把「写文件类命令」纳入与 Write 同等判据（见 §8.5），但仍不可穷尽；子 agent 不得主动利用这些手段绕过门禁（`AGENTS.md` §5.16）。
- **hotfix 折叠通道下 R14/R17 硬门禁补强（P2-6 升级）**：P0 影响的 hotfix（`hotfix_p0_impact: p0`）走 R11 折叠通道时，接口测试/存储对账原本无对应机读硬门禁（§8.3 已明确排除）——这是高风险场景下的一处真实机制空白（非文档/实现不一致）。**P2-6 修复**：`gate-stop-workflow` 在唯一测试通道 `finalE2ePassed=true` 后，对**本次**测试报告做结构化章节（非空「## 接口测试报告」「## 存储对账记录」真实数据行）检测；缺失时**先**写一次性软性提醒到 `process.md` 留痕（R9 脚注第 4 条），**随后注入 followup 阻断收尾**（升级为 Stop 硬门禁，不再是「非阻塞」）。**仍存的能力边界**：本硬门禁仅校验「结构化章节存在 + 真实数据行存在」的机读形态；接口用例语义正确性、存储对账查验语义等仍由 QE/PM 文字审查兜底（与 §8.3 R17 一致）。

### 8.5 审核加固项（R28–R31 与 R5/R6 加强）

本节对应一次外部审核中**实测可复现**的绕过链与静默失效。每条都配有回归用例：单元级见
`.trae/scripts/tests/selftest/r28-r31-hardening.mjs`，Hook 端到端见
`.trae/scripts/tests/scenarios/hardening.mjs`。

#### R28：Shell 侧写文件门禁

**问题**：`gate-dev-shell` 原先只匹配 `gatedShellPatterns`（包管理/脚手架），未命中即
`allow()` 早退——连 R5 身份判定都在其后。实测 `Set-Content src/app.ts`、`echo x > src/app.ts`、
`node -e "...writeFileSync..."`、`cp`、`curl -o`、`sed -i`、`git apply`、`rm -rf src/` 等
写文件命令 **100% 放行**，即 R5/R3/R9/R21/R23 仅覆盖 Write 类工具。

**判据**（`classifyShellWriteIntent`，执行权威为 Hook/脚本）：

| 分类 | 判定 | 裁决 |
| ---- | ---- | ---- |
| `targets` 非空 | 命令写入的目标可静态解析且命中受门禁路径 | 套用与 Write **完全相同**的判据：R5 顶层身份 → R5 角色↔路径 → （非 `e2e/**`）分派计划/R3/R9/阻塞 |
| `selfGoverned` 非空 | 目标为门禁自治资产 | 按 R29 分级（`deny` / `ask`） |
| `opaqueWrite` | 内联解释器（`node -e`/`python -c`…）含写文件语义但目标不可解析 | `deny`，要求改用 Write 类工具以便门禁裁决 |
| `opaqueWorktree` | `git apply` / `reset --hard` / `stash pop` 等可任意改写工作树 | `ask`（交人类判断） |
| 其余 | 只读 / 构建 / 框架运行器 / 写非门禁路径 | 沿用既有逻辑 |

**能力边界**：仍是正则「尽力而为」，目标是把随手绕过的成本从 0 提高到「必须刻意构造」，
不声称不可绕过。框架自带运行器（`e2e-run` / `lint-run` / `static-scan-run` / `qe-run` /
`bootstrap-docs` / `gate-*`）显式豁免，避免自锁。

#### R29：门禁自治资产

**问题**：`hooks.json`、`harness.config.json` 与三个运行时标记原先全在
`dotTraeExemptPatterns` 中，等于「被约束方可自由改写约束自身」。实测一步可达：
伪造 `.dispatched-roles.json` 即获任意角色身份（deny → allow）；自写
`.toolchain-install-approved.json` 即自签安装授权（ask → allow）且**一份凭证泛用于任意
安装命令**；把 `qe.commands.lint` 设为 `exit 0` 即令 R15 空转（`gatePassed=true`）；
清空 `sourceDirs` 即令 R6 全面失效。这使 R12「只可加强」失去机械基础。

| 分级 | 路径 | 裁决 | 理由与解法 |
| ---- | ---- | ---- | ---- |
| `runtime-marker` | `.trae/hooks/.root-conversation-id.json`、`.trae/hooks/.dispatched-roles.json` | **deny** | 只应由 Hook 进程自身落盘；代理写入即等于自签身份。解法：走正常 Task 派发让 Hook 自行落盘 |
| `approval-marker` | `.trae/hooks/.toolchain-install-approved.json` | **deny** | 代表「用户已批准」，代理写入即自签授权。解法：直接执行安装命令，由 `gate-toolchain-install` 在 PreToolUse（RunCommand）上 `ask` 请用户批准；如需批量预授权，由**用户本人**创建该凭证 |
| `gate-config` | `.trae/hooks.json`、`.trae/harness.config.json`、`AGENTS.md`、`.trae/harness/spec/**.md` | **deny** | 门禁强度旋钮与权威文本；「是否放宽门禁」不能由被约束方自行决定。解法：代理呈现 diff/理由，由**用户本人**编辑 |
| 角色门禁 | `.trae/harness-state.json` | 期望 `project-manager` | 它决定所有门禁读哪一份 `process.md`；保留 PM bootstrap 窗口 |

**为什么一律 `deny` 而不是 `ask`（重要，勿回改）**：Trae 官方 Hooks 文档（https://docs.trae.cn/）未明确保证 PreToolUse 的 `permissionDecision: 'ask'` 会触发用户批准（与 Cursor 官方对 `preToolUse` 的 `permission: 'ask'` 标注「accepted by the schema but **not enforced** today」同类风险）——即写文件通道上返回 `ask` **可能不会**弹出用户批准，实际行为未定义。
若在此处依赖 `ask`，保护会**静默退化**，正是本次审核要消除的失效模式。PreToolUse（RunCommand）
通道理论上同样支持 `permissionDecision: 'ask'`（`gate-toolchain-install` 即用它），但 R29 在 Shell 通道也刻意用 `deny`：
否则「Write 被拒 → 改用 RunCommand → 用户顺手点批准」会成为标准绕过路径，与 `AGENTS.md` §5.16 冲突。

**工具链授权加强**：`commandHash` 由「可选」改为**必需**，且须 `userConfirmed: true` 与
有效时间戳（`expiresAt` 或 `approvedAt`）。历史行为下一份无 `commandHash` 的凭证可放行
任意安装命令，现要求凭证与本次命令一一绑定。凭证本身已禁止代理创建（见上表），
故常态路径是每条系统级安装命令都经 `gate-toolchain-install` 的 `ask` 由用户批准。

**残留缺口（坦诚披露）**：`.trae/templates/**` 与 `.trae/rules/**` 仍为豁免——
前者不被 Hook 直接读取（门禁读 `docs/` 成果物），后者仅为提醒，风险较低；但被污染的模板
会向下游传播错误结构，仍需人审。

#### R30：门禁输入编码鲁棒性

**问题**：所有门禁读盘原先硬编码 `fs.readFileSync(p, 'utf8')`。实测**一个 UTF-8 BOM 就能
解冻 R10 的「不可逆冻结」**——BOM 顶开 `^---`，`parseProcessFrontmatter` 整体失配，
`cancelled` / `blocking` / `workflow_mode` / `iterationType` 全部静默丢失；UTF-16LE 更严重
（连 PM Task 也被放行）。触发路径完全现实：PowerShell 5.1 的 `>` 与 `Out-File` 默认输出
UTF-16LE，`Set-Content -Encoding UTF8` 与 Windows 记事本产出 UTF-8 BOM，而本规约示例命令
以 PowerShell 为主。

**判据**：统一走 `readTextFileSafe` / `readJsonFileSafe`（`decodeTextBuffer`）——识别
UTF-8 BOM、UTF-16LE/BE BOM，并按「0x00 字节的奇偶优势比」探测无 BOM 的 UTF-16；
`parseProcessFrontmatter` 另行防御性剥离前导 BOM。探测**不得**要求「另一侧严格为 0」：
中日韩文本中 U+xx00 形式的字符（如「一」U+4E00）会在另一侧贡献 0x00，严格判据会整份漏判。

#### R31：回退计数上限机械化

**问题**：`rollback.md` 声称开发回退由「stop Hook 与 `## 回退计数` 双重约束」，但
`gate-stop-workflow` 从不读取该章节——文档强于实现，按 R12 须补齐实现。

**判据**：`checkRollbackLimit` 解析 `## 回退计数` 的 `| 对象类型 | 对象编号 | 回退次数 |` 表；
任一对象 `回退次数 > rollback.limit`（默认 3）即由 stop 门禁注入 Stop 阻断（`{ decision: 'block', reason }`），要求 PM 置
`blocking: true`、写明反复回退根因并在返回结果中标注「需要用户确认：[继续投入/调整方案/终止流程]」由顶层 Agent 用 `AskUserQuestion` 代为请用户决策（Subagent 不含 `AskUserQuestion` 工具）。置于「全流程闭环放行」判据
**之后**——已跑完且全绿的流程不因历史回退次数被倒扣；空表/缺章节/非数字占位不误判。

#### R5 加强：身份基准 TTL 自愈

**问题**：`recordRootConversationId` 原先「文件存在即永不覆盖」，本意是防嵌套子代理误写基准，
但作用域被放大成「整个仓库永久只记一次」。实测后果：基准一旦被遗留夹具值或跨会话陈旧值占据，
`isRootConversationCaller` 恒 false，**顶层代写拦截永久静默失效**（审核时该仓库工作树即处于此态）。

**判据**：区分两个谓词——「可被覆盖（stale，无时间戳或超 TTL）」用于**自愈**决策；
「已确定过期（expired，有合法时间戳且超 TTL）」用于**身份判定**决策。TTL 内不覆盖（保留防嵌套语义），
超 TTL 由新会话首个 `SessionStart` 覆盖。降级态不再静默：`inspectIdentityBaseline` 判定为
`baseline-missing` / `baseline-expired` 时写 stderr 告警并在 `process.md` 留一次性
**非阻塞**提醒（`recordIdentityBaselineNotice`，幂等、cancelled 流程不写）。

**保留的 fail-open**：基准缺失时仍放行（避免 `SessionStart` 不可用导致硬死锁），
但已从「静默」变为「有告警 + 有留痕」。

#### R6 加强：代码扩展名默认受门禁

**问题**：路径门禁原先是 `sourceDirs` 目录名**白名单**，实测 14 类主流布局完全不受保护：
`Sources/`（SwiftPM）、`myapp/`（Python 根包）、`MyApp/`（.NET）、`functions/`（Serverless）、
`R/`、`Modules/`、`assets/`、`charts/`、`ansible/`、根目录 `main.py` / `index.js` 等——
与「跨技术栈通用」的定位直接冲突。原缓解手段（架构师在 `gated-artifacts.json` 声明
`extraSourceDirs`）既无机械校验，又晚于 T0 阶段的首批代码写入。

**判据**：改为**黑名单**——凡 `CODE_EXTENSIONS` 内的扩展名一律受门禁，除非位于
`gatedPaths.extensionGateExemptDirs`（依赖/构建产物/工具目录，如 `node_modules`、`dist`、
`target`、`.venv`、`test-results` 等）。`.trae/`、`docs/`、`e2e/` 分支优先级不变。

#### R32：分派计划匹配门禁（R8 越级派发机械化）

**问题**：`AGENTS.md` §5.2 / R8 长期声明「须先经 PM 写入 `process.md`，再仅依 `## 当前分派计划` 与 `## 待派发角色列表` 发起 Task」「禁止越级发起 Task」，但 `checkRoleDispatchGate` 只校验各角色的**前置成果物**（需求/设计/质量等是否就绪），从不校验「被派发角色是否在 PM 书面计划中」。实测后果：顶层代理可在 PM 未把某角色写入分派计划的情况下直接派发该角色 Task——R8 的「分派计划匹配」部分纯属文字约束，是「大量依赖顶层代理行为合规」的典型缺口之一。

**判据**（`checkDispatchPlanMatch`，执行权威为 `dispatch.mjs` / `gate-role-sequence.mjs` / `gate-r13-subagent.mjs`）：

| 场景 | 判定 | 裁决 |
| ---- | ---- | ---- |
| `## 待派发角色列表` 或 `## 当前分派计划` 至少一节含数据行，且本角色在其中 | `in-plan` | **放行**，继续后续 R13 前置校验 |
| 两节均含数据行但都不含本角色 | `not-in-dispatch-plan` | **deny**：须先派 `project-manager` 更新分派计划后再发起该角色 Task |
| 两节均空 / 缺失 / 格式不识别 | `no-plan-fail-open` | **放行**（fail-open，见下「能力边界」） |
| 无 `process.md` | `no-process` | **放行**（与既有 R13 行为一致） |

**解析规则**（`extractPlannedRoles`）：
- `## 待派发角色列表`：按 `| 角色 | 说明 |` 表格，取**第一列**角色名，经 `normalizeRoleSlug` 归一化为 agent slug。
- `## 当前分派计划`：按 `| 任务包编号 | 分派角色 | 并行/串行 | 状态 |` 表格，取**第二列**「分派角色」。
- 两节合并为一个 slug 集合；表格分隔行（`|---|`）与表头行跳过。

**为何不复用 `collectActiveRoleSlugs`**：后者合并「最近派发」（`recordDispatchedRole` 落盘值），而 `recordDispatchedRole` 在 `checkRoleDispatchGate` 之前已执行——若 R32 读它，会使「顶层已派发过该角色」成为放行依据，检查循环放行，等于没有 R32。R32 只读 PM 书面计划，不读运行时派发记录。

**作用范围**：仅约束 `GATED_ROLES`（`system-architect` / `requirement-reviewer` / `development-engineer` / `quality-engineer` / `test-engineer`）。`project-manager` / `requirements-analyst` 不在 `GATED_ROLES`（由 switch default 放行），不受 R32 约束——与 R8 文字约束一致（PM/RA 为流程入口与分诊角色，无须 PM 预先计划自身）。

**能力边界（坦诚披露）**：
- **fail-open 缺口**：两节均空时放行。这是刻意取舍——PM 首次接收目标时尚未写分派计划，若此时 fail-closed 会与「PM 为流程入口」冲突并硬死锁。代价是：若 PM 已写计划但顶层代理把 `## 当前分派计划` / `## 待派发角色列表` 两节**同时清空**再越级派发，R32 会放行。但清空这两节本身会被 `hasValidDispatchPlan`（DE 分支）等其他门禁与 R29（代理不得改写 `process.md` 自身——`process.md` 归 PM 角色，见 `role-path.mjs`）约束，且 `gate-stop-workflow` 会因「无有效分派计划」注入 followup，多层兜底已将该绕过路径的成本显著提高。
- **格式依赖**：依赖 PM 按模板写表格（表头列名与列序）。若 PM 用自由文本写分派计划，R32 不识别即 fail-open。这是「机械化」与「PM 写作自由度」的固有张力，本框架选择依赖模板格式以换取可机读性。
- **不校验语义**：R32 只验证「角色名出现在计划中」，不验证「任务包编号与角色是否匹配」「并行/串行是否合理」「是否真的轮到该角色」——后者仍由 R13 各角色前置成果物校验 + R8 文字约束 + §5.15 顶层自检承担。
- **Trae 适配**：与 R13 同——Trae 不路由 `Task` 进 PreToolUse，R32 实际由 `gate-r13-subagent.mjs`（`matcher:"*"`）在子代理首次工具调用时基于 `agent_id` 自动执行（见 §8.1 / §8.4「已实测验证」）；`gate-role-sequence.mjs`（`matcher:"Task"`）为前瞻性保留。手动 `gate-check role` 仍作兜底。

**回归用例**：单元级见 `.trae/scripts/tests/selftest/r13-dispatch.mjs`（「R32：分派计划匹配」段）；场景级见 `greenfield.mjs` G2/G2c、`lint-gate.mjs` L3/L4、`static-scan-gate.mjs` S4/S5。
