#!/usr/bin/env node
/**
 * SessionStart Hook
 *
 * 职责：会话启动时初始化，加载配置和状态。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function allow() {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart' } }));
  process.exit(0);
}

async function main() {
  try {
    const input = await readStdin();
    const hook = JSON.parse(input);

    const cwd = hook.cwd;

    // 确保 hooks 目录存在
    const hooksDir = path.join(cwd, '.claude/hooks');
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }

    // 初始化 harness-state.json（如果不存在）
    const statePath = path.join(cwd, '.claude/harness-state.json');
    if (!fs.existsSync(statePath)) {
      const initialState = {
        version: '2.0',
        activeProcessPath: null,
        lastUpdated: new Date().toISOString()
      };
      fs.writeFileSync(statePath, JSON.stringify(initialState, null, 2), 'utf8');
    }

    // 清理过期的工具链批准文件
    const approvalPath = path.join(cwd, '.claude/hooks/.toolchain-install-approved.json');
    if (fs.existsSync(approvalPath)) {
      try {
        const approval = JSON.parse(fs.readFileSync(approvalPath, 'utf8'));
        if (new Date(approval.expiresAt) < new Date()) {
          fs.unlinkSync(approvalPath);
        }
      } catch (e) {
        // 忽略错误
      }
    }

    return allow();

  } catch (error) {
    console.error(`[session-init] Error: ${error.message}`);
    return allow();
  }
}

main();
