/**
 * 门禁域：iteration — R3/R9 迭代成果物、需求就绪（含 R19 隐性需求记录、R33 界面期望确认）、
 * E2E/lint/scan/启动冒烟（R32）机读结果读取。
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
import { verifyExecutionProof, checkArtifactFreshness } from './execproof.mjs';

export function readE2eResult(scope) {
  const file = scope === 'final' ? '.e2e-final-result.json' : '.e2e-batch-result.json';
  const resultPath = path.join(PROJECT_ROOT, 'test-results/e2e', file);
  return readJsonFileSafe(resultPath); // R30
}

/**
 * **R34 + R38** 共用判据外壳：把「读产物 → 验执行证明 → 验新鲜度 → 分类工具不可用
 * → 看 gatePassed」这条链固定下来，供 R15/R16/R32/E2E 各门禁复用。
 *
 * 顺序有意为之：**先验签、再看 `toolUnavailable`**。否则「手写一份
 * `{toolUnavailable:true}`」就能把门禁失败从「质量问题」改写成「环境问题」，
 * 从而换到一条措辞更宽松的处置路径（虽仍不放行，但会误导用户）。
 * 新鲜度紧跟验签之后：它依赖产物时间戳，而时间戳只有在签名有效时才可信。
 *
 * @param {object} params
 * @param {string} params.kind `EXEC_PROOF_KINDS` 之一
 * @param {object|null} params.artifact 已解析产物
 * @param {string} params.missingReason 产物缺失时的 reason
 * @param {string} params.unavailableReason 工具不可用时的 reason
 * @param {(a: object) => boolean} params.isPassed 产物是否表示通过
 * @param {string|((a: object) => string)} params.failedReason 检查未通过时的 reason（可按产物细分）
 * @returns {{ ok: boolean, reason: string, message?: string, toolUnavailable?: boolean }}
 */
export function evaluateGateArtifact({
  kind,
  artifact,
  missingReason,
  unavailableReason,
  isPassed,
  failedReason,
}) {
  if (!artifact) return { ok: false, reason: missingReason };

  const proof = verifyExecutionProof(kind, artifact);
  if (!proof.ok) return { ok: false, reason: proof.reason, message: proof.message };

  const fresh = checkArtifactFreshness(kind, artifact);
  if (!fresh.ok) return { ok: false, reason: fresh.reason, message: fresh.message };

  if (artifact.toolUnavailable === true && !isPassed(artifact)) {
    return {
      ok: false,
      reason: unavailableReason,
      toolUnavailable: true,
      message: toolUnavailableMessage(kind, artifact),
    };
  }

  if (isPassed(artifact)) return { ok: true, reason: 'checked' };
  return {
    ok: false,
    reason: typeof failedReason === 'function' ? failedReason(artifact) : failedReason,
  };
}

