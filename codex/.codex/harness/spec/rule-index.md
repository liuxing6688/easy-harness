# 规则编号索引（导航用，不新增约束）

> 完整定义以「定义位置」列为准；机械判据以 Hook/脚本为准。  
> 本节承接原 AGENTS.md §10。

## 10. 规则编号索引（导航用，不新增约束）

正文中部分强制规则以编号形式被跨章节引用（如「见 R5」）。本表仅索引这些编号的定义位置，便于跳转与核对，**不改变任何判定逻辑**。「主题」列刻意只写一句话——本表是**查位置**用的，读判据请按右列跳转，不要拿本表当权威。

| 编号 | 主题（一句话，完整定义见「定义位置」） | 定义位置 |
| ---- | ---- | -------- |
| R2 | `single-task` 折叠测试轮次与分派节奏，角色职责不可省略（增量档底线，随 **R37** 重构保留） | `workflow-modes.md`「`single-task` 角色职责底线」 |
| R3 | 非 `hotfix`/`docs-only` 迭代开发前须校验四件成果物存在且被引用 | `gate-chain.md` 门禁链脚注；`workflow-gate-lib.mjs` 的 `checkIterationArtifacts` |
| R5 | 顶层代理不得代行子角色职责；Codex 机械化：根会话 `read-only` + 角色 agent `workspace-write` + 角色↔路径匹配（含 docs 成果物）+ 最近 Agent 派发落盘 | `AGENTS.md` §5.1；`.codex/config.toml`；`.codex/agents/*.toml`；`checkRolePathPermission` / `recordDispatchedRole`；`gate-dev-workflow` |
| R6 | `.codex/scripts\|agents\|hooks/**` 三目录纳入机制门禁；代码扩展名默认受门禁 | `mechanical-gates.md` §8.1 Hook 一览表；§8.5「R6 加强」 |
| R8 | 禁止越级发起 Task | `AGENTS.md` §5.8 |
| R9 | hotfix 开发前的设计存在性 / E2E 适用性 / `hotfix_p0_impact` 前置校验（含 P0 影响的非阻塞软性提醒） | `gate-chain.md` `hotfix` 门禁链脚注；`checkHotfixDesign` / `checkHotfixP0Impact` / `checkHotfixP0InterfaceStorageMention` / `recordHotfixP0SoftReminder` |
| B1 | `## 进度列表` 按任务包编号取最新有效状态，作废行为 tombstone | `mechanical-gates.md` §8.2 stop 门禁判据脚注 |
| R10 | 流程终止不可逆：确认取消后 Hook 永久冻结 `process.md`（仅留 PM 逃生口） | `workflow-modes.md`；`gate-chain.md`「R10 的 `project-manager` 例外」；`AGENTS.md` §5.19；`isCancelledProcessFile` / `isProcessFilePath` |
| R11 | hotfix 批次/最终测试折叠为单次通道，判据与执行器不降低 | `mechanical-gates.md` §8.2（唯一权威定义）；`gate-chain.md` `hotfix` 门禁链脚注；`mechanical-gates.md` §8.3 适用范围 |
| R12 | 元规则：只可新增/加强门禁约束，不可放松；文档强于实现须补实现；实现严于声明到不可达亦属缺陷，但修正方向属放松，**须经用户确认并留痕，代理不得自行判断** | `AGENTS.md` §2 强制规则第 5 条；理据与留痕范例见 `mechanical-gates.md` §8.5「门禁强度调整留痕」 |
| R13 | 成果物门禁链中客观条件由 `gate-role-sequence.mjs` 机械拦截 | `gate-chain.md` 表格脚注；`mechanical-gates.md` §8.1；`workflow-gate-lib.mjs` 的 `checkRoleDispatchGate` |
| R14 | 批次集成测试阶段须做接口测试，报告含非空章节；双要素豁免（**并入** `single-task` 折叠通道，hotfix 跳过） | `mechanical-gates.md` §8.2；§8.3（唯一权威定义）；`checkBatchApiTestReport` / `isApiTestExempt` |
| R15 | QE 须运行 lint 且 `gatePassed=true`；双要素豁免 | `mechanical-gates.md` §8.2（唯一权威定义）；`readLintResult` / `checkLintClean` / `isLintExempt`；`lint-run.mjs` |
| R16 | QE 须运行重复代码检测 + 安全扫描且均 `gatePassed=true`；双要素豁免；默认命令禁带 `--exitCode`（否则阈值失效） | `mechanical-gates.md` §8.2（唯一权威定义）；`readStaticScanResult` / `checkStaticScanClean` / `isDupCheckExempt` / `isSecurityScanExempt`；`static-scan-run.mjs` |
| R17 | 批次集成测试阶段须做业务数据存储对账：报告章节 + 分类型适用行 + 描述列完备 + 介质列 + 批次任务包覆盖 + 适用行 `test-results/recon/*.json` 证据文件；双要素豁免（**并入** `single-task` 折叠通道，hotfix 跳过） | `mechanical-gates.md` §8.2；§8.3（唯一权威定义）；`checkBatchStorageReconciliationReport` / `checkReconEvidenceRef` / `isStorageReconciliationExempt` / `isE2eExempt` |
| R18 | 设计问题清单机读要件（12 维 + 可修复字段 + P0 覆盖矩阵 + 摘录锚点窗口与去雷同 + 审核结论 + 技术选型确认）全部通过方可派 DE | `gate-chain.md`；`checkDesignReviewClean` / `checkRequirementCoverageMatrix` / `excerptInDesignAnchorWindow` / `checkDesignReviewConclusion` / `checkTechSelectionConfirmed` |
| R19 | `requirement-spec.md`「隐性需求确认记录」须有合规表头与真实数据行、关联 `R-编号` 与 §7 追溯；机读通过方可派 SA；**不适用**双要素豁免 | `mechanical-gates.md` §8.2；`checkImplicitRequirementRecord` / `checkRequirementReady` |
| R20 | 轻量模式（hotfix / docs-only / single-task）须 AskQuestion +「工作流模式确认」机读行后才生效；未确认 fail-safe 为 `full` 并拒绝受门禁角色 Task | `workflow-modes.md`「R20」（唯一权威定义，含固定选项文案）；`hasLiteModeConfirmation` / `checkLiteModeConfirmed` / `getWorkflowMode`；`checkRoleDispatchGate` |
| R21 | R5 角色↔路径收紧：最近派发为非 DE（TE/QE 等）时对产品源码路径直接 deny，不因进度表残留 DE 行而放行；TE 另硬禁止写产品源码或加可观测性钩子 | `mechanical-gates.md` §8.4；`checkRolePathPermission`（`role-path.mjs` 的 `non-de-dispatched-denied` 分支）；`test-engineer.toml` 强制约束 #8 |
| R22 | TE 冒烟的**负向**拦截：禁止用替代 E2E 启动命令掩盖生产启动失败；双要素豁免。**正向**证据要求见 R32 | `mechanical-gates.md` §8.4；`checkTeAlternativeE2eStartup` / `isAlternativeE2eStartupExempt`（`qe.mjs`）；`gate-dev-shell.mjs`；`test-engineer.toml` 强制约束 #11；`rollback.md` |
| R23 | `e2e/**` 纳入 `isGatedDevPath`，期望角色为 test-engineer；非 TE（含 DE）默认 deny，不走 DE 分派计划门禁 | `mechanical-gates.md` §8.4；`isE2eTestPath`（`paths.mjs`）；`expectedRolesForPath`（`role-path.mjs`） |
| R24 | TE 不得为测绿而随意改已生成用例，除非用例本身有客观缺陷并在「## 测试用例变更记录」留痕；实为产品缺陷须判不通过并回派 DE（纯文字约束） | `mechanical-gates.md` §8.4；`test-engineer.toml` 强制约束 #14；`rollback.md`「用例掩盖产品缺陷」回退触发条件 |
| R25 | 发起 requirement-reviewer 前，非 stub 的 `detail-design-spec.md` 须含「同构模块识别」章节（同构组 + 共享 primitive 非空，或「已排查，无同构资源族」+ 依据）；hotfix/docs-only 豁免 | `mechanical-gates.md` §8.2（唯一权威定义）；`checkIsomorphicModuleSection` / `checkIsomorphicModuleSectionReady`（`design.mjs`） |
| R26 | SA 阶段 1 技术选型须用 AskQuestion 请用户确认，不得以自由文本「待确认」代替；机读仅校验确认行存在（纯文字约束）；`single-task` 豁免本项 | `system-architect.toml`「阶段 1：技术选型」；`project-manager.toml`「技术选型确认留痕」；`checkTechSelectionConfirmed`（`design.mjs`） |
| R27 | RA 阶段二需求摘要须先用 AskQuestion 做「确认 / 需要修改」粗判断，不得替代或压缩阶段一苏格拉底追问（纯文字约束） | `requirements-analyst.toml`「阶段二：需求摘要确认」 |
| R28 | Shell 侧写文件门禁：写文件类命令按解析出的目标路径套用与 Write **同等**判据；目标不可解析的内联写入 deny、不可判定的工作树改写在 legacy 内核为 ask、经 Codex 适配后为 deny；`.codex/rules/harness.rules` 对同类固定前缀仅提供沙箱外 `prompt` 后备，不能覆盖 Hook 拒绝；框架自带运行器豁免 | `mechanical-gates.md` §8.5（唯一权威定义）；`classifyShellWriteIntent`（`paths.mjs`）；`gate-dev-shell.mjs`；`.codex/rules/harness.rules` |
| R29 | 门禁自治资产一律 **deny**（代理不得写入，含 Shell 通道）：运行时标记、授权凭证、台账、`hooks.json` / `harness.config.json` / `.codex/rules/*.rules` / `AGENTS.md` / `harness/spec/**`；`harness-state.json` 归 PM、`gated-artifacts.json` 归 SA；放松型旋钮不再被合并 | `mechanical-gates.md` §8.5（唯一权威定义）；`classifyHarnessSelfGovernedPath` / `harnessSelfGovernedVerdict` / `hasToolchainInstallApproval`（`paths.mjs`） |
| R30 | 门禁读盘统一走 BOM / UTF-16 安全解码，禁止硬编码 `'utf8'`（一个 BOM 即可使 `cancelled`/`blocking`/`workflow_mode` 静默丢失） | `mechanical-gates.md` §8.5（唯一权威定义）；`decodeTextBuffer` / `readTextFileSafe` / `readJsonFileSafe`（`core.mjs`） |
| R31 | 回退计数上限机械化：`## 回退计数` 任一对象超上限（默认 3）且未 `blocking` 时 stop 注入 followup，要求 PM 阻塞并请用户决策 | `mechanical-gates.md` §8.5（唯一权威定义）；`rollback.md`；`parseRollbackCounts` / `checkRollbackLimit`（`core.mjs`） |
| R32 | 生产启动冒烟硬门禁（**正向证据**）：两段冒烟（干净启动 + **强杀后再启动**）机读 `gatePassed` 且不陈旧；并入批次与最终，**含 hotfix / single-task 折叠通道**；豁免仅限「确无可冒烟常驻启动路径」，「暂时起不来」须回派 DE | `mechanical-gates.md` §8.6（唯一权威定义）；`startup-smoke-run.mjs` / `startup-smoke-lib.mjs`；`checkStartupSmoke` / `isStartupSmokeExempt`（`qe.mjs`）；`readStartupSmokeResult`（`iteration.mjs`）；`parseWorkflowState`（`dispatch.mjs`）；`test-engineer.toml` 强制约束 #10；`rollback.md` |
| R33 | 界面与交互期望确认：RA 罗盘第 7 维 + `requirement-spec.md` §3.4 落表 + `## 用户确认记录` **独立**确认行（技术选型行不能顶替），缺失时拒绝发起 SA；**不适用**双要素豁免 | `mechanical-gates.md` §8.6（唯一权威定义）；`hasUiExpectationConfirmation` / `checkUiExpectationConfirmed` / `checkRequirementReady`（`iteration.mjs`）；`requirements-analyst.toml` §1.3 / §1.3.1；`project-manager.toml` 强制约束 #24；`requirement-reviewer.toml`「体验」维 |
| R34 | 证据产物执行证明：`test-results/**` 机读产物须带 Hook 签发的 nonce + ed25519 签名，且时间戳晚于最后一次源码变更；堵掉「手写 `{gatePassed:true}`」与「存一份绿产物改坏代码后重放」两条路径。台账与私钥交接目录纳入 R29 禁写 | `mechanical-gates.md` §8.8（唯一权威定义）；§8.7 边界 2；`execproof.mjs`（`issueExecutionProof` / `attachExecutionProof` / `verifyExecutionProof` / `checkArtifactFreshness` / `latestSourceChangeMs` / `detectRunnerExecProofKind`）；`evaluateGateArtifact`（`iteration.mjs`）；`checkStartupSmoke`（`qe.mjs`）；各 `*-run.mjs` |
| R35 | 阻塞释放证据：`blocking: true` 不再无条件释放 stop 门禁，须机器起源（与 Hook 独占写入的旁路台账指纹相符、且一次性）或「实质阻塞原因 + 用户决策留痕」 | `mechanical-gates.md` §8.8（唯一权威定义）；§8.7 边界 4；`checkBlockingReleaseEvidence` / `findCorroboratedGateExceptionEvent` / `recordGateExceptionLedgerEntry` / `consumeGateExceptionRelease` / `hasSubstantiveBlockingReason` / `hasBlockingDecisionTrace`（`core.mjs`）；`recordFailOpenEvent`（`design.mjs`）；`gate-stop-workflow.mjs` |
| R36 | 判定期异常 fail-closed（write/shell/role → deny，stop → continuation）；工具链与不透明工作树的 legacy `ask` 经 Codex 适配器转为 deny。仅对活跃 `process.md` 的单独写入保留修复例外；legacy lib 加载失败仍 fail-open | `mechanical-gates.md` §8.4 / §8.8；`codex-hook-adapter.mjs`；`getGateExceptionPolicy` / `buildGateExceptionVerdict`；`resolveGateRepairPaths` |
| R37 | `single-task` = 增量迭代档：**省**测试轮次折叠 + R26 豁免；**不省** R14/R17/R32/R15/R16/R18/R25/R19/R27/R33；前置为基线 `detail-design-spec.md` + 「## 增量范围」四维声明 + schema 变更硬禁用 | `workflow-modes.md`「`single-task` = 增量迭代档」（唯一权威定义）；`gate-chain.md`「`single-task` 模式门禁链」；`mechanical-gates.md` §8.2 R11 脚注 / §8.3 / §8.8；`checkSingleTaskPreconditions` / `checkIncrementScopeDeclared` / `checkSingleTaskBaseDesign`（`iteration.mjs`）；`parseWorkflowState`（`dispatch.mjs`） |
| R38 | 工具不可用 vs 检查未通过：仅在证据明确时判为工具不可用；**仍使门禁失败**，改变的是解法（PM 标 `blocking` + AskQuestion 三选一），不得回派 DE 整改不存在的缺陷；R32 收窄为只认「启动命令本身不存在」 | `mechanical-gates.md` §8.8（唯一权威定义）；`tool-availability-lib.mjs`（`classifyCommandFailure` / `applyToolAvailability` / `LAUNCH_ONLY_SIGNALS`）；`computeLintGate` / `computeSubGate` / `computeStaticScanGate`；`evaluateGateArtifact` / `toolUnavailableMessage`（`iteration.mjs`）；`gate-stop-workflow.mjs` |
| TG-D-4 | 批次/最终 E2E 判据与 `workflow-gate-lib` 字段严格对齐 | `mechanical-gates.md` §8.3 两级集成测试与 E2E 判据 |

