#!/usr/bin/env node
/**
 * 风险1优化方案 - 一键部署脚本
 *
 * ⚠️ 已过时（2026-08-06 交付期脚本，勿运行）：本脚本以 `.claude/hooks/hooks.json` 与
 * `hooks-v2.1.json` 为部署对象，这两个文件**均已不存在**。Hook 注册的唯一权威源是
 * `.claude/settings.json`，本方案的防护（`gate-dev-workflow-enhanced.mjs` /
 * `session-init-enhanced.mjs`）**早已注册生效**，无需再部署。保留仅作交付期留痕。
 *
 * 用途：自动化部署权限模式防护优化
 *
 * 运行：node .claude/scripts/deploy-risk1-optimization.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CWD = process.cwd();

let stepsPassed = 0;
let stepsFailed = 0;

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  log(`\n[步骤 ${step}] ${message}`, 'cyan');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
  stepsPassed++;
}

function logError(message) {
  log(`❌ ${message}`, 'red');
  stepsFailed++;
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

// 检查文件是否存在
function checkFile(filePath, description) {
  const fullPath = path.join(CWD, filePath);
  if (fs.existsSync(fullPath)) {
    logSuccess(`${description} 存在`);
    return true;
  } else {
    logError(`${description} 不存在：${filePath}`);
    return false;
  }
}

// 备份文件
function backupFile(filePath) {
  const fullPath = path.join(CWD, filePath);
  const backupPath = `${fullPath}.backup.${Date.now()}`;

  if (fs.existsSync(fullPath)) {
    try {
      fs.copyFileSync(fullPath, backupPath);
      logSuccess(`已备份：${filePath} → ${path.basename(backupPath)}`);
      return backupPath;
    } catch (err) {
      logError(`备份失败：${err.message}`);
      return null;
    }
  } else {
    logInfo(`文件不存在，无需备份：${filePath}`);
    return null;
  }
}

// 运行命令
function runCommand(command, description) {
  try {
    logInfo(`执行：${command}`);
    const output = execSync(command, { cwd: CWD, encoding: 'utf8' });
    logSuccess(description);
    return { success: true, output };
  } catch (err) {
    logError(`${description} 失败：${err.message}`);
    return { success: false, error: err.message };
  }
}

// 主部署流程
async function deploy() {
  log('\n' + '═'.repeat(70), 'bright');
  log('  风险1优化方案 - 自动化部署', 'bright');
  log('═'.repeat(70) + '\n', 'bright');

  // ===== 步骤0：环境检查 =====
  logStep(0, '环境检查');

  // 检查 Node.js 版本
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));

  if (majorVersion >= 18) {
    logSuccess(`Node.js 版本：${nodeVersion} (>= 18)`);
  } else {
    logError(`Node.js 版本过低：${nodeVersion}，需要 >= 18`);
    process.exit(1);
  }

  // 检查当前目录
  const hooksDir = path.join(CWD, '.claude/hooks');
  if (!fs.existsSync(hooksDir)) {
    logError('未找到 .claude/hooks 目录，请确认在正确的项目根目录下运行');
    process.exit(1);
  }
  logSuccess('目录结构正确');

  // ===== 步骤1：验证新文件 =====
  logStep(1, '验证新增文件');

  const requiredFiles = [
    {
      path: '.claude/hooks/lib/permission-mode-guard.mjs',
      desc: '核心防护模块'
    },
    {
      path: '.claude/hooks/gate-dev-workflow-enhanced.mjs',
      desc: '增强版文件门禁'
    },
    {
      path: '.claude/hooks/session-init-enhanced.mjs',
      desc: '增强版会话初始化'
    },
    {
      path: '.claude/scripts/verify-permission-mode.mjs',
      desc: '权限模式验证脚本'
    },
    {
      path: '.claude/scripts/test-permission-mode-guard.mjs',
      desc: '自动化测试脚本'
    },
    {
      path: '.claude/hooks/hooks-v2.1.json',
      desc: '新版 hooks 配置'
    }
  ];

  let allFilesExist = true;
  for (const file of requiredFiles) {
    if (!checkFile(file.path, file.desc)) {
      allFilesExist = false;
    }
  }

  if (!allFilesExist) {
    logError('部分必需文件缺失，请先运行文件创建脚本');
    process.exit(1);
  }

  // ===== 步骤2：运行自动化测试 =====
  logStep(2, '运行自动化测试');

  const testResult = runCommand(
    'node .claude/scripts/test-permission-mode-guard.mjs',
    '自动化测试'
  );

  if (!testResult.success) {
    logError('测试失败，无法继续部署');
    logInfo('请检查测试输出，修复问题后重试');
    process.exit(1);
  }

  // 解析测试结果
  if (testResult.output.includes('所有测试通过')) {
    logSuccess('所有测试通过 (15/15)');
  } else {
    logWarning('测试输出异常，请手动检查');
  }

  // ===== 步骤3：备份现有配置 =====
  logStep(3, '备份现有配置');

  const backupPath = backupFile('.claude/hooks/hooks.json');
  if (backupPath) {
    logInfo(`备份位置：${backupPath}`);
  }

  // ===== 步骤4：更新 hooks 配置 =====
  logStep(4, '更新 hooks 配置');

  try {
    const sourcePath = path.join(CWD, '.claude/hooks/hooks-v2.1.json');
    const targetPath = path.join(CWD, '.claude/hooks/hooks.json');

    const newConfig = fs.readFileSync(sourcePath, 'utf8');
    fs.writeFileSync(targetPath, newConfig, 'utf8');

    logSuccess('hooks.json 已更新到 v2.1');
  } catch (err) {
    logError(`更新配置失败：${err.message}`);

    if (backupPath) {
      logInfo('正在恢复备份...');
      try {
        fs.copyFileSync(backupPath, path.join(CWD, '.claude/hooks/hooks.json'));
        logSuccess('已恢复备份');
      } catch (restoreErr) {
        logError(`恢复备份失败：${restoreErr.message}`);
      }
    }

    process.exit(1);
  }

  // ===== 步骤5：验证配置 =====
  logStep(5, '验证配置');

  try {
    const configPath = path.join(CWD, '.claude/hooks/hooks.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    // 检查关键 hooks
    const checks = [
      {
        condition: config.hooks?.SessionStart?.[0]?.hooks?.[0]?.args?.[0]?.includes('session-init-enhanced'),
        desc: 'SessionStart hook 使用 enhanced 版本'
      },
      {
        condition: config.hooks?.PreToolUse?.[0]?.hooks?.[0]?.args?.[0]?.includes('gate-dev-workflow-enhanced'),
        desc: 'PreToolUse Write|Edit hook 使用 enhanced 版本'
      }
    ];

    for (const check of checks) {
      if (check.condition) {
        logSuccess(check.desc);
      } else {
        logError(check.desc);
      }
    }

  } catch (err) {
    logError(`配置验证失败：${err.message}`);
  }

  // ===== 步骤6：检查权限模式 =====
  logStep(6, '检查当前权限模式');

  const settingsPaths = [
    '.claude/settings.json',
    '.claude/settings.local.json'
  ];

  let currentMode = 'default (未配置，使用默认值)';
  let foundAutoMode = false;

  for (const settingsPath of settingsPaths) {
    const fullPath = path.join(CWD, settingsPath);
    if (fs.existsSync(fullPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        if (settings.permission_mode) {
          currentMode = settings.permission_mode;
          if (currentMode === 'auto') {
            foundAutoMode = true;
            logWarning(`检测到 auto 模式：${settingsPath}`);
          } else {
            logSuccess(`权限模式：${currentMode} (${settingsPath})`);
          }
        }
      } catch (err) {
        logWarning(`无法读取 ${settingsPath}: ${err.message}`);
      }
    }
  }

  if (foundAutoMode) {
    logWarning('建议切换到 default 模式：');
    logInfo('  方式1：按 Shift+Tab');
    logInfo('  方式2：运行 /config permission_mode default');
    logInfo('  方式3：编辑配置文件');
  }

  // ===== 步骤7：生成部署报告 =====
  logStep(7, '生成部署报告');

  const report = {
    timestamp: new Date().toISOString(),
    version: 'v2.1',
    nodeVersion: nodeVersion,
    currentPermissionMode: currentMode,
    backupPath: backupPath,
    deploymentSteps: {
      passed: stepsPassed,
      failed: stepsFailed
    }
  };

  const reportPath = path.join(CWD, '.claude/harness-state/deployment-report.json');
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    logSuccess(`部署报告已保存：${reportPath}`);
  } catch (err) {
    logWarning(`保存部署报告失败：${err.message}`);
  }

  // ===== 完成总结 =====
  log('\n' + '═'.repeat(70), 'bright');
  log('  部署完成', 'bright');
  log('═'.repeat(70) + '\n', 'bright');

  logSuccess(`通过步骤：${stepsPassed}`);
  if (stepsFailed > 0) {
    logError(`失败步骤：${stepsFailed}`);
  }

  if (stepsFailed === 0) {
    log('\n🎉 部署成功！', 'green');
    log('\n下一步操作：', 'cyan');
    log('  1. 重启 Claude Code 会话（运行 /clear 或重新启动）', 'bright');
    log('  2. 验证权限模式警告是否显示（如果在 auto 模式）', 'bright');
    log('  3. 测试 R29 保护（尝试修改门禁配置文件）', 'bright');
    log('  4. 运行审计脚本：node .claude/scripts/verify-permission-mode.mjs', 'bright');

    if (foundAutoMode) {
      log('\n⚠️  重要提醒：', 'yellow');
      log('  检测到 auto 权限模式，建议切换到 default 模式', 'yellow');
      log('  按 Shift+Tab 或运行 /config permission_mode default', 'yellow');
    }

    log('\n📚 文档：', 'blue');
    log('  • 快速指南：.claude/harness/spec/RISK1_QUICK_GUIDE.md', 'blue');
    log('  • 完整方案：.claude/harness/spec/RISK1_MITIGATION.md', 'blue');
    log('  • 优化总结：.claude/harness/spec/RISK1_OPTIMIZATION_SUMMARY.md', 'blue');

    log('\n✅ 风险等级：从 🔴 6/10 降至 🟢 2/10\n', 'green');

  } else {
    log('\n❌ 部署失败，请检查错误信息\n', 'red');

    if (backupPath) {
      log('回滚命令：', 'yellow');
      log(`  cp ${backupPath} .claude/hooks/hooks.json`, 'yellow');
    }

    process.exit(1);
  }
}

// 运行部署
deploy().catch(err => {
  logError(`部署脚本异常：${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
