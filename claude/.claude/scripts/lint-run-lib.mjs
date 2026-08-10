/**
 * lint-run.mjs 的纯函数库：跨技术栈 lint 命令解析与 gatePassed 判据计算。
 *
 * 与 workflow-gate-lib.mjs 独立（不引入运行时状态依赖），便于单测覆盖。
 * 运行器入口：`./lint-run.mjs`；Hook 消费产物：`readLintResult()` → stop / R13。
 *
 * R15（mechanical-gates.md §8.2）：QE 阶段须实际运行 lint 且退出码为 0，
 * 机读结果落盘 test-results/qe/.lint-result.json。
 * gatePassed 仅在「有 lint 命令且退出码为 0」时为 true；无命令时 reason=no-lint-command，
 * 须由**用户本人**在 `harness.config.json` 配置覆盖（R29 锁定，代理不得写）或走双要素豁免
 * （lintApplicability:"n/a" + 用户确认）。detail-design-spec §5 仅为文档留痕，不作为 Hook 输入。
 *
 * ## 失败性质分四类（reason 字段），解法互不相同
 *
 * | reason | 含义 | 解法 |
 * | ------ | ---- | ---- |
 * | `lint-failed` | linter 跑起来了并报出违规 | DE/QE 整改代码 |
 * | `lint-tool-unavailable`（**R38**） | linter 没装 / 依赖拉不到 / 网络代理证书问题 | PM 阻塞 → 用户决策修环境 |
 * | `lint-not-configured` | 命令存在但项目**没配 linter**（如 npm 缺 `scripts.lint`） | DE 补 linter 配置，不是「整改违规」 |
 * | `no-lint-command` | 框架探测不到该栈默认命令（含未支持的栈、monorepo 根无清单） | 用户本人配 `qe.commands.lint` 覆盖，或双要素豁免 |
 *
 * 四者**都不放行**门禁（R12：不可用不等于免检），但门禁给出的指引方向完全不同——把
 * 「项目没装 linter」说成「代码有 lint 问题」会让 DE 去修一个不存在的缺陷（R38 同源教训）。
 */
import { applyToolAvailability } from './tool-availability-lib.mjs';

/**
 * 技术栈探测表：构建清单文件名（支持 `*` 通配）→ 栈名。**顺序即优先级**，先命中先返回。
 *
 * **覆盖面须 ⊇ `harness.config.json → gatedPaths.buildManifests`**（回归钉死于
 * `tests/selftest/r15-lint.mjs`「栈探测清单须覆盖受门禁构建清单」）。历史实现只认 10 个
 * 根目录清单，而路径门禁早已把 `build.gradle.kts` / `CMakeLists.txt` / `mix.exs` /
 * `pubspec.yaml` 纳管、R6 加强又让 `.swift` 等代码扩展名默认受门禁——于是这些项目**源码受
 * 门禁约束、却永远拿不到 lint 命令**，R15 变成任何真实项目都不可达的红灯（§8.2 R15）。
 * 两张表必须同源演进：新增受门禁清单时同步在此登记，没有默认命令就登记为空串（`''`），
 * 让门禁报「探测到 X 栈但无默认命令」而不是含糊的 `unknown`。
 */
export const STACK_MANIFESTS = Object.freeze([
  { stack: 'node', manifests: ['package.json'] },
  { stack: 'python', manifests: ['pyproject.toml'] },
  {
    stack: 'python-requirements',
    manifests: ['requirements.txt', 'Pipfile', 'setup.py', 'setup.cfg'],
  },
  { stack: 'go', manifests: ['go.mod'] },
  { stack: 'rust', manifests: ['Cargo.toml'] },
  { stack: 'java-maven', manifests: ['pom.xml'] },
  { stack: 'java-gradle', manifests: ['build.gradle', 'build.gradle.kts'] },
  { stack: 'php', manifests: ['composer.json'] },
  { stack: 'ruby', manifests: ['Gemfile'] },
  { stack: 'dotnet', manifests: ['*.sln', '*.csproj', '*.fsproj', '*.vbproj'] },
  { stack: 'dart', manifests: ['pubspec.yaml'] },
  { stack: 'elixir', manifests: ['mix.exs'] },
  { stack: 'swift', manifests: ['Package.swift'] },
  { stack: 'cpp-cmake', manifests: ['CMakeLists.txt'] },
  { stack: 'make', manifests: ['Makefile'] },
]);

