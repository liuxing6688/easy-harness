#!/usr/bin/env node
/**
 * 风险1优化方案 - 回滚脚本
 *
 * ⚠️ 已过时且危险（2026-08-06 交付期脚本，勿运行）：本脚本意在把 Hook 配置回滚到
 * 「优化前」，其操作对象 `.claude/hooks/hooks.json` 已不存在；且回滚 auto 模式防护
 * 属 **R12 意义上的放松**，须经用户明确确认并在 `.claude/harness/spec/**` 留痕。
 * 保留仅作交付期留痕。
 *
 * 用途：回滚到优化前的配置
 *
 * 运行：node .claude/scripts/rollback-risk1-optimization.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CWD = process.cwd();

// 创建交互式输入接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

function log(message, symbol = 'ℹ️') {
  console.log(`${symbol} ${message}`);
}

async function rollback() {
  console.log('\n' + '═'.repeat(70));
  console.log('  风险1优化方案 - 回滚脚本');
  console.log('═'.repeat(70) + '\n');

  log('此脚本将回滚到优化前的配置', '⚠️');
  log('', '');

  // 查找备份文件
  const hooksDir = path.join(CWD, '.claude/hooks');
  const backupFiles = fs.readdirSync(hooksDir)
    .filter(f => f.startsWith('hooks.json.backup.'))
    .sort()
    .reverse(); // 最新的在前

  if (backupFiles.length === 0) {
    log('未找到备份文件', '❌');
    log('可能原因：', '');
    log('  1. 尚未部署优化方案', '');
    log('  2. 备份文件已被删除', '');
    log('  3. 不在正确的项目目录下', '');
    rl.close();
    process.exit(1);
  }

  log('找到以下备份文件：', '📋');
  backupFiles.forEach((file, index) => {
    const timestamp = file.replace('hooks.json.backup.', '');
    const date = new Date(parseInt(timestamp));
    log(`  ${index + 1}. ${file} (${date.toLocaleString('zh-CN')})`, '');
  });
  log('', '');

  // 确认回滚
  const answer1 = await question('是否继续回滚？(y/N): ');
  if (answer1.toLowerCase() !== 'y') {
    log('已取消回滚', '✅');
    rl.close();
    process.exit(0);
  }

  // 选择备份文件
  let selectedBackup;
  if (backupFiles.length === 1) {
    selectedBackup = backupFiles[0];
    log(`将使用：${selectedBackup}`, '📌');
  } else {
    const answer2 = await question(`请选择备份文件 (1-${backupFiles.length}，默认1): `);
    const index = parseInt(answer2 || '1') - 1;

    if (index < 0 || index >= backupFiles.length) {
      log('无效的选择', '❌');
      rl.close();
      process.exit(1);
    }

    selectedBackup = backupFiles[index];
  }

  log('', '');

  // 执行回滚
  try {
    const backupPath = path.join(hooksDir, selectedBackup);
    const targetPath = path.join(hooksDir, 'hooks.json');

    // 先备份当前的 v2.1 配置
    const v21BackupPath = `${targetPath}.v2.1.backup`;
    if (fs.existsSync(targetPath)) {
      fs.copyFileSync(targetPath, v21BackupPath);
      log(`已备份当前配置：${path.basename(v21BackupPath)}`, '✅');
    }

    // 恢复旧配置
    fs.copyFileSync(backupPath, targetPath);
    log('已恢复到优化前的配置', '✅');

    // 读取配置验证
    const config = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    const isV21 = config.hooks?.SessionStart?.[0]?.hooks?.[0]?.args?.[0]?.includes('session-init-enhanced');

    if (isV21) {
      log('警告：恢复的配置似乎仍是 v2.1 版本', '⚠️');
    } else {
      log('配置已确认为优化前版本', '✅');
    }

  } catch (err) {
    log(`回滚失败：${err.message}`, '❌');
    rl.close();
    process.exit(1);
  }

  log('', '');
  log('═'.repeat(70), '');
  log('回滚完成', '🎉');
  log('═'.repeat(70), '');
  log('', '');

  log('下一步操作：', '📋');
  log('  1. 重启 Claude Code 会话（运行 /clear 或重新启动）', '');
  log('  2. 验证配置是否生效', '');
  log('', '');

  log('重要提醒：', '⚠️');
  log('  回滚后，auto 模式的保护将失效', '');
  log('  如需重新部署，运行：', '');
  log('  node .claude/scripts/deploy-risk1-optimization.mjs', '');
  log('', '');

  rl.close();
}

// 运行回滚
rollback().catch(err => {
  console.error(`❌ 回滚脚本异常：${err.message}`);
  console.error(err.stack);
  rl.close();
  process.exit(1);
});
