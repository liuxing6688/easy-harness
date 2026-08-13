import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 配置（E2E 机械门禁的运行时依赖）。
 *
 * **归属**：本文件在项目根，属**受门禁产品源码**（`gatedPaths.testConfigs` 明列），
 * 期望角色为 **development-engineer**；test-engineer 写它会被 R5/R21 直接 deny
 * （TE 只写 `e2e/**` 下的用例与 helpers）。需要改端口 / `webServer` 启动命令 /
 * 挂载自建 fixture 时，须由 PM 回派 DE。
 *
 * **三条硬约束**（说明权威：`.claude/harness/spec/mechanical-gates.md` §8.3
 * 「Playwright 配置约束」；执行权威：`.claude/scripts/e2e-run.mjs`）：
 *   1. `outputDir` **不得**是门禁产物目录 `test-results/qe`、`test-results/e2e`、
 *      `test-results/recon` 的祖先或自身（`test-results/` 与仓库根都在此列）——Playwright
 *      每次运行前**清空** `outputDir`，指向 `test-results/` 会连带删掉 `.lint-result.json`（R15）、
 *      `.static-scan-result.json`（R16）、`.startup-smoke-result.json`（R32）、
 *      `recon/*.json`（R17）与上一轮 `.e2e-batch-result.json`，造成「跑一次 E2E 就得重跑
 *      整套 QE」以及批次↔最终 ping-pong 死锁。故固定用同级隔离目录 `test-results/pw-artifacts/`。
 *      **本条由机械层强制**：`e2e-run.mjs` 在跑 Playwright 之前自检（`checkPlaywrightOutputDir`），
 *      违规——**含整个删掉这一行**（默认值正是 `test-results/`）——直接判 `gatePassed=false` 退出。
 *   2. JSON reporter 输出固定为 `test-results/e2e/pw-report.json`——`e2e-run.mjs` 按此硬编码
 *      路径解析门禁结论，改名即判为「报告未生成」。
 *   3. 仅声明 `chromium` project（浏览器范围是机械门禁唯一允许简化的维度）。
 *
 * 以下 `webServer` 与端口为**示例值**（Node 项目）：接入其他技术栈时由 DE 按项目实际的
 * 构建/启动命令修改，或用 `E2E_WEB_SERVER_COMMAND` / `E2E_BASE_URL` 环境变量覆盖；
 * 产品自身需要的运行期环境变量（数据目录、临时库连接等）加在 `webServer.env`。
 */
const PORT = Number(process.env.PORT ?? 3210);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e/specs',
  // 约束 1：outputDir 每次运行前被 Playwright 清空，故必须与机读门禁产物目录
  // test-results/qe、test-results/e2e 隔离（见文件头说明）。
  outputDir: 'test-results/pw-artifacts/',
  fullyParallel: false,
  workers: 1,
  // 约束 2：文件名固定为 pw-report.json，e2e-run.mjs 按此硬编码路径解析门禁结论。
  reporter: [['json', { outputFile: 'test-results/e2e/pw-report.json' }], ['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: process.env.E2E_WEB_SERVER_COMMAND ?? `node src/server.js`,
    url: BASE_URL,
    reuseExistingServer: false,
    env: {
      ...process.env,
      PORT: String(PORT),
      TODO_DATA_DIR: 'test-results/e2e/data',
      // 本机代理会劫持 webServer.url 的就绪探测：Playwright 把 http://127.0.0.1:<port>
      // 的探测请求发给 HTTP_PROXY（如 127.0.0.1:7890），代理返回非预期响应后 Playwright
      // 判为「端口已被占用」，在 reuseExistingServer:false 下直接失败——**零条用例执行**，
      // 而端口其实空闲。此时产物会出现 allPassed:true 与 playwrightExitCode:1 并存，
      // 门禁只能看到「覆盖率不达标」，把环境故障误导成「TE 用例写少了」（R38 要避免的错误指引）。
      // 故显式绕过本地回环，勿删。
      NO_PROXY: process.env.NO_PROXY ?? '127.0.0.1,localhost,::1',
      no_proxy: process.env.no_proxy ?? '127.0.0.1,localhost,::1',
    },
  },
});
