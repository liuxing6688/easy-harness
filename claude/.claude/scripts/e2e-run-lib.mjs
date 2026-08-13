/**
 * e2e-run.mjs 的纯函数库：[R-xxx] 标签解析、P0 提取、覆盖率与 gatePassed 计算。
 *
 * 与 workflow-gate-lib.mjs 独立；vitest 单测见 `e2e-run-lib.test.ts`。
 * 运行器：`./e2e-run.mjs`；Hook 消费：`readE2eResult(scope)` → stop / R13。
 *
 * 浏览器范围（mechanical-gates.md §8.3）：仅 Chromium——这是机械门禁**唯一**允许
 * 简化的维度；gatePassed / 覆盖率 / 追溯标签不因收窄而放松。
 */

const R_TAG_RE = /\[(R-[A-Za-z0-9_-]+)\]/;

/**
 * **F-10**：markdown 表格行 → 单元格数组，正确还原转义竖线 `\|`。
 *
 * 本库刻意不依赖 `hooks/lib/**`（运行器与 Hook 解耦），故与 `core.mjs#splitTableRow`
 * 同语义各留一份；两处口径必须一致，改一处务必同步另一处 + 跑 `gate-selftest`。
 * 裸 `split('|')` 会把需求描述里合法的 `status=all\|active\|done` 当列分隔符，
 * 令优先级列右移、P0 需求静默退出必测集合（见文件头 R30 契约）。
 *
 * **同步义务已机械化**：`selftest/r30-table-escape.mjs` 的「F-10 一致性」用例把两处实现
 * 喂同一批 500 条交叉生成语料并逐字比对，任一侧改动而另一侧未跟进即红——不再只靠本注释。
 */
export function splitTableRow(line) {
  const raw = String(line ?? '').trim();
  if (!raw) return [];
  const cells = [];
  let cur = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '\\' && raw[i + 1] === '|') {
      cur += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

/** 从用例标题中提取 [R-xxx] 追溯标签，未命中返回 null */
export function extractRequirementTag(title) {
  if (typeof title !== 'string') return null;
  const m = title.match(R_TAG_RE);
  return m ? m[1] : null;
}

/**
 * 解析 Playwright JSON reporter 输出（`--reporter=json` / `reporter: [['json', ...]]` 产物），
 * 仅提取 `chromium` project 的用例结果，归一化为：
 * [{ id, title, status: 'passed'|'failed'|'skipped'|'timedOut'|'interrupted', file }]
 */
export function parseChromiumResults(playwrightReport) {
  const results = [];
  if (!playwrightReport || !Array.isArray(playwrightReport.suites)) return results;

  function walkSuite(suite, filePath) {
    const currentFile = suite.file ?? filePath;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.projectName && test.projectName !== 'chromium') continue;
        const lastResult = (test.results ?? [])[test.results.length - 1];
        const status = lastResult?.status ?? test.status ?? 'unknown';
        const title = spec.title ?? test.title ?? '';
        results.push({
          id: extractRequirementTag(title),
          title,
          status,
          file: currentFile,
        });
      }
    }
    for (const child of suite.suites ?? []) {
      walkSuite(child, currentFile);
    }
  }

  for (const suite of playwrightReport.suites) {
    walkSuite(suite, suite.file);
  }

  return results;
}

/** 解析 requirement-list.md 表格，提取需求优先级=P0 的需求编号列表 */
export function parseRequirementP0Ids(requirementListContent) {
  if (!requirementListContent) return [];
  const ids = [];
  for (const line of requirementListContent.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue; // 分隔行
    const cells = splitTableRow(t);
    if (cells.length < 5) continue;
    const [reqId, , , , priority] = cells;
    if (!/^R-/.test(reqId)) continue; // 跳过表头行
    if (/^P0$/i.test(priority)) ids.push(reqId);
  }
  return ids;
}

