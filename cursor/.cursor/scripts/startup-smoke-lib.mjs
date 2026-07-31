/**
 * startup-smoke-run.mjs 的纯函数库：生产启动命令解析与启动冒烟门禁判据（**R32**）。
 *
 * 与 workflow-gate-lib.mjs 的运行时状态解耦（只吃入参、不读盘），便于单测覆盖；
 * 运行器入口：`./startup-smoke-run.mjs`；Hook 侧消费：`readStartupSmokeResult()` → stop / R13。
 *
 * 背景（2026-07-29 启动报错复盘）：R22 只拦「用替代启动命令掩盖生产启动失败」这一**负向**
 * 路径——测试工程师若干脆**不做**生产启动冒烟，机械层完全无感，`gatePassed` 仍可为 true。
 * 本模块提供**正向证据**：冒烟须真实执行并落盘可机读产物，门禁读产物判定。
 *
 * 冒烟含两段（缺一不可，见 mechanical-gates.md §8.6）：
 *   1. `cleanStart`        —— 干净启动：进程在稳定期内不退出（+ 可选健康检查）；
 *   2. `restartAfterKill`  —— 强杀后再启动：模拟异常退出/残留锁/端口未释放，覆盖
 *      `DATA_DIRECTORY_LOCKED` 一类「第二次才炸」的启动缺陷。
 */

/** 冒烟结果的最长有效期（小时）；超期视为陈旧，须重跑，防止一次冒烟长期复用 */
export const DEFAULT_MAX_AGE_HOURS = 24;

/** 干净启动的稳定观察期：进程须存活满该时长才算通过（毫秒） */
export const DEFAULT_STABILIZE_MS = 8000;

/** 健康检查轮询的总超时（毫秒） */
export const DEFAULT_READY_TIMEOUT_MS = 60000;

/** 强杀后到再次启动之间的等待（毫秒），给操作系统释放端口/文件句柄的时间 */
export const DEFAULT_RESTART_DELAY_MS = 1500;

/**
 * 解析本次冒烟应使用的生产启动命令。
 *
 * 优先级：`harness.config.json → te.startupSmoke.command` 覆盖 > `gated-artifacts.json`
 * 的 `productionStartupCommand`（架构师声明，与 detail-design-spec 的生产启动章节同源）
 * > `package.json` 的 `scripts.start`。三者皆无时返回 null——**不**回退到 dev/preview 等
 * 非生产脚本：猜错的启动路径比不冒烟更危险（正是复盘中 vite-node 变通的失效模式）。
 *
 * @param {{ override?: string|null, declared?: string|null, packageScripts?: object|null }} params
 * @returns {{ command: string, source: string }|null}
 */
export function resolveStartupCommand({ override = null, declared = null, packageScripts = null } = {}) {
  if (typeof override === 'string' && override.trim()) {
    return { command: override.trim(), source: 'harness.config.te.startupSmoke.command' };
  }
  if (typeof declared === 'string' && declared.trim()) {
    return { command: declared.trim(), source: 'gated-artifacts.productionStartupCommand' };
  }
  const start = packageScripts?.start;
  if (typeof start === 'string' && start.trim()) {
    return { command: 'npm run start', source: 'package.json.scripts.start' };
  }
  return null;
}

/**
 * 计算冒烟门禁判定：两段皆通过才 `gatePassed`。
 * @param {{ command: string|null, cleanStart?: object|null, restartAfterKill?: object|null }} params
 * @returns {{ gatePassed: boolean, reason: string }}
 */
export function computeStartupSmokeGate({ command, cleanStart, restartAfterKill }) {
  if (!command) {
    return { gatePassed: false, reason: 'no-startup-command' };
  }
  if (cleanStart?.passed !== true) {
    return { gatePassed: false, reason: 'clean-start-failed' };
  }
  if (restartAfterKill?.passed !== true) {
    return { gatePassed: false, reason: 'restart-after-kill-failed' };
  }
  return { gatePassed: true, reason: 'passed' };
}

/**
 * 校验机读产物是否构成有效的「冒烟已通过」证据（供 Hook 侧判定 `startupSmokePassed`）。
 *
 * 机读只证明「冒烟跑过、两段都过、结果不陈旧」；**不**证明启动命令确为设计声明的生产路径，
 * 也不证明健康检查语义正确——那部分仍由 QE/PM 文字审查兜底（能力边界见 mechanical-gates.md §8.6）。
 *
 * @param {object|null} result `.startup-smoke-result.json` 内容
 * @param {{ now?: number, maxAgeHours?: number }} [options]
 * @returns {{ ok: boolean, reason: string, message?: string }}
 */
export function evaluateStartupSmokeResult(result, { now = Date.now(), maxAgeHours = DEFAULT_MAX_AGE_HOURS } = {}) {
  if (!result || typeof result !== 'object') {
    return {
      ok: false,
      reason: 'no-startup-smoke-result',
      message:
        'R32：缺少生产启动冒烟机读产物 test-results/e2e/.startup-smoke-result.json，须由 test-engineer 运行 `node .cursor/scripts/startup-smoke-run.mjs`。',
    };
  }
  if (typeof result.command !== 'string' || !result.command.trim()) {
    return {
      ok: false,
      reason: 'startup-smoke-missing-command',
      message: 'R32：冒烟产物缺少非空 command 字段（未解析到生产启动命令）。',
    };
  }
  if (result.gatePassed !== true) {
    return {
      ok: false,
      reason: `startup-smoke-not-passed:${result.reason ?? 'unknown'}`,
      message: `R32：生产启动冒烟未通过（reason=${result.reason ?? 'unknown'}），属产品缺陷，须判定测试不通过并回派 development-engineer。`,
    };
  }
  if (result.restartAfterKill?.passed !== true) {
    return {
      ok: false,
      reason: 'startup-smoke-missing-restart-phase',
      message:
        'R32：冒烟产物缺少「强杀后再启动」段的通过记录，无法证明异常退出后仍可恢复（陈旧锁/端口未释放类缺陷）。',
    };
  }
  const capturedAt = Date.parse(result.capturedAt ?? '');
  if (!Number.isFinite(capturedAt)) {
    return {
      ok: false,
      reason: 'startup-smoke-missing-timestamp',
      message: 'R32：冒烟产物缺少可解析的 capturedAt 时间戳，无法判定新鲜度。',
    };
  }
  if (now - capturedAt > maxAgeHours * 60 * 60 * 1000) {
    return {
      ok: false,
      reason: 'startup-smoke-stale',
      message: `R32：生产启动冒烟结果已超过 ${maxAgeHours} 小时（capturedAt=${result.capturedAt}），须对当前代码重跑冒烟，不得复用历史结果。`,
    };
  }
  return { ok: true, reason: 'checked' };
}
