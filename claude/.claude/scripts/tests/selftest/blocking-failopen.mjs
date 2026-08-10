/**
 * 阻塞态（blocking）与 fail-open 留痕（recordFailOpenEvent）行为。
 *
 * 入口：node .claude/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs（仅导入本套件实际使用的符号，见该目录 README）
 */
import {
  test, fixtureProcess, assert, path, fs, isProcessBlocked, recordFailOpenEvent, PROJECT_ROOT,
  getTestProcessPath,
} from './_harness.mjs';

test('§8.4: recordFailOpenEvent 写入 blocking 与门禁异常事件', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      'blocking: false',
      'cancelled: false',
      '---',
      '',
      '## 阻塞原因',
      '',
      '无',
      '',
    ].join('\n'),
  );
  const r = recordFailOpenEvent('gate-selftest', 'runtime', new Error('boom'));
  assert.equal(r.ok, true);
  const md = fs.readFileSync(getTestProcessPath(), 'utf8');
  assert.match(md, /blocking:\s*true/);
  assert.match(md, /## 门禁异常事件/);
  assert.match(md, /gate-selftest/);
  assert.match(md, /boom/);
});
test('§8.4: cancelled 流程不写 fail-open 事件', () => {
  fixtureProcess('---\nworkflow_mode: full\ncancelled: true\nblocking: false\n---\n');
  const r = recordFailOpenEvent('gate-selftest', 'runtime', new Error('boom'));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'cancelled');
});

console.log('== Finding #1：出厂 process.md 模板不得被误判为阻塞 ==');
test('出厂模板的「## 阻塞原因」默认体不被判为阻塞（开箱即用不卡死）', () => {
  const templatePath = path.join(PROJECT_ROOT, '.claude/templates/process.md');
  const templateContent = fs.readFileSync(templatePath, 'utf8');
  assert.equal(
    isProcessBlocked(templateContent),
    false,
    '出厂 process.md 模板不应开箱即被判为阻塞（Finding #1 回归）',
  );
});
test('真实阻塞原因仍被判为阻塞（回归 isProcessBlocked 严格性，防止 R12 弱化）', () => {
  const blocked = [
    '---',
    'blocking: false',
    '---',
    '',
    '## 阻塞原因',
    '',
    '- 阻塞原因：等待用户确认预算上限',
    '',
  ].join('\n');
  assert.equal(isProcessBlocked(blocked), true);
});
test('frontmatter blocking: true 时判为阻塞（与章节内容无关）', () => {
  assert.equal(isProcessBlocked('---\nblocking: true\n---\n\n## 阻塞原因\n\n无\n'), true);
});