/**
 * **F-05 机械兜底**：门禁产物目录，Playwright 的 `outputDir` **不得**是其中任何一个的
 * 「自身或祖先」。Playwright 每次运行前**清空** `outputDir`。
 *
 * - `test-results/qe`   → `.lint-result.json`（R15）、`.static-scan-result.json`（R16）
 * - `test-results/e2e`  → `.startup-smoke-result.json`（R32）、`.e2e-batch-result.json`、
 *                          `.e2e-final-result.json`、`pw-report.json`
 * - `test-results/recon`→ `*.json`（R17 存储对账证据）
 *
 * 「祖先或自身」这一判法自动覆盖了两种最危险的写法：`outputDir: 'test-results/'`（清空全部
 * 机读证据）与 `outputDir: '.'`（清空整个仓库）。也比 §8.3 原文「不得指向 `test-results/`
 * 或其任何祖先」更严一档：`test-results/qe` 这类「只清掉一部分证据」的写法同样被拒
 * （只可加强，R12）。
 */
export const GATE_ARTIFACT_DIRS = Object.freeze([
  'test-results/qe',
  'test-results/e2e',
  'test-results/recon',
]);

/** Playwright 未声明 `outputDir` 时的默认值——**正是**会清空全部门禁产物的那一个。 */
export const PLAYWRIGHT_DEFAULT_OUTPUT_DIR = 'test-results';

/**
 * 去掉 JS/TS 源码里的行注释与块注释，**保留字符串字面量内部**的同形字符。
 *
 * 必要性：出厂 `playwright.config.ts` 的文件头注释里就整段讲解了 `outputDir` 约束
 * （「`outputDir` 不得指向 `test-results/`……」），裸正则会先命中注释里的那一处；
 * 而 `webServer.url` 之类的值里又含 `//`，粗暴地按 `//` 截断会把真实配置切碎。
 */
