#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  normalizeCodexInput,
  resolveHookProjectRoot,
  toCodexOutput,
} from './codex-adapter-lib.mjs';

const scripts = {
  write: 'gate-dev-workflow.mjs',
  role: 'gate-role-sequence.mjs',
  // 兼容内核的 shell 生命周期同时运行工具链批准和开发 Shell 门禁；保持
  // 先工具链、后路径/角色判定顺序，避免 Bash 绕过系统级安装拦截。
  shell: ['gate-toolchain-install.mjs', 'gate-dev-shell.mjs'],
  subagent: 'gate-subagent-track.mjs',
  stop: 'gate-stop-workflow.mjs',
};

async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  return raw.trim() ? JSON.parse(raw) : {};
}

const mode = process.argv[2];
if (!scripts[mode]) {
  process.stderr.write(`[codex-hook-adapter] unknown mode: ${mode ?? '<missing>'}\n`);
  process.exit(2);
}

try {
  const codexInput = await readInput();
  const input = normalizeCodexInput(mode, codexInput);
  const projectRoot = resolveHookProjectRoot(codexInput);
  const hookDir = path.dirname(fileURLToPath(import.meta.url));
  const gateScripts = Array.isArray(scripts[mode]) ? scripts[mode] : [scripts[mode]];
  const childEnv = {
    ...process.env,
    HARNESS_PROJECT_ROOT: projectRoot,
  };
  let legacyOutput = {};
  for (const script of gateScripts) {
    const child = spawnSync(process.execPath, [path.join(hookDir, script)], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: childEnv,
      cwd: projectRoot,
    });
    if (child.stderr) process.stderr.write(child.stderr);
    if (child.status !== 0) {
      if (mode === 'subagent') {
        process.stdout.write('{}');
        process.exit(0);
      }
      process.stderr.write(`[codex-hook-adapter] ${mode} gate exited with status ${child.status}\n`);
      process.exit(2);
    }
    legacyOutput = child.stdout.trim() ? JSON.parse(child.stdout) : {};
    if (legacyOutput.permission && legacyOutput.permission !== 'allow') break;
  }
  process.stdout.write(JSON.stringify(toCodexOutput(mode, legacyOutput, codexInput)));
} catch (error) {
  process.stderr.write(`[codex-hook-adapter] ${error?.message ?? error}\n`);
  if (mode === 'subagent') {
    process.stdout.write('{}');
    process.exit(0);
  }
  process.exit(2);
}
