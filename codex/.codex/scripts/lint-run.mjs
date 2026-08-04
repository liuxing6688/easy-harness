#!/usr/bin/env node
/**
 * 编程规范（lint）门禁运行器（R15）。
 *
 * 职责：探测技术栈 → 解析 lint 命令 → 执行 → 落盘机读产物。
 * 判据与产物说明权威：`.codex/harness/spec/mechanical-gates.md` §8.2。
 * 纯函数判据见 `./lint-run-lib.mjs`；Hook 侧读取见 `workflow-gate-lib` → `readLintResult()`。
 *
 * 命令解析优先级：`harness.config.json` → `qe.commands.lint` 覆盖 > 栈默认值。
 * 产物：`test-results/qe/.lint-result.json`（`gatePassed` + **R34** `execProof` 执行证明）。
 *   gatePassed=true 仅当「有 lint 命令且退出码为 0」；无命令时 gatePassed=false。
 *   **R38**：失败区分 `lint-tool-unavailable`（工具/依赖不可用）与 `lint-failed`（真有问题）；
 *   另有 `lint-not-configured`（项目没配 linter）与 `no-lint-command`（探测不到默认命令），
 *   四类的解法方向互不相同，见 `lint-run-lib.mjs` 头注释。
 * 消费方：`gate-stop-workflow` / `gate-role-sequence`（不得在 lint 未通过时推进 TE）。
 *
 * 用法：
 *   node .codex/scripts/lint-run.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  resolveLintCommand,
  computeLintGate,
  detectStackFromFileNames,
  buildLintRemediation,
} from './lint-run-lib.mjs';
import { attachExecutionProof } from '../hooks/lib/execproof.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const HARNESS_CONFIG = path.join(PROJECT_ROOT, '.codex/harness.config.json');
const RESULT_DIR = path.join(PROJECT_ROOT, 'test-results/qe');
const RESULT_FILE = path.join(RESULT_DIR, '.lint-result.json');

/** monorepo 子项目扫描的深度与条数上限：只为「给用户看清楚有哪些子项目」，不做全仓遍历。 */
const SUBPROJECT_SCAN_MAX_DEPTH = 3;
const SUBPROJECT_SCAN_MAX_HITS = 20;

/** 兜底豁免目录：配置缺失/损坏时也不该扫进 node_modules 之流。 */
const FALLBACK_SKIP_DIRS = ['node_modules', 'dist', 'build', 'out', 'target', 'vendor', '.venv'];

/** 读取 harness.config.json；缺失/非法返回 null（不抛出，运行器不因配置损坏而失败）。 */
function loadHarnessConfig() {
  if (!fs.existsSync(HARNESS_CONFIG)) return null;
  try {
    return JSON.parse(fs.readFileSync(HARNESS_CONFIG, 'utf8'));
  } catch {
    return null;
  }
}

/** 读取 qe.commands.lint 覆盖；缺失/非法返回 null */
function readLintOverride(config) {
  const lint = config?.qe?.commands?.lint;
  return typeof lint === 'string' ? lint : null;
}

/** @returns {string[]} 目录内文件名；不可读时返回空数组 */
function readDirNames(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * 递归扫描子目录里的构建清单，产出「本仓库看起来有哪些子项目」的诊断素材。
 *
 * **只诊断、不推断命令**（2026-08-03 跨栈覆盖修复）：monorepo 里在哪个子目录跑哪条 lint、
 * 是否该逐个跑，属项目决策；框架替用户猜，轻则在错误目录跑错误命令，重则跑出一个空转的
 * 「通过」——后者是 R12 明令禁止的放松。故这里只把发现的子项目写进产物，门禁据此提示
 * **用户本人**配置 `qe.commands.lint` 覆盖。
 *
 * @returns {Array<{ dir: string, stack: string }>}
 */
function scanSubProjects(skipDirs) {
  const skip = new Set(skipDirs.map((d) => d.toLowerCase()));
  const hits = [];

  const walk = (absDir, relDir, depth) => {
    if (depth > SUBPROJECT_SCAN_MAX_DEPTH || hits.length >= SUBPROJECT_SCAN_MAX_HITS) return;
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name.startsWith('.') || skip.has(name.toLowerCase())) continue;
      const childAbs = path.join(absDir, name);
      const childRel = relDir ? `${relDir}/${name}` : name;
      const stack = detectStackFromFileNames(readDirNames(childAbs));
      if (stack) {
        // 命中即视为一个子项目，不再深入其内部（其内部的清单属于它自己的构成）。
        hits.push({ dir: childRel, stack });
        if (hits.length >= SUBPROJECT_SCAN_MAX_HITS) return;
        continue;
      }
      walk(childAbs, childRel, depth + 1);
    }
  };

  walk(PROJECT_ROOT, '', 1);
  return hits;
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
  const config = loadHarnessConfig();
  const stack = detectStackFromFileNames(readDirNames(PROJECT_ROOT));
  const override = readLintOverride(config);
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

  // 无命令是唯一「靠重跑绝不会变」的失败：必须当场给出用户可粘贴的出路，否则代理只会反复重试。
  if (!command) {
    const skipDirs = config?.gatedPaths?.extensionGateExemptDirs ?? FALLBACK_SKIP_DIRS;
    const subProjects = stack ? [] : scanSubProjects(skipDirs);
    result.subProjects = subProjects;
    result.remediation = buildLintRemediation({ stack, subProjects });
  }

  // R34：落签须在写盘之前，且签名覆盖上面全部字段（含 gatePassed）。
  attachExecutionProof('lint', result);
  writeResult(result);
  // 控制台省略 output，避免刷屏；完整输出已在产物文件中。
  console.log(JSON.stringify({ ...result, output: undefined }, null, 2));
  process.exit(result.gatePassed ? 0 : 1);
}

main();
