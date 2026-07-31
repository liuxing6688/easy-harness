/**
 * 未解决问题机读（hasUnresolvedIssues / hasResolvedDesignIssues）供门禁链使用。
 *
 * 入口：node .trae/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs（仅导入本套件实际使用的符号，见该目录 README）
 */
import {
  test, assert, hasUnresolvedIssues, hasResolvedDesignIssues,
} from './_harness.mjs';

console.log('== 表格未解决问题解析（design-problem-list.md / quality-report.md 通用）==');
test('hasUnresolvedIssues: 识别是否存在=是 且 是否解决≠是 的行', () => {
  const content = '| 是否存在 | 是否解决 |\n| --- | --- |\n| 是 | 否 |\n';
  assert.equal(hasUnresolvedIssues(content), true);
});
test('hasUnresolvedIssues: 已解决问题不计入未解决', () => {
  const content = '| 是否存在 | 是否解决 |\n| --- | --- |\n| 是 | 是 |\n';
  assert.equal(hasUnresolvedIssues(content), false);
});