/**
 * 各技术栈默认 lint 命令（与 qe-run.mjs 共用本表；空串表示该栈无默认 lint）。
 *
 * **选取口径（2026-08-03 跨栈覆盖修复，见 §8.5 留痕）**：只给「工具链自带、且不会空转」的
 * 分析器配默认值——`dart analyze` / `mix compile --warnings-as-errors` / `dotnet build
 * -warnaserror` 随 SDK 分发，无配置也按默认规则真检查；`swiftlint` 虽需单独安装，但它是
 * SwiftPM 生态事实标准，未装时由 **R38** 报 `lint-tool-unavailable` 并给出正确指引。
 *
 * 反过来，Maven / Gradle / PHP / CMake / Make **刻意留空**：这些栈没有「未配插件也能真检查」
 * 的通用命令，`gradle check -x test` 一类在未启用 checkstyle/ktlint/detekt 时会**静默通过**
 * ——空转放行比红灯更坏（R12）。它们走 `STACK_LINT_SUGGESTIONS` 的候选命令，由用户本人择一
 * 写入 `qe.commands.lint`。
 */
export const STACK_LINT_COMMANDS = {
  node: 'npm run lint',
  python: 'ruff check .',
  'python-requirements': 'ruff check .',
  go: 'go vet ./...',
  rust: 'cargo clippy',
  'java-maven': '',
  'java-gradle': '',
  php: '',
  ruby: 'rubocop',
  dotnet: 'dotnet build -warnaserror',
  dart: 'dart analyze',
  elixir: 'mix compile --warnings-as-errors',
  swift: 'swiftlint',
  'cpp-cmake': '',
  make: '',
};

/**
 * 无默认命令的栈的**候选命令建议**，仅用于 `no-lint-command` 诊断文案。
 *
 * 刻意**不参与命令解析**：它们要么依赖项目已装插件，要么可能空转通过，须由用户确认本项目
 * 确已配置后再写入 `qe.commands.lint`。代理不得据此自行推断命令去跑（那等于绕过用户裁定）。
 */
export const STACK_LINT_SUGGESTIONS = Object.freeze({
  'java-maven': 'mvn -q -DskipTests checkstyle:check（或 spotless:check / pmd:check，取决于已装插件）',
  'java-gradle':
    'gradle check -x test（**须确认已启用 checkstyle/ktlint/detekt**，否则该命令会空转通过）',
  php: 'vendor/bin/phpcs --standard=PSR12 src（或 vendor/bin/php-cs-fixer fix --dry-run --diff）',
  'cpp-cmake': 'clang-tidy -p build <源文件>（或在 CMake 里定义 lint target 后 cmake --build build --target lint）',
  make: 'make lint（须确认 Makefile 确有该目标，否则命令会直接报错）',
  dotnet: 'dotnet format --verify-no-changes（比默认的 build -warnaserror 更偏格式规范）',
});

