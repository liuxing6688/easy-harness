/**
 * R3：迭代进入开发前四件成果物存在且被 process.md 引用（hotfix/docs-only 豁免）。
 *
 * 入口：node .codex/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs；共享 fixture：./_fixtures.mjs
 */
import {
  test, fixtureProcess, assert, checkIterationArtifacts, getWorkflowMode, getDeclaredWorkflowMode,
} from './_harness.mjs';

import {
  liteModeConfirmSection,
} from './_fixtures.mjs';

console.log('== R3：迭代成果物前置校验 ==');
test('R3: iterationType 缺失时按 full 兜底校验（缺成果物则失败）', () => {
  const result = checkIterationArtifacts('---\nworkflow_mode: full\n---\n');
  assert.equal(result.ok, false);
});
test('R3: iterationType 缺失但四件成果物齐全且被引用时通过', () => {
  const content = fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
      '已产出 requirement-spec.md、requirement-list.md、detail-design-spec.md、develop-task-list.md。',
      '',
    ].join('\n'),
    {
      'docs/requirement/requirement-spec.md': '# spec',
      'docs/requirement/requirement-list.md': '# list',
      'docs/design/detail-design-spec.md': '# design',
      'docs/design/develop-task-list.md': '# tasks',
    },
  );
  assert.equal(checkIterationArtifacts(content).ok, true);
});
test('R3: 已确认的 hotfix/docs-only 豁免', () => {
  assert.equal(
    checkIterationArtifacts(
      ['---', 'workflow_mode: hotfix', '---', '', liteModeConfirmSection('hotfix')].join('\n'),
    ).ok,
    true,
  );
  assert.equal(
    checkIterationArtifacts(
      ['---', 'workflow_mode: docs-only', '---', '', liteModeConfirmSection('docs-only')].join('\n'),
    ).ok,
    true,
  );
});
test('R3: 未确认的 lite 声明不豁免（有 iterationType 时按 full 校验）', () => {
  const content = fixtureProcess('---\nworkflow_mode: hotfix\niterationType: greenfield\n---\n');
  assert.equal(checkIterationArtifacts(content).ok, false);
  assert.equal(getWorkflowMode(content), 'full');
  assert.equal(getDeclaredWorkflowMode(content), 'hotfix');
});
test('R3: 非 hotfix 迭代缺成果物时失败', () => {
  const content = fixtureProcess('---\nworkflow_mode: full\niterationType: greenfield\n---\n');
  assert.equal(checkIterationArtifacts(content).ok, false);
});
test('R3: 四件成果物存在且被 process.md 引用时通过', () => {
  const content = fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      'iterationType: greenfield',
      '---',
      '',
      '已产出 requirement-spec.md、requirement-list.md、detail-design-spec.md、develop-task-list.md。',
      '',
    ].join('\n'),
    {
      'docs/requirement/requirement-spec.md': '# spec',
      'docs/requirement/requirement-list.md': '# list',
      'docs/design/detail-design-spec.md': '# design',
      'docs/design/develop-task-list.md': '# tasks',
    },
  );
  assert.equal(checkIterationArtifacts(content).ok, true);
});