/** R38：工具不可用的统一处置指引——环境/工具问题，不得当成代码质量问题去「整改」 */
export function toolUnavailableMessage(kind, artifact) {
  const detail = artifact?.toolUnavailableDetail ?? artifact?.reason ?? '未提供细节';
  const category = artifact?.toolUnavailableCategory ?? 'unknown';
  return (
    `R38：${kind} 门禁失败的原因是**检查工具本身不可用**（类别 ${category}：${detail}），` +
    '不是代码质量不达标——请勿按「整改问题」的路径处理。' +
    '本门禁**不因工具不可用而放行**（R12：网络一断即免检属放松），但解法不同：' +
    '须由项目经理将 frontmatter `blocking` 置为 true、在「## 阻塞原因」写明工具不可用的具体证据，' +
    '并用 AskQuestion 请用户在三条路径中决策——①安装/修复工具或网络（含企业代理、证书、离线镜像）；' +
    '②在 `harness.config.json` 配置可离线执行的等价命令覆盖（`qe.commands.*` / `te.startupSmoke.command`，' +
    '该文件受 R29 锁定，须**用户本人**编辑）；③确认本项目确不适用该检查，走对应门禁的双要素豁免。' +
    '不得由代理自行选择其中任何一条。'
  );
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

/** R32：读取生产启动冒烟机读结果（startup-smoke-run.mjs 产出），缺失/解析失败返回 null */
export function readStartupSmokeResult() {
  const resultPath = path.join(PROJECT_ROOT, 'test-results/e2e', '.startup-smoke-result.json');
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

// ---------------------------------------------------------------------------
// R37：single-task = 增量迭代档
// ---------------------------------------------------------------------------

/**
 * **R37** 必填影响面维度。键为机读关键词正则，值为人话名称（用于报错文案）。
 *
 * 这四维不是随手挑的，它们对应「增量能否安全折叠测试轮次」的四个判断：
 * 接口与交互面决定 R14/E2E 是否必须落地新用例；schema 变更决定这次改动是否**根本不该**
 * 走增量档（数据模型改动的回滚面与兼容面远超单轮测试能覆盖的范围）；
 * 既有行为决定回归范围。缺任一维，「折叠成一轮测试」就失去论证基础。
 */
export const INCREMENT_SCOPE_DIMENSIONS = Object.freeze([
  { key: 'api', re: /接口|\bapi\b/i, label: '新增/变更对外接口' },
  { key: 'schema', re: /数据模型|\bschema\b|迁移|migration/i, label: '数据模型 / schema 变更' },
  { key: 'surface', re: /交互面|新增页面|新增入口|新增命令/i, label: '新增交互面（页面/命令/入口）' },
  { key: 'behavior', re: /既有行为|已有行为|回归范围/i, label: '影响的既有行为' },
]);

const AFFECTED_YES_RE = /^(是|yes|y|涉及)$/i;
const AFFECTED_NO_RE = /^(否|no|n|不涉及|无)$/i;

/** 说明列去掉标点空白后的有效长度（防「-」「待补」这类占位过关） */
function meaningfulLength(text) {
  return String(text ?? '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .length;
}

/**
 * **R37**：解析 `process.md`「## 增量范围」表。
 * @returns {{ ok: false, reason: string }|{ ok: true, rows: Array<{ dimension: string, affected: string, note: string }> }}
 */
export function parseIncrementScope(content) {
  const body = extractSection(content ?? '', '增量范围');
  if (!body) return { ok: false, reason: 'no-increment-scope-section' };
  const table = parseMarkdownTables(body).find((t) => t.headers.some((h) => /影响面|维度/.test(h)));
  if (!table) return { ok: false, reason: 'invalid-increment-scope-header' };
  const dimIdx = table.headers.findIndex((h) => /影响面|维度/.test(h));
  const affectedIdx = table.headers.findIndex((h) => /是否涉及|是否影响/.test(h));
  const noteIdx = table.headers.findIndex((h) => /说明|范围|依据/.test(h));
  if (dimIdx < 0 || affectedIdx < 0 || noteIdx < 0) {
    return { ok: false, reason: 'invalid-increment-scope-header' };
  }
  const rows = table.rows
    .map((row) => ({
      dimension: (row[dimIdx] ?? '').trim(),
      affected: (row[affectedIdx] ?? '').trim(),
      note: (row[noteIdx] ?? '').trim(),
    }))
    .filter((r) => r.dimension || r.affected || r.note);
  if (rows.length === 0) return { ok: false, reason: 'no-increment-scope-data-row' };
  return { ok: true, rows };
}

/**
 * **R37**：`single-task` 增量范围声明机读。
 *
 * 判据：四维齐全 → 每维「是否涉及」为是/否枚举 + 「说明」有实质内容 →
 * schema 维为「是」时**直接拒绝**（须改走 `full`）。
 *
 * 最后一条是把 `workflow-modes.md` 分诊表里早就写着、但历史实现从未校验过的
 * 「修改数据模型 / schema ⇒ 禁止 single-task」补成机械判据（R12：文档强于实现须补实现）。
 */
export function checkIncrementScopeDeclared(content) {
  const parsed = parseIncrementScope(content);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.reason,
      message: `R37：single-task（增量迭代）须在 process.md「## 增量范围」声明四维影响面（${INCREMENT_SCOPE_DIMENSIONS.map((d) => d.label).join('、')}），每维填「是/否」+ 实质说明。当前判定：${parsed.reason}。未声明增量范围前不得进入开发——折叠测试轮次的前提正是「改动面已被界定」。`,
    };
  }

  for (const dim of INCREMENT_SCOPE_DIMENSIONS) {
    const row = parsed.rows.find((r) => dim.re.test(r.dimension));
    if (!row) {
      return {
        ok: false,
        reason: 'increment-scope-missing-dimension',
        message: `R37：「## 增量范围」缺少「${dim.label}」这一维，不得进入开发。`,
      };
    }
    if (!AFFECTED_YES_RE.test(row.affected) && !AFFECTED_NO_RE.test(row.affected)) {
      return {
        ok: false,
        reason: 'increment-scope-invalid-enum',
        message: `R37：「${dim.label}」的「是否涉及」须为「是」或「否」，当前为「${row.affected || '空'}」。`,
      };
    }
    if (meaningfulLength(row.note) < 4) {
      return {
        ok: false,
        reason: 'increment-scope-empty-note',
        message: `R37：「${dim.label}」的「说明」为空或过短（去标点后不足 4 字），须写明具体范围或「不涉及」的依据。`,
      };
    }
    if (dim.key === 'schema' && AFFECTED_YES_RE.test(row.affected)) {
      return {
        ok: false,
        reason: 'increment-scope-schema-change',
        message:
          'R37：本次增量声明涉及数据模型 / schema 变更，**禁止**使用 single-task（`workflow-modes.md` 迭代分诊表既有规定，现补为机械判据）。schema 改动的兼容面与回滚面超出单轮折叠测试的覆盖能力，须经 AskQuestion 改回 `workflow_mode: full` 并走批次 + 最终两轮测试。',
      };
    }
  }
  return { ok: true, reason: 'checked' };
}

/**
 * **R37**：`single-task` 须建立在**已有设计**之上（增量的定义即「对既有设计做增量」）。
 * 与 hotfix 的 R9 前置校验同构：没有 `detail-design-spec.md` 说明这是从零开发，
 * 应走 `full`，而不是用增量档跳过技术选型确认（R26）。
 */
export function checkSingleTaskBaseDesign() {
  const designPath = path.join(getActiveDocsBase(), 'design/detail-design-spec.md');
  if (fs.existsSync(designPath)) return { ok: true, reason: 'checked' };
  return {
    ok: false,
    reason: 'single-task-base-design-missing',
    message:
      'R37：single-task 是**增量迭代**档，前提是项目已有 detail-design-spec.md（增量所依附的基线设计）。当前活跃 docs 子树下不存在该文件，说明这其实是首次开发——须改走 `workflow_mode: full`（含技术选型 R26 确认），不得用增量档绕过基线设计与选型确认。',
  };
}

/**
 * **R37**：`single-task` 进入开发前的完整前置校验（基线设计 + 增量范围声明）。
 * 非 single-task 模式直接通过。
 */
export function checkSingleTaskPreconditions(content) {
  if (getWorkflowMode(content) !== 'single-task') {
    return { ok: true, reason: 'not-single-task' };
  }
  const base = checkSingleTaskBaseDesign();
  if (!base.ok) return base;
  return checkIncrementScopeDeclared(content);
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

/**
 * R33：用户确认记录是否含「界面与交互期望」确认行。
 *
 * 背景（2026-07-29 界面不符复盘）：用户目标含强体验锚点（「类似 Apifox 的 B/S 工具」），
 * 需求分析师 13 轮澄清把**功能**问透了，却从未问布局/导航/信息架构；用户「确认」的是
 * 功能摘要，界面则被默默交给组件库默认样式，交付后严重不符预期。既有确认留痕只机读
 * 需求摘要与技术选型——「React + Ant Design」是**技术栈**，不等于界面期望已确认。
 *
 * 本判据要求确认记录中出现一行界面/交互类表态，两种形态皆可（都算「用户表过态」）：
 *   - 有期望：布局/导航/信息密度/对标某产品外观/参考图等；
 *   - 明确无独立期望：接受组件库默认外观，或本项目无 UI（CLI/库/纯后端）。
 *
 * 能力边界：机读只证明「界面这一维被摆到用户面前并留了痕」，不证明澄清是否充分、
 * 落地是否忠实——后者由 RA 的苏格拉底追问与 RR「体验」维人工审核承担。
 */
export function hasUiExpectationConfirmation(content) {
  const body = extractSection(content ?? '', '用户确认记录');
  if (!body) return false;
  const uiTopicRe = /界面|\bUI\b|交互|视觉|外观|布局/i;
  const stanceRe = /期望|对标|参考|风格|布局|导航|信息架构|默认|不适用|无\s*UI|无界面|确认|接受/i;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    // 跳过表头行（表头本身不含界面类词时不会误命中，这里只防表头恰好含「交互」等字样）
    if (/确认项/.test(t) && /时间/.test(t) && /用户原话/.test(t)) continue;
    if (uiTopicRe.test(t) && stanceRe.test(t)) return true;
  }
  return false;
}

/** R33：界面与交互期望确认机读（供发起 system-architect 前机械校验） */
export function checkUiExpectationConfirmed(content) {
  const md = content ?? readProcessMd() ?? '';
  if (hasUiExpectationConfirmation(md)) return { ok: true, reason: 'checked' };
  return {
    ok: false,
    reason: 'no-ui-expectation-confirmation',
    message:
      'R33：process.md「## 用户确认记录」缺少「界面与交互期望」确认行。需求分析师须在阶段一罗盘第 7 维澄清界面/交互期望（布局、导航、信息密度、是否对标某产品外观、参考图），并在阶段二摘要中单列「界面与交互期望」小节请用户确认；用户确认后由项目经理补一行确认记录。若本次确无独立界面期望，也须留痕「接受组件库默认外观」或「本项目无 UI/不适用」。不得发起 system-architect。',
  };
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
  // R33：需求摘要确认须显式覆盖界面与交互期望（或明确「无独立 UI 期望」）。
  const uiExpectation = checkUiExpectationConfirmed(content);
  if (!uiExpectation.ok) return uiExpectation;
  return { ok: true, reason: 'checked' };
}


