/**
 * Vitest 配置：仅跑 `.cursor/scripts` 下的 `*.test.ts`（见下方 include；当前覆盖
 * e2e-run-lib 与 startup-smoke-lib 纯函数单测）。
 *
 * 注意：本注释内不得出现 glob 的双星加斜杠写法——`*` 紧跟 `/` 会提前闭合块注释，
 * 导致整份配置解析失败（历史版本即因此使 vitest 无法加载配置，属文档-实现落差）。
 *
 * 门禁 Hook 回归请用：
 *   node .cursor/scripts/gate-selftest.mjs
 *   node .cursor/scripts/gate-scenarios.mjs
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['.cursor/scripts/**/*.test.ts'],
    environment: 'node',
  },
});
