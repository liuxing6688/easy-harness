/**
 * 运行器共享纯函数库：**R38** 区分「工具不可用」与「检查未通过」。
 *
 * 消费方：`lint-run.mjs` / `static-scan-run.mjs` / `e2e-run.mjs` / `startup-smoke-run.mjs`。
 * 门禁侧读取产物的 `toolUnavailable` 字段（见 `mechanical-gates.md` §8.8）。
 *
 * ## 要解决的问题
 *
 * 历史实现中三个运行器都只看退出码：`exitCode === 0 ? 通过 : 不通过`。于是
 * 「离线环境下 `npx --yes jscpd-rs` 拉不到包」与「代码里真有 8% 重复」产出**完全相同**的
 * `{ gatePassed: false, reason: 'scan-failed' }`。R16 默认命令依赖 npx 在线获取两个非主流包，
 * 用户第一次在受限网络 / 企业代理 / 离线机器上使用本框架，就会卡死在 QE 阶段，
 * 并且门禁给出的指引是「请整改重复代码」——指向完全错误的方向。
 *
 * ## 判定口径
 *
 * 只在**证据明确**时判为工具不可用，宁漏不误：命中「命令不存在」类退出码，
 * 或输出里出现依赖获取 / 网络 / 证书 / 代理 / 模块缺失类信号。检查工具**正常运行并
 * 报出问题**（真实 lint 报错、重复率超阈值、检出密钥）绝不会命中这些信号。
 *
 * ## 「进程起不来」与「进程自己报错」必须分开（2026-07-30 复核修正）
 *
 * `ENOENT`（及其中文形态「系统找不到指定的文件」）历史上直接写在 `command-not-found`
 * 正则里，对**任意输出文本**生效。后果在 R32 上完全反转了门禁语义：被测应用自己
 * `open('/app/config/production.json')` 失败时输出 `ENOENT`，会被判成「工具不可用」，
 * 指引用户去修环境——而这恰是 R32 立场里最典型的**产品缺陷**（配置路径写错），
 * 也正是 2026-07-29 复盘里两次热修撞上的那类 bug。
 *
 * 现按**信号来源**分两组：`UNAVAILABLE_SIGNALS` 匹配命令输出（工具跑起来了但报了
 * 环境类错误），`LAUNCH_ONLY_SIGNALS` 只匹配 `launchError`（进程压根没起来，如
 * `spawn ruff ENOENT`）。应用自己打印的 ENOENT 落不进 `launchError`，故不再误判。
 *
 * ## 门禁语义（关键）
 *
 * 工具不可用**不放行**门禁——那会变成「网络一断就自动免检」的放松（R12）。它改变的是
 * **失败的性质与解法**：门禁把它报为环境/工具问题，要求项目经理标 `blocking` 并用
 * AskQuestion 请用户决策（装工具 / 配 `qe.commands.*` 覆盖 / 走双要素豁免），
 * 而不是要求开发工程师去「整改不存在的质量问题」。
 */

/**
 * 「命令本身不存在」的退出码：
 * - 127：POSIX shell `command not found`
 * - 9009：Windows `cmd.exe` 命令未找到
 */
export const COMMAND_NOT_FOUND_EXIT_CODES = Object.freeze([127, 9009]);

/**
 * 工具不可用信号（大小写不敏感）。分组便于在产物里回显**具体**是哪一类，
 * 用户看到 `dependency-fetch` 与 `network` 的处置方式并不相同。
 */
