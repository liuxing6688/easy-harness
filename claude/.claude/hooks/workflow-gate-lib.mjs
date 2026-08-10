/**
 * workflow-gate-lib.mjs — 门禁逻辑统一导出
 *
 * 从 hooks/lib/* 重新导出所有门禁判据，供各 gate-*.mjs 入口脚本使用。
 *
 * **Claude Code 适配版本** (2026-08-06)
 * - 移植自 cursor/.cursor/hooks/workflow-gate-lib.mjs
 * - 路径适配为 .claude
 * - 导出的函数和逻辑保持不变
 */

export * from './lib/all.mjs';
