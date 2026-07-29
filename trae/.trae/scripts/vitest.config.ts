/**
 * Vitest 配置：仅跑 `.trae/scripts/**/*.test.ts`（当前为 e2e-run-lib 纯函数单测）。
 * 门禁 Hook 回归请用：
 *   node .trae/scripts/gate-selftest.mjs
 *   node .trae/scripts/gate-scenarios.mjs
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['.trae/scripts/**/*.test.ts'],
    environment: 'node',
  },
});
