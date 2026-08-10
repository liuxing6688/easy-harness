# Harness 项目复盘审计清单

Phase 1 对照本清单逐项打勾并记录证据。结论：`✓` 合规 / `△` 部分合规 / `✗` 不合规 / `N/A` 不适用。

## A. 流程初始化与模式

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| A1 | `docs/` 结构已由 bootstrap 或等价方式创建 | `CLAUDE.md` §8 |
| A2 | `workflow_mode` 与用户 R20 确认一致（full/hotfix/docs-only/single-task；轻量须有「工作流模式确认」行） | `workflow-modes.md` R20 |
| A3 | `iterationType` 与分诊表一致且已留痕 | `workflow-modes.md` |
| A4 | Feature 迭代时 `harness-state.json` 指向正确 `process.md` | `workflow-modes.md` |
| A5 | `## 用户目标` 记录完整 | process 模板 |
| A6 | 须确认事项均在 `## 用户确认记录` 留痕 | `gate-chain.md` |
| A7 | hotfix 且 `hotfix_p0_impact: none` 时，「## 用户确认记录」含「hotfix影响面」、受影响用户、既有行为、回滚条件与 P0 判断依据的最小影响澄清行 | `gate-chain.md` R9 |
| A8 | R33：「## 用户确认记录」含**独立**的「界面与交互期望」确认行（或明确「接受组件库默认外观」/「无 UI 不适用」）；**技术选型/组件库确认行不算** | `mechanical-gates.md` §8.6 R33 |

## B. 成果物门禁链（按 workflow_mode）

### full / feature / greenfield

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| B1 | `requirement-spec.md`、`requirement-list.md` 存在且有效 | `gate-chain.md` |
| B2 | `detail-design-spec.md`、`develop-task-list.md` 存在 | `gate-chain.md` |
| B3 | 技术选型经用户确认（`## 用户确认记录` 含技术选型/技术栈确认行，R18 机读） | `gate-chain.md` 无效成果物 |
| B4 | `design-problem-list.md` 设计审核已通过（R18：12 维+可修复字段+P0 覆盖矩阵含验收标准+审核结论通过/复审通过） | `gate-chain.md`、R18 |
| B5 | 四件成果物在 `process.md` 中被引用（R3） | `gate-chain.md`、R3 |
| B5a | R33：`requirement-spec.md`「3.4 界面与交互期望」已按用户确认逐维填写（含非目标与 §7 追溯）；若目标点名竞品，「像什么/像到什么程度」已钉死为功能/流程/外观 | `mechanical-gates.md` §8.6 R33、requirement-spec 模板 |
| B5b | R32：`detail-design-spec.md` §4「生产启动与异常恢复」已填生产启动命令、健康检查、单实例/锁机制与异常退出恢复策略（非 dev server） | `mechanical-gates.md` §8.6 R32、detail-design-spec 模板 |

### hotfix

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| B6 | `detail-design-spec.md` 存在（R9） | `gate-chain.md` hotfix |
| B7 | E2E 适用性可解析或已豁免留痕 | R9、`mechanical-gates.md` §8.3 |
| B8 | 测试按 R11 单次通道执行 | R11 |

### docs-only

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| B9 | 无业务源码写入；仅 `docs/**/*.md` | `workflow-modes.md` |

### single-task（增量迭代档）

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| B10 | 基线 `detail-design-spec.md` 在进入开发前已存在（不是本次从零写的） | R37 |
| B11 | `## 增量范围` 四维齐全、「是否涉及」为是/否、「说明」有实质内容 | R37 |
| B12 | 增量范围声明与**实际改动**相符（抽查 git diff：声明「不涉及接口」却新增了端点属虚假声明） | R37 |
| B13 | 未涉及数据模型 / schema 变更（若实际改了 schema 但声明「否」，属严重违规） | R37 |
| B14 | 测试按单轮通道执行，且该轮 R14 接口测试 + R17 存储对账 + R32 启动冒烟齐备（**不得**照搬 hotfix R11 的跳过） | R37 |
| B15 | 增量设计由 system-architect 产出，非 PM 代写 | R2 / R37 |

## C. 项目经理编排

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| C1 | `## 当前分派计划` 含有效数据行（非占位） | `gate-chain.md` 无效成果物 |
| C2 | 开发前存在 `## 待派发角色列表` | `gate-chain.md` |
| C3 | `develop-task-list.md` 含 §3 分派方式与整体分派模式 | `gate-chain.md` |
| C4 | 角色切换经项目经理（进度表有 PM 记录） | `CLAUDE.md` §5.9、§7 |
| C5 | 并行开发线分 Agent 未合并任务包 | `CLAUDE.md` §5.11–12 |
| C6 | `## 回退计数` 与超 3 次阻塞处理 | `rollback.md` |
| C7 | `blocking: true` 时流程未偷偷推进 | `CLAUDE.md` §5.4 |
| C8 | `cancelled: true` 后无继续修改 process | R10 |

## D. 开发与质量

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| D1 | 业务代码在 DE 分派后出现，非 PM 代写 | `CLAUDE.md` §5、`gate-chain.md` |
| D2 | 每条开发线有独立 QE 记录 | `gate-chain.md`、`CLAUDE.md` §7 |
| D3 | QE 非抽样：任务包全量单元测试已运行 | `gate-chain.md` 无效成果物 |
| D4 | `quality-report` 与任务包编号对应 | `gate-chain.md` |
| D5 | R15：`lint-run.mjs` 已运行且 `.lint-result.json` 中 `gatePassed=true`（或双要素豁免留痕） | `mechanical-gates.md` §8.2 R15 |
| D6 | 质量报告含「## 编程规范（lint）执行记录」 | quality-report 模板 |
| D7 | R16：`static-scan-run.mjs` 已运行且 `.static-scan-result.json` 中 `duplication.gatePassed`/`security.gatePassed` 均为 `true`（或对应双要素豁免留痕，二者独立） | `mechanical-gates.md` §8.2 R16 |
| D8 | 质量报告含「## 静态代码质量执行记录（R16：重复代码 + 安全扫描）」 | quality-report 模板 |

