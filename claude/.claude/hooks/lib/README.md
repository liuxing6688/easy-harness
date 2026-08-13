# hooks/lib — 门禁逻辑按域拆分（实现文件）

**Claude Code 适配版本** - 从 cursor/.cursor/hooks/lib 移植

对外导入路径不变：`import { ... } from '../hooks/workflow-gate-lib.mjs'`。

| 编辑此文件 | 维护关注点 |
| ---- | ---------- |
| `core.mjs` | 路径常量、stdin/allow/deny、process.md、配置、Markdown 表解析、R20、`normalizePath`、阻塞/分派计划基础判定、R30 读盘编码、**R35 阻塞释放证据与门禁异常旁路台账**、**R36 判定期异常裁决** |
| `execproof.mjs` | **R34 证据产物执行证明**：nonce 签发（Hook 侧）、落签（运行器侧）、验签与**新鲜度**（门禁侧）。刻意不在模块顶层引用 `core.mjs` 的常量——依赖链 `core → role-path → paths → iteration → execproof` 会使其落进 TDZ（函数体内运行期引用无此问题） |
| `paths.mjs` | R10 取消冻结、源码/Shell/工具链路径门禁、`assertDevGateOrDeny`、`isE2eTestPath`、R28 Shell 写意图、R29 自治资产（含 **R34** 台账与私钥交接目录、**R35** 异常台账）、**R36 修复通道作用域**（`resolveGateRepairPaths`） |
| `identity.mjs` | R5 顶层会话 id（TTL 自愈）、最近派发角色落盘、身份健康度告警 |
| `role-path.mjs` | 角色 ↔ 成果物路径权限、进度统计（B1）；非 DE 最近派发拒写产品源码；e2e 期望 TE |
| `iteration.mjs` | R3/R9/R19 迭代与需求就绪、**R33 界面与交互期望确认**、E2E/lint/scan/**R32 启动冒烟**机读结果读取、**R37 增量范围与增量档前置**、`evaluateGateArtifact`（**R34** 验签 + **R38** 工具不可用的统一判据外壳） |
| `design.mjs` | R18 设计审核/覆盖矩阵、**R25 同构模块识别章节**、热修 P0、fail-open 落盘、R31 回退计数 |
| `qe.mjs` | R14–R17 接口/对账、R15–R16 lint/扫描豁免、R22 TE 替代启动拦截、**R32 生产启动冒烟正向证据**、`checkE2eGate` |
| `dispatch.mjs` | R13 角色派发、`parseWorkflowState`（stop 状态机；含 **R37** `foldedTestChannel` 与 R34/R38 失败清单汇总） |
| `all.mjs` | 兼容再导出（勿在此写逻辑） |

新增判据：放到对应域文件并确保 `workflow-gate-lib.mjs` 已 `export *` 该域（通常已覆盖）。

回归：`node .claude/scripts/gate-selftest.mjs` 与 `node .claude/scripts/gate-scenarios.mjs`。

Hook 入口脚本（`../gate-*.mjs`）只编排判定顺序并输出 Cursor Hook JSON；业务判据一律落在本目录。
包括 **R36** 的判定期异常裁决——入口脚本只负责调用 `buildGateExceptionVerdict` 并输出结果，
五处文案不得各写一份（历史上四份近似 deny 文案已合并到 `core.mjs`）。
