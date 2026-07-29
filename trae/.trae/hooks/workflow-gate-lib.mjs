/**
 * 流程门禁共享逻辑 — 对外稳定入口（薄 barrel）。
 *
 * 用途：六个 `gate-*.mjs` Hook 与回归脚本通过本文件 `import` 全部判据函数；
 * 实现已按域拆到 `./lib/*.mjs`，**请勿在本文件写逻辑**。
 *
 * 维护指引：
 *   - 新增/修改判据 → 编辑对应域文件（见 `./lib/README.md` 对照表）；
 *   - 新增域文件后须在此 `export *`，并同步更新 `./lib/all.mjs`（兼容再导出）；
 *   - 行为变更须同步 `.trae/harness/spec/mechanical-gates.md` / `gate-chain.md`（R12）；
 *   - 回归：`node .trae/scripts/gate-selftest.mjs` 与 `node .trae/scripts/gate-scenarios.mjs`。
 *
 * 域一览：
 *   core      路径常量、stdin/allow/deny、process.md、配置、Markdown、R20、normalizePath
 *   paths     R10 取消冻结、源码/Shell/工具链路径、assertDevGateOrDeny、R28/R29
 *   identity  R5 顶层会话 id、最近派发角色落盘
 *   role-path 角色↔成果物路径权限、进度统计（B1）
 *   iteration R3/R9/R19、E2E/lint/scan 机读结果读取
 *   design    R18 设计审核/覆盖矩阵、R25 同构模块、热修 P0、fail-open 留痕
 *   qe        R14–R17 / R15–R16 豁免与机读、R22 TE 冒烟
 *   dispatch  R13 角色派发、`parseWorkflowState`（供 stop 门禁）
 */
export * from './lib/core.mjs';
export * from './lib/paths.mjs';
export * from './lib/identity.mjs';
export * from './lib/role-path.mjs';
export * from './lib/iteration.mjs';
export * from './lib/design.mjs';
export * from './lib/qe.mjs';
export * from './lib/dispatch.mjs';
