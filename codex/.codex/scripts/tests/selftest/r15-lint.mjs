/**
 * R15：lint 机读结果、lintApplicability 双要素豁免与 checkLintClean。
 *
 * 入口：node .codex/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs；共享 fixture：./_fixtures.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  test, fixtureProcess, assert, parseWorkflowState, isLintExempt, readLintResult, checkLintClean,
  resolveLintCommand, computeLintGate, snapshotLintResult, restoreLintResult, writeLintResult,
  clearLintResult, detectStackFromFileNames, buildLintRemediation, isLintNotConfigured,
  STACK_MANIFESTS, STACK_LINT_COMMANDS, PROJECT_ROOT,
} from './_harness.mjs';

import {
  liteModeConfirmSection, R15_QE_DONE, LINT_PASS, LINT_FAIL, LINT_NA_GATED,
  LINT_EXEMPT_CONFIRM_PROCESS,
} from './_fixtures.mjs';

console.log('== R15：编程规范（lint）门禁纯函数判据 ==');
test('R15: resolveLintCommand 覆盖优先于栈默认值', () => {
  assert.equal(resolveLintCommand({ stack: 'node', override: 'eslint .' }), 'eslint .');
  assert.equal(resolveLintCommand({ stack: 'node', override: null }), 'npm run lint');
  assert.equal(resolveLintCommand({ stack: 'python', override: null }), 'ruff check .');
});
test('R15: 无 lint 命令的栈返回 null', () => {
  assert.equal(resolveLintCommand({ stack: 'java-maven', override: null }), null);
  assert.equal(resolveLintCommand({ stack: null, override: null }), null);
});
test('R15: computeLintGate —— 有命令且退出码 0 才 gatePassed', () => {
  assert.equal(computeLintGate({ command: 'npm run lint', exitCode: 0 }).gatePassed, true);
  assert.equal(computeLintGate({ command: 'npm run lint', exitCode: 1 }).gatePassed, false);
  assert.equal(computeLintGate({ command: null, exitCode: null }).gatePassed, false);
  assert.equal(computeLintGate({ command: null, exitCode: null }).reason, 'no-lint-command');
});

console.log('== R15：跨技术栈探测覆盖面（2026-08-03 覆盖缺口修复）==');
test('R15: 栈探测清单须覆盖受门禁构建清单（两张表不得再漂移）', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, '.codex/harness.config.json'), 'utf8'),
  );
  const detected = new Set(
    STACK_MANIFESTS.flatMap((s) => s.manifests).map((m) => m.toLowerCase()),
  );
  const missing = (config.gatedPaths?.buildManifests ?? []).filter(
    (m) => !detected.has(String(m).toLowerCase()),
  );
  assert.deepEqual(
    missing,
    [],
    `受门禁构建清单未登记进栈探测表：${missing.join('、')}——这些项目源码受门禁却拿不到 lint 命令`,
  );
});
test('R15: 探测表覆盖 Kotlin DSL / CMake / Elixir / Flutter / Swift / csproj', () => {
  assert.equal(detectStackFromFileNames(['build.gradle.kts']), 'java-gradle');
  assert.equal(detectStackFromFileNames(['CMakeLists.txt']), 'cpp-cmake');
  assert.equal(detectStackFromFileNames(['mix.exs']), 'elixir');
  assert.equal(detectStackFromFileNames(['pubspec.yaml']), 'dart');
  assert.equal(detectStackFromFileNames(['Package.swift']), 'swift');
  assert.equal(detectStackFromFileNames(['App.csproj']), 'dotnet');
  assert.equal(detectStackFromFileNames(['README.md']), null);
});
test('R15: 既有栈的探测与默认命令不得因扩表而改变（防回归）', () => {
  assert.equal(detectStackFromFileNames(['package.json', 'pyproject.toml']), 'node');
  assert.equal(resolveLintCommand({ stack: 'go', override: null }), 'go vet ./...');
  assert.equal(resolveLintCommand({ stack: 'ruby', override: null }), 'rubocop');
});
test('R15: 新栈默认命令为工具链自带分析器；可能空转的栈须留空', () => {
  assert.equal(resolveLintCommand({ stack: 'dart', override: null }), 'dart analyze');
  assert.equal(resolveLintCommand({ stack: 'elixir', override: null }), 'mix compile --warnings-as-errors');
  assert.equal(resolveLintCommand({ stack: 'dotnet', override: null }), 'dotnet build -warnaserror');
  assert.equal(resolveLintCommand({ stack: 'swift', override: null }), 'swiftlint');
  // gradle check / make lint 未配插件时会静默通过，空转放行比红灯更坏（§8.5 留痕「后续禁止事项」）
  for (const stack of ['java-maven', 'java-gradle', 'php', 'cpp-cmake', 'make']) {
    assert.equal(STACK_LINT_COMMANDS[stack], '', `${stack} 不得配置可能空转的默认命令`);
  }
});
test('R15: no-lint-command 须给出用户可粘贴的出路（不得只报一句无命令）', () => {
  const detectedStack = buildLintRemediation({ stack: 'java-gradle' });
  assert.equal(detectedStack.configPath, '.codex/harness.config.json');
  assert.ok(detectedStack.suggestedCommand, '无默认命令的栈须给候选命令');
  assert.ok(detectedStack.summary.includes('java-gradle'));

  const monorepo = buildLintRemediation({
    stack: null,
    subProjects: [{ dir: 'packages/api', stack: 'node' }, { dir: 'services/worker', stack: 'go' }],
  });
  assert.ok(monorepo.summary.includes('packages/api（node）'));
  assert.ok(monorepo.configSnippet.includes('lint'));
});

console.log('== R15：失败性质四分（lint-not-configured 不得与违规/工具不可用混淆）==');
test('R15: 项目没配 linter 判为 lint-not-configured 而非 lint-failed', () => {
  const npmMissing = computeLintGate({
    command: 'npm run lint',
    exitCode: 1,
    output: 'npm ERR! Missing script: "lint"\nnpm ERR! To see a list of scripts, run: npm run',
  });
  assert.equal(npmMissing.gatePassed, false);
  assert.equal(npmMissing.reason, 'lint-not-configured');
  assert.equal(computeLintGate({ command: 'pnpm lint', exitCode: 1, output: 'ERR_PNPM_NO_SCRIPT  Missing script: lint' }).reason, 'lint-not-configured');
});
test('R15: 真实 lint 违规仍判 lint-failed，工具缺失仍判 lint-tool-unavailable', () => {
  const violation = computeLintGate({
    command: 'npm run lint',
    exitCode: 1,
    output: 'src/app.ts:12:5  error  Unexpected console statement  no-console\n1 problem',
  });
  assert.equal(violation.reason, 'lint-failed');
  assert.equal(isLintNotConfigured('error  Unexpected console statement  no-console'), false);

  const unavailable = computeLintGate({
    command: 'ruff check .',
    exitCode: 127,
    output: 'ruff: command not found',
  });
  assert.equal(unavailable.reason, 'lint-tool-unavailable');
  assert.equal(unavailable.toolUnavailable, true);
});
test('R15: 通过时不得被误判为未配置（宁漏不误）', () => {
  const passed = computeLintGate({ command: 'npm run lint', exitCode: 0, output: '> lint\n> eslint .' });
  assert.equal(passed.gatePassed, true);
  assert.equal(passed.reason, 'passed');
});

console.log('== R15：编程规范（lint）门禁机读判据（含双要素豁免）==');

snapshotLintResult();
test('R15: 无 lint 机读产物时 checkLintClean 失败、lintPassed=false', () => {
  const content = fixtureProcess(R15_QE_DONE);
  clearLintResult();
  assert.equal(readLintResult(), null);
  assert.equal(checkLintClean().ok, false);
  assert.equal(parseWorkflowState(content).lintPassed, false);
});
test('R15: lint gatePassed=true 时 checkLintClean 通过、lintPassed=true', () => {
  const content = fixtureProcess(R15_QE_DONE);
  writeLintResult(LINT_PASS);
  assert.equal(checkLintClean().ok, true);
  assert.equal(parseWorkflowState(content).lintPassed, true);
});
test('R15: lint gatePassed=false（lint 失败）时 checkLintClean 失败、lintPassed=false', () => {
  const content = fixtureProcess(R15_QE_DONE);
  writeLintResult(LINT_FAIL);
  assert.equal(checkLintClean().ok, false);
  assert.equal(parseWorkflowState(content).lintPassed, false);
});
test('R15: 仅架构师声明 n/a 但无用户确认 → 不豁免', () => {
  const content = fixtureProcess(R15_QE_DONE, { 'docs/design/gated-lint-na.json': LINT_NA_GATED });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-lint-na.json';
  clearLintResult();
  assert.equal(isLintExempt(content), false);
  assert.equal(parseWorkflowState(content).lintPassed, false);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R15: 仅用户确认但架构师未声明 n/a → 不豁免', () => {
  const content = fixtureProcess(LINT_EXEMPT_CONFIRM_PROCESS, { 'docs/design/none.json': '{}\n' });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/none.json';
  clearLintResult();
  assert.equal(isLintExempt(content), false);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R15: 架构师声明 n/a + 用户确认 → 豁免，lintPassed 视为满足（即便无 lint 产物）', () => {
  const content = fixtureProcess(LINT_EXEMPT_CONFIRM_PROCESS, { 'docs/design/gated-lint-na.json': LINT_NA_GATED });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-lint-na.json';
  clearLintResult();
  assert.equal(isLintExempt(content), true);
  assert.equal(checkLintClean().ok, true);
  assert.equal(parseWorkflowState(content).lintPassed, true);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R15: no-lint-command / lint-not-configured 须原样上浮，不得压成 lint-not-passed', () => {
  // stop 门禁按 lintReason 分流文案；压成通用 reason 会让 DE 被派去整改一个没检查过的代码库。
  fixtureProcess(R15_QE_DONE);
  writeLintResult({
    gatePassed: false, reason: 'no-lint-command', stack: 'unknown', command: null, exitCode: null,
  });
  assert.equal(checkLintClean().reason, 'no-lint-command');

  writeLintResult({
    gatePassed: false, reason: 'lint-not-configured', notConfigured: true,
    stack: 'node', command: 'npm run lint', exitCode: 1,
  });
  assert.equal(checkLintClean().reason, 'lint-not-configured');

  writeLintResult(LINT_FAIL);
  assert.equal(checkLintClean().reason, 'lint-not-passed');
});
test('R15: docs-only 模式 lintPassed 视为满足', () => {
  const content = ['---', 'workflow_mode: docs-only', '---', '', liteModeConfirmSection('docs-only')].join('\n');
  clearLintResult();
  assert.equal(parseWorkflowState(content).lintPassed, true);
});
restoreLintResult();
