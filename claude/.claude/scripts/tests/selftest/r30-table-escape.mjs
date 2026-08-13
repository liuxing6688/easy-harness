/**
 * **F-10 / R30**：markdown 表格单元格内转义竖线 `\|` 的还原。
 *
 * 复盘背景（2026-08-11 v2 评审）：需求描述里写枚举 `status=all\|active\|done` 是 GFM 下
 * 唯一正确写法，但历史判据一律裸 `split('|')`——该行列数变多、优先级列右移，
 * `parseRequirementP0Ids` 从 `cells[4]` 取到 `"done"` → 一条如实标 P0 的需求**静默**
 * 退出 E2E 必测集合，`gatePassed: true`、签名有效、零提示。
 *
 * 本套件锁定：切分器正确还原 `\|`、列序不位移，且 P0 提取 / 分派计划 / 通用表格解析
 * 三条下游判据都不再被一个合法的枚举写法击穿。
 *
 * 入口：node .claude/scripts/gate-selftest.mjs
 */
import {
  test, assert, splitTableRow, isTableSeparatorLine, parseMarkdownTables,
  sectionHasDataRow, collectActiveRoleSlugs, fixtureProcess, cleanup,
} from './_harness.mjs';
import {
  parseRequirementP0Ids,
  splitTableRow as splitTableRowRunner,
} from '../../e2e-run-lib.mjs';

test('F-10 切分器：转义竖线还原为字面量且不产生额外列', () => {
  const cells = splitTableRow('| R-101 | 过滤 | 描述 status=all\\|active\\|done | 无 | P0 |');
  assert.equal(cells.length, 5, `列数应为 5，实际 ${cells.length}：${JSON.stringify(cells)}`);
  assert.equal(cells[2], '描述 status=all|active|done');
  assert.equal(cells[4], 'P0');
});

test('F-10 切分器：普通行、缺尾竖线、空行的行为不变', () => {
  assert.deepEqual(splitTableRow('| a | b | c |'), ['a', 'b', 'c']);
  assert.deepEqual(splitTableRow('| a | b | c'), ['a', 'b', 'c']);
  assert.deepEqual(splitTableRow(''), []);
  assert.deepEqual(splitTableRow('|  |  |'), ['', '']);
});

test('F-10 切分器：连续转义与行尾转义不吞列', () => {
  assert.deepEqual(splitTableRow('| a\\|\\|b | c |'), ['a||b', 'c']);
  assert.deepEqual(splitTableRow('| a | b\\| |'), ['a', 'b|']);
});

test('F-10 分隔行判定与切分器同源可用', () => {
  assert.equal(isTableSeparatorLine('| --- | :--: |'), true);
  assert.equal(isTableSeparatorLine('| R-101 | P0 |'), false);
});

test('F-10 P0 提取：描述含转义竖线的 P0 需求不得被静默跳过', () => {
  const md = [
    '| 需求编号 | 名称 | 描述 | 依赖 | 优先级 |',
    '| -------- | ---- | ---- | ---- | ------ |',
    '| R-101 | 状态过滤 | 支持 status=all\\|active\\|done | 无 | P0 |',
    '| R-102 | 排序 | 按时间排序 | 无 | P0 |',
    '| R-103 | 分页 | 分页展示 | 无 | P1 |',
  ].join('\n');
  const ids = parseRequirementP0Ids(md);
  assert.deepEqual(ids, ['R-101', 'R-102'], `实际：${JSON.stringify(ids)}`);
});

test('F-10 通用表格解析：单元格内竖线不撑破列宽', () => {
  const [table] = parseMarkdownTables([
    '| 维度 | 是否涉及 | 说明 |',
    '| ---- | -------- | ---- |',
    '| 新增/变更对外接口 | 是 | 枚举 status=all\\|active\\|done |',
  ].join('\n'));
  assert.equal(table.headers.length, 3);
  assert.deepEqual(table.rows[0], [
    '新增/变更对外接口', '是', '枚举 status=all|active|done',
  ]);
});

test('F-10 分派计划：角色列不因前列含竖线而错位', () => {
  const md = [
    '---',
    'workflow_mode: full',
    'blocking: false',
    '---',
    '',
    '## 当前分派计划',
    '',
    '| 任务包编号 | 分派角色 | 是否并行 | 状态 |',
    '| ---------- | -------- | -------- | ---- |',
    '| T-01（status=all\\|active\\|done） | 开发工程师 | 否 | 待执行 |',
    '',
  ].join('\n');
  fixtureProcess(md);
  // 首参是 process.md **内容**（传路径会把路径字符串当 markdown 解析）；
  // 传 null 走 readProcessMd()，顺带覆盖 fixtureProcess 落的 HARNESS_PROCESS_PATH 读取路径。
  const roles = collectActiveRoleSlugs(null);
  assert.ok(
    roles.includes('development-engineer'),
    `应识别到 development-engineer，实际：${JSON.stringify(roles)}`,
  );
  cleanup();
});

