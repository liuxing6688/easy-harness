/**
 * 流程门禁共享逻辑 — 对外稳定入口（薄 barrel）。
 * 实现按域拆分，见 ./lib/README.md。
 */
export * from './lib/core.mjs';
export * from './lib/paths.mjs';
export * from './lib/identity.mjs';
export * from './lib/role-path.mjs';
export * from './lib/iteration.mjs';
export * from './lib/design.mjs';
export * from './lib/qe.mjs';
export * from './lib/dispatch.mjs';
