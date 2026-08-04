/**
 * static-scan-run.mjs 的纯函数库：重复代码（DRY）与安全静态扫描的命令解析 / gatePassed。
 *
 * 与 workflow-gate-lib.mjs 独立，便于单测。运行器：`./static-scan-run.mjs`；
 * Hook 消费：`readStaticScanResult()` → stop / R13。
 *
 * R16（mechanical-gates.md §8.2）：两项均须退出码 0；经 npx 获取（jscpd-rs /
 * gitleaks-secret-scanner），跨技术栈通用，不做 per-stack 探测。
 * gatePassed = duplication.gatePassed && security.gatePassed；可分别双要素豁免。
 * 反弱化：禁止擅自提高 --threshold 或扩大 --ignore（见 mechanical-gates.md）。
 */
import { applyToolAvailability } from './tool-availability-lib.mjs';

/**
 * 重复代码检测默认命令：jscpd-rs，5% 阈值，超限退出码非 0，JSON 报告落盘供人工核查。
 *
 * **禁止再加回 `--exitCode`（2026-07-29 审核修复）**：jscpd-rs 的两个标志是两套独立逻辑——
 *   - `--threshold N`：重复率 >= N% 时以错误码退出（这是 R16 声明的判据）；
 *   - `--exitCode N`：**只要检出任何重复**就用该退出码（与阈值无关）。
 * 历史默认值同时带 `--exitCode 1`，使 `--threshold 5` **完全失效**，门禁实际退化为
 * 「零重复容忍」。实测（本仓库 2.78% 重复率）：`--threshold 5` 退出 0（正确），
 * 加上 `--exitCode 1` 后退出 1（错误）；`--threshold 1` 退出 1，证明阈值本身工作正常。
 * 后果是任何真实宿主项目都不可能通过 R16——与 R19 出厂模板缺陷同级的硬阻塞。
 * 移除 `--exitCode` 是让实现回到**文档声明的判据**（5% 阈值），不是放松门禁（R12）。
 * 回归见 `tests/selftest/r16-static-scan.mjs`「默认命令不得含 --exitCode」。
 */
export const DEFAULT_DUP_COMMAND =
  'npx --yes jscpd-rs --threshold 5 --reporters json --output test-results/qe/.jscpd --ignore "**/node_modules/**,**/dist/**,**/build/**,**/.git/**,**/test-results/**,**/vendor/**,**/target/**,**/coverage/**" .';

/** 安全静态扫描默认命令：gitleaks-secret-scanner，跨平台自动获取 gitleaks 二进制，扫描全部改动 */
export const DEFAULT_SECURITY_COMMAND = 'npx --yes gitleaks-secret-scanner --diff-mode all';

/**
 * 解析重复代码检测命令：`harness.config.json` → `qe.commands.dupCheck` 覆盖优先
 * （显式空串视为「禁用默认命令」，回退为 no-command，须走适用性豁免），否则使用通用默认值。
 * @param {{ override?: string|null }} params
 * @returns {string|null}
 */
export function resolveDupCommand({ override = null } = {}) {
  if (typeof override === 'string') {
    return override.trim() ? override.trim() : null;
  }
  return DEFAULT_DUP_COMMAND;
}

/**
 * 解析安全静态扫描命令，规则与 resolveDupCommand 对称。
 * @param {{ override?: string|null }} params
 * @returns {string|null}
 */
export function resolveSecurityCommand({ override = null } = {}) {
  if (typeof override === 'string') {
    return override.trim() ? override.trim() : null;
  }
  return DEFAULT_SECURITY_COMMAND;
}

/**
 * 计算单项子门禁（重复代码 或 安全扫描）。gatePassed = 有命令且退出码为 0。
 *
 * **R38**：传入 `output` 时，失败会区分「工具不可用」（`tool-unavailable`）与
 * 「扫描检出问题」（`scan-failed`）。这对 R16 尤其关键——两项默认命令都靠
 * `npx --yes` 在线获取非主流包，离线/代理环境下拉包失败与「真有重复代码」
 * 在历史实现里是同一个 `scan-failed`。
 *
 * @param {{ command: string|null, exitCode: number|null, output?: string }} params
 * @returns {{ gatePassed: boolean, reason: string, toolUnavailable?: boolean }}
 */
export function computeSubGate({ command, exitCode, output = '' }) {
  if (!command) {
    return { gatePassed: false, reason: 'no-command' };
  }
  if (exitCode === 0) {
    return { gatePassed: true, reason: 'passed' };
  }
  return applyToolAvailability(
    { gatePassed: false, reason: 'scan-failed' },
    { exitCode, output },
    'tool-unavailable',
  );
}

/**
 * 汇总静态代码质量门禁判定：两项子检查须均通过。
 * `toolUnavailable` 在任一子项因工具不可用失败时上浮，供门禁选择正确的 followup 文案。
 * @param {{ duplication: { gatePassed: boolean }, security: { gatePassed: boolean } }} params
 * @returns {{ gatePassed: boolean, reason: string, toolUnavailable?: boolean }}
 */
export function computeStaticScanGate({ duplication, security }) {
  const gatePassed = duplication?.gatePassed === true && security?.gatePassed === true;
  const toolUnavailable =
    duplication?.toolUnavailable === true || security?.toolUnavailable === true;
  return {
    gatePassed,
    reason: gatePassed ? 'passed' : toolUnavailable ? 'tool-unavailable' : 'failed',
    toolUnavailable,
  };
}
