#!/usr/bin/env node
/**
 * 生产启动冒烟门禁运行器（**R32**）。
 *
 * 职责：解析设计声明的生产启动命令 → ①干净启动 ②强杀后再启动 → 落盘机读产物。
 * 判据与产物说明权威：`.trae/harness/spec/mechanical-gates.md` §8.6。
 * 纯函数判据见 `./startup-smoke-lib.mjs`；Hook 侧读取见 `workflow-gate-lib` → `readStartupSmokeResult()`。
 *
 * 为什么要两段（2026-07-29 启动报错复盘）：
 *   - 干净启动抓「构建产物起不来」（如 ESM/CJS 互操作、缺依赖、配置解析失败）；
 *   - 强杀后再启动抓「第二次才炸」（陈旧数据目录锁、PID 文件残留、端口未释放）——
 *     该类缺陷在一次性启动验证下必然漏网，只能在用户现场暴露。
 *
 * 命令解析优先级：`harness.config.json → te.startupSmoke.command`
 *   > `gated-artifacts.json → productionStartupCommand` > `package.json → scripts.start`。
 * 解析不到时 `gatePassed=false`（reason=`no-startup-command`）：须由 system-architect 声明，
 * 或走 `startupSmokeApplicability:"n/a"` 双要素豁免，**不得**静默跳过（R12）。
 *
 * 用法：
 *   node .trae/scripts/startup-smoke-run.mjs
 *
 * 产物：`test-results/e2e/.startup-smoke-result.json`（`gatePassed` + **R34** `execProof`）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { loadGatedArtifacts, readJsonFileSafe } from '../hooks/lib/core.mjs';
import {
  DEFAULT_MAX_AGE_HOURS,
  DEFAULT_READY_TIMEOUT_MS,
  DEFAULT_RESTART_DELAY_MS,
  DEFAULT_STABILIZE_MS,
  computeStartupSmokeGate,
  resolveStartupCommand,
} from './startup-smoke-lib.mjs';
import { classifyCommandFailure } from './tool-availability-lib.mjs';
import { attachExecutionProof } from '../hooks/lib/execproof.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const HARNESS_CONFIG = path.join(PROJECT_ROOT, '.trae/harness.config.json');
const RESULT_DIR = path.join(PROJECT_ROOT, 'test-results/e2e');
const RESULT_FILE = path.join(RESULT_DIR, '.startup-smoke-result.json');

const IS_WINDOWS = process.platform === 'win32';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 读取 `harness.config.json → te.startupSmoke`；缺失/非法返回空对象 */
function loadStartupSmokeConfig() {
  const config = readJsonFileSafe(HARNESS_CONFIG);
  const section = config?.te?.startupSmoke;
  return section && typeof section === 'object' ? section : {};
}

function loadPackageScripts() {
  const pkg = readJsonFileSafe(path.join(PROJECT_ROOT, 'package.json'));
  return pkg?.scripts ?? null;
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 保留输出尾部，避免机读产物膨胀 */
function tail(text, max = 2000) {
  if (!text) return '';
  return text.length > max ? `…(truncated)\n${text.slice(-max)}` : text;
}

/**
 * 强杀进程树。POSIX 下 `detached: true` 使子进程自成进程组，可用负 pid 连带杀掉
 * shell 派生的实际服务进程；Windows 用 `taskkill /T /F`。
 */
function hardKill(child) {
  if (!child?.pid) return;
  if (IS_WINDOWS) {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      return;
    } catch {
      /* 进程可能已自行退出 */
    }
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
    return;
  } catch {
    /* 进程组不存在时退回单进程 */
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* 已退出 */
  }
}

function waitForExit(child, timeoutMs = 10000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** 任一 HTTP 响应（状态码 < 500）即视为服务已就绪并能处理请求 */
async function probeHealth(url, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'manual' });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 执行一段启动观察：拉起命令 →（可选）健康检查轮询 → 稳定期内不得退出。
 * @returns {Promise<{ child: object, phase: object }>} child 供调用方后续强杀
 */
