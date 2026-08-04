#!/usr/bin/env node
/**
 * 批次/最终 E2E 门禁运行器（Chromium-only）。
 *
 * 职责：跑 Playwright chromium → 解析 JSON 报告 → 按覆盖率/通过率算 gatePassed → 落盘。
 * 判据说明权威：`.codex/harness/spec/mechanical-gates.md` §8.3。
 * 纯函数判据见 `./e2e-run-lib.mjs`；Hook 侧读取见 `readE2eResult(scope)`。
 *
 * 用法：
 *   node .codex/scripts/e2e-run.mjs --scope=batch --required-ids=R-001,R-002
 *   node .codex/scripts/e2e-run.mjs --scope=final --baseline=docs/requirement/requirement-list.md
 *
 * 产物（均含 **R34** `execProof` 执行证明）：
 *   batch → test-results/e2e/.e2e-batch-result.json
 *   final → test-results/e2e/.e2e-final-result.json
 * 浏览器范围：仅 Chromium（唯一允许简化的维度；gatePassed/覆盖率不因收窄而放松）。
 * hotfix（R11）：唯一测试通道直接以 `--scope=final` 语义运行。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import {
  parseChromiumResults,
  parseRequirementP0Ids,
  parseCoverageWaivers,
  computeGateResult,
} from './e2e-run-lib.mjs';
import { classifyCommandFailure } from './tool-availability-lib.mjs';
import { attachExecutionProof } from '../hooks/lib/execproof.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const PW_JSON_REPORT = path.join(PROJECT_ROOT, 'test-results/e2e/pw-report.json');
const RESULT_DIR = path.join(PROJECT_ROOT, 'test-results/e2e');

/** 解析 `--key=value` 形式的 CLI 参数。 */
function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-zA-Z0-9_-]+)=(.*)$/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

