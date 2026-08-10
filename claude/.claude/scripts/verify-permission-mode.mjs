#!/usr/bin/env node
/**
 * 权限模式验证脚本
 *
 * 用途：
 * 1. 检查当前权限模式配置
 * 2. 分析 auto 模式使用情况
 * 3. 生成审计报告
 *
 * 运行：node .claude/scripts/verify-permission-mode.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CWD = process.cwd();

function readSettings() {
  const settingsPaths = [
    path.join(CWD, '.claude/settings.json'),
    path.join(CWD, '.claude/settings.local.json'),
    path.join(process.env.HOME || process.env.USERPROFILE, '.claude/settings.json')
  ];

  const settings = {};

  for (const p of settingsPaths) {
    if (fs.existsSync(p)) {
      try {
        const content = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (content.permission_mode) {
          settings[p] = content.permission_mode;
        }
      } catch (err) {
        console.error(`⚠️ 无法读取 ${p}: ${err.message}`);
      }
    }
  }

  return settings;
}

function readAutoModeAudit() {
  const auditPath = path.join(CWD, '.claude/harness-state/auto-mode-audit.jsonl');

  if (!fs.existsSync(auditPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(auditPath, 'utf8');
    return content.split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch (err) {
    console.error(`⚠️ 无法读取审计日志: ${err.message}`);
    return [];
  }
}

function readPermissionWarnings() {
  const warningPath = path.join(CWD, '.claude/harness-state/permission-mode-warnings.jsonl');

  if (!fs.existsSync(warningPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(warningPath, 'utf8');
    return content.split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch (err) {
    console.error(`⚠️ 无法读取警告日志: ${err.message}`);
    return [];
  }
}

function analyzeAutoModeUsage(auditLogs) {
  const stats = {
    total: auditLogs.length,
    bySessions: {},
    byTools: {},
    byAgentTypes: {},
    byPaths: {}
  };

  for (const log of auditLogs) {
    // 按会话统计
    stats.bySessions[log.sessionId] = (stats.bySessions[log.sessionId] || 0) + 1;

    // 按工具统计
    stats.byTools[log.toolName] = (stats.byTools[log.toolName] || 0) + 1;

    // 按角色统计
    if (log.agentType) {
      stats.byAgentTypes[log.agentType] = (stats.byAgentTypes[log.agentType] || 0) + 1;
    }

    // 按路径统计
    if (log.targetPath) {
      stats.byPaths[log.targetPath] = (stats.byPaths[log.targetPath] || 0) + 1;
    }
  }

  return stats;
}

function generateReport() {
  console.log('');
  console.log('═'.repeat(70));
  console.log('  Harness Engineering - 权限模式审计报告');
  console.log('═'.repeat(70));
  console.log('');

  // 1. 当前配置
  console.log('📋 当前权限模式配置：');
  console.log('');

  const settings = readSettings();
  if (Object.keys(settings).length === 0) {
    console.log('  ℹ️  未找到权限模式配置（使用默认值：default）');
  } else {
    for (const [path, mode] of Object.entries(settings)) {
      const icon = mode === 'auto' ? '⚠️' : '✅';
      console.log(`  ${icon}  ${mode.padEnd(10)} - ${path}`);
    }
  }
  console.log('');

  // 2. 推荐配置
  const hasAutoMode = Object.values(settings).includes('auto');
  if (hasAutoMode) {
    console.log('⚠️  **警告：检测到 auto 模式**');
    console.log('');
    console.log('  Harness Engineering 规约建议使用以下模式：');
    console.log('  • default - 平衡模式（推荐）');
    console.log('  • careful - 谨慎模式（高风险项目）');
    console.log('');
    console.log('  如何切换：');
    console.log('  1. 快捷键：Shift+Tab');
    console.log('  2. 命令：/config permission_mode default');
    console.log('  3. 编辑配置文件并重启会话');
    console.log('');
  } else {
    console.log('✅ 权限模式配置符合规约推荐');
    console.log('');
  }

  // 3. Auto 模式使用统计
  const auditLogs = readAutoModeAudit();

  if (auditLogs.length > 0) {
    console.log('─'.repeat(70));
    console.log('📊 Auto 模式使用统计（历史记录）：');
    console.log('');

    const stats = analyzeAutoModeUsage(auditLogs);

    console.log(`  总操作次数：${stats.total}`);
    console.log('');

    console.log('  按工具分类：');
    for (const [tool, count] of Object.entries(stats.byTools)) {
      console.log(`    ${tool}: ${count} 次`);
    }
    console.log('');

    if (Object.keys(stats.byAgentTypes).length > 0) {
      console.log('  按角色分类：');
      for (const [role, count] of Object.entries(stats.byAgentTypes)) {
        console.log(`    ${role}: ${count} 次`);
      }
      console.log('');
    }

    console.log('  涉及的唯一会话数：' + Object.keys(stats.bySessions).length);
    console.log('');

    // 最近的操作
    const recentLogs = auditLogs.slice(-5);
    console.log('  最近 5 次操作：');
    for (const log of recentLogs) {
      const time = new Date(log.timestamp).toLocaleString('zh-CN');
      const agentInfo = log.agentType ? ` [${log.agentType}]` : '';
      const pathInfo = log.targetPath ? ` → ${log.targetPath}` : '';
      console.log(`    ${time} - ${log.toolName}${agentInfo}${pathInfo}`);
    }
    console.log('');
  } else {
    console.log('─'.repeat(70));
    console.log('ℹ️  未发现 auto 模式使用记录');
    console.log('');
  }

  // 4. 警告历史
  const warnings = readPermissionWarnings();

  if (warnings.length > 0) {
    console.log('─'.repeat(70));
    console.log('⚠️  权限模式警告历史：');
    console.log('');
    console.log(`  总警告次数：${warnings.length}`);
    console.log('');

    const recentWarnings = warnings.slice(-3);
    console.log('  最近 3 次警告：');
    for (const warn of recentWarnings) {
      const time = new Date(warn.timestamp).toLocaleString('zh-CN');
      console.log(`    ${time} - ${warn.permissionMode} 模式`);
    }
    console.log('');
  }

  // 5. 建议
  console.log('═'.repeat(70));
  console.log('💡 建议：');
  console.log('');

  if (hasAutoMode || auditLogs.length > 0) {
    console.log('  1. 切换到 default 或 careful 模式');
    console.log('  2. 如需使用 auto 模式，定期审查操作日志');
    console.log('  3. 关键操作（R29/R35/工具链安装）会在 auto 模式下强制阻止');
  } else {
    console.log('  ✅ 当前配置良好，继续保持');
  }

  console.log('');
  console.log('═'.repeat(70));
  console.log('');
}

// 主函数
try {
  generateReport();
} catch (error) {
  console.error('❌ 执行失败:', error.message);
  process.exit(1);
}
