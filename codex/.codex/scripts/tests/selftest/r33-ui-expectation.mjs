/**
 * R33：需求阶段「界面与交互期望」确认机读——确认行识别、发起 system-architect 前置。
 *
 * 复盘背景（2026-07-29）：用户目标「类似 Apifox 的 B/S 工具」，RA 13 轮把功能问透，
 * 界面维零追问；用户确认的是**功能摘要**，「React + Ant Design」只是技术栈确认。
 * 本套件锁定：技术选型行**不能**顶替界面期望行。
 *
 * 入口：node .codex/scripts/gate-selftest.mjs
 */
import {
  test, fixtureProcess, cleanup, assert, hasUiExpectationConfirmation,
  checkUiExpectationConfirmed, checkRoleDispatchGate,
} from './_harness.mjs';

const SPEC_OK = [
  '# spec',
  '',
  '## 隐性需求确认记录',
  '',
  '| 类别 | 要点 | 用户确认摘要 | 关联需求/§7 追溯 | 状态 | 影响/决策点 |',
  '| ---- | ---- | ------------ | ---------------- | ---- | ------------ |',
  '| 排查结论 | 已排查，无额外隐性假设 | 用户确认现有描述已完整 | R-001；§7 追溯-001 | 已确认 | 已确认不影响额外范围 |',
  '',
].join('\n');

function processWith(rows) {
  return [
    '---', 'workflow_mode: full', '---', '',
    '## 用户确认记录',
    '',
    '| 确认项 | 时间 | 用户原话摘要 |',
    '| ------ | ---- | ------------ |',
    '| 需求摘要 | 2026-01-01 | 用户确认无误 |',
    ...rows,
    '',
  ].join('\n');
}

console.log('== R33：界面与交互期望确认（需求 → 设计前置）==');

test('R33: 只有需求摘要确认时，界面期望视为未确认', () => {
  assert.equal(hasUiExpectationConfirmation(processWith([])), false);
});

test('R33: 技术选型/组件库确认不能顶替界面期望确认', () => {
  const content = processWith([
    '| 技术选型 | 2026-01-01 | 确认采用 React 18 + Ant Design |',
  ]);
  assert.equal(hasUiExpectationConfirmation(content), false);
  assert.equal(checkUiExpectationConfirmed(content).reason, 'no-ui-expectation-confirmation');
});

test('R33: 有具体界面期望（对标竞品布局）时通过', () => {
  const content = processWith([
    '| 界面与交互期望 | 2026-07-29 | 对标 Apifox：左侧接口树 + 右侧请求/响应三栏，信息密度偏紧凑 |',
  ]);
  assert.equal(hasUiExpectationConfirmation(content), true);
  assert.equal(checkUiExpectationConfirmed(content).ok, true);
});

test('R33: 明确「接受组件库默认外观」也算已表态', () => {
  const content = processWith([
    '| 界面期望 | 2026-07-29 | 本版无独立界面期望，接受组件库默认外观 |',
  ]);
  assert.equal(hasUiExpectationConfirmation(content), true);
});

test('R33: 无 UI 项目（CLI/纯后端）可用「不适用」留痕', () => {
  const content = processWith([
    '| 界面与交互期望 | 2026-07-29 | 本项目为 CLI 工具，无界面，交互期望不适用 |',
  ]);
  assert.equal(hasUiExpectationConfirmation(content), true);
});

test('R33: 缺界面期望确认时拒绝发起 system-architect', () => {
  fixtureProcess(processWith([]), {
    'docs/requirement/requirement-spec.md': SPEC_OK,
    'docs/requirement/requirement-list.md': '# list',
  });
  const r = checkRoleDispatchGate('system-architect');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-ui-expectation-confirmation');
  assert.match(r.message, /R33/);
});

test('R33: 补齐界面期望确认后允许发起 system-architect', () => {
  fixtureProcess(
    processWith(['| 界面与交互期望 | 2026-07-29 | 对标 Apifox 的三栏调试工作区，导航采用左树 |']),
    {
      'docs/requirement/requirement-spec.md': SPEC_OK,
      'docs/requirement/requirement-list.md': '# list',
    },
  );
  assert.equal(checkRoleDispatchGate('system-architect').ok, true);
});

test('R33: hotfix / docs-only 不走 RA→SA 路径，豁免本判据', () => {
  fixtureProcess(
    [
      '---', 'workflow_mode: hotfix', '---', '',
      '## 用户确认记录',
      '',
      '| 确认项 | 时间 | 用户原话摘要 |',
      '| ------ | ---- | ------------ |',
      '| 工作流模式确认 | 2026-07-29 | 确认采用 workflow_mode: hotfix |',
      '',
    ].join('\n'),
  );
  assert.equal(checkRoleDispatchGate('system-architect').reason, 'hotfix-exempt');
});

cleanup();
