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
| R21 | R5 角色↔路径进一步收紧：最近派发角色若为 test-engineer/quality-engineer 等非 DE，对产品源码路径直接 deny，不因进度表残留 DE「正在执行」而放行；TE 角色文件同步硬禁止写产品源码/加可观测性钩子 | `mechanical-gates.md` §8.4；`checkRolePathPermission`（`role-path.mjs` 的 `non-de-dispatched-denied` 分支）；`test-engineer.md` 强制约束 #8 |
| R22 | TE 冒烟：最近派发为 test-engineer 时，禁止用替代 E2E 启动命令（`E2E_WEB_SERVER_COMMAND=` / `npx vite-node`+e2e 等）掩盖生产启动失败；双要素豁免（`gated-artifacts.json` 的 `e2eAlternativeStartup:"allowed"` + 用户确认「允许非 dist 启动」） | `mechanical-gates.md` §8.4；`checkTeAlternativeE2eStartup` / `isAlternativeE2eStartupExempt`（`qe.mjs`）；`gate-dev-shell.mjs`；`test-engineer.md` 强制约束 #10；`rollback.md`「生产启动冒烟失败」回退触发条件 |
| R23 | `e2e/**` 纳入 `isGatedDevPath` 机械门禁，期望角色为 test-engineer；非 TE（含 DE）写 `e2e/**` 默认 deny，不走 DE 分派计划门禁 | `mechanical-gates.md` §8.4；`isE2eTestPath`（`paths.mjs`）；`expectedRolesForPath`（`role-path.mjs`） |
| R25 | 发起 requirement-reviewer 前，非 stub 的 detail-design-spec.md 须含「同构模块识别」章节（同构组+共享 primitive 表格非空，或声明「已排查，无同构资源族」+ 依据）；hotfix/docs-only 豁免；2026-07-28 QE R16 消重复盘新增 | `mechanical-gates.md` §8.2（唯一权威定义）；`checkIsomorphicModuleSection` / `checkIsomorphicModuleSectionReady`（`design.mjs`） |
| R24 | TE 不得为使测试通过而随意修改已生成的测试用例，除非用例本身存在客观缺陷（断言逻辑错误/选择器过时/前置条件缺失/需求设计矛盾/语法编译错误之一并附佐证）；确属用例缺陷的修改须在测试报告新增「## 测试用例变更记录」留痕；若实为产品缺陷须判不通过/blocking 并回派 DE，不得靠改用例掩盖（纯文字约束，语义不可机械化） | `mechanical-gates.md` §8.4；`test-engineer.md` 强制约束 #11；`rollback.md`「用例掩盖产品缺陷」回退触发条件 |
| R26 | 系统架构师阶段 1 呈现技术选型候选时须使用 AskQuestion（选项含各候选摘要+推荐标注，不得只给短标签）请用户确认，不得仅以自由文本「待确认」代替；机读仍为既有 `## 用户确认记录` 技术选型/技术栈确认行校验，AskQuestion 使用本身不可机械化（比照 R20，纯文字约束） | `system-architect.md`「阶段 1：技术选型」；`project-manager.md`「技术选型确认留痕」；`checkTechSelectionConfirmed`（`design.mjs`，机读仅校验确认行存在） |
| R27 | 需求分析师阶段二需求摘要确认，须先用 AskQuestion 做「确认」/「需要修改」粗粒度判断（选项须各自说明含义）；选「需要修改」时须回到自由对话追问具体修改点，不得凭该选择直接猜测改动内容；本步骤仅用于收敛「摘要是否准确」，不得替代或压缩阶段一苏格拉底式追问（纯文字约束，语义不可机械化） | `requirements-analyst.md`「阶段二：需求摘要确认」 |