/** @param {string} pattern 清单名或通配（如 `*.sln`） @param {string[]} fileNames 目录内文件名 */
function manifestMatches(pattern, fileNames) {
  if (!pattern.includes('*')) {
    return fileNames.some((f) => f.toLowerCase() === pattern.toLowerCase());
  }
  const re = new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`, 'i');
  return fileNames.some((f) => re.test(f));
}

/**
 * 按目录内的文件名清单探测技术栈（纯函数，便于单测与递归复用）。
 * @param {string[]} fileNames 单层目录内的文件名（不含路径）
 * @returns {string|null} 命中的栈名；无匹配返回 null
 */
export function detectStackFromFileNames(fileNames = []) {
  const names = fileNames.map((f) => String(f));
  for (const { stack, manifests } of STACK_MANIFESTS) {
    if (manifests.some((m) => manifestMatches(m, names))) return stack;
  }
  return null;
}

/**
 * 解析本次应使用的 lint 命令：harness.config.json → qe.commands.lint 覆盖优先，
 * 其次按探测到的技术栈默认值。二者皆无（含空串）时返回 null（视为无 lint 命令）。
 * @param {{ stack?: string|null, override?: string|null }} params
 * @returns {string|null}
 */
export function resolveLintCommand({ stack = null, override = null } = {}) {
  if (typeof override === 'string' && override.trim()) return override.trim();
  if (override === null || override === undefined) {
    const fallback = stack ? STACK_LINT_COMMANDS[stack] : null;
    if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
  }
  return null;
}

/**
 * 「命令跑了，但项目根本没配这个 linter」的信号（大小写不敏感）。
 *
 * 与 **R38**「工具不可用」刻意分开：那是**环境**缺工具（装了就能跑），这里是**项目**缺配置
 * （得有人去写 `scripts.lint` / linter 配置文件）。历史实现把 npm 的 `Missing script: "lint"`
 * 一律并入 `lint-failed`，门禁于是要求 DE「整改 lint 违规」——而实际上一条违规都还没被检查过。
 *
 * 判据宁漏不误：只认包管理器明确说「找不到这个脚本」的措辞，真实 lint 报错绝不会命中。
 */
const NOT_CONFIGURED_SIGNALS = Object.freeze([
  /missing script:\s*["']?lint/i,
  /npm (?:ERR!|error) missing script/i,
  /ERR_PNPM_NO_SCRIPT/i,
  /command ["']lint["'] not found/i,
  /error: unknown command ["']lint["']/i,
]);

/** @param {string} output 命令合并输出 @returns {boolean} 是否为「项目未配置 linter」 */
export function isLintNotConfigured(output = '') {
  const text = String(output ?? '');
  return NOT_CONFIGURED_SIGNALS.some((re) => re.test(text));
}

/**
 * 计算 lint 门禁判定。gatePassed = 有命令且退出码为 0。
 *
 * 失败时按性质细分（见模块头注释表格）：先判「项目没配 linter」（`lint-not-configured`），
 * 再交 **R38** 判「工具不可用」（`lint-tool-unavailable`），都不命中才是真有违规（`lint-failed`）。
 * 三者**一律不放行**，区分的意义在于门禁给出的解法方向不同。
 *
 * @param {{ command: string|null, exitCode: number|null, output?: string }} params
 * @returns {{ gatePassed: boolean, reason: string, toolUnavailable?: boolean, notConfigured?: boolean }}
 */
export function computeLintGate({ command, exitCode, output = '' }) {
  if (!command) {
    return { gatePassed: false, reason: 'no-lint-command' };
  }
  if (exitCode === 0) {
    return { gatePassed: true, reason: 'passed' };
  }
  if (isLintNotConfigured(output)) {
    return { gatePassed: false, reason: 'lint-not-configured', notConfigured: true };
  }
  return applyToolAvailability(
    { gatePassed: false, reason: 'lint-failed' },
    { exitCode, output },
    'lint-tool-unavailable',
  );
}

/**
 * 生成 `no-lint-command` 的可执行诊断：说明为什么没命令、以及**用户本人**该粘贴什么。
 *
 * 存在的理由：该 reason 的唯一出路是「用户改 `harness.config.json`」或「双要素豁免」，而
 * `harness.config.json` 受 R29 锁定、**任何代理（含架构师）都不得写**。门禁若只丢一句
 * 「无 lint 命令」，代理要么反复重跑，要么去试探绕过；给出可直接粘贴的片段才是真正的出路。
 *
 * @param {{ stack?: string|null, subProjects?: Array<{ dir: string, stack: string }> }} params
 * @returns {{ summary: string, suggestedCommand: string|null, configPath: string, configSnippet: string }}
 */
export function buildLintRemediation({ stack = null, subProjects = [] } = {}) {
  const suggestion = stack ? (STACK_LINT_SUGGESTIONS[stack] ?? null) : null;
  const subList = subProjects.map((s) => `${s.dir}（${s.stack}）`).join('、');

  let summary;
  if (stack) {
    summary = `已探测到技术栈 ${stack}，但本框架未为该栈提供默认 lint 命令（无「未配插件也不会空转」的通用命令）。`;
    if (suggestion) summary += `候选命令：${suggestion}。`;
  } else if (subProjects.length > 0) {
    summary =
      `项目根目录没有可识别的构建清单，但在子目录发现了 ${subProjects.length} 个子项目：${subList}。` +
      '这通常是 monorepo/workspace 布局。框架**刻意不替你猜**该在哪个子目录跑哪条命令' +
      '——猜错会在错误的目录跑错误的命令，或跑出一个空转的「通过」。';
  } else {
    summary =
      '项目根目录与子目录都没有发现可识别的构建清单，无法探测技术栈。' +
      '若本项目确实用了框架尚未登记的技术栈，请在覆盖里写明该栈的 lint 命令。';
  }

  return {
    summary,
    suggestedCommand: suggestion,
    configPath: '.claude/harness.config.json',
    configSnippet: JSON.stringify(
      { qe: { commands: { lint: suggestion ? '<按上方候选命令择一>' : '<本项目的 lint 命令>' } } },
      null,
      2,
    ),
  };
}