> **R5 / R6 / R10 的加强项**（不新增编号，见 `mechanical-gates.md` §8.5）：R5 顶层会话 id 基准改为 TTL 自愈 + 降级态告警留痕；R6 路径门禁由 `sourceDirs` 白名单改为**代码扩展名默认受门禁**；R10 的 cancelled 判定前移至角色白名单短路之前。

> R14/R15/R16/R17/R32/E2E 的双要素豁免机制唯一权威定义见 `mechanical-gates.md` §8.2「双要素豁免机制」表，本索引不重复各字段名/关键词。

> **R34/R38 与既有五项机读门禁的关系**：两者不新增门禁，而是给 R15/R16/R17/R32/E2E 的**判据链统一加了两段前置**——先验签、再看失败性质，最后才看 `gatePassed`（`evaluateGateArtifact`）。故都不出现在「双要素豁免」表中：它们无豁免字段，只有 `execProof.enforce` / `execProof.requireFreshArtifacts` 这两个**用户级**开关。

> 编号不连续（如无 R1/R4/R7）属正常：这些编号源自本框架自举开发（governance-overhaul）迭代中的需求/任务追溯标识，对应的 `requirement-list.md`/`develop-task-list.md` 是运行时产物，不随框架模板分发；本表只收录当前仍在 `AGENTS.md`/Hook 正文中被引用、因而需要跨章节定位的编号。
