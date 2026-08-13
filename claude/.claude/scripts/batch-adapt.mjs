#!/usr/bin/env node
/**
 * 批量适配脚本：将 cursor 规约文件复制并适配到 claude 目录
 *
 * 用法：node .claude/scripts/batch-adapt.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

// 适配映射
const adaptations = {
  // 文本替换规则
  textReplacements: [
    { from: /\.cursor\//g, to: '.claude/' },
    { from: /\`\.cursor\//g, to: '`.claude/' },
    { from: /AGENTS\.md/g, to: 'CLAUDE.md' },
    { from: /AskQuestion/g, to: 'AskUserQuestion' },
    { from: /\bTask\b(?!\w)/g, to: 'Agent' },
    { from: /发起 Task/g, to: '发起 Agent' },
    { from: /调用 Task/g, to: '调用 Agent' },
    { from: /Task 工具/g, to: 'Agent 工具' },
  ],

  // 需要添加的适配说明模板
  adaptationNote: `
> **Claude Code 适配说明**：
> - 使用 \`Agent\` 工具替代 Cursor 的 \`Task\` 工具
> - 使用 \`AskUserQuestion\` 替代 \`AskQuestion\`
> - Hook 已技术强制拦截（\`.claude/settings.json\` 注册）；机械层判不到的部分（阶段顺序、确认真实性）仍须主动自检
`,

  // 模型映射
  modelMapping: {
    'grok-4.5': 'claude-opus-5',
    'claude-opus-5': 'claude-opus-5',
    'claude-sonnet-5': 'claude-sonnet-5',
    'gpt-5.6-terra': 'claude-opus-5',
  }
};

// 需要适配的文件列表
const filesToAdapt = [
  // 角色定义
  {
    src: '../cursor/.cursor/agents/system-architect.md',
    dest: '.claude/agents/system-architect.md',
    type: 'agent'
  },
  {
    src: '../cursor/.cursor/agents/requirement-reviewer.md',
    dest: '.claude/agents/requirement-reviewer.md',
    type: 'agent'
  },
  {
    src: '../cursor/.cursor/agents/quality-engineer.md',
    dest: '.claude/agents/quality-engineer.md',
    type: 'agent'
  },
  {
    src: '../cursor/.cursor/agents/test-engineer.md',
    dest: '.claude/agents/test-engineer.md',
    type: 'agent'
  },

  // 规格说明文档
  {
    src: '../cursor/.cursor/harness/spec/rule-index.md',
    dest: '.claude/harness/spec/rule-index.md',
    type: 'spec'
  },
  {
    src: '../cursor/.cursor/harness/spec/gate-chain.md',
    dest: '.claude/harness/spec/gate-chain.md',
    type: 'spec'
  },
  {
    src: '../cursor/.cursor/harness/spec/workflow-modes.md',
    dest: '.claude/harness/spec/workflow-modes.md',
    type: 'spec'
  },
  {
    src: '../cursor/.cursor/harness/spec/mechanical-gates.md',
    dest: '.claude/harness/spec/mechanical-gates.md',
    type: 'spec'
  },
  {
    src: '../cursor/.cursor/harness/spec/rollback.md',
    dest: '.claude/harness/spec/rollback.md',
    type: 'spec'
  },

  // 模板文件
  {
    src: '../cursor/.cursor/templates/requirement-spec.md',
    dest: '.claude/templates/requirement-spec.md',
    type: 'template'
  },
  {
    src: '../cursor/.cursor/templates/requirement-list.md',
    dest: '.claude/templates/requirement-list.md',
    type: 'template'
  },
  {
    src: '../cursor/.cursor/templates/detail-design-spec.md',
    dest: '.claude/templates/detail-design-spec.md',
    type: 'template'
  },
  {
    src: '../cursor/.cursor/templates/design-problem-list.md',
    dest: '.claude/templates/design-problem-list.md',
    type: 'template'
  },
  {
    src: '../cursor/.cursor/templates/develop-task-list.md',
    dest: '.claude/templates/develop-task-list.md',
    type: 'template'
  },
  {
    src: '../cursor/.cursor/templates/quality-report.md',
    dest: '.claude/templates/quality-report.md',
    type: 'template'
  },
  {
    src: '../cursor/.cursor/templates/test-report.md',
    dest: '.claude/templates/test-report.md',
    type: 'template'
  },
  {
    src: '../cursor/.cursor/templates/process.md',
    dest: '.claude/templates/process.md',
    type: 'template'
  },
  {
    src: '../cursor/.cursor/templates/tech-stack-options.md',
    dest: '.claude/templates/tech-stack-options.md',
    type: 'template'
  },

  // 脚本文件（直接复制，仅改路径）
  {
    src: '../cursor/.cursor/scripts/bootstrap-docs.mjs',
    dest: '.claude/scripts/bootstrap-docs.mjs',
    type: 'script'
  },
  {
    src: '../cursor/.cursor/scripts/e2e-run.mjs',
    dest: '.claude/scripts/e2e-run.mjs',
    type: 'script'
  },
  {
    src: '../cursor/.cursor/scripts/lint-run.mjs',
    dest: '.claude/scripts/lint-run.mjs',
    type: 'script'
  },
  {
    src: '../cursor/.cursor/scripts/static-scan-run.mjs',
    dest: '.claude/scripts/static-scan-run.mjs',
    type: 'script'
  },
  {
    src: '../cursor/.cursor/scripts/startup-smoke-run.mjs',
    dest: '.claude/scripts/startup-smoke-run.mjs',
    type: 'script'
  },
];

/**
 * 适配文本内容
 */
