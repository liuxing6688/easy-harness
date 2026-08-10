#!/usr/bin/env node
/**
 * 风险1优化方案 - 自动化测试脚本
 *
 * 用途：验证权限模式防护机制是否正常工作
 *
 * 运行：node .claude/scripts/test-permission-mode-guard.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 导入待测试模块
import {
  isAutoPermissionMode,
  hardenDecisionForAutoMode,
  assessCriticality
} from '../hooks/lib/permission-mode-guard.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${description}`);
    passed++;
  } catch (error) {
    console.error(`❌ FAIL: ${description}`);
    console.error(`   ${error.message}`);
    failed++;
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n   Expected: ${expected}\n   Actual: ${actual}`);
  }
}

function assertContains(text, substring, message) {
  if (!text.includes(substring)) {
    throw new Error(`${message}\n   Expected to contain: "${substring}"\n   Actual: "${text}"`);
  }
}

console.log('');
console.log('═'.repeat(70));
console.log('  权限模式防护机制测试');
console.log('═'.repeat(70));
console.log('');

// ===== 测试1：权限模式检测 =====
console.log('📋 测试组1：权限模式检测');
console.log('');

test('检测 auto 模式', () => {
  const hookInput = { permission_mode: 'auto' };
  assertEquals(isAutoPermissionMode(hookInput), true, 'auto 模式应被检测');
});

test('检测 default 模式', () => {
  const hookInput = { permission_mode: 'default' };
  assertEquals(isAutoPermissionMode(hookInput), false, 'default 模式不应被视为 auto');
});

test('检测 careful 模式', () => {
  const hookInput = { permission_mode: 'careful' };
  assertEquals(isAutoPermissionMode(hookInput), false, 'careful 模式不应被视为 auto');
});

test('缺失权限模式字段时默认为非 auto', () => {
  const hookInput = {};
  assertEquals(isAutoPermissionMode(hookInput), false, '缺失字段应默认为 default');
});

console.log('');

// ===== 测试2：严重程度评估 =====
console.log('📋 测试组2：严重程度评估');
console.log('');

test('R29 评估为 critical', () => {
  assertEquals(assessCriticality('R29'), 'critical', 'R29 应为 critical 级别');
});

test('工具链安装评估为 critical', () => {
  assertEquals(assessCriticality(null, 'toolchain-install'), 'critical', '工具链安装应为 critical');
});

test('R5 评估为 high', () => {
  assertEquals(assessCriticality('R5'), 'high', 'R5 应为 high 级别');
});

test('R21 评估为 high', () => {
  assertEquals(assessCriticality('R21'), 'high', 'R21 应为 high 级别');
});

test('未知规则评估为 normal', () => {
  assertEquals(assessCriticality('R99'), 'normal', '未知规则应为 normal 级别');
});

console.log('');

// ===== 测试3：决策强化逻辑 =====
console.log('📋 测试组3：决策强化（default 模式）');
console.log('');

test('default 模式下 allow 保持不变', () => {
  const hookInput = { permission_mode: 'default' };
  const result = hardenDecisionForAutoMode(hookInput, 'allow', 'Test', 'normal');
  assertEquals(result.decision, 'allow', 'allow 决策应保持');
});

test('default 模式下 deny 保持不变', () => {
  const hookInput = { permission_mode: 'default' };
  const result = hardenDecisionForAutoMode(hookInput, 'deny', 'Test', 'normal');
  assertEquals(result.decision, 'deny', 'deny 决策应保持');
});

test('default 模式下 ask 保持不变', () => {
  const hookInput = { permission_mode: 'default' };
  const result = hardenDecisionForAutoMode(hookInput, 'ask', 'Test', 'normal');
  assertEquals(result.decision, 'ask', 'ask 决策应保持');
});

console.log('');

// ===== 测试4：auto 模式强化 =====
console.log('📋 测试组4：决策强化（auto 模式）');
console.log('');

test('auto 模式下 allow 保持不变', () => {
  const hookInput = { permission_mode: 'auto' };
  const result = hardenDecisionForAutoMode(hookInput, 'allow', 'Test', 'normal');
  assertEquals(result.decision, 'allow', 'allow 决策应保持');
});

test('auto 模式下 deny 保持但添加警告', () => {
  const hookInput = { permission_mode: 'auto' };
  const result = hardenDecisionForAutoMode(hookInput, 'deny', 'Test', 'normal');
  assertEquals(result.decision, 'deny', 'deny 决策应保持');
  assertContains(result.additionalContext, 'auto 权限模式', '应包含 auto 模式警告');
});

test('auto 模式下 critical 级别的 ask 改为 deny', () => {
  const hookInput = { permission_mode: 'auto' };
  const result = hardenDecisionForAutoMode(hookInput, 'ask', 'R29 Test', 'critical');
  assertEquals(result.decision, 'deny', 'critical ask 应改为 deny');
  assertContains(result.reason, '[AUTO 模式保护]', '理由应标明 AUTO 保护');
  assertContains(result.additionalContext, '关键操作被阻止', '应包含关键操作警告');
});

test('auto 模式下 high 级别的 ask 改为 deny', () => {
  const hookInput = { permission_mode: 'auto' };
  const result = hardenDecisionForAutoMode(hookInput, 'ask', 'R5 Test', 'high');
  assertEquals(result.decision, 'deny', 'high ask 应改为 deny');
  assertContains(result.additionalContext, '重要操作需要审查', '应包含重要操作警告');
});

test('auto 模式下 normal 级别的 ask 保持但警告', () => {
  const hookInput = { permission_mode: 'auto' };
  const result = hardenDecisionForAutoMode(hookInput, 'ask', 'Normal check', 'normal');
  assertEquals(result.decision, 'ask', 'normal ask 应保持');
  assertContains(result.additionalContext, '自动批准', '应包含自动批准警告');
});

console.log('');

// ===== 测试5：端到端场景 =====
console.log('📋 测试组5：端到端场景');
console.log('');

test('场景：auto 模式下修改 R29 保护的文件', () => {
  const hookInput = { permission_mode: 'auto' };
  const criticality = assessCriticality('R29');
  const result = hardenDecisionForAutoMode(
    hookInput,
    'ask',
    'R29: 门禁自治资产禁止代理写入',
    criticality
  );

  assertEquals(result.decision, 'deny', '应强制 deny');
  assertContains(result.reason, '[AUTO 模式保护]', '理由应标明保护');
  assertContains(result.additionalContext, 'Shift+Tab', '应包含切换指引');
});

test('场景：default 模式下修改 R29 保护的文件', () => {
  const hookInput = { permission_mode: 'default' };
  const criticality = assessCriticality('R29');
  const result = hardenDecisionForAutoMode(
    hookInput,
    'deny',
    'R29: 门禁自治资产禁止代理写入',
    criticality
  );

  assertEquals(result.decision, 'deny', '应保持 deny');
  assertEquals(result.additionalContext, null, '不应有额外上下文');
});

test('场景：auto 模式下安装工具链', () => {
  const hookInput = { permission_mode: 'auto' };
  const criticality = assessCriticality(null, 'toolchain-install');
  const result = hardenDecisionForAutoMode(
    hookInput,
    'ask',
    '需要确认工具链安装',
    criticality
  );

  assertEquals(result.decision, 'deny', '应强制 deny');
  assertEquals(criticality, 'critical', '工具链安装应为 critical');
});

console.log('');

// ===== 测试总结 =====
console.log('═'.repeat(70));
console.log('  测试结果');
console.log('═'.repeat(70));
console.log('');
console.log(`✅ 通过：${passed} 项`);
console.log(`❌ 失败：${failed} 项`);
console.log('');

if (failed > 0) {
  console.log('❌ 测试失败，请检查实现');
  process.exit(1);
} else {
  console.log('✅ 所有测试通过！权限模式防护机制工作正常。');
  console.log('');
  console.log('💡 下一步：');
  console.log('  1. 更新 hooks.json 配置');
  console.log('  2. 重启 Claude Code 会话');
  console.log('  3. 测试实际场景');
  process.exit(0);
}
