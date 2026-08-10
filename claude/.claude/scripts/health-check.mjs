#!/usr/bin/env node
/**
 * Harness Engineering 工具链健康检查
 *
 * 检查所有必需和可选工具是否正确安装
 *
 * 使用方式:
 *   node .claude/scripts/health-check.mjs           # 仅检查
 *   node .claude/scripts/health-check.mjs --fix     # 自动修复
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function colorize(text, color) {
  return `${colors[color] || ''}${text}${colors.reset}`;
}

function execQuiet(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

function checkCommand(name, cmd, versionCmd, required = true) {
  const version = execQuiet(versionCmd || `${cmd} --version`);
  const status = {
    name,
    cmd,
    installed: !!version,
    version: version ? version.split('\n')[0] : null,
    required,
  };

  if (status.installed) {
    console.log(`${colorize('✅', 'green')} ${colorize(name, 'bright')}: ${colorize(status.version, 'dim')}`);
  } else {
    const icon = required ? colorize('❌', 'red') : colorize('⚠️ ', 'yellow');
    const label = required ? '未安装（必需）' : '未安装（可选）';
    console.log(`${icon} ${colorize(name, 'bright')}: ${label}`);
  }

  return status;
}

function checkFile(name, path, required = true) {
  const exists = existsSync(path);
  const status = {
    name,
    path,
    exists,
    required,
  };

  if (exists) {
    console.log(`${colorize('✅', 'green')} ${colorize(name, 'bright')}: ${colorize(path, 'dim')}`);
  } else {
    const icon = required ? colorize('❌', 'red') : colorize('⚠️ ', 'yellow');
    const label = required ? '缺失（必需）' : '缺失（可选）';
    console.log(`${icon} ${colorize(name, 'bright')}: ${label}`);
  }

  return status;
}

function printSection(title) {
  console.log(`\n${colorize(title, 'cyan')}`);
  console.log(colorize('─'.repeat(60), 'dim'));
}

function printFixSuggestion(tool, cmd) {
  console.log(`   ${colorize('修复:', 'cyan')} ${colorize(cmd, 'yellow')}`);
}

async function runHealthCheck(autoFix = false) {
  console.log(colorize('\n🔧 Harness Engineering 工具链健康检查\n', 'bright'));

  const results = {
    runtime: [],
    linters: [],
    testers: [],
    files: [],
    optional: [],
  };

  // 1. 运行时环境
  printSection('📦 运行时环境');
  results.runtime.push(checkCommand('Node.js', 'node', 'node --version'));
  results.runtime.push(checkCommand('npm', 'npm', 'npm --version'));
  results.runtime.push(checkCommand('Git', 'git', 'git --version'));

  // 2. Lint 工具
  printSection('🔍 Lint 工具（R15 门禁）');
  results.linters.push(checkCommand('ESLint', 'eslint', 'eslint --version'));

  // 检查项目级安装
  const projectEslint = existsSync(join(process.cwd(), 'node_modules', '.bin', 'eslint'));
  if (!results.linters[0].installed && projectEslint) {
    console.log(`   ${colorize('ℹ️  ESLint 已在项目级安装', 'cyan')}`);
    results.linters[0].installed = true;
    results.linters[0].projectLevel = true;
  }

  // 3. 静态扫描工具
  printSection('🛡️  静态扫描工具（R16 门禁）');
  results.linters.push(checkCommand('jscpd', 'jscpd', 'jscpd --version', true));

  // 4. 测试工具
  printSection('🧪 测试工具（R32/R34 门禁）');
  results.testers.push(checkCommand('Playwright', 'playwright', 'playwright --version', true));

  // 检查项目级 Playwright
  const projectPlaywright = existsSync(join(process.cwd(), 'node_modules', '.bin', 'playwright'));
  if (!results.testers[0].installed && projectPlaywright) {
    console.log(`   ${colorize('ℹ️  Playwright 已在项目级安装', 'cyan')}`);
    results.testers[0].installed = true;
    results.testers[0].projectLevel = true;
  }

  // 5. 可选工具
  printSection('➕ 可选工具');
  results.optional.push(checkCommand('Python', 'python', 'python --version', false));
  results.optional.push(checkCommand('Docker', 'docker', 'docker --version', false));

  // 6. 关键文件
  printSection('📁 关键配置文件');
  results.files.push(checkFile('规约文档', join(process.cwd(), 'CLAUDE.md'), true));
  results.files.push(checkFile('Harness 配置', join(process.cwd(), '.claude', 'harness.config.json'), true));
  results.files.push(checkFile('Hooks 配置', join(process.cwd(), '.claude', 'hooks.json'), false));

  // 7. 统计
  printSection('📊 检查结果汇总');

  const allChecks = [
    ...results.runtime,
    ...results.linters,
    ...results.testers,
    ...results.files,
  ];

  const requiredChecks = allChecks.filter(c => c.required);
  const passedRequired = requiredChecks.filter(c => c.installed || c.exists).length;
  const totalRequired = requiredChecks.length;

  const optionalChecks = [...results.optional];
  const passedOptional = optionalChecks.filter(c => c.installed).length;
  const totalOptional = optionalChecks.length;

  console.log(`必需项: ${passedRequired}/${totalRequired} ${passedRequired === totalRequired ? colorize('✅', 'green') : colorize('❌', 'red')}`);
  console.log(`可选项: ${passedOptional}/${totalOptional} ${colorize('ℹ️ ', 'cyan')}`);

  // 8. 修复建议
  const failed = allChecks.filter(c => c.required && !(c.installed || c.exists));

  if (failed.length > 0) {
    printSection('🔧 修复建议');

    failed.forEach(item => {
      console.log(`\n${colorize(item.name, 'yellow')}:`);

      if (item.cmd === 'node') {
        printFixSuggestion(item, 'winget install OpenJS.NodeJS');
        console.log(`   或访问: ${colorize('https://nodejs.org/', 'dim')}`);
      } else if (item.cmd === 'git') {
        printFixSuggestion(item, 'winget install Git.Git');
        console.log(`   或访问: ${colorize('https://git-scm.com/', 'dim')}`);
      } else if (item.cmd === 'eslint') {
        printFixSuggestion(item, 'npm install -g eslint');
        console.log(`   或项目级: ${colorize('npm install --save-dev eslint', 'dim')}`);

        if (autoFix) {
          console.log(`   ${colorize('正在安装...', 'cyan')}`);
          try {
            execSync('npm install -g eslint', { stdio: 'inherit' });
            console.log(`   ${colorize('✅ 安装成功', 'green')}`);
          } catch (err) {
            console.log(`   ${colorize('❌ 安装失败，请手动安装', 'red')}`);
          }
        }
      } else if (item.cmd === 'jscpd') {
        printFixSuggestion(item, 'npm install -g jscpd');

        if (autoFix) {
          console.log(`   ${colorize('正在安装...', 'cyan')}`);
          try {
            execSync('npm install -g jscpd', { stdio: 'inherit' });
            console.log(`   ${colorize('✅ 安装成功', 'green')}`);
          } catch (err) {
            console.log(`   ${colorize('❌ 安装失败，请手动安装', 'red')}`);
          }
        }
      } else if (item.cmd === 'playwright') {
        printFixSuggestion(item, 'npm install -g playwright');
        console.log(`   然后运行: ${colorize('playwright install', 'dim')}`);
        console.log(`   或项目级: ${colorize('npm install --save-dev @playwright/test', 'dim')}`);

        if (autoFix) {
          console.log(`   ${colorize('正在安装...', 'cyan')}`);
          try {
            execSync('npm install -g playwright', { stdio: 'inherit' });
            execSync('playwright install', { stdio: 'inherit' });
            console.log(`   ${colorize('✅ 安装成功', 'green')}`);
          } catch (err) {
            console.log(`   ${colorize('❌ 安装失败，请手动安装', 'red')}`);
          }
        }
      } else if (item.path) {
        console.log(`   ${colorize('文件缺失:', 'yellow')} ${item.path}`);
        console.log(`   ${colorize('请确保在正确的项目目录运行此脚本', 'dim')}`);
      }
    });
  }

  // 9. 总结
  console.log('\n');
  if (passedRequired === totalRequired) {
    console.log(colorize('✅ 工具链健康检查通过！所有必需工具已就绪', 'green'));
    console.log(colorize('   你可以开始使用 Harness Engineering 规约了', 'dim'));
  } else {
    console.log(colorize('❌ 工具链不完整，请安装缺失的必需工具', 'red'));
    if (!autoFix) {
      console.log(colorize('   提示: 运行 node .claude/scripts/health-check.mjs --fix 自动安装', 'dim'));
    }
  }

  console.log('\n');

  return passedRequired === totalRequired ? 0 : 1;
}

// 主入口
const autoFix = process.argv.includes('--fix');

runHealthCheck(autoFix)
  .then(exitCode => process.exit(exitCode))
  .catch(err => {
    console.error(colorize(`\n❌ 错误: ${err.message}`, 'red'));
    process.exit(1);
  });
