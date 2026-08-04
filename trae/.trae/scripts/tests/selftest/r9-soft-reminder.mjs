/**
 * R9：hotfix P0 接口/存储软性提醒（非阻塞，recordHotfixP0SoftReminder）。
 *
 * 入口：node .trae/scripts/gate-selftest.mjs
 * 脚手架：./_harness.mjs；共享 fixture：./_fixtures.mjs
 */
import {
  test, fixtureProcess, assert, fs, checkHotfixP0InterfaceStorageMention,
  recordHotfixP0SoftReminder, recordFailOpenEvent, getActiveProcessPath,
} from './_harness.mjs';

import {
  hotfixProcessBody, HOTFIX_STRUCTURED_API_STORAGE_REPORT,
} from './_fixtures.mjs';

console.log('== R9 软性提醒：P0 影响 hotfix 的本次报告结构化章节检测（非阻塞）==');
test('R9 软性提醒: 非 hotfix 时不适用', () => {
  const content = fixtureProcess('---\nworkflow_mode: full\n---\n');
  assert.equal(checkHotfixP0InterfaceStorageMention(content).applicable, false);
});
test('R9 软性提醒: hotfix 但 hotfix_p0_impact=none 时不适用', () => {
  const content = fixtureProcess(hotfixProcessBody(['hotfix_p0_impact: none']));
  assert.equal(checkHotfixP0InterfaceStorageMention(content).applicable, false);
});
test('R9 软性提醒: hotfix_p0_impact=p0 但本次报告缺结构化接口/存储章节时 needsReminder=true', () => {
  const content = fixtureProcess(hotfixProcessBody(['hotfix_p0_impact: p0']), {
    'docs/test/test-report.md': '# 测试报告\n\n## 集成测试记录\n\n全部通过。\n',
  });
  const r = checkHotfixP0InterfaceStorageMention(content);
  assert.equal(r.applicable, true);
  assert.equal(r.mentionsInterface, false);
  assert.equal(r.mentionsStorage, false);
  assert.equal(r.needsReminder, true);
});
test('R9 软性提醒: 本次 test-report.md 含结构化章节真实数据行时 needsReminder=false', () => {
  const content = fixtureProcess(hotfixProcessBody(['hotfix_p0_impact: p0']), {
    'docs/test/test-report.md': HOTFIX_STRUCTURED_API_STORAGE_REPORT,
  });
  const r = checkHotfixP0InterfaceStorageMention(content);
  assert.equal(r.mentionsInterface, true);
  assert.equal(r.mentionsStorage, true);
  assert.equal(r.needsReminder, false);
});
test('R9 软性提醒: 仅有关键词而无真实数据行时仍 needsReminder=true', () => {
  const content = fixtureProcess(hotfixProcessBody(['hotfix_p0_impact: p0']), {
    'docs/test/test-report.md':
      '# 测试报告\n\n## 接口测试报告\n\n已核对接口契约无变化。\n\n## 存储对账记录\n\n已完成存储对账，结果一致。\n',
  });
  const r = checkHotfixP0InterfaceStorageMention(content);
  assert.equal(r.mentionsInterface, false);
  assert.equal(r.mentionsStorage, false);
  assert.equal(r.needsReminder, true);
});
test('R9 软性提醒: 历史无关报告中的结构化章节不得抑制本次提醒', () => {
  const content = fixtureProcess(hotfixProcessBody(['hotfix_p0_impact: p0']), {
    'docs/test/old-history.md': HOTFIX_STRUCTURED_API_STORAGE_REPORT,
    'docs/test/test-report.md': '# 测试报告\n\n## 集成测试记录\n\n全部通过。\n',
  });
  const r = checkHotfixP0InterfaceStorageMention(content);
  assert.equal(r.needsReminder, true, '历史报告不得抑制本次 test-report.md 的提醒');
});
test('R9 软性提醒: recordHotfixP0SoftReminder 命中时写入一次性非阻塞记录', () => {
  const content = fixtureProcess(
    hotfixProcessBody(['hotfix_p0_impact: p0', 'blocking: false', 'cancelled: false']),
    {
      'docs/test/test-report.md': '# 测试报告\n\n## 集成测试记录\n\n全部通过。\n',
    },
  );
  const r = recordHotfixP0SoftReminder(content);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'recorded');
  const md = fs.readFileSync(getActiveProcessPath(), 'utf8');
  assert.match(md, /## 门禁软性提醒（非阻塞）/);
  assert.match(md, /接口测试报告|存储对账记录/);
  // blocking 不应被本机制置为 true（区别于 recordFailOpenEvent 的 fail-open 语义）
  assert.doesNotMatch(md, /blocking:\s*true/);
});
test('R9 软性提醒: recordHotfixP0SoftReminder 幂等——同一 process.md 不重复写入', () => {
  const content = fixtureProcess(
    hotfixProcessBody(['hotfix_p0_impact: p0', 'blocking: false', 'cancelled: false']),
    {
      'docs/test/test-report.md': '# 测试报告\n\n## 集成测试记录\n\n全部通过。\n',
    },
  );
  recordHotfixP0SoftReminder(content);
  const first = fs.readFileSync(getActiveProcessPath(), 'utf8');
  const r2 = recordHotfixP0SoftReminder(content);
  assert.equal(r2.ok, true);
  assert.equal(r2.reason, 'already-recorded');
  const second = fs.readFileSync(getActiveProcessPath(), 'utf8');
  assert.equal(first, second, '第二次调用不应再追加内容');
});
test('R9 软性提醒: 不满足条件（needsReminder=false）时不写入', () => {
  const content = fixtureProcess(
    hotfixProcessBody(['hotfix_p0_impact: p0', 'blocking: false', 'cancelled: false']),
    {
      'docs/test/test-report.md': HOTFIX_STRUCTURED_API_STORAGE_REPORT,
    },
  );
  const r = recordHotfixP0SoftReminder(content);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'not-needed');
  const md = fs.readFileSync(getActiveProcessPath(), 'utf8');
  assert.doesNotMatch(md, /## 门禁软性提醒/);
});
test('R9 软性提醒: cancelled 流程不写入', () => {
  const content = fixtureProcess(
    hotfixProcessBody(['hotfix_p0_impact: p0', 'cancelled: true']),
    {
      'docs/test/test-report.md': '# 测试报告\n\n全部通过。\n',
    },
  );
  const r = recordHotfixP0SoftReminder(content);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'cancelled');
});