const UNAVAILABLE_SIGNALS = Object.freeze([
  {
    category: 'command-not-found',
    re: /(?:command not found|not recognized as an internal or external command|无法将[^\n]{0,40}识别为|is not recognized as the name of a cmdlet)/i,
  },
  {
    category: 'dependency-fetch',
    re: /(?:npm (?:ERR!|error) code E4\d{2}|404 Not Found[^\n]{0,80}(?:npm|registry)|could not determine executable to run|npm (?:ERR!|error) code ENOVERSIONS|no matching version found|package .* not found|Cannot find module|ModuleNotFoundError|error: externally-managed-environment)/i,
  },
  {
    category: 'network',
    re: /(?:\bENOTFOUND\b|\bEAI_AGAIN\b|\bECONNREFUSED\b|\bECONNRESET\b|\bETIMEDOUT\b|\bENETUNREACH\b|network (?:is )?unreachable|getaddrinfo|request to https?:\/\/[^\s]+ failed|socket hang up)/i,
  },
  {
    category: 'proxy-or-tls',
    re: /(?:\bERR_TLS\b|UNABLE_TO_(?:GET_ISSUER_CERT|VERIFY_LEAF_SIGNATURE)|SELF_SIGNED_CERT_IN_CHAIN|CERT_HAS_EXPIRED|self[- ]signed certificate|unable to get local issuer certificate|407 Proxy Authentication Required|tunneling socket could not be established)/i,
  },
  {
    category: 'browser-binary-missing',
    re: /(?:Executable doesn't exist at|playwright install|browserType\.launch: .*(?:ENOENT|Failed to launch)|Host system is missing dependencies)/i,
  },
]);

/**
 * **只对 `launchError` 生效**的信号：进程本身没能被拉起（`spawn xxx ENOENT`）。
 *
 * 刻意不匹配命令输出——被测程序自己打印的 `ENOENT`（读不到配置文件、找不到数据目录）
 * 说明命令跑起来了、是程序自身有问题，属产品缺陷而非工具不可用。
 */
const LAUNCH_ONLY_SIGNALS = Object.freeze([
  {
    category: 'command-not-found',
    re: /(?:\bENOENT\b|系统找不到指定的文件)/i,
  },
]);

/**
 * 判定一次命令失败是「工具不可用」还是「检查未通过」。
 *
 * `launchError` 与 `output` 的判据**不对称**：前者代表「进程没起来」，后者代表
 * 「进程起来了并且这样说」。调用方须把 spawn/exec 抛出的错误传 `launchError`，
 * 而不是拼进 `output`，否则 `ENOENT` 类信号会失去来源信息（见模块头注释）。
 *
 * @param {{ exitCode: number|null, output?: string, launchError?: unknown }} params
 * @returns {{ toolUnavailable: boolean, category: string|null, detail: string|null }}
 */
export function classifyCommandFailure({ exitCode = null, output = '', launchError = null } = {}) {
  const launchText = launchError ? String(launchError.message ?? launchError) : '';
  for (const { category, re } of LAUNCH_ONLY_SIGNALS) {
    const m = launchText.match(re);
    if (m) {
      return { toolUnavailable: true, category, detail: firstLine(launchText) };
    }
  }
  const text = `${output ?? ''}\n${launchText}`;
  for (const { category, re } of UNAVAILABLE_SIGNALS) {
    const m = text.match(re);
    if (m) {
      return { toolUnavailable: true, category, detail: firstLine(m[0]) };
    }
  }
  if (typeof exitCode === 'number' && COMMAND_NOT_FOUND_EXIT_CODES.includes(exitCode)) {
    return {
      toolUnavailable: true,
      category: 'command-not-found',
      detail: `退出码 ${exitCode}：命令不存在`,
    };
  }
  return { toolUnavailable: false, category: null, detail: null };
}

function firstLine(text) {
  return String(text ?? '')
    .split(/\r?\n/)[0]
    .trim()
    .slice(0, 240);
}

/**
 * 把分类结果合并进子门禁判定结果。工具不可用时**保持 `gatePassed: false`**
 * （不可用不等于免检，R12），仅改写 `reason` 并补 `toolUnavailable` / `toolUnavailableCategory`。
 *
 * @param {{ gatePassed: boolean, reason: string }} gate
 * @param {{ exitCode: number|null, output?: string, launchError?: unknown }} run
 * @param {string} unavailableReason 该门禁专属的 reason 值（如 `lint-tool-unavailable`）
 */
export function applyToolAvailability(gate, run, unavailableReason) {
  if (gate?.gatePassed === true) return gate;
  const verdict = classifyCommandFailure(run ?? {});
  if (!verdict.toolUnavailable) return { ...gate, toolUnavailable: false };
  return {
    ...gate,
    gatePassed: false,
    reason: unavailableReason,
    toolUnavailable: true,
    toolUnavailableCategory: verdict.category,
    toolUnavailableDetail: verdict.detail,
  };
}
