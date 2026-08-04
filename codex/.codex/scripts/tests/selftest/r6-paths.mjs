/**
 * R6：源码/扩展名路径门禁、.codex/scripts|agents|hooks 纳入、扩展名豁免目录。
 *
 * 入口：node .codex/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs（仅导入本套件实际使用的符号，见该目录 README）
 */
import {
  test, assert, isGatedDevPath, isGatedRoleArtifactPath, expectedRolesForPath,
} from './_harness.mjs';

console.log('== R6：.codex/ 门禁路径判定 ==');
test('R6: .codex/scripts 下的文件受门禁保护', () => {
  assert.equal(isGatedDevPath('.codex/scripts/foo.mjs'), true);
});
test('R6: .codex/agents 下的文件受门禁保护', () => {
  assert.equal(isGatedDevPath('.codex/agents/foo.md'), true);
});
test('R6: .codex/hooks 下的文件受门禁保护（豁免标记文件除外）', () => {
  assert.equal(isGatedDevPath('.codex/hooks/gate-foo.mjs'), true);
  assert.equal(isGatedDevPath('.codex/toolchain-install-approved.json'), false);
});
test('R6: 治理配置文件不走 DE 源码门禁（改由 R29 自治资产分级裁决）', () => {
  // 这些路径刻意不进 isGatedDevPath——否则会被当成 DE 源码而要求分派计划。
  // 它们的保护由 R29 承担：hooks.json/harness.config.json → ask（人工批准），
  // harness-state.json → 角色门禁（project-manager）。
  // 详见 selftest/r28-r31-hardening.mjs 与 mechanical-gates.md §8.5。
  assert.equal(isGatedDevPath('.codex/templates/process.md'), false);
  assert.equal(isGatedDevPath('.codex/harness.config.json'), false);
  assert.equal(isGatedDevPath('.codex/hooks.json'), false);
  assert.equal(isGatedDevPath('.harness/harness-state.json'), false);
});
test('R6: 常规源码路径仍受门禁保护（回归既有行为）', () => {
  assert.equal(isGatedDevPath('src/index.ts'), true);
  assert.equal(isGatedDevPath('docs/requirement/requirement-list.md'), false);
});
test('R5: e2e/** 纳入 isGatedDevPath，期望角色为 test-engineer', () => {
  assert.equal(isGatedDevPath('e2e/specs/foo.spec.ts'), true);
  assert.equal(isGatedDevPath('e2e/helpers/nav.ts'), true);
  assert.deepEqual(expectedRolesForPath('e2e/specs/foo.spec.ts'), ['test-engineer']);
  assert.deepEqual(expectedRolesForPath('e2e/helpers/nav.ts'), ['test-engineer']);
});
test('R5: docs 角色成果物纳入 isGatedRoleArtifactPath（与 isGatedDevPath 互补）', () => {
  assert.equal(isGatedRoleArtifactPath('docs/requirement/requirement-list.md'), true);
  assert.equal(isGatedRoleArtifactPath('docs/design/detail-design-spec.md'), true);
  assert.equal(isGatedRoleArtifactPath('docs/process/process.md'), true);
  assert.equal(isGatedRoleArtifactPath('docs/quality/quality-report.md'), true);
  assert.equal(isGatedRoleArtifactPath('docs/test/test-report.md'), true);
  assert.equal(isGatedRoleArtifactPath('src/index.ts'), false);
  assert.deepEqual(expectedRolesForPath('docs/requirement/requirement-spec.md'), [
    'requirements-analyst',
  ]);
  assert.deepEqual(expectedRolesForPath('src/app.ts'), ['development-engineer']);
});
test('R5: docs 下代码扩展名期望 DE（Finding #2），文档扩展名仍期望对应角色', () => {
  assert.deepEqual(expectedRolesForPath('docs/design/notes.py'), ['development-engineer']);
  assert.deepEqual(expectedRolesForPath('docs/design/detail-design-spec.md'), ['system-architect']);
  assert.equal(isGatedDevPath('docs/design/notes.py'), true);
});