| R28 | Shell 侧写文件门禁：写文件类命令（重定向 / `Set-Content` / `cp` / `mv` / `rm` / `sed -i` / `curl -o` / 解压 / `git checkout -- <path>` 等）按解析出的目标路径套用与 Write **同等**判据（R5 身份、R5 角色↔路径、分派计划/R3/R9）；内联解释器含写文件语义但目标不可解析时 deny；`git apply`/`reset --hard`/`stash pop` 等不可判定的工作树改写 ask；框架自带运行器豁免。修复「R5/R3/R9/R21/R23 仅覆盖 Write 类工具」的实测绕过 | `mechanical-gates.md` §8.5（唯一权威定义）；`classifyShellWriteIntent`（`paths.mjs`）；`gate-dev-shell.mjs` |
| R29 | 门禁自治资产一律 **deny**（代理不得写入）：运行时标记（`.root-conversation-id.json` / `.dispatched-roles.json`）、授权凭证（`.toolchain-install-approved.json`）、门禁配置与权威文本（`hooks.json` / `harness.config.json` / `AGENTS.md` / `harness/spec/**.md`）；`harness-state.json` 归 project-manager 角色门禁。不用 `ask` 是因为 `preToolUse` 的 ask 官方标注「not enforced today」，依赖它会静默退化；Shell 通道亦用 deny 以免成为绕过路径。另：工具链授权凭证的 `commandHash` 由可选改为**必需**。修复「被约束方可自由改写约束自身」使 R12 失去机械基础的问题 | `mechanical-gates.md` §8.5（唯一权威定义）；`classifyHarnessSelfGovernedPath` / `harnessSelfGovernedVerdict` / `hasToolchainInstallApproval`（`paths.mjs`） |
| R30 | 门禁输入编码鲁棒性：全部门禁读盘统一走 BOM/UTF-16 安全解码，禁止硬编码 `'utf8'`。修复「一个 UTF-8 BOM 或 UTF-16LE 即可使 `cancelled`/`blocking`/`workflow_mode` 静默丢失、解冻 R10 不可逆冻结」的实测缺陷（PowerShell 5.1 重定向与 Windows 记事本即可触发）；UTF-16 探测须用奇偶优势比，不得要求另一侧严格为 0（否则含 U+xx00 汉字的文本整份漏判） | `mechanical-gates.md` §8.5（唯一权威定义）；`decodeTextBuffer` / `readTextFileSafe` / `readJsonFileSafe`（`core.mjs`） |
| R31 | 回退计数上限机械化：`gate-stop-workflow` 读取 `## 回退计数`，任一对象超上限（默认 3，`rollback.limit` 可调）且未标记 `blocking` 时注入 followup，要求 PM 阻塞并 AskQuestion 请用户决策。补齐 `rollback.md` 曾声称「stop Hook 与回退计数双重约束」但实现从不读该章节的文档-实现落差（R12） | `mechanical-gates.md` §8.5（唯一权威定义）；`rollback.md`；`parseRollbackCounts` / `checkRollbackLimit`（`core.mjs`） |

> **R5 / R6 / R10 的加强项**（不新增编号，见 `mechanical-gates.md` §8.5）：R5 顶层会话 id 基准改为 TTL 自愈 + 降级态告警留痕（原「永不覆盖」会使顶层代写拦截永久静默失效）；R6 路径门禁由 `sourceDirs` 目录名白名单改为**代码扩展名默认受门禁**（原白名单漏掉 `Sources/`、`myapp/`、`MyApp/`、`functions/`、`R/`、根目录 `main.py` 等主流布局）；R10 的 cancelled 判定前移至角色白名单短路之前，覆盖除 `project-manager`（逃生口）外的全部角色。

> R14/R15/R16/R17/E2E 的双要素豁免机制唯一权威定义见 `mechanical-gates.md` §8.2「双要素豁免机制」表，本索引不再重复各字段名/关键词。

> 编号不连续（如无 R1/R4/R7）属正常：这些编号源自本框架自举开发（governance-overhaul）迭代中的需求/任务追溯标识，对应的 `requirement-list.md`/`develop-task-list.md` 是运行时产物，不随框架模板分发；本表只收录当前仍在 `AGENTS.md`/Hook 正文中被引用、因而需要跨章节定位的编号。