export function stripJsComments(source) {
  const src = String(source ?? '');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 从 `playwright.config.*` 源码里取 `outputDir` 的声明值。
 *
 * @returns `{ declared: false }`（未声明，Playwright 回落到危险的默认值）
 *        | `{ declared: true, literal: string }`（字符串字面量）
 *        | `{ declared: true, literal: null, expression: string }`（表达式，静态判不了）
 */
export function parsePlaywrightOutputDir(source) {
  const code = stripJsComments(source);
  const m = code.match(/(?:^|[^\w$.])outputDir\s*:\s*([^\n]*)/);
  if (!m) return { declared: false };
  const rest = m[1].trim();
  const lit = rest.match(/^(['"`])((?:\\.|(?!\1)[^\\])*)\1/);
  if (lit) return { declared: true, literal: lit[2] };
  // 表达式只进报错文案，截到同层的 `,` / `}` / `)` 为止，免得把后面半行配置一起贴出来。
  let depth = 0;
  let end = rest.length;
  for (let i = 0; i < rest.length; i += 1) {
    const ch = rest[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) { end = i; break; }
      depth -= 1;
    } else if (ch === ',' && depth === 0) { end = i; break; }
  }
  return { declared: true, literal: null, expression: rest.slice(0, end).trim() };
}

/** 归一为相对项目根的 posix 路径；`''` 表示项目根自身。 */
function toPosixRelative(projectRoot, target) {
  const abs = target.replace(/\\/g, '/').match(/^(?:[A-Za-z]:)?\//)
    ? target
    : `${projectRoot}/${target}`;
  const parts = [];
  for (const seg of abs.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  const rootParts = projectRoot
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '' && s !== '.');
  let i = 0;
  while (i < rootParts.length && i < parts.length && rootParts[i] === parts[i]) i += 1;
  if (i < rootParts.length) return { outside: true, rel: parts.join('/') };
  return { outside: false, rel: parts.slice(i).join('/') };
}

/**
 * **F-05 机械兜底**：`playwright.config.*` 的 `outputDir` 是否安全。
 *
 * 背景（原报告 F-05，阻断级）：Playwright 每次运行前清空 `outputDir`，默认值即
 * `test-results/`。历史模板缺 `playwright.config.ts`，接入方自建配置时若沿用默认值，
 * 跑一次 `npx playwright test` 就把 `.lint-result.json` / `.static-scan-result.json` /
 * `.startup-smoke-result.json` / `recon/*.json` / 上一轮 `.e2e-batch-result.json` **全部删掉**，
 * `gate-role-sequence` 随即以 `no-lint-result` 拒派 TE，且**没有任何一层会说明原因**。
 *
 * 该约束此前只由「模板默认值 + 三处文档」承载（`mechanical-gates.md` §8.3、
 * `e2e/specs/README.md`、`test-engineer.md`）——宿主项目按自身技术栈重写配置即可重演删除。
 * 本函数把它落到机械层：判据在**跑 Playwright 之前**执行，不安全即拒绝，绝不「跑完再说」。
 *
 * **未声明 = 拒绝**：缺 `outputDir` 时 Playwright 用默认值 `test-results/`，正是最危险的那个，
 * 「没写」不等于「安全」。
 *
 * **非字面量 = 拒绝**（fail-closed）：`path.join(...)` 之类表达式静态判不了。此处刻意不放行——
 * F-05 的失效是**静默**的（证据没了、门禁只报「产物缺失」），放行一个判不了的配置等于把
 * 阻断级缺陷重新打开；改成字符串字面量的代价则只有一行。
 *
 * @param source `playwright.config.*` 源码
 * @param projectRoot 项目根（posix 或 win32 路径均可）
 * @returns `{ok:true, outputDir}` | `{ok:false, reason, message, outputDir}`
 */
export function checkPlaywrightOutputDir(source, projectRoot = '.') {
  const parsed = parsePlaywrightOutputDir(source);
  const guidance =
    '说明权威见 `.claude/harness/spec/mechanical-gates.md` §8.3「Playwright 配置约束」。' +
    '该文件属受门禁产品源码（期望角色 development-engineer），须由 PM 回派 DE 修改；' +
    `模板取值为 \`outputDir: 'test-results/pw-artifacts/'\`（与门禁产物同级隔离）。`;

  if (!parsed.declared) {
    return {
      ok: false,
      reason: 'playwright-outputdir-undeclared',
      outputDir: PLAYWRIGHT_DEFAULT_OUTPUT_DIR,
      message:
        'playwright.config.* 未声明 `outputDir`，Playwright 将回落到默认值 `test-results/`——' +
        '而它每次运行前会**清空** `outputDir`，即跑一次 E2E 就删光 lint（R15）/ 静态扫描（R16）/ ' +
        `启动冒烟（R32）/ 存储对账（R17）与上一轮 E2E 的全部机读门禁证据。${guidance}`,
    };
  }
  if (parsed.literal === null) {
    return {
      ok: false,
      reason: 'playwright-outputdir-not-literal',
      outputDir: parsed.expression,
      message:
        `playwright.config.* 的 \`outputDir\` 是表达式（\`${parsed.expression}\`）而非字符串字面量，` +
        '机械层无法静态判定它是否会清空门禁产物目录。F-05 的失效是静默的（证据消失、门禁只报' +
        `「产物缺失」），故此处不放行判不了的配置：请改写成字符串字面量。${guidance}`,
    };
  }

  const { outside, rel } = toPosixRelative(String(projectRoot).replace(/\\/g, '/'), parsed.literal);
  if (outside) return { ok: true, outputDir: parsed.literal, reason: 'outside-project-root' };

  const clobbered = GATE_ARTIFACT_DIRS.filter((d) => rel === '' || d === rel || d.startsWith(`${rel}/`));
  if (clobbered.length > 0) {
    return {
      ok: false,
      reason: 'playwright-outputdir-clobbers-gate-artifacts',
      outputDir: parsed.literal,
      message:
        `playwright.config.* 的 \`outputDir: '${parsed.literal}'\` 是门禁产物目录 ` +
        `${clobbered.join(' / ')} 的祖先或自身。Playwright 每次运行前**清空** \`outputDir\`，` +
        '该配置会在跑 E2E 时连带删除 lint（R15）/ 静态扫描（R16）/ 启动冒烟（R32）/ ' +
        '存储对账（R17）/ 上一轮 E2E 的机读证据，造成「跑一次 E2E 就要重跑整套 QE」' +
        `以及批次↔最终 ping-pong 死锁。${guidance}`,
    };
  }
  return { ok: true, outputDir: parsed.literal };
}

/** 解析 coverage-waivers.json 内容，返回已豁免的需求编号集合（含说明校验：须有 reason 字段） */
export function parseCoverageWaivers(waiversJsonContent) {
  if (!waiversJsonContent) return new Set();
  try {
    const parsed = JSON.parse(waiversJsonContent);
    const waivers = Array.isArray(parsed) ? parsed : parsed.waivers ?? [];
    const ids = new Set();
    for (const w of waivers) {
      if (w && typeof w.id === 'string' && typeof w.reason === 'string' && w.reason.trim()) {
        ids.add(w.id);
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}

/**
 * 计算覆盖率与门禁判定。
 *
 * @param {Array<{id: string|null, status: string}>} results Chromium 用例结果
 * @param {string[]} requiredIds 本次范围要求覆盖的需求编号（批次：--required-ids；最终：P0 全集）
 * @param {Set<string>} waivedIds 已登记且有理由说明的覆盖率豁免需求编号
 * @returns {{
 *   allPassed: boolean,
 *   coverageComplete: boolean,
 *   gatePassed: boolean,
 *   missingIds: string[],
 *   unexplainedSkips: string[],
 *   coveredIds: string[],
 * }}
 */
export function computeGateResult(results, requiredIds, waivedIds = new Set(), opts = {}) {
  const coveredIds = new Set(results.filter((r) => r.id && r.status === 'passed').map((r) => r.id));

  const missingIds = requiredIds.filter((id) => !coveredIds.has(id) && !waivedIds.has(id));

  const unexplainedSkips = results
    .filter((r) => (r.status === 'skipped' || r.status === 'interrupted') && r.id && !waivedIds.has(r.id))
    .map((r) => r.id);

  const failed = results.filter((r) => r.status === 'failed' || r.status === 'timedOut');
  const allPassed = failed.length === 0;

  const coverageComplete = missingIds.length === 0 && unexplainedSkips.length === 0;

  // F-14（2026-08-11 审核修复）：`playwrightExitCode` 须为 `gatePassed` 的必要条件。
  // 历史实现只用 `allPassed && coverageComplete`，二者都由**报告里的用例状态**推出；
  // 而进程级故障（企业代理劫持就绪探测、webServer 起不来、配置错误）不产生任何 failed 用例，
  // 于是 `allPassed: true`（零条失败）与 `exitCode: 1` 可以共存并判 `gatePassed: true`。
  // 实测：`HTTP_PROXY=127.0.0.1:7890` 下就绪探测被劫持报「端口已占用」而端口实际空闲。
  const { playwrightExitCode = null } = opts;
  const processFailed = playwrightExitCode !== null && playwrightExitCode !== 0;
  // 有退出码非 0 却零条用例 → 不是「用例没写够」而是工具/环境不可用，交 R38 分流，
  // 避免把代理故障指引成「TE 用例写少了」（与 R38 想避免的错误指引同类）。
  const toolUnavailableSuspect = processFailed && results.length === 0;

  return {
    allPassed,
    coverageComplete,
    processPassed: !processFailed,
    gatePassed: allPassed && coverageComplete && !processFailed,
    missingIds,
    unexplainedSkips,
    coveredIds: [...coveredIds],
    ...(toolUnavailableSuspect
      ? {
          toolUnavailable: true,
          toolUnavailableCategory: 'runner-process-failure',
          toolUnavailableDetail:
            `Playwright 退出码 ${playwrightExitCode} 但报告中零条用例——` +
            '通常为进程级故障（企业代理劫持 127.0.0.1 就绪探测、webServer 启动失败、配置错误），' +
            '而非用例缺失。请先按 R38 分类排除环境成因（如设置 NO_PROXY=127.0.0.1,localhost）。',
        }
      : {}),
  };
}