test('F-10 数据行判定：仅含转义竖线的行仍算真实数据行', () => {
  const body = [
    '## 当前分派计划',
    '',
    '| 任务包编号 | 分派角色 |',
    '| ---------- | -------- |',
    '| T-01\\|A | 开发工程师 |',
    '',
  ].join('\n');
  assert.equal(sectionHasDataRow(body, '当前分派计划'), true);
});

/**
 * **F-10 口径一致性**：`core.mjs#splitTableRow`（Hook 侧唯一权威切分器）与
 * `e2e-run-lib.mjs#splitTableRow`（运行器侧）**同语义各留一份**。
 *
 * 这份重复是**刻意**的——`e2e-run-lib.mjs` 不依赖 `hooks/lib/**`，运行器与 Hook 解耦，
 * 使门禁运行器不因 Hook 库重构而连带损坏。代价是两处会漂移，而漂移的后果恰是 F-10 本身：
 * 覆盖率基线（运行器侧 `parseRequirementP0Ids`）与 R18 覆盖矩阵、`## 增量范围`（Hook 侧）
 * 对**同一份 markdown** 解析出不同的列，一条如实标 P0 的需求可以在一侧在册、另一侧出局，
 * 且两侧各自都 `gatePassed: true`、签名有效、零提示。
 *
 * 原本这条同步义务只写在两处代码的注释里（「改一处务必同步另一处」），属自律面。
 * 本用例把它变成**机械可捕获**：任一侧被改动而另一侧未跟进，本用例即红。
 *
 * 语料按「片段 × 位置」交叉生成而非手挑，覆盖转义竖线、连续转义、行尾转义、
 * 反斜杠不接竖线、缺尾竖线、空单元格、全空白单元格、CRLF 残留、首尾空白等形态；
 * 另附非字符串入参（`null`/`undefined`/数字/对象）——两份实现都以 `String(line ?? '')`
 * 归一，边界行为同样必须一致。
 */
const CELL_FRAGMENTS = [
  'a',
  '',
  '  ',
  'all\\|active\\|done',
  'x\\|\\|y',
  'trail\\|',
  'path\\to\\file',
  '反斜杠结尾\\',
  '中文 与 空格',
  '§7 / R-001',
];

/** 由片段交叉生成表格行语料（含缺尾竖线、缺首竖线、行尾 CR 等形态变体）。 */
function buildRowCorpus() {
  const rows = [];
  for (const a of CELL_FRAGMENTS) {
    for (const b of CELL_FRAGMENTS) {
      rows.push(`| ${a} | ${b} |`);
      rows.push(`| ${a} | ${b}`); // 缺尾竖线
      rows.push(`${a} | ${b} |`); // 缺首竖线
      rows.push(`|${a}|${b}|`); // 无内边距
      rows.push(`| ${a} | ${b} |\r`); // CRLF 残留
    }
  }
  return rows;
}

test('F-10 一致性：core.mjs 与 e2e-run-lib.mjs 两份 splitTableRow 对同一批输入须逐字相等', () => {
  const corpus = buildRowCorpus();
  assert.ok(corpus.length >= 500, `语料规模异常：${corpus.length}`);
  const drifted = [];
  for (const line of corpus) {
    const hook = splitTableRow(line);
    const runner = splitTableRowRunner(line);
    try {
      assert.deepEqual(runner, hook);
    } catch {
      drifted.push({ line, hook, runner });
    }
  }
  assert.deepEqual(
    drifted.slice(0, 5),
    [],
    `两份实现口径漂移 ${drifted.length}/${corpus.length} 例（前 5 例见上）。` +
      '两处必须同语义：core.mjs 供 Hook 侧全部表格判据，e2e-run-lib.mjs 供覆盖率基线；' +
      '漂移会让同一份 markdown 在两侧解析出不同的列（F-10 原缺陷形态）。',
  );
});

test('F-10 一致性：非字符串入参的边界行为两处也须一致', () => {
  for (const input of [null, undefined, 0, 42, true, {}, [], '   ', '|', '||']) {
    assert.deepEqual(
      splitTableRowRunner(input),
      splitTableRow(input),
      `入参 ${JSON.stringify(input) ?? String(input)} 两处行为不一致`,
    );
  }
});

test('F-10 一致性用例自身有判别力：与裸 split 实现对比须判为漂移', () => {
  // 反事实：历史裸切实现。若上面的语料/比较逻辑失效（例如语料里没有一条含 `\|`），
  // 本断言会失败，从而暴露「一致性用例其实测不出漂移」。
  const legacy = (line) => String(line ?? '').trim().split('|').slice(1, -1).map((c) => c.trim());
  const drifted = buildRowCorpus().filter((line) => {
    try {
      assert.deepEqual(legacy(line), splitTableRow(line));
      return false;
    } catch {
      return true;
    }
  });
  assert.ok(drifted.length > 0, '语料无法区分裸 split 与转义感知实现，一致性用例形同虚设');
});
