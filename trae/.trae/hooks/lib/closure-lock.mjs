/**
 * 门禁域：closure-lock — R40 闭环锁。
 *
 * 背景（摩擦点1优化，2026-07-31）：stop 门禁受 `hooks.json` 的 `loop_limit` 限次，
 * 而 Trae 平台对 `loop_limit` 的强制力未保证（见 `rollback.md` / `mechanical-gates.md`
 * §8.7 边界 3）。代理硬结束回合后，下一轮 PreToolUse 读不到任何「未闭环」痕迹，
 * 约束即断——只剩 `AGENTS.md` §5.15 纯文字自检兜底。
 *
 * 闭环锁把 stop 的「事后催促」转化为 PreToolUse 的「事前阻断」：
 * - `gate-stop-workflow` 在 block 时落盘 marker（纳入 R29 `runtime-marker`，代理不可写/删）；
 * - 下一轮 `gate-dev-workflow` / `gate-dev-shell` / `gate-r13-subagent` 读到 marker 即
 *   收紧 development-engineer 的源码写入/分派——未闭环不得开始新开发，须先补完流程
 *   或由 PM 回派 DE（回派依据 = `## 回退计数` 表有 count > 0 的行，复用 R31 机读）。
 *
 * 与 R21 的区别：R21 读 `.dispatched-roles.json`（最近派发），代理可通过 PM→DE 分派链
 * 让 DE 重新活跃从而绕过；闭环锁读持久化 marker + 回派依据，跨回合有效且不依赖
 * 「最近派发」这一可变状态。
 *
 * 逃生口（不新增，复用现有两条）：
 * - 流程真正闭环 / R10 cancelled / R35 阻塞释放证据齐备 → stop 放行并清 marker；
 * - R36 判定期异常 → marker 读取异常 fail-open（不阻拦，由 R36 自身处置）；
 * - 用户显式跳过闭环 → 走 R35「实质阻塞原因 + 用户决策留痕」双证据，stop 放行清 marker。
 *
 * 残余边界（坦诚披露）：marker 文件可被代理通过非 Hook 通道（MCP 写工具、未来新增写
 * 工具等，见 §8.7 边界表「PreToolUse 覆盖面」）删除——但删除 `runtime-marker` 与改写
 * 门禁同级违规，且 R28 已兜底 RunCommand 通道。闭环锁把「未闭环就跑路」的成本从 0
 * 抬到「必须刻意删除 marker 或伪造回退计数」，不是安全边界。
 *
 * 主要消费方：gate-stop-workflow（写/清）、gate-dev-workflow / gate-dev-shell /
 * gate-r13-subagent（读 + 判定）。域对照见 ./README.md。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  PROJECT_ROOT,
  readJsonFileSafe,
  readProcessMd,
  parseRollbackCounts,
} from './core.mjs';

/** marker 文件路径（相对项目根；规范化后用于 R29 比对） */
export const CLOSURE_LOCK_MARKER = '.trae/hooks/.workflow-closure-pending.json';

/**
 * marker 生命周期阶段（由 stop hook 根据 block 路径写入）。
 * 对应 `gate-stop-workflow` 的各 block 分支：
 * - `dev-incomplete`：stop 因 `devInProgress` block（DE 任务未完成，继续开发合法）
 * - `qe-incomplete`：待分派 QE / QE 未完成 / R34 / R38 / R15 / R16
 * - `test-incomplete`：各测试阶段（E2E / R14 / R17 / R32 / 最终整体集成测试）未完成
 * - `rollback-exceeded`：R31 回退计数超上限
 * - `blocking-no-evidence`：R35 阻塞态缺释放证据
 */
export const CLOSURE_STAGES = Object.freeze({
  DEV_INCOMPLETE: 'dev-incomplete',
  QE_INCOMPLETE: 'qe-incomplete',
  TEST_INCOMPLETE: 'test-incomplete',
  ROLLBACK_EXCEEDED: 'rollback-exceeded',
  BLOCKING_NO_EVIDENCE: 'blocking-no-evidence',
});

/** marker 默认 TTL（7 天）：防止历史 marker 永久锁死项目；过期视为失效 fail-open */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function markerAbsPath() {
  return path.join(PROJECT_ROOT, CLOSURE_LOCK_MARKER);
}

/**
 * 读取闭环锁 marker。不存在 / 过期 / 解析失败 → `null`（fail-open）。
 * @returns {{stage:string, missingGates:string[], reason:string, pendingSince:string}|null}
 */
export function readClosureLock() {
  try {
    const data = readJsonFileSafe(markerAbsPath());
    if (!data || typeof data !== 'object') return null;
    if (!data.stage || typeof data.stage !== 'string') return null;
    // TTL 过期判定：超期的 marker 视为残留，不再阻拦（fail-open）
    if (data.pendingSince) {
      const since = new Date(data.pendingSince).getTime();
      if (Number.isFinite(since) && Date.now() - since > DEFAULT_TTL_MS) return null;
    }
    return {
      stage: data.stage,
      missingGates: Array.isArray(data.missingGates) ? data.missingGates : [],
      reason: typeof data.reason === 'string' ? data.reason : '',
      pendingSince: typeof data.pendingSince === 'string' ? data.pendingSince : '',
    };
  } catch {
    return null;
  }
}

