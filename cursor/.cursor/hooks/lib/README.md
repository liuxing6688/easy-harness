# hooks/lib — 门禁逻辑按域拆分（实现文件）

对外导入路径不变：`import { ... } from '../hooks/workflow-gate-lib.mjs'`。

| 编辑此文件 | 维护关注点 |
| ---- | ---------- |
| `core.mjs` | 路径常量、stdin/allow/deny、process.md、配置、Markdown 表解析、R20、`normalizePath`、阻塞/分派计划基础判定、R30 读盘编码 |
| `paths.mjs` | R10 取消冻结、源码/Shell/工具链路径门禁、`assertDevGateOrDeny`、`isE2eTestPath`、R28 Shell 写意图、R29 自治资产 |
| `identity.mjs` | R5 顶层会话 id（TTL 自愈）、最近派发角色落盘、身份健康度告警 |
| `role-path.mjs` | 角色 ↔ 成果物路径权限、进度统计（B1）；非 DE 最近派发拒写产品源码；e2e 期望 TE |
| `iteration.mjs` | R3/R9/R19 迭代与需求就绪、E2E/lint/scan 机读结果读取 |
| `design.mjs` | R18 设计审核/覆盖矩阵、**R25 同构模块识别章节**、热修 P0、fail-open、R31 回退计数 |
| `qe.mjs` | R14–R17 接口/对账、R15–R16 lint/扫描豁免、R22 TE 冒烟 |
| `dispatch.mjs` | R13 角色派发、`parseWorkflowState`（stop 状态机） |
| `all.mjs` | 兼容再导出（勿在此写逻辑） |

新增判据：放到对应域文件并确保 `workflow-gate-lib.mjs` 已 `export *` 该域（通常已覆盖）。

回归：`node .cursor/scripts/gate-selftest.mjs` 与 `node .cursor/scripts/gate-scenarios.mjs`。

Hook 入口脚本（`../gate-*.mjs`）只编排判定顺序并输出 Cursor Hook JSON；业务判据一律落在本目录。
