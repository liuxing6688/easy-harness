# 规则编号索引（导航用，不新增约束）

> 完整定义以「定义位置」列为准；机械判据以 Hook/脚本为准。  
> 本节承接原 AGENTS.md §10。

## 10. 规则编号索引（导航用，不新增约束）

正文中部分强制规则以编号形式被跨章节引用（如「见 R5」）。本表仅索引这些编号在当前文件中的定义位置，便于跳转与核对，不改变任何判定逻辑：

| 编号 | 主题（一句话，完整定义见「定义位置」） | 定义位置 |
| ---- | ---- | -------- |
| R2 | `single-task` 分派节奏可压缩，角色职责不可省略 | `workflow-modes.md`「`single-task` 收紧定义」 |
| R3 | 非 `hotfix`/`docs-only` 迭代开发前须校验四件成果物存在且被引用 | `gate-chain.md` 门禁链脚注；`workflow-gate-lib.mjs` 的 `checkIterationArtifacts` |
| R5 | 顶层代理不得代行子角色职责；机械化：`conversation_id` 顶层拦截 + 角色↔路径匹配（含 docs 成果物）+ 最近 Task 派发落盘 | `AGENTS.md` §5.1；`isRootConversationCaller` / `checkRolePathPermission` / `recordDispatchedRole`；`gate-subagent-track` / `gate-dev-workflow` |
| R6 | `.cursor/scripts\|agents\|hooks/**` 三目录纳入机制门禁 | `mechanical-gates.md` §8.1 Hook 一览表 |
| R8 | 禁止越级发起 Task | `AGENTS.md` §5.8 |
| R9 | hotfix 开发前须校验设计存在性、E2E 适用性与 `hotfix_p0_impact`；声明 `none` 须留痕受影响用户、既有行为、回滚条件、P0 判断依据组成的最小影响澄清；P0 影响须 RR 或改走 full；P0 影响时另有本次报告接口/存储结构化章节软性提醒（非阻塞） | `gate-chain.md` `hotfix` 门禁链脚注；`checkHotfixDesign` / `checkHotfixP0Impact` / `checkHotfixP0InterfaceStorageMention` / `recordHotfixP0SoftReminder` |
| B1 | `## 进度列表` 按任务包编号取最新有效状态，作废行为 tombstone | `mechanical-gates.md` §8.2 stop 门禁判据脚注 |
| R10 | 流程终止不可逆：确认取消后 Hook 永久冻结 `process.md` | `workflow-modes.md`；`AGENTS.md` §5.19；`workflow-gate-lib.mjs` 的 `isCancelledProcessFile`/`isProcessFilePath` |
| R11 | hotfix 批次/最终测试折叠为单次通道，判据与执行器不降低 | `mechanical-gates.md` §8.2（唯一权威定义）；`gate-chain.md` `hotfix` 门禁链脚注；`mechanical-gates.md` §8.3 适用范围 |
| R12 | 元规则：只可新增/加强门禁约束，不可放松 | `AGENTS.md` §2 强制规则第 5 条 |
| R13 | 成果物门禁链中客观条件由 `gate-role-sequence.mjs` 机械拦截 | `gate-chain.md` 表格脚注；`mechanical-gates.md` §8.1；`workflow-gate-lib.mjs` 的 `checkRoleDispatchGate` |
| R18 | 设计问题清单须含 12 维+可修复字段+覆盖矩阵（验收标准↔设计落点↔设计落点原文摘录↔任务包，P0 全部「已覆盖」）+审核结论（返工后须复审通过）+技术选型确认；摘录须非空/够长/为设计原文/落在 §N 章节窗口内/不过度雷同；机读通过方可派 DE | `gate-chain.md`；`checkDesignReviewClean` / `checkRequirementCoverageMatrix` / `excerptInDesignAnchorWindow` / `checkDesignReviewConclusion` / `checkTechSelectionConfirmed` |
| R19 | `requirement-spec.md`「隐性需求确认记录」须有完整表头、枚举合法的完整数据行，关联 `R-编号` 与 §7 追溯；待决项须含责任方/最晚决策点；机读通过方可派 SA | `mechanical-gates.md` §8.2；`checkImplicitRequirementRecord` / `checkRequirementReady` |
| R20 | 轻量模式（hotfix/docs-only/single-task）须 AskQuestion +「工作流模式确认」机读行后才生效；未确认 fail-safe 为 full，并对受门禁角色拒绝 Task | `workflow-modes.md`「R20」；`hasLiteModeConfirmation` / `checkLiteModeConfirmed` / `getWorkflowMode`；`checkRoleDispatchGate` |
| R14 | 批次集成测试阶段须做接口测试，报告含非空章节；双要素豁免 | `mechanical-gates.md` §8.2；`mechanical-gates.md` §8.3（唯一权威定义）；`checkBatchApiTestReport` / `isApiTestExempt` |
| R17 | 批次集成测试阶段须做业务数据存储对账，报告含非空章节+适用分类型行+至少一条适用行+描述列完备+其他/不适用备注+介质列+批次任务包覆盖+适用行证据文件 `test-results/recon/*.json`；双要素豁免 | `mechanical-gates.md` §8.2；`mechanical-gates.md` §8.3（唯一权威定义）；`checkBatchStorageReconciliationReport` / `checkReconEvidenceRef` / `isStorageReconciliationExempt` / `isE2eExempt` |
| R15 | QE 须运行 lint 且 `gatePassed=true`；双要素豁免 | `mechanical-gates.md` §8.2（唯一权威定义）；`readLintResult` / `checkLintClean` / `isLintExempt`；`lint-run.mjs` |
| R16 | QE 须运行重复代码检测+安全扫描且均 `gatePassed=true`；双要素豁免 | `mechanical-gates.md` §8.2（唯一权威定义）；`readStaticScanResult` / `checkStaticScanClean` / `isDupCheckExempt` / `isSecurityScanExempt`；`static-scan-run.mjs` |
| TG-D-4 | 批次/最终 E2E 判据与 `workflow-gate-lib` 字段严格对齐 | `mechanical-gates.md` §8.3 两级集成测试与 E2E 判据 |

> R14/R15/R16/R17/E2E 的双要素豁免机制唯一权威定义见 `mechanical-gates.md` §8.2「双要素豁免机制」表，本索引不再重复各字段名/关键词。

> 编号不连续（如无 R1/R4/R7）属正常：这些编号源自本框架自举开发（governance-overhaul）迭代中的需求/任务追溯标识，对应的 `requirement-list.md`/`develop-task-list.md` 是运行时产物，不随框架模板分发；本表只收录当前仍在 `AGENTS.md`/Hook 正文中被引用、因而需要跨章节定位的编号。
