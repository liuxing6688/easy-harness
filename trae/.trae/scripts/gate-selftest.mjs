#!/usr/bin/env node
/**
 * 门禁逻辑回归自检（薄入口）。
 * 用例按规则拆在 tests/selftest/*.mjs；共享脚手架 _harness.mjs；共享 fixture _fixtures.mjs。
 * 用法：node .trae/scripts/gate-selftest.mjs
 */
import './tests/selftest/run-all.mjs';
