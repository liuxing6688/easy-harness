#!/usr/bin/env node
/**
 * 静态代码质量门禁运行器（R16：重复代码 DRY + 安全静态扫描）。
 *
 * 职责：解析 dupCheck / securityScan 命令 → 依次执行 → 落盘汇总机读产物。
 * 判据与产物唯一权威：`.claude/harness/spec/mechanical-gates.md` §8.2（R16）。
 * 纯函数判据见 `./static-scan-run-lib.mjs`；Hook 侧读取见 `readStaticScanResult()`。
 *
 * 命令解析优先级：`harness.config.json` → `qe.commands.dupCheck` / `securityScan`
 * 覆盖 > 框架默认（jscpd-rs / gitleaks-secret-scanner，经 npx）。跨技术栈通用，
 * 不做 per-stack 探测（本框架要求 Node.js >= 18）。
 *
 * 产物：`test-results/qe/.static-scan-result.json`（含 **R34** `execProof` 执行证明）
 *   gatePassed = duplication.gatePassed && security.gatePassed
 *   **R38**：任一子项因工具不可用失败时 `toolUnavailable: true` 上浮（离线/代理环境下
 *   `npx --yes` 拉不到 jscpd-rs / gitleaks 与「真有重复代码」不再是同一个失败）。
 * 消费方：`gate-stop-workflow` / `gate-role-sequence`。
 * 反弱化：禁止擅自提高 jscpd 阈值或扩大 ignore（见 mechanical-gates.md R16）。
 *
 * 用法：
 *   node .claude/scripts/static-scan-run.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  resolveDupCommand,
  resolveSecurityCommand,
  computeSubGate,
  computeStaticScanGate,
  parseDupThreshold,
  extractDupPercentage,
  evaluateDuplicationReport,
} from './static-scan-run-lib.mjs';
import { attachExecutionProof, warnIfUnsigned } from '../hooks/lib/execproof.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const HARNESS_CONFIG = path.join(PROJECT_ROOT, '.claude/harness.config.json');
const RESULT_DIR = path.join(PROJECT_ROOT, 'test-results/qe');
const RESULT_FILE = path.join(RESULT_DIR, '.static-scan-result.json');

/** 读取 harness.config.json → qe.commands[key]；缺失返回 undefined（走默认命令）。 */
function loadOverride(key) {
  if (!fs.existsSync(HARNESS_CONFIG)) return undefined;
  try {
    const config = JSON.parse(fs.readFileSync(HARNESS_CONFIG, 'utf8'));
    const value = config.qe?.commands?.[key];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** 截断过长输出，避免机读产物膨胀。 */
function truncate(text, max = 4000) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
}

/**
 * 在项目根执行扫描命令，捕获退出码与输出（不抛出）。
 * @returns {{ exitCode: number, output: string }}
 */
function runCommand(command) {
  try {
    const stdout = execSync(command, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: truncate(stdout) };
  } catch (err) {
    return {
      exitCode: typeof err.status === 'number' ? err.status : 1,
      output: truncate(`${err.stdout ?? ''}\n${err.stderr ?? ''}`),
    };
  }
}

/**
 * 解析命令 → 执行（或无命令）→ 合并子门禁判定字段。
 * @param {(p: { override?: string|null }) => string|null} resolveCommand
 * @param {string} overrideKey harness.config.json 中的 commands 键名
 */
function runCheck(resolveCommand, overrideKey) {
  const override = loadOverride(overrideKey);
  const command = resolveCommand({ override });
  if (!command) {
    return { command: null, exitCode: null, output: '', ...computeSubGate({ command: null, exitCode: null }) };
  }
  const run = runCommand(command);
  return {
    command,
    exitCode: run.exitCode,
    output: run.output,
    ...computeSubGate({ command, exitCode: run.exitCode, output: run.output }),
  };
}

/**
 * 读取 jscpd JSON 报告（`--output` 目录下的 `jscpd-report.json`，兼容几种常见文件名）。
 * 读不到返回 `null`，由 `evaluateDuplicationReport` 判为 `dup-report-unreadable`。
 * @returns {any|null}
 */
function readDupReport() {
  const candidates = [
    path.join(PROJECT_ROOT, 'test-results/qe/.jscpd/jscpd-report.json'),
    path.join(PROJECT_ROOT, 'test-results/qe/.jscpd/report.json'),
    path.join(PROJECT_ROOT, 'test-results/qe/.jscpd/jscpd-report.json.json'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 在退出码判据之上叠加报告判据（**F-13**）：只有「退出码 0」**且**「报告重复率 < 阈值」
 * 才算通过。工具不可用（R38）保持原出口，不被报告判据覆盖——那是环境问题而非重复率问题。
 * @param {{ gatePassed: boolean, reason: string, toolUnavailable?: boolean, command: string|null }} sub
 * @returns {object}
 */
function applyDupReportGate(sub) {
  if (!sub.command || sub.toolUnavailable === true) return sub;
  const threshold = parseDupThreshold(sub.command);
  const report = evaluateDuplicationReport({
    percentage: extractDupPercentage(readDupReport()),
    threshold,
  });
  return {
    ...sub,
    reportPercentage: report.percentage,
    reportThreshold: report.threshold,
    gatePassed: sub.gatePassed === true && report.ok === true,
    reason: sub.gatePassed !== true ? sub.reason : report.ok ? 'passed' : report.reason,
  };
}

/** 落盘 `.static-scan-result.json`（含 gatePassed 与两项子结果）。 */
function writeResult(result) {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.writeFileSync(RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

function main() {
  const duplication = applyDupReportGate(runCheck(resolveDupCommand, 'dupCheck'));
  const security = runCheck(resolveSecurityCommand, 'securityScan');

  const gate = computeStaticScanGate({ duplication, security });
  const result = {
    ...gate,
    duplication,
    security,
    executedAt: new Date().toISOString(),
  };

  // R34：落签须在写盘之前，且签名覆盖两项子结果的 gatePassed。
  attachExecutionProof('static-scan', result);
  writeResult(result);
  warnIfUnsigned(result); // F-03：未落签时给出与 stop 门禁一致的排查方向
  // 控制台省略子结果 output；完整输出已在产物文件中。
  console.log(
    JSON.stringify(
      {
        ...result,
        duplication: { ...result.duplication, output: undefined },
        security: { ...result.security, output: undefined },
      },
      null,
      2,
    ),
  );
  process.exit(result.gatePassed ? 0 : 1);
}

main();
