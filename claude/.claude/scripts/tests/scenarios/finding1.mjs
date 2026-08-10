/**
 * 场景套件：finding1Scenario
 * Finding #1 回归：出厂模板不得因空进度/占位行被误判为阻塞或错误催促。
 *
 * 入口：node .claude/scripts/gate-scenarios.mjs；脚手架：./_harness.mjs
 */
import {
  PROJECT_ROOT,
  REQ_SPEC,
  REQ_LIST,
  GATED_EMPTY,
  relToProject,
  writeFixture,
  check,
  path,
  fs,
  recordFail
} from './_harness.mjs';

export function finding1Scenario() {
  console.log('== Finding #1：出厂模板端到端不被误判为阻塞 ==');
  const template = fs
    .readFileSync(path.join(PROJECT_ROOT, '.claude/templates/process.md'), 'utf8')
    .replace(/\r\n/g, '\n');
  const withConfirm = template.replace(
    '| ------ | ---- | ------------ |\n',
    '| ------ | ---- | ------------ |\n| 需求摘要 | 2026-01-01 | 已确认 |\n| 界面与交互期望 | 2026-01-01 | 确认接受组件库默认外观，本版无独立界面期望 |\n',
  );
  if (withConfirm === template) {
    recordFail('B1 模板注入用户确认行', 'injected', 'template-shape-changed');
    console.error('  FAIL  出厂模板「## 用户确认记录」表结构变化，无法注入确认行（请更新本回归）');
    return;
  }
  const root = writeFixture('finding1-template', {
    'docs/process/process.md': withConfirm,
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('B1 出厂模板派发 system-architect（不得因阻塞误判被拒）', 'allow', {
    hook: 'role',
    role: 'system-architect',
    processPath: relToProject(path.join(root, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(root, 'docs/design/gated-artifacts.json')),
  });
}

// ---------------------------------------------------------------------------
