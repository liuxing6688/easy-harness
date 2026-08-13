/**
 * **F-05**：`playwright.config.*` 的 `outputDir` 机械兜底。
 *
 * 复盘背景（2026-08-11 v2 评审，阻断级）：Playwright 每次运行前**清空** `outputDir`，
 * 默认值即 `test-results/`。历史 claude 模板既无配置文件、三处文档也全无 `outputDir` 字样，
 * 实测跑一次 `npx playwright test` 后 `test-results/qe/.lint-result.json` **直接消失**——
 * R15/R16/R32/R17 全部机读证据一并蒸发，`gate-role-sequence` 随即以 `no-lint-result` 拒派 TE，
 * 且没有任何一层说得清原因。
 *
 * 修复时该约束落到了「模板默认值 + 三处规约正文」，但**机械层不校验**：宿主项目按自身
 * 技术栈重写配置即可重演删除。本套件锁定 `e2e-run.mjs` 前置自检里的机械判据。
 *
 * 入口：node .claude/scripts/gate-selftest.mjs
 */
import { test, assert, fs, path, PROJECT_ROOT } from './_harness.mjs';
import {
  checkPlaywrightOutputDir,
  parsePlaywrightOutputDir,
  stripJsComments,
  GATE_ARTIFACT_DIRS,
  PLAYWRIGHT_DEFAULT_OUTPUT_DIR,
} from '../../e2e-run-lib.mjs';

const ROOT = PROJECT_ROOT.replace(/\\/g, '/');
const cfg = (body) => `import { defineConfig } from '@playwright/test';\nexport default defineConfig({\n${body}\n});\n`;

test('F-05 出厂 playwright.config.ts 必须自证通过（防判据与模板漂移）', () => {
  const real = fs.readFileSync(path.join(PROJECT_ROOT, 'playwright.config.ts'), 'utf8');
  const r = checkPlaywrightOutputDir(real, ROOT);
  assert.equal(r.ok, true, `出厂配置被判不安全：${r.reason} / ${r.message}`);
  assert.equal(r.outputDir, 'test-results/pw-artifacts/');
});

test('F-05 未声明 outputDir 即拒绝（Playwright 默认值正是 test-results/）', () => {
  const r = checkPlaywrightOutputDir(cfg(`  testDir: './e2e/specs',`), ROOT);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'playwright-outputdir-undeclared');
  assert.equal(r.outputDir, PLAYWRIGHT_DEFAULT_OUTPUT_DIR);
  assert.match(r.message, /清空/);
  assert.match(r.message, /R15|R16|R32|R17/);
});

test('F-05 outputDir 指向 test-results/ 即拒绝（原报告的失效形态）', () => {
  for (const v of ['test-results', 'test-results/', './test-results']) {
    const r = checkPlaywrightOutputDir(cfg(`  outputDir: '${v}',`), ROOT);
    assert.equal(r.ok, false, `${v} 应被拒绝`);
    assert.equal(r.reason, 'playwright-outputdir-clobbers-gate-artifacts');
  }
});

test('F-05 outputDir 指向仓库根或其祖先即拒绝（清空整个仓库）', () => {
  for (const v of ['.', './', '']) {
    const r = checkPlaywrightOutputDir(cfg(`  outputDir: '${v}',`), ROOT);
    assert.equal(r.ok, false, `${v} 应被拒绝`);
    assert.equal(r.reason, 'playwright-outputdir-clobbers-gate-artifacts');
  }
});

test('F-05 outputDir 指向单个门禁产物目录同样拒绝（比 §8.3 原文更严一档，只可加强）', () => {
  for (const d of GATE_ARTIFACT_DIRS) {
    const r = checkPlaywrightOutputDir(cfg(`  outputDir: '${d}',`), ROOT);
    assert.equal(r.ok, false, `${d} 应被拒绝`);
    assert.equal(r.reason, 'playwright-outputdir-clobbers-gate-artifacts');
    assert.match(r.message, new RegExp(d.replace('/', '\\/')));
  }
});

test('F-05 绕路写法（.. 回退）不得规避判据', () => {
  const r = checkPlaywrightOutputDir(cfg(`  outputDir: 'test-results/pw/../../test-results',`), ROOT);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'playwright-outputdir-clobbers-gate-artifacts');
});

