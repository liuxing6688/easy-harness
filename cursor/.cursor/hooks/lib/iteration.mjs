/**
 * 门禁域：iteration — R3/R9 迭代成果物、需求就绪（含 R19）、E2E/lint/scan 机读结果读取。
 *
 * 主要消费方：paths.assertDevGateOrDeny（R3/R9）、dispatch / stop（机读 gatePassed）、
 * design.checkRequirementReady。域对照见 ./README.md。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  PROJECT_ROOT,
  getActiveDocsBase,
  getWorkflowMode,
  extractSection,
  parseMarkdownTables,
  sectionHasDataRow,
  readProcessMd,
  readTextFileSafe,
  readJsonFileSafe
} from './core.mjs';

export function readE2eResult(scope) {
  const file = scope === 'final' ? '.e2e-final-result.json' : '.e2e-batch-result.json';
  const resultPath = path.join(PROJECT_ROOT, 'test-results/e2e', file);
  return readJsonFileSafe(resultPath); // R30
}

/** R15：读取 QE 阶段编程规范（lint）门禁机读结果（lint-run.mjs 产出），缺失/解析失败返回 null */
export function readLintResult() {
  const resultPath = path.join(PROJECT_ROOT, 'test-results/qe', '.lint-result.json');
  return readJsonFileSafe(resultPath); // R30
}

/** R16：读取 QE 阶段静态代码质量门禁机读结果（static-scan-run.mjs 产出），缺失/解析失败返回 null */
export function readStaticScanResult() {
  const resultPath = path.join(PROJECT_ROOT, 'test-results/qe', '.static-scan-result.json');
  return readJsonFileSafe(resultPath); // R30
}

/**
 * R3：非 hotfix/docs-only 迭代进入开发前须校验四件成果物存在且被 process.md 引用。
 * `iterationType` 缺失时按 full 兜底校验（R12：只可加强，不得因缺字段豁免）。
 */
export function checkIterationArtifacts(content) {
  const mode = getWorkflowMode(content);
  if (mode === 'hotfix' || mode === 'docs-only') {
    return { ok: true, reason: 'exempt-mode' };
  }

  const docsBase = getActiveDocsBase();
  const required = [
    ['requirement/requirement-spec.md', 'requirement-spec.md'],
    ['requirement/requirement-list.md', 'requirement-list.md'],
    ['design/detail-design-spec.md', 'detail-design-spec.md'],
    ['design/develop-task-list.md', 'develop-task-list.md'],
  ];

  const missing = [];
  for (const [rel, label] of required) {
    const abs = path.join(docsBase, rel);
    if (!fs.existsSync(abs)) {
      missing.push(label);
      continue;
    }
    if (!content.includes(label)) {
      missing.push(`${label}(未被process.md引用)`);
    }
  }
  return { ok: missing.length === 0, missing };
}

/** R9：hotfix 模式进入开发前须校验 detail-design-spec.md 是否存在 */
export function checkHotfixDesign(content) {
  if (getWorkflowMode(content) !== 'hotfix') {
    return { ok: true, reason: 'not-hotfix' };
  }
  const docsBase = getActiveDocsBase();
  const designPath = path.join(docsBase, 'design/detail-design-spec.md');
  return { ok: fs.existsSync(designPath), designPath };
}

/** R13：需求成果物是否就绪（供发起 system-architect 前机械校验） */
export function checkImplicitRequirementRecord(specContent) {
  const section = extractSection(specContent, '隐性需求确认记录');
  if (!section) {
    return { ok: false, reason: 'no-implicit-requirement-record' };
  }
  const table = parseMarkdownTables(section).find((t) => t.headers.some((h) => /类别/.test(h)));
  if (!table) {
    return { ok: false, reason: 'invalid-implicit-requirement-record-header' };
  }

  const columns = {
    category: table.headers.findIndex((h) => /类别/.test(h)),
    item: table.headers.findIndex((h) => /^要点/.test(h)),
    confirmation: table.headers.findIndex((h) => /用户确认摘要/.test(h)),
    trace: table.headers.findIndex((h) => /关联需求.*追溯|关联需求.*§7/.test(h)),
    status: table.headers.findIndex((h) => /^状态/.test(h)),
    impact: table.headers.findIndex((h) => /影响.*决策点/.test(h)),
  };
  if (Object.values(columns).some((index) => index < 0)) {
    return { ok: false, reason: 'invalid-implicit-requirement-record-header' };
  }

  const rows = table.rows.filter((row) => row.some((cell) => cell.trim()));
  if (rows.length === 0) {
    return { ok: false, reason: 'no-implicit-requirement-record' };
  }
  const allowedCategories = /^(假设|边界|取舍|待决|排查结论)$/;
  const allowedStatuses = /^(已确认|待决假设)$/;
  for (const row of rows) {
    if (Object.values(columns).some((index) => !(row[index] ?? '').trim())) {
      return { ok: false, reason: 'incomplete-implicit-requirement-record' };
    }
    const category = row[columns.category].trim();
    const status = row[columns.status].trim();
    const trace = row[columns.trace].trim();
    const impact = row[columns.impact].trim();
    if (!allowedCategories.test(category) || !allowedStatuses.test(status)) {
      return { ok: false, reason: 'invalid-implicit-requirement-record-enum' };
    }
    if (!/R-\d+/i.test(trace) || !/§\s*7/.test(trace)) {
      return { ok: false, reason: 'missing-implicit-requirement-trace' };
    }
    if (status === '待决假设' && (!/责任方/.test(impact) || !/最晚/.test(impact))) {
      return { ok: false, reason: 'incomplete-pending-assumption-decision' };
    }
  }
  return { ok: true, reason: 'checked' };
}

export function checkRequirementReady() {
  const docsBase = getActiveDocsBase();
  const specPath = path.join(docsBase, 'requirement/requirement-spec.md');
  const listPath = path.join(docsBase, 'requirement/requirement-list.md');
  if (!fs.existsSync(specPath) || !fs.existsSync(listPath)) {
    return { ok: false, reason: 'missing-requirement-artifacts' };
  }
  // R19：需求说明书「隐性需求确认记录」须有完整、可追溯的结构化数据行。
  const specContent = readTextFileSafe(specPath) ?? ''; // R30
  const implicitRecord = checkImplicitRequirementRecord(specContent);
  if (!implicitRecord.ok) return implicitRecord;
  const content = readProcessMd() ?? '';
  if (!sectionHasDataRow(content, '用户确认记录')) {
    return { ok: false, reason: 'no-user-confirmation' };
  }
  return { ok: true, reason: 'checked' };
}


