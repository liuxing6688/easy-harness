#!/usr/bin/env node
/**
 * SessionStart Hook - 增强版
 *
 * v2.1 新增：权限模式检查和警告
 *
 * 职责：
 * 1. 会话启动时初始化门禁状态
 * 2. 检查权限模式，对 auto 模式发出警告
 * 3. 加载配置和历史状态
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

function returnOutput(systemMessage = null, additionalContext = null) {
  const output = {};

  if (systemMessage) {
    output.systemMessage = systemMessage;
  }

  if (additionalContext) {
    output.hookSpecificOutput = {
      hookEventName: 'SessionStart',
      additionalContext: additionalContext
    };
  }

  console.log(JSON.stringify(output));
  process.exit(0);
}

async function main() {
  try {
    const input = await readStdin();
    const hook = JSON.parse(input);

    const sessionId = hook.session_id;
    const cwd = hook.cwd;
    const permissionMode = hook.permission_mode || 'default';
    const sessionMatcher = hook.matcher || 'startup';

    // === 权限模式检查 ===
    if (permissionMode === 'auto') {
      const warning = buildAutoModeWarning(permissionMode);

      // 记录警告到审计日志
      logPermissionModeWarning(cwd, sessionId, permissionMode);

      // 返回系统消息和上下文
      return returnOutput(warning.systemMessage, warning.additionalContext);
    }

    // === 正常模式的欢迎信息 ===
    const welcomeMessage = buildWelcomeMessage(permissionMode);

    return returnOutput(null, welcomeMessage);

  } catch (error) {
    // SessionStart 失败不应阻止会话启动
    console.error(`[SessionStart] Error: ${error.message}`);
    console.log(JSON.stringify({}));
    process.exit(0);
  }
}

function buildAutoModeWarning(permissionMode) {
  return {
    systemMessage: `⚠️ 权限模式警告：检测到 auto 模式

Harness Engineering 规约在 auto 模式下的门禁效果会受到削弱。

建议立即切换到推荐模式：
• 按 Shift+Tab 快速切换
• 或运行：/config permission_mode default

当前模式：${permissionMode}
推荐模式：default 或 careful`,

    additionalContext: `
🔒 **Harness Engineering 权限模式说明**

**当前模式：auto（自动批准）**

影响：
- ❌ 关键门禁的 ask 决策会被自动批准
- ❌ R29 自治资产保护、工具链安装确认等需要用户明确决策的检查点将被绕过
- ✅ deny 决策仍然有效（会被阻止）

**推荐模式：**
- ✅ **default** - 平衡模式，关键操作需手动确认（推荐）
- ✅ **careful** - 谨慎模式，所有操作需确认（高风险项目）

**如何切换：**
1. 快捷键：Shift+Tab
2. 命令：\`/config permission_mode default\`
3. 配置文件：修改 \`.claude/settings.json\`

**重要说明：**
如果您确实需要使用 auto 模式（例如自动化脚本），请注意：
- 关键门禁点（R29/R35/工具链安装）会强制改为 deny 而非 ask
- 所有 auto 模式下的操作会被记录到审计日志
- 建议定期检查 \`.claude/harness-state/auto-mode-audit.jsonl\`
`
  };
}

function buildWelcomeMessage(permissionMode) {
  const modeDescriptions = {
    'default': '✅ default（平衡模式，推荐）',
    'careful': '✅ careful（谨慎模式）',
    'auto': '⚠️ auto（自动批准，不推荐）'
  };

  const modeDesc = modeDescriptions[permissionMode] || permissionMode;

  return `
📋 **Harness Engineering v2.1 已加载**

当前权限模式：${modeDesc}

🔒 技术强制门禁：
• PreToolUse - 文件写入拦截
• PreToolUse - Shell 命令拦截
• PreToolUse - Agent 调用拦截
• Stop - 回合结束门禁
• SubagentStart - 身份追踪

📚 快速命令：
• \`/config permission_mode default\` - 切换到推荐模式
• \`/hooks\` - 查看所有已配置的 hooks
• 查看规约：阅读 CLAUDE.md

准备就绪。
`;
}

function logPermissionModeWarning(cwd, sessionId, permissionMode) {
  try {
    const logPath = path.join(cwd, '.claude/harness-state/permission-mode-warnings.jsonl');
    const logEntry = {
      timestamp: new Date().toISOString(),
      sessionId: sessionId,
      permissionMode: permissionMode,
      event: 'session_start_warning'
    };

    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
  } catch (err) {
    console.error(`[Audit] Failed to log permission mode warning: ${err.message}`);
  }
}

main();
