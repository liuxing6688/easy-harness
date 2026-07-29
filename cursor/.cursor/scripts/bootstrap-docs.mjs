#!/usr/bin/env node
/**
 * 幂等初始化 docs/ 目录骨架 + process.md，并同步 `.cursor/harness-state.json`。
 *
 * 职责：为门禁提供「活跃 process.md 指针」。Hook 通过 harness-state.json
 * （或环境变量 `HARNESS_PROCESS_PATH`）决定读哪一份流程文件。
 *
 * 用法：
 *   node .cursor/scripts/bootstrap-docs.mjs                  # Greenfield → docs/
 *   node .cursor/scripts/bootstrap-docs.mjs --feature=<name> # Feature → docs/<name>/
 *
 * 幂等性：已存在的 process.md 不会被覆盖；已存在的子目录不会报错。
 * 注意：harness-state.json 属 R29 门禁自治资产——本脚本面向用户/PM 初始化场景；
 * 代理不得通过写文件工具自改该指针以绕过门禁。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

/** 标准 docs 子目录（与角色成果物路径约定对齐）。 */
const DOC_SUBDIRS = ['requirement', 'design', 'quality', 'test', 'process'];
const PROCESS_TEMPLATE = path.join(PROJECT_ROOT, '.cursor/templates/process.md');
const HARNESS_STATE = path.join(PROJECT_ROOT, '.cursor/harness-state.json');

/** 解析 `--key=value` CLI 参数。 */
function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-zA-Z0-9_-]+)=(.*)$/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * 若不存在 process.md，则从模板复制；已存在则保留。
 * @returns {{ path: string, created: boolean }}
 */
function ensureProcessMd(processDir) {
  const processPath = path.join(processDir, 'process.md');
  if (fs.existsSync(processPath)) {
    return { path: processPath, created: false };
  }
  if (!fs.existsSync(PROCESS_TEMPLATE)) {
    throw new Error(`模板缺失：${PROCESS_TEMPLATE}`);
  }
  const template = fs.readFileSync(PROCESS_TEMPLATE, 'utf8');
  fs.writeFileSync(processPath, template, 'utf8');
  return { path: processPath, created: true };
}

/** 绝对路径 → 仓库相对正斜杠路径（写入 harness-state 用）。 */
function toWorkspaceRelative(absPath) {
  return path.relative(PROJECT_ROOT, absPath).replace(/\\/g, '/');
}

/**
 * 更新活跃流程指针；保留文件中其它字段。
 * @param {string} activeProcessPath 相对仓库根的 process.md 路径
 * @param {string|null} activeFeature Feature 名；Greenfield 时清除该字段
 */
function writeHarnessState(activeProcessPath, activeFeature) {
  let state = {};
  if (fs.existsSync(HARNESS_STATE)) {
    try {
      state = JSON.parse(fs.readFileSync(HARNESS_STATE, 'utf8'));
    } catch {
      state = {};
    }
  }
  state.activeProcessPath = activeProcessPath;
  if (activeFeature) {
    state.activeFeature = activeFeature;
  } else {
    delete state.activeFeature;
  }
  fs.mkdirSync(path.dirname(HARNESS_STATE), { recursive: true });
  fs.writeFileSync(HARNESS_STATE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const feature = args.feature ? args.feature.trim() : null;

  const docsBase = feature
    ? path.join(PROJECT_ROOT, 'docs', feature)
    : path.join(PROJECT_ROOT, 'docs');

  for (const sub of DOC_SUBDIRS) {
    ensureDir(path.join(docsBase, sub));
  }

  const processDir = path.join(docsBase, 'process');
  const { path: processPath, created } = ensureProcessMd(processDir);

  const activeProcessPath = toWorkspaceRelative(processPath);
  writeHarnessState(activeProcessPath, feature);

  console.log(
    JSON.stringify(
      {
        ok: true,
        feature: feature ?? null,
        docsBase: toWorkspaceRelative(docsBase),
        processPath: activeProcessPath,
        processCreated: created,
      },
      null,
      2,
    ),
  );
}

main();