/** 查找 coverage-waivers.json（优先 e2e/ 根，其次 e2e/specs/）。 */
function findCoverageWaiversPath() {
  const candidates = [
    path.join(PROJECT_ROOT, 'e2e/coverage-waivers.json'),
    path.join(PROJECT_ROOT, 'e2e/specs/coverage-waivers.json'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/** @returns {Set<string>} 已登记且含 reason 的豁免需求编号 */
function loadWaivedIds() {
  const p = findCoverageWaiversPath();
  if (!p) return new Set();
  try {
    return parseCoverageWaivers(fs.readFileSync(p, 'utf8'));
  } catch {
    return new Set();
  }
}

/**
 * 解析本次要求覆盖的需求编号：
 *   - batch：`--required-ids=R-001,R-002`
 *   - final：`--baseline=<requirement-list.md>` 提取全部 P0
 */
function loadRequiredIds(args) {
  if (args['required-ids']) {
    return args['required-ids']
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (args.baseline) {
    const baselinePath = path.resolve(PROJECT_ROOT, args.baseline);
    if (!fs.existsSync(baselinePath)) {
      throw new Error(`baseline 文件不存在：${baselinePath}`);
    }
    const content = fs.readFileSync(baselinePath, 'utf8');
    return parseRequirementP0Ids(content);
  }
  return [];
}

/**
 * 前置依赖自检：`playwright.config.ts` 依赖 `@playwright/test`，而本框架目录不预置
 * `package.json`（预置会在「整体复制到宿主项目」时覆盖宿主自己的清单）。
 *
 * 未安装时，`npx playwright test` 会去拉一个临时 playwright，再在加载配置文件时抛
 * `Cannot find module '@playwright/test'`——报错发生在 Playwright 内部，运行器只能
 * 记录成「JSON 报告未生成」，与「用例真的失败」无法区分，排查成本很高。
 * 故改为先自检并给出确切的缺失原因与安装命令。
 *
 * @returns {{ok: true} | {ok: false, reason: string, message: string}}
 */
function checkPlaywrightDependency() {
  const configFile = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'].find(
    (f) => fs.existsSync(path.join(PROJECT_ROOT, f)),
  );
  if (!configFile) {
    return {
      ok: false,
      reason: 'missing-playwright-config',
      message:
        '未找到 playwright.config.*（E2E 机械门禁的运行时依赖）。若为接入已有项目，请确认已按 README「快速开始 · 方式二」把 playwright.config.ts 与 e2e/ 一并复制到项目根。',
    };
  }
  try {
    // 用宿主项目根解析，兼容 monorepo/workspace 提升到上层 node_modules 的情形
    createRequire(path.join(PROJECT_ROOT, 'noop.js')).resolve('@playwright/test');
    return { ok: true };
  } catch {
    return {
      ok: false,
      reason: 'missing-playwright-dependency',
      message:
        `${configFile} 依赖 @playwright/test，但在项目根解析不到该包，Playwright 会在加载配置时崩溃且不产出 JSON 报告。` +
        '请先由 test-engineer 按「检测→询问用户→确认→安装」流程执行：npm i -D @playwright/test && npx playwright install chromium',
    };
  }
}

/**
 * 执行 Playwright chromium project；stdout inherit 便于本地排查，
 * stderr 另行捕获后原样转发——**R38** 需要它来区分「浏览器/依赖不可用」与「用例失败」。
 */
function runPlaywright() {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  try {
    execSync('npx playwright test --project=chromium', {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'inherit', 'pipe'],
      encoding: 'utf8',
      env: { ...process.env },
    });
    return { exitCode: 0, output: '' };
  } catch (err) {
    const output = String(err.stderr ?? '');
    if (output) process.stderr.write(output);
    return { exitCode: typeof err.status === 'number' ? err.status : 1, output };
  }
}

/**
 * 读取 R32 生产启动冒烟产物，回显进 E2E 结果供报告与人工审查引用。
 * 只回显、不参与本运行器的 `gatePassed`——冒烟是独立门禁（判定在 Hook 侧
 * `checkStartupSmoke`），两者语义分开更便于定位失败原因。
 */
function loadStartupSmokeSummary() {
  const p = path.join(RESULT_DIR, '.startup-smoke-result.json');
  if (!fs.existsSync(p)) return { present: false };
  try {
    const r = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      present: true,
      gatePassed: r.gatePassed === true,
      reason: r.reason ?? null,
      command: r.command ?? null,
      commandSource: r.commandSource ?? null,
      capturedAt: r.capturedAt ?? null,
    };
  } catch {
    return { present: false, error: 'unparsable-startup-smoke-result' };
  }
}

/** 读取 Playwright JSON reporter 产物；缺失或解析失败返回 null。 */
function loadPlaywrightReport() {
  if (!fs.existsSync(PW_JSON_REPORT)) return null;
  try {
    return JSON.parse(fs.readFileSync(PW_JSON_REPORT, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 按 scope 落盘 `.e2e-batch-result.json` 或 `.e2e-final-result.json`。
 * **R34**：落签在写盘之前，签名覆盖除 `execProof` 外的全部字段。
 */
function writeResult(scope, result) {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const file = scope === 'final' ? '.e2e-final-result.json' : '.e2e-batch-result.json';
  attachExecutionProof(scope === 'final' ? 'e2e-final' : 'e2e-batch', result);
  fs.writeFileSync(path.join(RESULT_DIR, file), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scope = args.scope === 'final' ? 'final' : 'batch';

  const requiredIds = loadRequiredIds(args);
  const waivedIds = loadWaivedIds();

  // 依赖缺失属环境问题而非用例失败：直接给出确切原因，不跑一遍再报「报告缺失」。
  const preflight = checkPlaywrightDependency();
  if (!preflight.ok) {
    const failResult = {
      scope,
      gatePassed: false,
      allPassed: false,
      coverageComplete: false,
      missingIds: requiredIds,
      unexplainedSkips: [],
      coveredIds: [],
      requiredIds,
      playwrightExitCode: null,
      reason: preflight.reason,
      error: preflight.message,
      // R38：配置/依赖缺失属工具不可用，门禁据此走「环境问题」而非「用例失败」文案。
      toolUnavailable: true,
      toolUnavailableCategory: 'dependency-fetch',
      toolUnavailableDetail: preflight.reason,
      executedAt: new Date().toISOString(),
    };
    writeResult(scope, failResult);
    console.error(JSON.stringify(failResult, null, 2));
    process.exit(1);
  }

  const { exitCode, output } = runPlaywright();
  const report = loadPlaywrightReport();

  // 无 JSON 报告则无法机读覆盖率——直接 fail（不得静默放过）。
  if (!report) {
    // R38：区分「浏览器二进制/依赖拉不下来」与「用例真的跑挂了」。
    const availability = classifyCommandFailure({ exitCode, output });
    const failResult = {
      scope,
      gatePassed: false,
      allPassed: false,
      coverageComplete: false,
      missingIds: requiredIds,
      unexplainedSkips: [],
      coveredIds: [],
      requiredIds,
      playwrightExitCode: exitCode,
      error: 'Playwright JSON 报告未生成（test-results/e2e/pw-report.json 缺失），无法判定门禁。',
      toolUnavailable: availability.toolUnavailable,
      toolUnavailableCategory: availability.category,
      toolUnavailableDetail: availability.detail,
      executedAt: new Date().toISOString(),
    };
    writeResult(scope, failResult);
    console.error(JSON.stringify(failResult, null, 2));
    process.exit(1);
  }

  const chromiumResults = parseChromiumResults(report);
  const gate = computeGateResult(chromiumResults, requiredIds, waivedIds);

  const finalResult = {
    scope,
    ...gate,
    requiredIds,
    waivedIds: [...waivedIds],
    playwrightExitCode: exitCode,
    startupSmoke: loadStartupSmokeSummary(),
    executedAt: new Date().toISOString(),
  };

  writeResult(scope, finalResult);
  console.log(JSON.stringify(finalResult, null, 2));
  process.exit(finalResult.gatePassed ? 0 : 1);
}

main();
