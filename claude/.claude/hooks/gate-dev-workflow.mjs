#!/usr/bin/env node
/**
 * PreToolUse 门禁（Write / Edit）
 *
 * 职责：在写文件工具真正落盘前，对受门禁路径做确定性拦截。
 *
 * 拦截范围：
 *   - 源码 / 构建 / 根敏感路径（isGatedDevPath）
 *   - docs 角色成果物（isGatedRoleArtifactPath）
 *   - R6：.claude/scripts|agents|hooks/** 与代码扩展名默认门禁
 *   - R29：门禁自治资产（运行时标记 / 授权凭证 / 门禁配置与权威文本）
 *
 * 判定顺序（命中即 deny）：
 *   R10 cancelled → R29 自治资产 → R5 身份基准 → R5 顶层 session_id
 *   → R5 角色↔路径 →（仅源码路径）分派计划 + R3/R9/阻塞 → allow
 *
 * Claude Code 返回格式：
 * {
 *   "hookSpecificOutput": {
 *     "hookEventName": "PreToolUse",
 *     "permissionDecision": "allow|deny|ask",
 *     "permissionDecisionReason": "原因说明",
 *     "additionalContext": "给 Claude 的额外信息"
 *   }
 * }
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取标准输入（Claude Code 传递的 JSON）
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// 返回 Hook 决策
function returnDecision(decision, reason, additionalContext = null) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason
    }
  };

  if (additionalContext) {
    output.hookSpecificOutput.additionalContext = additionalContext;
  }

  console.log(JSON.stringify(output));
  process.exit(0);
}

// 阻止操作
function deny(reason, context = null) {
  returnDecision('deny', reason, context);
}

// 允许操作
function allow(reason = null) {
  returnDecision('allow', reason || 'Gate passed');
}

// 询问用户
function ask(reason, context = null) {
  returnDecision('ask', reason, context);
}

// 主逻辑
async function main() {
  try {
    const input = await readStdin();
    const hook = JSON.parse(input);

    const toolName = hook.tool_name;
    const toolInput = hook.tool_input || {};
    const sessionId = hook.session_id;
    const agentId = hook.agent_id;
    const agentType = hook.agent_type;
    const cwd = hook.cwd;

    // 获取目标路径
    const targetPath = toolInput.file_path;

    if (!targetPath) {
      // 没有路径信息，放行
      return allow('No file path to check');
    }

    // 规范化路径
    const absolutePath = path.isAbsolute(targetPath)
      ? targetPath
      : path.resolve(cwd, targetPath);

    const relativePath = path.relative(cwd, absolutePath);

    // === R10: 流程已取消，冻结所有写入 ===
    const processPath = findActiveProcessFile(cwd);
    if (processPath && isProcessCancelled(processPath)) {
      return deny(
        'R10: 流程已取消，禁止修改任何文件',
        '该 process.md 已标记为 cancelled，不可恢复。请启动新流程。'
      );
    }

    // === R29: 门禁自治资产，禁止任何代理写入 ===
    if (isSelfGovernedAsset(relativePath)) {
      return deny(
        'R29: 门禁自治资产禁止代理写入',
        `文件 ${relativePath} 属于门禁配置或权威文档，只能由用户本人编辑。如需修改，请将建议呈现给用户。`
      );
    }

    // === R5: 身份识别 - 顶层代理不得代行子角色职责 ===
    const isTopLevel = !agentId || agentId === sessionId;

    if (isTopLevel && isGatedDevPath(relativePath)) {
      // 顶层代理试图写入受门禁路径
      return deny(
        'R5: 顶层代理不得直接写入受门禁路径',
        `请通过 Agent 工具派发对应角色完成此操作。受门禁路径须在子 Agent 上下文中写入。`
      );
    }

    // === R5: 角色↔路径匹配 ===
    if (agentType && isGatedDevPath(relativePath)) {
      const expectedRoles = getExpectedRolesForPath(relativePath);

      if (expectedRoles.length > 0 && !expectedRoles.includes(agentType)) {
        // 最近派发的角色检查
        const lastDispatchedRole = getLastDispatchedRole(processPath);

        if (lastDispatchedRole && lastDispatchedRole !== agentType) {
          // R21: 最近派发为非 DE 时对产品源码路径直接 deny
          if (isProductSourcePath(relativePath) && agentType !== 'development-engineer') {
            return deny(
              'R21: 非开发工程师不得写入产品源码',
              `路径 ${relativePath} 是产品源码，当前角色 ${agentType} 无权写入。`
            );
          }
        }

        return deny(
          'R5: 角色与路径不匹配',
          `路径 ${relativePath} 应由 ${expectedRoles.join('或')} 写入，当前角色是 ${agentType}。`
        );
      }
    }

    // === docs-only 模式检查 ===
    if (processPath) {
      const workflowMode = getWorkflowMode(processPath);

      if (workflowMode === 'docs-only' && !isDocsPath(relativePath)) {
        return deny(
          'docs-only 模式禁止写入源码',
          `当前工作流模式为 docs-only，只能修改 docs/**/*.md 文件。`
        );
      }
    }

    // === 分派计划检查（仅源码路径） ===
    if (isProductSourcePath(relativePath)) {
      if (processPath) {
        const dispatchPlan = getDispatchPlan(processPath);

        if (!dispatchPlan || !dispatchPlan.valid) {
          return deny(
            '无有效分派计划',
            '写入产品源码前须有项目经理的有效分派计划。'
          );
        }

        // R3: 非 hotfix/docs-only 迭代须有四件成果物
        if (!isLiteModeConfirmed(processPath)) {
          const artifacts = checkIterationArtifacts(cwd);
          if (!artifacts.allPresent) {
            return deny(
              'R3: 缺少必要的成果物',
              `开发前须存在：${artifacts.missing.join(', ')}`
            );
          }
        }

        // 阻塞状态检查
        if (isBlocking(processPath)) {
          return deny(
            '流程处于阻塞状态',
            '须解除阻塞后才能继续开发。'
          );
        }
      }
    }

    // === E2E 测试路径检查（R23） ===
    if (isE2eTestPath(relativePath)) {
      if (agentType !== 'test-engineer') {
        return deny(
          'R23: e2e/** 路径须由测试工程师写入',
          `当前角色 ${agentType || '顶层'} 无权写入 E2E 测试。`
        );
      }
    }

    // 所有检查通过，允许写入
    return allow(`Gate passed for ${relativePath}`);

  } catch (error) {
    // 错误处理：fail-closed
    console.error(`[gate-dev-workflow] Error: ${error.message}`);
    return deny(
      '门禁判定异常',
      `门禁脚本执行出错：${error.message}。为安全起见拒绝操作。`
    );
  }
}

// ============ 辅助函数 ============

function findActiveProcessFile(cwd) {
  // 查找活跃的 process.md
  const candidates = [
    path.join(cwd, 'docs/process/process.md'),
    path.join(cwd, 'docs/*/process/process.md')
  ];

  // 简化实现：假设在 docs/process/process.md
  const defaultPath = path.join(cwd, 'docs/process/process.md');
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }

  return null;
}

function isProcessCancelled(processPath) {
  try {
    const content = fs.readFileSync(processPath, 'utf8');
    // 检查 frontmatter 中的 cancelled: true
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (match) {
      return /cancelled:\s*true/i.test(match[1]);
    }
  } catch (e) {
    // 读取失败，保守起见认为未取消
  }
  return false;
}

function isSelfGovernedAsset(relativePath) {
  // R29: 门禁自治资产
  // 【跨平台修复】规范化路径分隔符为正斜杠（Windows 使用反斜杠）
  const normalized = relativePath.replace(/\\/g, '/');

  const patterns = [
    /^\.claude\/hooks\//,
    /^\.claude\/harness\.config\.json$/,
    /^\.claude\/harness-state\.json$/,
    /^CLAUDE\.md$/,
    /^\.claude\/harness\/spec\//,
    /^\.claude\/hooks\/.+\.json$/
  ];

  return patterns.some(p => p.test(normalized));
}

function isGatedDevPath(relativePath) {
  // 受门禁的开发路径
  // 【跨平台修复】规范化路径分隔符
  const normalized = relativePath.replace(/\\/g, '/');

  const sourceDirs = [
    'src', 'lib', 'app', 'components', 'pages', 'api',
    'services', 'handlers', 'backend', 'frontend'
  ];

  // 检查是否在源码目录
  const firstDir = normalized.split('/')[0];
  if (sourceDirs.includes(firstDir)) {
    return true;
  }

  // 检查代码扩展名
  if (/\.(js|ts|jsx|tsx|py|go|rs|java|c|cpp|cs)$/.test(normalized)) {
    return true;
  }

  // .claude/scripts|agents|hooks/**
  if (/^\.claude\/(scripts|agents|hooks)\//.test(normalized)) {
    return true;
  }

  return false;
}

function isProductSourcePath(relativePath) {
  // 【跨平台修复】规范化路径分隔符
  const normalized = relativePath.replace(/\\/g, '/');

  const sourceDirs = [
    'src', 'lib', 'app', 'components', 'pages', 'api'
  ];

  const firstDir = normalized.split('/')[0];
  return sourceDirs.includes(firstDir);
}

function isDocsPath(relativePath) {
  // 【跨平台修复】规范化路径分隔符
  const normalized = relativePath.replace(/\\/g, '/');
  return /^docs\//.test(normalized) && /\.md$/.test(normalized);
}

function isE2eTestPath(relativePath) {
  // 【跨平台修复】规范化路径分隔符
  const normalized = relativePath.replace(/\\/g, '/');
  return /^e2e\//.test(normalized);
}

function getExpectedRolesForPath(relativePath) {
  // 【跨平台修复】规范化路径分隔符
  const normalized = relativePath.replace(/\\/g, '/');

  if (isE2eTestPath(relativePath)) {
    return ['test-engineer'];
  }

  if (isProductSourcePath(relativePath)) {
    return ['development-engineer'];
  }

  if (/^docs\/requirement\//.test(normalized)) {
    return ['requirements-analyst'];
  }

  if (/^docs\/design\//.test(normalized)) {
    return ['system-architect', 'requirement-reviewer'];
  }

  if (/^docs\/quality\//.test(normalized)) {
    return ['quality-engineer'];
  }

  if (/^docs\/test\//.test(normalized)) {
    return ['test-engineer'];
  }

  return [];
}

function getWorkflowMode(processPath) {
  try {
    const content = fs.readFileSync(processPath, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (match) {
      const modeMatch = match[1].match(/workflow_mode:\s*(\w+)/);
      return modeMatch ? modeMatch[1] : 'full';
    }
  } catch (e) {
    // 读取失败
  }
  return 'full';
}

function getDispatchPlan(processPath) {
  try {
    const content = fs.readFileSync(processPath, 'utf8');
    // 检查是否有 ## 当前分派计划 章节且有真实数据
    const planMatch = content.match(/## 当前分派计划\s*\n([\s\S]*?)(?=\n## |\n---|\n$)/);
    if (planMatch && planMatch[1].trim().length > 50) {
      return { valid: true };
    }
  } catch (e) {
    // 读取失败
  }
  return { valid: false };
}

function isLiteModeConfirmed(processPath) {
  const mode = getWorkflowMode(processPath);
  if (mode === 'full') return false;

  // 检查是否有工作流模式确认记录
  try {
    const content = fs.readFileSync(processPath, 'utf8');
    return /## 用户确认记录[\s\S]*工作流模式确认/.test(content);
  } catch (e) {
    return false;
  }
}

function checkIterationArtifacts(cwd) {
  const required = [
    'docs/requirement/requirement-spec.md',
    'docs/requirement/requirement-list.md',
    'docs/design/detail-design-spec.md',
    'docs/design/develop-task-list.md'
  ];

  const missing = required.filter(p => !fs.existsSync(path.join(cwd, p)));

  return {
    allPresent: missing.length === 0,
    missing
  };
}

function isBlocking(processPath) {
  try {
    const content = fs.readFileSync(processPath, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (match) {
      return /blocking:\s*true/i.test(match[1]);
    }
  } catch (e) {
    // 读取失败
  }
  return false;
}

function getLastDispatchedRole(processPath) {
  // 简化实现：从进度列表读取最近的角色
  // 实际应从 .claude/hooks/.dispatched-roles.json 读取
  return null;
}

// 执行
main();
