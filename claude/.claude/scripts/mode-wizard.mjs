#!/usr/bin/env node
/**
 * Harness Engineering 工作流模式选择向导
 *
 * 通过交互式问答帮助用户选择最适合的工作流模式
 *
 * 使用方式:
 *   node .claude/scripts/mode-wizard.mjs
 */

import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

function colorize(text, color) {
  return `${colors[color] || ''}${text}${colors.reset}`;
}

function ask(question, options) {
  return new Promise((resolve) => {
    console.log(`\n${colorize(question, 'cyan')}`);
    options.forEach((opt, idx) => {
      console.log(`  ${colorize(`[${idx + 1}]`, 'yellow')} ${opt}`);
    });
    rl.question('\n请选择 (输入数字): ', (answer) => {
      const choice = parseInt(answer.trim(), 10) - 1;
      if (choice >= 0 && choice < options.length) {
        resolve(choice);
      } else {
        console.log(colorize('❌ 无效选择，请重新输入', 'yellow'));
        resolve(ask(question, options));
      }
    });
  });
}

function printResult(result) {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('🎯 推荐的工作流模式', 'bright'));
  console.log('='.repeat(60));
  console.log(`\n${colorize('模式:', 'cyan')} ${colorize(result.mode, 'green')}`);
  console.log(`${colorize('原因:', 'cyan')} ${result.reason}`);
  console.log(`${colorize('预计耗时:', 'cyan')} ${result.estimatedTime}`);
  console.log(`${colorize('涉及角色:', 'cyan')} ${result.roles}`);
  console.log(`\n${colorize('流程说明:', 'cyan')}`);
  console.log(`  ${result.description}`);

  if (result.preconditions && result.preconditions.length > 0) {
    console.log(`\n${colorize('前置条件:', 'yellow')}`);
    result.preconditions.forEach(cond => {
      console.log(`  ${cond.met ? '✅' : '❌'} ${cond.text}`);
    });
  }

  if (result.warnings && result.warnings.length > 0) {
    console.log(`\n${colorize('⚠️  注意事项:', 'yellow')}`);
    result.warnings.forEach(warn => {
      console.log(`  - ${warn}`);
    });
  }

  console.log(`\n${colorize('启动命令:', 'cyan')}`);
  console.log(colorize(`  "${result.startCommand}"`, 'blue'));
  console.log('\n' + '='.repeat(60) + '\n');
}