## E. 测试与 E2E

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| E1 | 每批次 QE 后有批次集成测试行（非 hotfix） | `CLAUDE.md` §7、`mechanical-gates.md` §8.3 |
| E2 | `.e2e-batch-result.json` 存在且 `gatePassed=true`（非 hotfix） | `mechanical-gates.md` §8.3 |
| E3 | 全部批次完成后有最终整体集成测试 | `CLAUDE.md` §7 |
| E4 | `.e2e-final-result.json` 存在且 `gatePassed=true` | `mechanical-gates.md` §8.3 |
| E5 | P0 用例含 `[R-xxx]` 追溯标签 | `mechanical-gates.md` §8.3 |
| E6 | 未在 E2E 未通过时宣告完成 | `CLAUDE.md` §5.13、`mechanical-gates.md` §8.3 |
| E7 | hotfix：单次 final 通道满足 E3/E4 语义 | R11 |
| E8 | 批次测试报告含非空「## 接口测试报告」且至少一条真实用例数据行，或已双要素豁免 | R14、`mechanical-gates.md` §8.3 |
| E9 | 接口测试豁免留痕（若适用）：`apiTestApplicability` + 用户确认 | R14、`mechanical-gates.md` §8.2 |
| E10 | 批次测试报告含非空「## 存储对账记录」且适用分类型行/至少一条适用行/描述列/介质/其他与不适用备注/批次任务包覆盖机读通过，或已双要素豁免 | R17、`mechanical-gates.md` §8.3 |
| E11 | 存储对账豁免留痕（若适用）：`storageReconciliationApplicability` + 用户确认 | R17、`mechanical-gates.md` §8.2 |
| E12 | R32：`.startup-smoke-result.json` 存在且 `gatePassed=true`，含 `restartAfterKill.passed=true`（强杀后再启动段），`capturedAt` 未超新鲜度上限；**批次与最终两级（含 hotfix 折叠通道）** | R32、`mechanical-gates.md` §8.6 |
| E13 | R32：测试报告含「## 生产启动冒烟」章节，逐段记录启动命令/命令来源/健康检查/结果；启动命令与 design §4 声明一致 | R32、test-report 模板 |
| E14 | R32/R22：无「已知生产启动失败却标非阻塞收尾」，无用替代启动命令（`E2E_WEB_SERVER_COMMAND` / `vite-node`）保绿；启动冒烟豁免留痕（若适用）：`startupSmokeApplicability` + 用户确认，且**不是**用于掩盖「暂时起不来」 | R32、R22、`rollback.md` |

## F. 顶层代理与 Hook（证据：日志、git、对话）

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| F1 | 无顶层代写受门禁路径 | R5、`CLAUDE.md` §5.1 |
| F2 | 无越级发起 Agent | R8、R13 |
| F3 | 无 Hook 拒绝后换工具绕过 | `CLAUDE.md` §5.16 |
| F4 | 工具链安装经用户确认与批准标记 | `CLAUDE.md` §5.17 |
| F5 | Agent 未附加 `model` 覆盖 | `CLAUDE.md` §5.3 |
| F6 | **R34 执行证明**：五项机读产物的 `execProof.nonce` 非空、`reason` 未标 `no-issued-nonce`；无手工编辑 `test-results/**` 的痕迹（抽查 `execProof.signedAt` 与 `executedAt`/`capturedAt` 是否同批、是否存在「产物比运行器最后一次执行更新」的时间倒挂） | R34、§8.7 边界 2 |
| F7 | **R34 反向抽查**：若某轮门禁曾报 `exec-proof-*`，后续是**重跑运行器**解决的，而非改了产物或关掉 `execProof.enforce`（后者只能由用户改，须有对话证据） | R34、R12 |
| F8 | **R35 阻塞证据**：每次 `blocking: true` 都有实质「## 阻塞原因」+「## 用户确认记录」阻塞决策留痕（或来自 Hook 的 `## 门禁异常事件`）；抽查该留痕行与**实际对话**是否对得上——机读只能证明写了，不能证明问了 | R35、§8.7 边界 1/4 |
| F9 | **R36 判定期异常**：`## 门禁异常事件` 的「待处理」行都已真正修复（不是靠 `gateException.onJudgmentError: "allow"` 绕过）；若确实改了该配置，须为**用户本人**所改且有对话证据 | R36、R29 |
| F10 | **R38 工具不可用**：产物曾标 `toolUnavailable` 时，处置路径是「PM 标 blocking + AskUserQuestion 请用户决策」，**不是**回派 DE 整改不存在的缺陷、也不是编造违规项来「解释」失败 | R38 |

## G. 文档与规约一致性

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| G1 | `CLAUDE.md` 与 `README.md` E2E/测试表述与 `mechanical-gates.md` §8.3 一致 | TG-D-4 |
| G2 | agent 文件 `model` slug 为系统可用模型（未回退至父 agent 模型） | `CLAUDE.md` §1 |
| G3 | Hook 行为与 `mechanical-gates.md` §8.1 表一致（可对照 gate-scenarios） | `mechanical-gates.md` §8.1 |
| G4 | 文档声明强于实现时，实现已补齐（非削文档） | R12 |

## H. 复盘元数据

记录：

- 复盘人/对话 id（可选）
- 证据缺口（无法验证的项及原因）
- 执行偏差 vs 规约缺口 数量统计
