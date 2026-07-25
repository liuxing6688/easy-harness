#!/usr/bin/env node
/**
 * 场景级门禁回归（薄入口）。
 * 套件按场景拆在 tests/scenarios/*.mjs；共享脚手架见 tests/scenarios/_harness.mjs。
 * 用法：
 *   node .cursor/scripts/gate-scenarios.mjs
 *   node .cursor/scripts/gate-scenarios.mjs --verbose
 */
import './tests/scenarios/run-all.mjs';