function adaptContent(content, type) {
  let adapted = content;

  // 应用文本替换规则
  for (const rule of adaptations.textReplacements) {
    adapted = adapted.replace(rule.from, rule.to);
  }

  // 如果是 agent 文件，处理 frontmatter 中的 model
  if (type === 'agent') {
    adapted = adapted.replace(/^model: (.+)$/m, (match, model) => {
      const mappedModel = adaptations.modelMapping[model.trim()] || 'claude-opus-5';
      return `model: ${mappedModel}`;
    });

    // 在 frontmatter 后添加适配说明
    adapted = adapted.replace(/^---\n([\s\S]*?)\n---\n/, (match) => {
      return match + adaptations.adaptationNote;
    });
  }

  // 如果是 spec 文档，在开头添加适配说明
  if (type === 'spec') {
    const header = `# Claude Code 适配版本

本文档从 Cursor 版本适配而来。主要变更：
- 路径从 \`.cursor\` 改为 \`.claude\`
- Hook 机制改为文档化约束和主动自检
- \`Task\` 改为 \`Agent\`，\`AskQuestion\` 改为 \`AskUserQuestion\`

---

`;
    adapted = header + adapted;
  }

  return adapted;
}

/**
 * 确保目录存在
 */
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 适配单个文件
 */
function adaptFile(fileInfo) {
  const srcPath = path.resolve(projectRoot, fileInfo.src);
  const destPath = path.resolve(projectRoot, fileInfo.dest);

  if (!fs.existsSync(srcPath)) {
    console.log(`⚠️  源文件不存在: ${fileInfo.src}`);
    return false;
  }

  try {
    const content = fs.readFileSync(srcPath, 'utf8');
    const adapted = adaptContent(content, fileInfo.type);

    ensureDir(destPath);
    fs.writeFileSync(destPath, adapted, 'utf8');

    console.log(`✅ ${fileInfo.src} → ${fileInfo.dest}`);
    return true;
  } catch (error) {
    console.error(`❌ 适配失败: ${fileInfo.src}`, error.message);
    return false;
  }
}

/**
 * 主函数
 */
function main() {
  console.log('开始批量适配 Cursor 规约到 Claude Code...\n');

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const fileInfo of filesToAdapt) {
    const result = adaptFile(fileInfo);
    if (result === true) {
      success++;
    } else if (result === false) {
      failed++;
    } else {
      skipped++;
    }
  }

  console.log(`\n完成！成功: ${success}, 失败: ${failed}, 跳过: ${skipped}`);

  if (failed > 0) {
    process.exit(1);
  }
}

// 执行
main();
