#!/usr/bin/env node
/**
 * 场景级门禁回归（薄入口）。
 *
 * 覆盖：对六个 `gate-*.mjs` 注入模拟 stdin，断言 stdout 裁决（allow/deny/ask/followup）。
 * 套件按场景拆在 `tests/scenarios/*.mjs`（greenfield / feature / hotfix / lint-gate 等）；
 * 共享脚手架见 `tests/scenarios/_harness.mjs`。
 *
 * 用法：
 *   node .cursor/scripts/gate-scenarios.mjs
 *   node .cursor/scripts/gate-scenarios.mjs --verbose
 *
 * 与 `gate-selftest.mjs` 的分工：本入口测「Hook 端到端」；自检测「判据函数」。
 * 说明权威与期望行为见 `.cursor/harness/spec/mechanical-gates.md` / `gate-chain.md`。
 */
import './tests/scenarios/run-all.mjs';
