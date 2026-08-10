/**
 * 权限模式防护模块
 *
 * 问题：auto 权限模式会自动批准所有 ask 决策，削弱门禁效果
 * 方案：检测权限模式，对关键决策强制使用 deny + additionalContext 引导
 */

/**
 * 检查当前权限模式是否为 auto
 * @param {object} hookInput - Hook 输入对象
 * @returns {boolean}
 */
export function isAutoPermissionMode(hookInput) {
  const permissionMode = hookInput.permission_mode || 'default';
  return permissionMode === 'auto';
}

/**
 * 在 auto 模式下强化决策
 *
 * 策略：
 * 1. 对必须用户确认的操作（R29 自治资产、工具链安装、阻塞释放），
 *    即使原本想返回 ask，也改为 deny + 引导文案
 * 2. 普通门禁（角色路径、分派计划）保持 deny 不变
 * 3. 允许操作保持 allow 不变
 *
 * @param {object} hookInput - Hook 输入对象
 * @param {string} originalDecision - 原本的决策 (allow/deny/ask)
 * @param {string} reason - 决策原因
 * @param {string} criticalityLevel - 严重程度 ('critical'|'high'|'normal')
 * @returns {object} 强化后的决策
 */
export function hardenDecisionForAutoMode(
  hookInput,
  originalDecision,
  reason,
  criticalityLevel = 'normal'
) {
  // 非 auto 模式，保持原决策
  if (!isAutoPermissionMode(hookInput)) {
    return {
      decision: originalDecision,
      reason: reason,
      additionalContext: null
    };
  }

  // auto 模式下的强化逻辑
  const permissionMode = hookInput.permission_mode;

  switch (originalDecision) {
    case 'allow':
      // 允许操作不变
      return {
        decision: 'allow',
        reason: reason,
        additionalContext: null
      };

    case 'deny':
      // 拒绝操作不变，但增加 auto 模式警告
      return {
        decision: 'deny',
        reason: reason,
        additionalContext: `⚠️ 检测到 auto 权限模式。Harness Engineering 规约建议使用 default 或 careful 模式以确保充分审查。`
      };

    case 'ask':
      // 这是关键：ask 在 auto 模式下会被自动批准
      if (criticalityLevel === 'critical' || criticalityLevel === 'high') {
        // 关键操作：强制改为 deny，要求明确处理
        return {
          decision: 'deny',
          reason: `[AUTO 模式保护] ${reason}`,
          additionalContext: buildAutoModeWarning(reason, criticalityLevel)
        };
      } else {
        // 普通操作：保持 ask，但在 additionalContext 中警告
        return {
          decision: 'ask',
          reason: reason,
          additionalContext: `注意：当前为 auto 权限模式，此询问将被自动批准。建议切换到 default 模式以手动审查。`
        };
      }

    default:
      return {
        decision: originalDecision,
        reason: reason,
        additionalContext: null
      };
  }
}

/**
 * 构建 auto 模式警告文案
 */
function buildAutoModeWarning(reason, criticalityLevel) {
  const warnings = {
    critical: `
🚨 **关键操作被阻止**

当前权限模式：auto（自动批准）
原因：${reason}

此操作属于关键门禁检查点，在 auto 模式下无法获得充分审查。

**解决方案**：
1. 切换权限模式：按 Shift+Tab 切换到 default 或 careful 模式
2. 或临时退出 auto：运行 \`/config permission_mode default\`
3. 完成操作后可切换回 auto

**为什么需要这样做？**
Harness Engineering 规约的某些门禁点（如 R29 自治资产保护、工具链安装确认、阻塞释放审批）
需要用户明确决策，auto 模式的自动批准会绕过这些保护。
`,
    high: `
⚠️ **重要操作需要审查**

当前权限模式：auto（自动批准）
原因：${reason}

此操作属于重要门禁检查点，建议切换到 default 模式手动审查。

**快速切换**：按 Shift+Tab 或运行 \`/config permission_mode default\`
`,
    normal: `
ℹ️ 当前为 auto 权限模式，此询问将被自动批准。
如需手动审查，请切换到 default 模式（Shift+Tab）。
`
  };

  return warnings[criticalityLevel] || warnings.normal;
}

/**
 * 判断操作的严重程度
 *
 * @param {string} ruleId - 规则编号（如 'R29', 'R5'）
 * @param {string} operationType - 操作类型（如 'self-governed-asset', 'toolchain-install'）
 * @returns {'critical'|'high'|'normal'}
 */
export function assessCriticality(ruleId, operationType) {
  // 关键级别：必须用户明确确认，不可自动批准
  const criticalOps = [
    'R29', // 门禁自治资产
    'R10', // 流程取消
    'toolchain-install', // 工具链安装
    'blocking-release', // 阻塞释放（R35）
    'workflow-mode-downgrade' // 工作流模式降级
  ];

  // 高级别：重要门禁，强烈建议手动审查
  const highOps = [
    'R5',  // 角色分离
    'R21', // 角色路径匹配
    'R28', // Shell 写文件
    'R3',  // 迭代前置
    'R9'   // hotfix 前置
  ];

  if (criticalOps.includes(ruleId) || criticalOps.includes(operationType)) {
    return 'critical';
  }

  if (highOps.includes(ruleId) || highOps.includes(operationType)) {
    return 'high';
  }

  return 'normal';
}

/**
 * 生成权限模式建议信息（用于会话启动时提示）
 */
export function generatePermissionModeGuidance() {
  return `
📋 **Harness Engineering 权限模式建议**

推荐模式：
- ✅ **default** - 平衡模式，关键操作需确认（推荐）
- ✅ **careful** - 谨慎模式，所有操作需确认（高风险项目）

不推荐：
- ⚠️ **auto** - 自动批准所有操作，会削弱规约门禁效果

当前模式：{{CURRENT_MODE}}

切换方式：
- 快捷键：Shift+Tab
- 命令：\`/config permission_mode default\`
`;
}

/**
 * 检查是否应该在会话启动时警告 auto 模式
 */
export function shouldWarnAutoModeOnStartup(hookInput) {
  return isAutoPermissionMode(hookInput);
}