async function runWizard() {
  console.log(colorize('\n🎯 Harness Engineering 工作流模式选择向导\n', 'bright'));
  console.log('通过几个简单问题，帮你选择最适合的工作流模式\n');

  // 问题 1: 工作类型
  const q1 = await ask('这是什么类型的工作？', [
    '🆕 新建项目/新功能',
    '🐛 修复 Bug',
    '📝 只改文档',
    '➕ 小功能增量（在已有项目基础上）',
  ]);

  // docs-only 直接返回
  if (q1 === 2) {
    printResult({
      mode: 'docs-only',
      reason: '仅修改文档，无需开发流程',
      estimatedTime: '10-30 分钟',
      roles: 'PM（项目经理）直接操作',
      description: 'Hook 会拒绝一切源码与构建产物写入（含 e2e/**）；文档与仓库元文件可改',
      startCommand: '使用 Harness Engineering 规约，按 docs-only 模式更新文档',
      warnings: [
        '此模式下无法修改源码文件',
        '如果需要更新代码注释，请选择其他模式',
      ],
    });
    rl.close();
    return;
  }

  // 问题 2: 是否已有设计文档
  const q2 = await ask('项目是否已有设计文档 (docs/detail-design-spec.md)？', [
    '✅ 有，已经存在完整的设计文档',
    '❌ 没有，需要从头设计',
    '🤔 不确定',
  ]);

  const hasDesign = q2 === 0;

  // Bug 修复分支
  if (q1 === 1) {
    if (hasDesign) {
      // 确认是否需要架构变更
      const q3 = await ask('这个 Bug 修复是否涉及架构变更或新功能？', [
        '否，只是简单的代码修复',
        '是，需要改动架构或添加新逻辑',
      ]);

      if (q3 === 0) {
        printResult({
          mode: 'hotfix',
          reason: 'Bug 修复且已有设计，不涉及架构变更',
          estimatedTime: '3-5 小时',
          roles: 'PM → DE → QE → TE（单次测试）',
          description: '跳过需求分析和系统架构，直接进入开发。测试环节折叠为单次集成测试+E2E',
          preconditions: [
            { met: true, text: '已有 detail-design-spec.md' },
            { met: true, text: '是缺陷修复，不是新功能' },
          ],
          startCommand: '使用 Harness Engineering 规约，按 hotfix 模式修复 [问题描述]',
          warnings: [
            'PM 会执行 R9 最小影响澄清（受影响用户、既有行为、回滚条件）',
            '如果发现需要新功能，会升级为 full 模式',
          ],
        });
      } else {
        printResult({
          mode: 'full',
          reason: 'Bug 修复但涉及架构变更，需要完整设计流程',
          estimatedTime: '3-4 天',
          roles: 'PM → RA → SA → RR → DE → QE → TE（批次+最终）',
          description: '完整的需求分析、架构设计、审核、开发、测试流程',
          startCommand: '使用 Harness Engineering 规约，按 full 模式修复 [问题描述]',
          warnings: [
            '涉及架构变更的 Bug 修复需要完整设计审核',
            '测试会分批次测试和最终测试两轮',
          ],
        });
      }
    } else {
      printResult({
        mode: 'full',
        reason: 'Bug 修复但无设计文档，需要先补设计',
        estimatedTime: '3-4 天',
        roles: 'PM → RA → SA → RR → DE → QE → TE（批次+最终）',
        description: '先补充最小热修设计，再进行完整开发流程',
        preconditions: [
          { met: false, text: '缺少 detail-design-spec.md' },
        ],
        startCommand: '使用 Harness Engineering 规约，按 full 模式修复 [问题描述]',
        warnings: [
          'SA 会先补充最小热修设计（R9 前置校验）',
          '如果是简单 Bug，建议先手动创建设计文档后用 hotfix 模式',
        ],
      });
    }
    rl.close();
    return;
  }

  // 新功能分支
  if (q1 === 0 || q1 === 3) {
    // 问题 3: 是否改 Schema
    // F-08：数据形状变更不再一刀切导向 full——判据落在**破坏性**上。
    // 先问形状是否变，再问是否需要迁移/破坏向后兼容；只有后者为「是」才禁用增量档。
    const q4 = await ask('是否会变更数据形状（新增/修改字段、表、集合）？', [
      '会，需要新增或修改字段、表、集合',
      '不会，只改业务逻辑或界面',
    ]);

    const changesShape = q4 === 0;
    let breakingChange = false;

    if (changesShape) {
      const q4b = await ask('该变更是否需要迁移脚本，或会破坏向后兼容？', [
        '会，需要迁移脚本，或改了字段类型/主键/表结构、删改了既有字段',
        '不会，只新增可选字段（有默认值），读取侧容忍缺失，无迁移脚本',
      ]);
      breakingChange = q4b === 0;
    }

    if (breakingChange) {
      printResult({
        mode: 'full',
        reason: '涉及迁移脚本或破坏向后兼容的变更，必须使用完整流程',
        estimatedTime: '3-4 天',
        roles: 'PM → RA → SA → RR → DE → QE → TE（批次+最终）',
        description: '迁移与不兼容变更需要完整测试覆盖，包括数据迁移、兼容性测试、回滚方案',
        startCommand: '使用 Harness Engineering 规约，按 full 模式 [目标描述]',
        warnings: [
          '需要迁移/破坏兼容的变更禁止使用 single-task 模式（R37/F-08）',
          '需要设计数据迁移脚本与回滚方案',
          '测试会覆盖数据兼容性和回滚场景',
        ],
      });
      rl.close();
      return;
    }

    // 不改 Schema 的情况
    if (q1 === 3 && hasDesign) {
      // 小功能增量且有设计
      const q5 = await ask('是否会新增对外 API 接口？', [
        '会，需要新增或修改对外 API',
        '不会，只在已有接口基础上工作',
      ]);

      const newApi = q5 === 0;

      printResult({
        mode: 'single-task',
        reason: '功能增量，已有设计，不改 Schema',
        estimatedTime: '2-3 天',
        roles: 'PM → RA → SA → RR → DE → QE → TE（单轮测试）',
        description: '保留所有角色和验证，但测试折叠为单轮。豁免技术选型确认（沿用已有技术栈）',
        preconditions: [
          { met: true, text: '已有 detail-design-spec.md' },
          { met: true, text: '不需要迁移脚本、不破坏向后兼容' },
          { met: newApi, text: newApi ? '会新增对外 API（需 R14 接口测试）' : '不新增 API' },
        ],
        startCommand: '使用 Harness Engineering 规约，按 single-task 模式 [目标描述]',
        warnings: [
          'PM 会在 process.md 声明"增量范围"五维影响面',
          '所有质量门禁保留（R15/R16/R32/R34）',
          newApi ? 'R14 接口测试会并入单轮测试' : '',
          changesShape
            ? '数据形状有变更：须在"增量范围"两维说明中写明兼容性回归用例，并在单轮测试报告中落地其执行记录（R37/F-08），否则不得收尾'
            : '',
          '设计审核 12 维度一个不省',
        ].filter(Boolean),
      });
    } else {
      // 新功能或无设计
      printResult({
        mode: 'full',
        reason: q1 === 0 ? '新建项目需要完整设计' : '功能增量但无设计文档',
        estimatedTime: '3-4 天',
        roles: 'PM → RA → SA → RR → DE → QE → TE（批次+最终）',
        description: '完整的需求分析、架构设计、审核、开发、测试流程',
        preconditions: hasDesign ? [] : [
          { met: false, text: '缺少 detail-design-spec.md' },
        ],
        startCommand: '使用 Harness Engineering 规约，按 full 模式 [目标描述]',
        warnings: [
          'RA 会通过苏格拉底式提问充分澄清需求',
          'SA 会进行技术选型，需要用户确认（R26）',
          '测试分两轮：批次测试 + 最终整体测试',
        ],
      });
    }
  }

  rl.close();
}

// 运行向导
runWizard().catch((err) => {
  console.error(colorize(`\n❌ 错误: ${err.message}`, 'yellow'));
  rl.close();
  process.exit(1);
});
