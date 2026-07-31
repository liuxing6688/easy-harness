#!/usr/bin/env node
/**
 * 编程规范（lint）门禁运行器（R15）。
 *
 * 职责：探测技术栈 → 解析 lint 命令 → 执行 → 落盘机读产物。
 * 判据与产物说明权威：`.trae/harness/spec/mechanical-gates.md` §8.2。
 * 纯函数判据见 `./lint-run-lib.mjs`；Hook 侧读取见 `workflow-gate-lib` → `readLintResult()`。
 *
 * 命令解析优先级：`harness.config.json` → `qe.commands.lint` 覆盖 > 栈默认值。
 * 产物：`test-results/qe/.lint-result.json`（`gatePassed` + **R34** `execProof` 执行证明）。
 *   gatePassed=true 仅当「有 lint 命令且退出码为 0」；无命令时 gatePassed=false。
 *   **R38**：失败区分 `lint-tool-unavailable`（工具/依赖不可用）与 `lint-failed`（真有问题）。
 * 消费方：`gate-stop-workflow` / `gate-role-sequence`（不得在 lint 未通过时推进 TE）。
 *
 * 用法：
 *   node .trae/scripts/lint-run.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { resolveLintCommand, computeLintGate } from './lint-run-lib.mjs';
import { attachExecutionProof } from '../hooks/lib/execproof.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const HARNESS_CONFIG = path.join(PROJECT_ROOT, '.trae/harness.config.json');
const RESULT_DIR = path.join(PROJECT_ROOT, 'test-results/qe');
const RESULT_FILE = path.join(RESULT_DIR, '.lint-result.json');

/** 与 qe-run.mjs 同口径：按项目根构建清单文件识别技术栈。 */
const STACK_DETECTORS = [
  { stack: 'node', manifest: 'package.json' },
  { stack: 'python', manifest: 'pyproject.toml' },
  { stack: 'python-requirements', manifest: 'requirements.txt' },
  { stack: 'go', manifest: 'go.mod' },
  { stack: 'rust', manifest: 'Cargo.toml' },
  { stack: 'java-maven', manifest: 'pom.xml' },
  { stack: 'java-gradle', manifest: 'build.gradle' },
  { stack: 'php', manifest: 'composer.json' },
  { stack: 'ruby', manifest: 'Gemfile' },
  { stack: 'dotnet', manifest: '*.sln' },
];

/** @param {string} pattern 清单文件名或通配（如 `*.sln`） */
function manifestExists(pattern) {
  if (!pattern.includes('*')) {
    return fs.existsSync(path.join(PROJECT_ROOT, pattern));
  }
  const re = new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`, 'i');
  try {
    return fs.readdirSync(PROJECT_ROOT).some((f) => re.test(f));
  } catch {
    return false;
  }
}

/** @returns {string|null} 探测到的栈名；无匹配返回 null */
function detectStack() {
  for (const detector of STACK_DETECTORS) {
    if (manifestExists(detector.manifest)) return detector.stack;
  }
  return null;
}

/** 读取 harness.config.json → qe.commands.lint；缺失/非法返回 null */
function loadLintOverride() {
  if (!fs.existsSync(HARNESS_CONFIG)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(HARNESS_CONFIG, 'utf8'));
    const lint = config.qe?.commands?.lint;
    return typeof lint === 'string' ? lint : null;
  } catch {
    return null;
  }
}

/** 截断过长 stdout/stderr，避免机读产物膨胀。 */
function truncate(text, max = 4000) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
}

/**
 * 在项目根执行 lint 命令，捕获退出码与输出（不抛出）。
 * @returns {{ exitCode: number, output: string }}
 */
function runLint(command) {
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

/** 落盘 `.lint-result.json`（含 gatePassed，供 Hook 机读）。 */
function writeResult(result) {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.writeFileSync(RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

function main() {
  const stack = detectStack();
  const override = loadLintOverride();
  const command = resolveLintCommand({ stack, override });

  let exitCode = null;
  let output = '';
  if (command) {
    const run = runLint(command);
    exitCode = run.exitCode;
    output = run.output;
  }

  const gate = computeLintGate({ command, exitCode, output });
  const result = {
    ...gate,
    stack: stack ?? 'unknown',
    command,
    exitCode,
    output: truncate(output),
    executedAt: new Date().toISOString(),
  };

  // R34：落签须在写盘之前，且签名覆盖上面全部字段（含 gatePassed）。
  attachExecutionProof('lint', result);
  writeResult(result);
  // 控制台省略 output，避免刷屏；完整输出已在产物文件中。
  console.log(JSON.stringify({ ...result, output: undefined }, null, 2));
  process.exit(result.gatePassed ? 0 : 1);
}

main();