/**
 * 写闭环锁 marker（best-effort，失败不抛）。
 *
 * 调用方为 `gate-stop-workflow`（Stop 事件，不经 PreToolUse，故不受 R29 自身拦截）。
 * 代理通过 Write/Edit/RunCommand 写该路径会被 R29 `runtime-marker` deny。
 * @param {string} stage
 * @param {string[]} missingGates
 * @param {string} reason
 */
export function writeClosureLock(stage, missingGates = [], reason = '') {
  try {
    const payload = {
      stage,
      missingGates: Array.isArray(missingGates) ? missingGates : [],
      reason: typeof reason === 'string' ? reason : '',
      pendingSince: new Date().toISOString(),
    };
    fs.writeFileSync(markerAbsPath(), JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    /* best-effort：写入失败不影响 stop 判定，仅丧失跨回合约束（退化为纯 loop_limit） */
  }
}

/** 清闭环锁 marker（best-effort，失败不抛）。 */
export function clearClosureLock() {
  try {
    const abs = markerAbsPath();
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    /* best-effort：清不掉的残留 marker 在下一轮 PreToolUse 仍会阻拦，
       但代理可走 R35/R36 处置；不会造成永久死锁（补完流程即闭环清 marker）。 */
  }
}

/**
 * 闭环锁对 development-engineer 源码写入/分派的判定。
 *
 * 判定（marker 不存在 → 不阻拦）：
 * - `dev-incomplete` → 不阻拦（DE 任务未完成，继续开发合法）；
 * - `rollback-exceeded` → 阻拦（已超回退上限，须 PM 标 blocking 请用户决策）；
 * - `blocking-no-evidence` → 阻拦（阻塞态，须先补 R35 证据）；
 * - 其余 stage（`qe-incomplete` / `test-incomplete`）→ 须有回派依据
 *   （`## 回退计数` 表存在 count > 0 的行，复用 R31 `parseRollbackCounts`）才放行；
 *   无依据则阻拦——不得在未闭环的 QE/TE 阶段通过发起新 PM→DE 分派链开始新开发。
 *
 * 回派依据的选择理由：stop block 写 marker 的场景中，「须回派 DE」的（R32 冒烟失败、
 * QE 打回、测试不通过）都会伴随 PM 在 `## 回退计数` 表 +1。故「回退计数 > 0」是
 * 「回派 DE」的可靠代理指标；伪造回退计数会触发 R31 上限，成本不为零。
 *
 * @param {string|null|undefined} content process.md 内容；缺省时内部读活跃 process.md
 * @param {{stage:string}|null|undefined} lock `readClosureLock()` 的返回；缺省时内部读
 * @returns {{blocked:boolean, reason:string}}
 */
export function closureLockBlocksDev(content, lock) {
  const marker = lock ?? readClosureLock();
  if (!marker) return { blocked: false, reason: '' };

  if (marker.stage === CLOSURE_STAGES.DEV_INCOMPLETE) {
    return { blocked: false, reason: '' };
  }
  if (marker.stage === CLOSURE_STAGES.ROLLBACK_EXCEEDED) {
    return {
      blocked: true,
      reason:
        '流程未闭环（闭环锁 R40）：回退计数已超上限（stage=rollback-exceeded），不得再分派 development-engineer 或由其写源码。须由 project-manager 将 frontmatter blocking 置为 true、写明「## 阻塞原因」并用 AskUserQuestion 请用户决策（继续投入/调整方案/终止流程）。',
    };
  }
  if (marker.stage === CLOSURE_STAGES.BLOCKING_NO_EVIDENCE) {
    return {
      blocked: true,
      reason:
        '流程未闭环（闭环锁 R40）：流程处于阻塞态但缺 R35 阻塞释放证据（stage=blocking-no-evidence）。须先补齐「## 阻塞原因」实质内容与「## 用户确认记录」中的阻塞决策留痕，再继续推进；不得在阻塞态下开始新的开发写入。',
    };
  }
  // qe-incomplete / test-incomplete：须回派依据
  const md = content ?? readProcessMd() ?? '';
  const hasRollback = parseRollbackCounts(md).some((r) => r.count > 0);
  if (!hasRollback) {
    const missing = Array.isArray(marker.missingGates) ? marker.missingGates : [];
    return {
      blocked: true,
      reason:
        `流程未闭环（闭环锁 R40）：当前 stage=${marker.stage}（${marker.reason || '流程未完成'}），` +
        `未拿出闭环证据前不得由 development-engineer 写源码或发起其 Task。` +
        `须先补完流程（missingGates=[${missing.join(', ')}]：跑 lint / E2E / 启动冒烟等运行器、写 test-results 产物、推进 process.md 进度），` +
        `或由 project-manager 回派 DE（须在 process.md「## 回退计数」表记录，作为回派依据）。` +
        `不得通过发起新 PM→DE 分派链绕过未闭环约束。`,
    };
  }
  return { blocked: false, reason: '' };
}
