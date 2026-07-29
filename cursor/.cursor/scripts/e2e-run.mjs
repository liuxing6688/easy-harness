#!/usr/bin/env node
/**
 * 批次/最终 E2E 门禁运行器（Chromium-only）。
 *
 * 职责：跑 Playwright chromium → 解析 JSON 报告 → 按覆盖率/通过率算 gatePassed → 落盘。
 * 判据说明权威：`.cursor/harness/spec/mechanical-gates.md` §8.3。
 * 纯函数判据见 `./e2e-run-lib.mjs`；Hook 侧读取见 `readE2eResult(scope)`。
 *
 * 用法：
 *   node .cursor/scripts/e2e-run.mjs --scope=batch --required-ids=R-001,R-002
 *   node .cursor/scripts/e2e-run.mjs --scope=final --baseline=docs/requirement/requirement-list.md
 *
 * 产物：
 *   batch → test-results/e2e/.e2e-batch-result.json
 *   final → test-results/e2e/.e2e-final-result.json
 * 浏览器范围：仅 Chromium（唯一允许简化的维度；gatePassed/覆盖率不因收窄而放松）。
 * hotfix（R11）：唯一测试通道直接以 `--scope=final` 语义运行。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  parseChromiumResults,
  parseRequirementP0Ids,
  parseCoverageWaivers,
  computeGateResult,
} from './e2e-run-lib.mjs';

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

/** 执行 Playwright chromium project；stdio inherit 便于本地排查。 */
function runPlaywright() {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  try {
    execSync('npx playwright test --project=chromium', {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      env: { ...process.env },
    });
    return { exitCode: 0 };
  } catch (err) {
    return { exitCode: err.status ?? 1 };
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

/** 按 scope 落盘 `.e2e-batch-result.json` 或 `.e2e-final-result.json`。 */
function writeResult(scope, result) {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const file = scope === 'final' ? '.e2e-final-result.json' : '.e2e-batch-result.json';
  fs.writeFileSync(path.join(RESULT_DIR, file), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scope = args.scope === 'final' ? 'final' : 'batch';

  const requiredIds = loadRequiredIds(args);
  const waivedIds = loadWaivedIds();

  const { exitCode } = runPlaywright();
  const report = loadPlaywrightReport();

  // 无 JSON 报告则无法机读覆盖率——直接 fail（不得静默放过）。
  if (!report) {
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
    executedAt: new Date().toISOString(),
  };

  writeResult(scope, finalResult);
  console.log(JSON.stringify(finalResult, null, 2));
  process.exit(finalResult.gatePassed ? 0 : 1);
}

main();