async function runStartupPhase(command, { healthUrl, stabilizeMs, readyTimeoutMs }) {
  const child = spawn(command, {
    cwd: PROJECT_ROOT,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !IS_WINDOWS,
    env: { ...process.env },
  });

  const observed = { exited: false, exitCode: null, signal: null, output: '', launchError: null };
  const append = (chunk) => {
    observed.output = tail(observed.output + chunk.toString(), 8000);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.on('error', (err) => {
    observed.exited = true;
    observed.exitCode = observed.exitCode ?? -1;
    // **R38**：进程没被拉起来（spawn 失败）与「进程起来了自己报错」是两类事，
    // 故单独留一份 launchError，不只是拼进输出——分类器对二者口径不同。
    observed.launchError = String(err?.message ?? err);
    append(`\n[spawn error] ${err?.message ?? err}\n`);
  });
  child.on('exit', (code, signal) => {
    observed.exited = true;
    observed.exitCode = code;
    observed.signal = signal ?? null;
  });

  const startedAt = Date.now();
  let healthOk = null;
  if (healthUrl) {
    healthOk = false;
    while (Date.now() - startedAt < readyTimeoutMs && !observed.exited) {
      if (await probeHealth(healthUrl)) {
        healthOk = true;
        break;
      }
      await sleep(500);
    }
  }

  // 稳定期内轮询而非一次性 sleep：进程提前退出时立即结束本段（启动失败是本门禁的常见路径，
  // 让它快速失败而不是每次都干等满 stabilizeMs）。
  while (!observed.exited && Date.now() - startedAt < stabilizeMs) {
    await sleep(200);
  }

  const passed = !observed.exited && (healthUrl ? healthOk === true : true);
  return {
    child,
    phase: {
      passed,
      exited: observed.exited,
      exitCode: observed.exitCode,
      signal: observed.signal,
      healthOk,
      elapsedMs: Date.now() - startedAt,
      outputTail: tail(observed.output),
      launchError: observed.launchError,
    },
  };
}

/**
 * **R38**（本门禁刻意收窄）：只有 shell 报「启动命令本身不存在」才算工具不可用。
 *
 * R32 的立场是「应用起不来属**产品缺陷**，须回派 DE，不得据此豁免」，因此网络失败、
 * 依赖拉取失败、端口占用、配置解析崩溃等一概**不**归入工具不可用——它们恰恰是本门禁
 * 要抓的东西。唯一例外是解释器/包管理器压根没装（如机器上没有 `npm`），
 * 那不是产品的问题，报成产品缺陷只会把人指向错误的修复方向。
 *
 * 2026-07-30 复核修正：收窄到 `command-not-found` 这一步本身是对的，但那个类别当时
 * 含 `ENOENT`，且对**应用自己的输出**生效——于是「应用读不到 `config/production.json`」
 * 这类最典型的启动缺陷被叙述成环境问题，方向完全反了。现 `ENOENT` 只在 `launchError`
 * （进程没被拉起来）时才算数，故此处把 spawn 错误单独传下去，不再依赖输出文本。
 */
function classifyStartupToolAvailability(gate, cleanStart) {
  if (gate?.gatePassed === true || !cleanStart) return { toolUnavailable: false };
  const verdict = classifyCommandFailure({
    exitCode: cleanStart.exitCode ?? null,
    output: cleanStart.outputTail ?? '',
    launchError: cleanStart.launchError ?? null,
  });
  if (!verdict.toolUnavailable || verdict.category !== 'command-not-found') {
    return { toolUnavailable: false };
  }
  return {
    reason: 'startup-tool-unavailable',
    toolUnavailable: true,
    toolUnavailableCategory: verdict.category,
    toolUnavailableDetail: verdict.detail,
  };
}

function writeResult(result) {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  // R34：落签须在写盘之前，签名覆盖 gatePassed / 两段结果 / capturedAt。
  attachExecutionProof('startup-smoke', result);
  fs.writeFileSync(RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function main() {
  const smokeConfig = loadStartupSmokeConfig();
  const gated = loadGatedArtifacts();
  const resolved = resolveStartupCommand({
    override: smokeConfig.command ?? null,
    declared: gated.productionStartupCommand ?? null,
    packageScripts: loadPackageScripts(),
  });

  const healthUrl = smokeConfig.healthUrl ?? gated.productionStartupHealthUrl ?? null;
  const stabilizeMs = positiveNumber(smokeConfig.stabilizeMs, DEFAULT_STABILIZE_MS);
  const readyTimeoutMs = positiveNumber(smokeConfig.readyTimeoutMs, DEFAULT_READY_TIMEOUT_MS);
  const restartDelayMs = positiveNumber(smokeConfig.restartDelayMs, DEFAULT_RESTART_DELAY_MS);

  let cleanStart = null;
  let restartAfterKill = null;

  if (resolved) {
    const phaseOptions = { healthUrl, stabilizeMs, readyTimeoutMs };

    const first = await runStartupPhase(resolved.command, phaseOptions);
    cleanStart = first.phase;
    // 无论第一段是否通过都强杀：既清理端口，又构造第二段所需的「异常退出」现场。
    hardKill(first.child);
    await waitForExit(first.child);
    await sleep(restartDelayMs);

    if (cleanStart.passed) {
      const second = await runStartupPhase(resolved.command, phaseOptions);
      restartAfterKill = second.phase;
      hardKill(second.child);
      await waitForExit(second.child);
    } else {
      restartAfterKill = { passed: false, skipped: true, reason: 'clean-start-failed' };
    }
  }

  const gate = computeStartupSmokeGate({
    command: resolved?.command ?? null,
    cleanStart,
    restartAfterKill,
  });

  const result = {
    ...gate,
    ...classifyStartupToolAvailability(gate, cleanStart),
    command: resolved?.command ?? null,
    commandSource: resolved?.source ?? null,
    healthUrl,
    stabilizeMs,
    killSignal: IS_WINDOWS ? 'taskkill /T /F' : 'SIGKILL',
    cleanStart,
    restartAfterKill,
    maxAgeHours: positiveNumber(smokeConfig.maxAgeHours, DEFAULT_MAX_AGE_HOURS),
    capturedAt: new Date().toISOString(),
  };

  writeResult(result);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.gatePassed ? 0 : 1);
}

main();
