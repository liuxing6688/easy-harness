/**
 * 场景套件：featureScenarios（F1–F2）
 * 覆盖 feature 迭代：docs/<feature>/ 活跃指针下的门禁链与写入裁决。
 *
 * 入口：node .claude/scripts/gate-scenarios.mjs；脚手架：./_harness.mjs
 */
import {
  REQ_SPEC,
  REQ_LIST,
  DESIGN_SPEC,
  TASK_LIST,
  DPL_CLEAN,
  GATED_EMPTY,
  featureReady,
  relToProject,
  writeFixture,
  check,
  clearDispatchedRoles,
  path,
  fs
} from './_harness.mjs';

export function featureScenarios() {
  console.log('== 场景 2：功能迭代 Feature（full，独立子树）==');
  clearDispatchedRoles();
  const root = writeFixture('feature', {
    'docs/filter/process/process.md': featureReady(),
    'docs/filter/requirement/requirement-spec.md': REQ_SPEC,
    'docs/filter/requirement/requirement-list.md': REQ_LIST,
    'docs/filter/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/filter/design/develop-task-list.md': TASK_LIST,
    'docs/filter/design/design-problem-list.md': DPL_CLEAN,
    'docs/filter/design/gated-artifacts.json': GATED_EMPTY,
  });
  const proc = relToProject(path.join(root, 'docs/filter/process/process.md'));
  const gated = relToProject(path.join(root, 'docs/filter/design/gated-artifacts.json'));

  check('F1 feature 子树内有分派计划写源码', 'allow', {
    hook: 'write', filePath: 'src/filter.js', processPath: proc, gatedPath: gated,
  });
  check('F2 feature 子树设计审核通过发起 development-engineer', 'allow', {
    hook: 'role', role: 'development-engineer', processPath: proc, gatedPath: gated,
  });
}

