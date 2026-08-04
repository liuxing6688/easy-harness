#!/usr/bin/env node
/**
 * 跨技术栈 QE 命令运行器——Windows 退出码不可靠时的留痕手段。
 *
 * 职责：按技术栈探测（或 harness.config.json → qe.commands 覆盖）运行
 * test / lint / audit，将退出码与摘要落盘到 `test-results/qe/qe-run-result.json`。
 *
 * 注意：本脚本**不是** R15/R16 硬门禁运行器。
 *   - 编程规范硬门禁 → `lint-run.mjs`（产物 `.lint-result.json`）
 *   - 静态扫描硬门禁 → `static-scan-run.mjs`（产物 `.static-scan-result.json`）
 * 本脚本供 QE 在质量报告中留痕 / 本地快速跑通；Hook 不读 `qe-run-result.json`。
 *
 * 用法：
 *   node .cursor/scripts/qe-run.mjs                 # 运行 test + lint + audit
 *   node .cursor/scripts/qe-run.mjs --only=test,audit
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { detectStackFromFileNames, STACK_LINT_COMMANDS } from './lint-run-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const HARNESS_CONFIG = path.join(PROJECT_ROOT, '.cursor/harness.config.json');
const RESULT_DIR = path.join(PROJECT_ROOT, 'test-results/qe');

/**
 * 各技术栈默认 test/audit 命令；空串表示该栈无默认命令（记为 skipped）。
 *
 * **lint 一列不在这里**：探测表与 lint 默认命令都从 `lint-run-lib.mjs` 取（`STACK_MANIFESTS`
 * / `STACK_LINT_COMMANDS`）。历史实现两个运行器各抄一份，注释写着「口径一致」却只能靠人眼
 * 维持——真实后果是本表长期停在 10 个栈，与门禁纳管的构建清单脱节（§8.2 R15）。
 */
const STACK_TEST_AUDIT_COMMANDS = {
  node: { test: 'npm test', audit: 'npm audit' },
  python: { test: 'pytest', audit: 'pip-audit' },
  'python-requirements': { test: 'pytest', audit: 'pip-audit' },
  go: { test: 'go test ./...', audit: 'govulncheck ./...' },
  rust: { test: 'cargo test', audit: 'cargo audit' },
  'java-maven': { test: 'mvn test', audit: 'mvn org.owasp:dependency-check-maven:check' },
  'java-gradle': { test: 'gradle test', audit: 'gradle dependencyCheckAnalyze' },
  php: { test: 'composer test', audit: 'composer audit' },
  ruby: { test: 'bundle exec rspec', audit: 'bundle audit' },
  dotnet: { test: 'dotnet test', audit: 'dotnet list package --vulnerable' },
  dart: { test: 'dart test', audit: 'dart pub outdated' },
  elixir: { test: 'mix test', audit: 'mix hex.audit' },
  swift: { test: 'swift test', audit: '' },
  'cpp-cmake': { test: 'ctest --test-dir build', audit: '' },
  make: { test: '', audit: '' },
};

/** 解析 `--key=value` CLI 参数。 */
function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-zA-Z0-9_-]+)=(.*)$/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

/** @returns {{ stack: string, commands: { test: string, lint: string, audit: string } }|null} */
function detectStack() {
  let names = [];
  try {
    names = fs.readdirSync(PROJECT_ROOT);
  } catch {
    return null;
  }
  const stack = detectStackFromFileNames(names);
  if (!stack) return null;
  const { test = '', audit = '' } = STACK_TEST_AUDIT_COMMANDS[stack] ?? {};
  return { stack, commands: { test, lint: STACK_LINT_COMMANDS[stack] ?? '', audit } };
}

/** 读取 harness.config.json → qe.commands 覆盖表（可部分覆盖）。 */
function loadConfigOverrides() {
  if (!fs.existsSync(HARNESS_CONFIG)) return {};
  try {
    const config = JSON.parse(fs.readFileSync(HARNESS_CONFIG, 'utf8'));
    return config.qe?.commands ?? {};
  } catch {
    return {};
  }
}

/**
 * 执行单项命令；空命令记为 skipped（不计入失败）。
 * @returns {{ command: string|null, exitCode: number|null, skipped?: boolean, reason?: string, output?: string }}
 */
function runCommand(name, command) {
  if (!command) {
    return { command: null, exitCode: null, skipped: true, reason: '未配置该命令' };
  }
  try {
    const stdout = execSync(command, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { command, exitCode: 0, output: truncate(stdout) };
  } catch (err) {
    return {
      command,
      exitCode: typeof err.status === 'number' ? err.status : 1,
      output: truncate(`${err.stdout ?? ''}\n${err.stderr ?? ''}`),
    };
  }
}

function truncate(text, max = 4000) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const only = args.only ? args.only.split(',').map((s) => s.trim()) : ['test', 'lint', 'audit'];

  const detected = detectStack();
  const overrides = loadConfigOverrides();
  const baseCommands = detected?.commands ?? {};
  // 配置覆盖优先于栈默认（可只覆盖部分键）。
  const commands = { ...baseCommands, ...overrides };

  const results = {};
  let hasFailure = false;

  for (const key of only) {
    const cmd = commands[key];
    const result = runCommand(key, cmd);
    results[key] = result;
    if (!result.skipped && result.exitCode !== 0) hasFailure = true;
  }

  const finalResult = {
    detectedStack: detected?.stack ?? 'unknown',
    commands: results,
    executedAt: new Date().toISOString(),
  };

  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULT_DIR, 'qe-run-result.json'),
    `${JSON.stringify(finalResult, null, 2)}\n`,
    'utf8',
  );

  console.log(JSON.stringify(finalResult, null, 2));
  process.exit(hasFailure ? 1 : 0);
}

main();