test('F-05 合规隔离目录必须放行（判据不得严到任何配置都不可达）', () => {
  for (const v of [
    'test-results/pw-artifacts/',
    'test-results/pw-artifacts',
    'test-results/e2e/pw', // 门禁产物的**子目录**：清它不动同级的 .e2e-*-result.json
    'build/pw',
    '.playwright',
  ]) {
    const r = checkPlaywrightOutputDir(cfg(`  outputDir: '${v}',`), ROOT);
    assert.equal(r.ok, true, `${v} 应放行，实际 ${r.reason}：${r.message}`);
  }
});

test('F-05 项目根之外的 outputDir 放行并标明理由', () => {
  const r = checkPlaywrightOutputDir(cfg(`  outputDir: '../pw-out',`), ROOT);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'outside-project-root');
});

test('F-05 非字面量 outputDir 拒绝（fail-closed：静态判不了不等于安全）', () => {
  const r = checkPlaywrightOutputDir(cfg(`  outputDir: path.join('test-results', 'pw'),`), ROOT);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'playwright-outputdir-not-literal');
  // 报错文案里的表达式须截干净，不得把后半行配置一起贴出来。
  assert.equal(r.outputDir, "path.join('test-results', 'pw')");
  assert.match(r.message, /字符串字面量/);
});

test('F-05 注释里的 outputDir 不得被当成声明（出厂配置文件头就整段讲解该约束）', () => {
  // 只在注释里出现 → 视为未声明（而非「已安全声明」）。
  const onlyComment = `// outputDir: 'test-results/pw-artifacts/'\n${cfg(`  testDir: './e2e',`)}`;
  assert.equal(checkPlaywrightOutputDir(onlyComment, ROOT).reason, 'playwright-outputdir-undeclared');

  // 注释讲解「不得指向 test-results/」+ 真实安全声明 → 必须按真实声明放行。
  const commented = `/**\n * outputDir 不得指向 test-results/ 或其祖先。\n */\n${cfg(`  outputDir: 'test-results/pw-artifacts/',`)}`;
  assert.equal(checkPlaywrightOutputDir(commented, ROOT).ok, true);

  // 注释里写了危险值 + 真实声明安全值 → 仍须按真实声明放行（防注释污染判据）。
  const trap = `// 反例：outputDir: 'test-results/'\n${cfg(`  outputDir: 'test-results/pw-artifacts/',`)}`;
  assert.equal(checkPlaywrightOutputDir(trap, ROOT).ok, true);
});

test('F-05 stripJsComments 不得破坏字符串字面量内的 // 与 /*', () => {
  assert.equal(stripJsComments(`const u = 'http://127.0.0.1:3210'; // 注释`), `const u = 'http://127.0.0.1:3210'; `);
  assert.equal(stripJsComments('const s = "/* not a comment */";'), 'const s = "/* not a comment */";');
  assert.equal(stripJsComments('a = `x//y`;'), 'a = `x//y`;');
  assert.equal(stripJsComments("a = 'it\\'s //ok';"), "a = 'it\\'s //ok';");
});

test('F-05 同名后缀键不得被误当成 outputDir（如 webServerOutputDir）', () => {
  const r = checkPlaywrightOutputDir(cfg(`  webServerOutputDir: 'test-results/',\n  outputDir: 'test-results/pw-artifacts/',`), ROOT);
  assert.equal(r.ok, true, `实际 ${r.reason}：${r.message}`);
  assert.equal(r.outputDir, 'test-results/pw-artifacts/');
});

test('F-05 parsePlaywrightOutputDir：三种返回形态', () => {
  assert.deepEqual(parsePlaywrightOutputDir("export default { testDir: './e2e' }"), { declared: false });
  assert.deepEqual(parsePlaywrightOutputDir("export default { outputDir: 'a/b' }"), {
    declared: true,
    literal: 'a/b',
  });
  const expr = parsePlaywrightOutputDir('export default { outputDir: mk(1), foo: 2 }');
  assert.equal(expr.declared, true);
  assert.equal(expr.literal, null);
  assert.equal(expr.expression, 'mk(1)');
});
