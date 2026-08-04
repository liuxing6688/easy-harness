#!/usr/bin/env node
/**
 * 门禁逻辑回归自检（薄入口）。
 *
 * 覆盖：workflow-gate-lib 各域的规则级单元断言（R3/R5/R9/R10/R13–R20/R28–R31 等）。
 * 用例按规则拆在 `tests/selftest/*.mjs`；共享脚手架 `_harness.mjs`；共享 fixture `_fixtures.mjs`。
 *
 * 用法：
 *   node .codex/scripts/gate-selftest.mjs
 *
 * 与 `gate-scenarios.mjs` 的分工：本入口测「判据函数」；场景套件测「Hook 端到端 stdin/stdout」。
 * 修改 Hook 或 lib 后应先跑本脚本，再跑场景套件。
 */
import './tests/selftest/run-all.mjs';
