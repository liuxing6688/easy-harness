/**
 * 门禁域：design — R18 设计审核/覆盖矩阵、R25 同构模块识别、热修 P0、fail-open 留痕、R31 回退计数。
 *
 * 主要消费方：gate-role-sequence（设计就绪/审核干净/同构章节）、gate-stop-workflow（回退上限/软提醒）。
 * 域对照见 ./README.md。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  PROJECT_ROOT,
  getActiveProcessPath,
  getActiveDocsBase,
  readProcessMd,
  readProcessMdAtPath,
  parseProcessFrontmatter,
  getWorkflowMode,
  extractSection,
  parseMarkdownTables,
  sectionHasDataRow,
  isProcessBlocked,
  hasUnresolvedIssues,
  readTextFileSafe,
  recordGateExceptionLedgerEntry
} from './core.mjs';
import { checkRequirementReady } from './iteration.mjs';

export const REQUIRED_DPL_HEADERS = [
  '检查维度',
  '问题描述',
  '严重等级',
  '是否存在',
  '是否解决',
  '关联成果物',
  '关联需求编号',
  '建议责任角色',
  '修复建议',
];

/** R18：设计审核 12 维（须全部出现在「检查维度」列） */
export const REQUIRED_DESIGN_REVIEW_DIMENSIONS = [
  '需求覆盖度',
  '目标达成性',
  '功能',
  '体验',
  '可行性',
  'MVP 范围',
  '任务可执行性',
  '流程合规性',
  '架构设计原则',
  '成果物完整性',
  '测试可执行性',
  '安全与合规',
];

const KNOWN_FIX_ROLE_RE =
  /^(system-architect|requirements-analyst|requirement-reviewer|project-manager|development-engineer|quality-engineer|test-engineer|系统架构师|需求分析师|需求评审专家|项目经理|开发工程师|质量工程师|测试工程师|QE)$/i;

/** 归一化需求编号：R-001（去前导零后至少 3 位） */
export function normalizeRequirementId(raw) {
  const m = String(raw ?? '')
    .trim()
    .match(/^R-0*(\d+)$/i);
  if (!m) return null;
  return `R-${m[1].padStart(3, '0')}`;
}

/** 从 requirement-list.md 提取全部 P0 需求编号 */
export function extractP0RequirementIds(content) {
  if (!content) return [];
  const ids = [];
  for (const table of parseMarkdownTables(content)) {
    const idIdx = table.headers.findIndex((h) => /需求编号/.test(h));
    const prioIdx = table.headers.findIndex((h) => /优先级/.test(h));
    if (idIdx === -1 || prioIdx === -1) continue;
    for (const row of table.rows) {
      const id = normalizeRequirementId(row[idIdx]);
      const prio = (row[prioIdx] ?? '').trim();
      if (id && /^P0$/i.test(prio)) ids.push(id);
    }
  }
  return [...new Set(ids)];
}

function normalizeDimensionName(raw) {
  const s = String(raw ?? '').trim();
  if (/^MVP(\s*范围)?$/i.test(s)) return 'MVP 范围';
  return s;
}

function isBlankOrPlaceholder(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return true;
  if (/^(高\/中\/低|已覆盖\/未覆盖)$/i.test(s)) return true;
  if (/^Given\/When\/Then/i.test(s)) return true;
  return false;
}

/** 从任务包单元格提取 T 编号（如 T0-1、T-DOC-1） */
function extractTaskPackIds(raw) {
  const matches = String(raw ?? '').match(/\bT[\w./-]+\b/g);
  return matches ? [...new Set(matches)] : [];
}

/**
 * 设计落点是否可在详细设计中解析到（stub 设计文件跳过）。
 * 有 §N 引用时，要求设计正文出现对应章节痕迹。
 */
function designAnchorResolvable(anchor, designContent) {
  if (!designContent) return true;
  const body = designContent.replace(/^#.+$/m, '').trim();
  if (!body) return true;
  const sectionMatch = String(anchor ?? '').match(/§\s*([\w.]+)/);
  if (!sectionMatch) return true;
  const n = sectionMatch[1];
  if (designContent.includes(`§${n}`)) return true;
  if (new RegExp(`^#+\\s*${n}([.\\s]|$)`, 'm').test(designContent)) return true;
  if (designContent.includes(`第${n}`)) return true;
  return false;
}

/** 任务包编号是否出现在开发任务清单（清单本身无任何 T 编号时视为 stub，跳过） */
function taskPackExistsInList(taskId, taskListContent) {
  if (!taskListContent) return true;
  if (!/\bT[\w./-]+\b/.test(taskListContent)) return true;
  return taskListContent.includes(taskId);
}

/** 摘录归一化：剥离引号与全部空白，用于跨文档子串匹配；不改变机械判定边界（仅证明文字真实存在，不证明语义相关）。 */
function normalizeExcerptText(raw) {
  return String(raw ?? '')
    .replace(/[「」『』""''\u3000]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

const MIN_DESIGN_EXCERPT_LENGTH = 6;

/**
 * 摘录是否为设计文档正文中真实存在的原文（归一化空白/引号后做子串匹配）。
 * 设计文档为 stub（无正文）时跳过，与 designAnchorResolvable 的「非 stub 才交叉校验」策略一致。
 * 本函数只证明「这句话确实来自设计文档」，不证明「与本条验收标准相关」——相关性仍需人工核验
 * （见 .cursor/harness/spec/mechanical-gates.md §8.4；机械判定边界坦诚披露，非隐藏漏洞）。
 */
function excerptFoundInDesign(excerpt, designContent) {
  const body = String(designContent ?? '').replace(/^#.+$/m, '').trim();
  if (!body) return true;
  const needle = normalizeExcerptText(excerpt);
  if (!needle) return false;
  return normalizeExcerptText(body).includes(needle);
}

/**
 * R18：按设计落点 §N 提取设计文档对应章节窗口正文（到下一同级/更高级标题为止）。
 * 无 §N 锚点或找不到对应标题时返回 null（调用方跳过窗口校验，保持与 designAnchorResolvable 软性策略一致）。
 */
export function extractDesignSectionWindow(anchor, designContent) {
  const sectionMatch = String(anchor ?? '').match(/§\s*([\w.]+)/);
  if (!sectionMatch || !designContent) return null;
  const n = sectionMatch[1];
  const lines = String(designContent).split('\n');
  let start = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const hm = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (!hm) continue;
    const title = hm[2];
    const hit =
      title.includes(`§${n}`) ||
      new RegExp(`^${n}([.\\s：:]|$)`).test(title.trim()) ||
      title.includes(`第${n}`);
    if (hit) {
      start = i;
      startLevel = hm[1].length;
      break;
    }
  }
  if (start === -1) return null;
  const bodyLines = [];
  for (let i = start + 1; i < lines.length; i++) {
    const hm = lines[i].match(/^(#{1,6})\s+/);
    if (hm && hm[1].length <= startLevel) break;
    bodyLines.push(lines[i]);
  }
  return bodyLines.join('\n');
}

/**
 * 摘录是否落在设计落点对应章节窗口内。
 * - 设计 stub / 无 § 锚点 / 找不到章节标题 → 跳过（true）
 * - 找到窗口 → 摘录归一化后须为该窗口子串
 */
export function excerptInDesignAnchorWindow(excerpt, anchor, designContent) {
  const body = String(designContent ?? '').replace(/^#.+$/m, '').trim();
  if (!body) return true;
  if (!/§\s*[\w.]+/.test(String(anchor ?? ''))) return true;
  const window = extractDesignSectionWindow(anchor, designContent);
  if (window == null) return true;
  const windowBody = window.trim();
  if (!windowBody) return true;
  const needle = normalizeExcerptText(excerpt);
  if (!needle) return false;
  return normalizeExcerptText(windowBody).includes(needle);
}

/**
 * R18：用户确认记录是否含技术选型/技术栈确认行。
 */
export function hasTechSelectionConfirmation(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (/确认项|时间|用户原话/.test(t) && /\|.*\|.*\|/.test(t) && !/技术/.test(t)) continue;
    if (/技术选型|技术栈/.test(t) && /确认|采用|同意|选定|已选/.test(t)) return true;
  }
  return false;
}

/** R18：技术选型确认机读（供 RR / DE 前置） */
export function checkTechSelectionConfirmed(content) {
  const md = content ?? readProcessMd() ?? '';
  if (!hasTechSelectionConfirmation(md)) {
    return {
      ok: false,
      reason: 'no-tech-selection-confirmation',
      message:
        'R18：process.md「## 用户确认记录」缺少技术选型/技术栈确认行，不得发起设计审核或开发。',
    };
  }
  return { ok: true, reason: 'checked' };
}

/**
 * R18：是否存在「曾登记为问题且已标记解决」的行（是否存在=是 且 是否解决=是）。
 * 用于强制 SA 返工后须经 RR 复审（审核结论须为「复审通过」）。
 */
export function hasResolvedDesignIssues(content) {
  const tables = parseMarkdownTables(content);
  for (const table of tables) {
    const existIdx = table.headers.findIndex((h) => /是否存在/.test(h));
    const resolvedIdx = table.headers.findIndex((h) => /是否解决/.test(h));
    if (existIdx === -1 || resolvedIdx === -1) continue;
    for (const row of table.rows) {
      const exists = (row[existIdx] ?? '').trim();
      const resolved = (row[resolvedIdx] ?? '').trim();
      if (/^是$/.test(exists) && /^是$/.test(resolved)) return true;
    }
  }
  return false;
}

/**
 * R18：审核结论机读——须有「## 审核结论」；最新结论为「通过」或「复审通过」；
 * 若存在已解决的设计问题行，最新结论必须为「复审通过」。
 */
export function checkDesignReviewConclusion(dplContent) {
  const section = extractSection(dplContent, '审核结论');
  if (section == null) {
    return {
      ok: false,
      reason: 'missing-review-conclusion',
      message: 'R18：设计问题清单缺少「## 审核结论」章节（首次通过填「通过」；返工后须「复审通过」）。',
    };
  }
  const tables = parseMarkdownTables(section);
  const table = tables.find((t) => t.headers.some((h) => /结论/.test(h)));
  if (!table || table.rows.length === 0) {
    return {
      ok: false,
      reason: 'missing-review-conclusion-rows',
      message: 'R18：「## 审核结论」缺少含「结论」列的数据行。',
    };
  }
  const verdictIdx = table.headers.findIndex((h) => /^结论$/.test(h.trim()) || /结论/.test(h));
  const last = table.rows[table.rows.length - 1];
  const verdict = (last[verdictIdx] ?? '').trim();
  const needsRereview = hasResolvedDesignIssues(dplContent);
  if (needsRereview) {
    if (!/^复审通过$/.test(verdict)) {
      return {
        ok: false,
        reason: 'rereview-required',
        message:
          'R18：设计问题清单存在已解决的问题行，须由 requirement-reviewer 复审并将「## 审核结论」最新结论标为「复审通过」后，方可进入开发。',
      };
    }
  } else if (!/^(通过|复审通过)$/.test(verdict)) {
    return {
      ok: false,
      reason: 'review-not-passed',
      message: `R18：「## 审核结论」最新结论须为「通过」或「复审通过」（当前：${verdict || '空'}）。`,
    };
  }
  return { ok: true, reason: needsRereview ? 'rereview-passed' : 'checked' };
}

/**
 * R9：声明 hotfix_p0_impact:none 时，用户确认记录是否含最小影响澄清记录。
 * 记录须覆盖受影响用户、既有行为变化、回滚条件与 P0 判断依据；
 * 仅校验结构关键词，不校验语义真实性。
 */
export function hasHotfixNoneJustification(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (/确认项|时间|用户原话/.test(t) && /\|.*\|.*\|/.test(t) && !/hotfix|热修/i.test(t)) {
      continue;
    }
    if (
      /hotfix影响面|hotfix\s*影响面|热修影响面/i.test(t) &&
      /受影响用户/.test(t) &&
      /既有行为/.test(t) &&
      /回滚条件/.test(t) &&
      /P0/i.test(t)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * R9 扩展：hotfix 须声明 hotfix_p0_impact；声明 none 时须留痕判断依据；
 * 若为 p0/yes，则须 R18 设计审核清洁（含复审结论）。
 */
export function checkHotfixP0Impact(content) {
  const fm = parseProcessFrontmatter(content);
  if (getWorkflowMode(content) !== 'hotfix') {
    return { ok: true, reason: 'not-hotfix' };
  }
  const raw = String(fm.hotfix_p0_impact ?? '')
    .trim()
    .toLowerCase();
  if (!raw) {
    return {
      ok: false,
      reason: 'hotfix-p0-impact-unset',
      message:
        'R9：hotfix 须在 process.md frontmatter 声明 hotfix_p0_impact: none|p0（影响 P0 行为时为 p0）。',
    };
  }
  if (!/^(none|no|p0|yes)$/.test(raw)) {
    return {
      ok: false,
      reason: 'hotfix-p0-impact-invalid',
      message: `R9：hotfix_p0_impact 取值无效（${raw}），仅允许 none|p0。`,
    };
  }
  if (/^(none|no)$/.test(raw)) {
    if (!hasHotfixNoneJustification(content)) {
      return {
        ok: false,
        reason: 'hotfix-none-justification-missing',
        message:
          'R9：声明 hotfix_p0_impact:none 时须在 ## 用户确认记录 补一行最小影响澄清记录（含「hotfix影响面」「受影响用户」「既有行为」「回滚条件」与 P0 判断依据）。',
      };
    }
  }
  if (/^(p0|yes)$/.test(raw)) {
    const clean = checkDesignReviewClean();
    if (!clean.ok) {
      return {
        ok: false,
        reason: 'hotfix-p0-needs-rr',
        message:
          clean.message ??
          'R9：hotfix 影响 P0 行为时须完成需求评审（R18 通过）或改走 workflow_mode: full。',
      };
    }
  }
  return { ok: true, reason: /^(p0|yes)$/.test(raw) ? 'p0-reviewed' : 'no-p0-impact' };
}

/**
 * 收集「本次 hotfix」相关的测试报告路径（不扫描整个 docs/test/ 目录）：
 * 1. process.md 正文显式引用的 `docs/.../test/*.md` / `test/*.md`；
 * 2. 若无引用，回退到规范名 `test-report.md`（存在时）。
 * 历史无关报告中的关键词/章节不得抑制本次软性提醒。
 */
function collectCurrentHotfixTestReportPaths(content) {
  const docsBase = getActiveDocsBase();
  const testDir = path.join(docsBase, 'test');
  const names = new Set();
  const refs =
    String(content ?? '').match(
      /(?:docs\/(?:[\w.-]+\/)?test\/|\/test\/|(?:^|[\s(`])test\/)([\w./-]+\.md)/gi,
    ) ?? [];
  for (const ref of refs) {
    const m = ref.match(/([\w./-]+\.md)$/i);
    if (m) names.add(path.basename(m[1]));
  }
  if (names.size === 0 && fs.existsSync(path.join(testDir, 'test-report.md'))) {
    names.add('test-report.md');
  }
  const paths = [];
  for (const name of names) {
    const abs = path.join(testDir, name);
    if (fs.existsSync(abs)) paths.push(abs);
  }
  return paths;
}

/**
 * R9 软性提醒（非阻塞，说明权威见 `.cursor/harness/spec/gate-chain.md` R9 脚注第 4 条（执行权威：Hook/脚本））：
 * P0 影响的 hotfix 走 R11 折叠通道时，R14（接口测试）/R17（存储对账）机读硬门禁
 * 明确不并入该通道（仅约束 full 模式开发窗口批次阶段），但高风险的 P0 行为变更仍
 * 应在**本次**测试报告中留痕接口/存储相关验证结果。本函数仅对**本次 hotfix 测试报告**
 * （process.md 引用或规范名 `test-report.md`）做结构化章节校验——须含非空
 * 「## 接口测试报告」「## 存储对账记录」真实数据行（同 R14/R17 的 `sectionHasDataRow`），
 * **不做全目录关键词匹配**；缺失时供 `recordHotfixP0SoftReminder` 写入一次性提醒，
 * **不阻塞流程、不影响 gatePassed/finalTestComplete**。
 */
export function checkHotfixP0InterfaceStorageMention(content) {
  const fm = parseProcessFrontmatter(content);
  if (getWorkflowMode(content) !== 'hotfix') return { applicable: false, reason: 'not-hotfix' };
  const raw = String(fm.hotfix_p0_impact ?? '').trim().toLowerCase();
  if (!/^(p0|yes)$/.test(raw)) return { applicable: false, reason: 'no-p0-impact' };

  const reportPaths = collectCurrentHotfixTestReportPaths(content);
  let mentionsInterface = false;
  let mentionsStorage = false;
  for (const reportPath of reportPaths) {
    let reportContent = '';
    try {
      reportContent = readTextFileSafe(reportPath) ?? ''; // R30
    } catch {
      continue;
    }
    if (sectionHasDataRow(reportContent, '接口测试报告')) mentionsInterface = true;
    if (sectionHasDataRow(reportContent, '存储对账记录')) mentionsStorage = true;
  }
  return {
    applicable: true,
    mentionsInterface,
    mentionsStorage,
    reportPaths,
    needsReminder: !mentionsInterface || !mentionsStorage,
  };
}

const HOTFIX_P0_SOFT_REMINDER_MARKER = '<!-- hotfix-p0-interface-storage-reminder -->';

/**
 * 将 R9 软性提醒（见 `checkHotfixP0InterfaceStorageMention`）以一次性、非阻塞的方式
 * 写入活跃 `process.md`：仅在「hotfix + P0 影响 + 唯一测试通道已完成」时检测一次，
 * 命中即追加「## 门禁软性提醒（非阻塞）」章节并留下幂等标记（同一 process.md 不重复写入）。
 * 本函数**永不**返回失败以外的阻塞语义——调用方（`gate-stop-workflow`）须以 best-effort/
 * try-catch 方式调用，任何异常都不得影响正常的 allow/followup 判定。
 */
export function recordHotfixP0SoftReminder(content) {
  try {
    const processPath = getActiveProcessPath();
    if (!fs.existsSync(processPath)) return { ok: false, reason: 'no-process' };
    let fileContent = readTextFileSafe(processPath) ?? ''; // R30
    const fm = parseProcessFrontmatter(fileContent);
    if (fm.cancelled === true) return { ok: false, reason: 'cancelled' };
    if (fileContent.includes(HOTFIX_P0_SOFT_REMINDER_MARKER)) {
      return { ok: true, reason: 'already-recorded' };
    }

    const check = checkHotfixP0InterfaceStorageMention(content ?? fileContent);
    if (!check.applicable || !check.needsReminder) {
      return { ok: true, reason: 'not-needed' };
    }

    const missing = [];
    if (!check.mentionsInterface) missing.push('接口测试报告（须含真实数据行）');
    if (!check.mentionsStorage) missing.push('存储对账记录（须含真实数据行）');

    const note = [
      '',
      '## 门禁软性提醒（非阻塞）',
      '',
      HOTFIX_P0_SOFT_REMINDER_MARKER,
      `- [R9 软性提醒] 本次 hotfix 声明 \`hotfix_p0_impact: p0\`（影响 P0 行为），但**本次**测试报告（process.md 引用或 \`test-report.md\`）缺少结构化「${missing.join('、')}」。R14/R17 机读硬门禁按 R11 明确不并入 hotfix 折叠通道，本提醒**不阻塞**本次收尾；建议 test-engineer/项目经理复核本次热修是否实际触及接口或业务数据存储，若涉及，请在本次测试报告补充对应章节与真实数据行供人工审查参考。`,
      '',
    ].join('\n');

    fileContent = `${fileContent.trimEnd()}\n${note}`;
    fs.writeFileSync(processPath, fileContent, 'utf8');
    return { ok: true, reason: 'recorded' };
  } catch (writeErr) {
    process.stderr.write(
      `[recordHotfixP0SoftReminder] failed: ${writeErr?.message ?? writeErr}\n`,
    );
    return { ok: false, reason: 'write-failed' };
  }
}

/**
 * 把「## 阻塞原因」里的出厂占位「无」替换成具体阻塞条目（逐行处理，不用整段正则）。
 *
 * 历史实现用 `/## 阻塞原因\s*\n+无\s*(?=\n## |\n*$)/` 匹配，**匹配不上出厂模板**——
 * 模板里「无」后面紧跟两行 `>` 使用说明，先行断言要求的 `\n## ` 或结尾都不成立。
 * 后果是门禁 fail-open 时只置了 `blocking: true`、却没写阻塞原因，与 **R35** 的
 * 「实质阻塞原因」判据配合时会显得自相矛盾（门禁自己写的阻塞过不了门禁自己的证据校验）。
 * 现改为逐行定位那一行裸「无」，保留其后的引用块说明。
 */
function fillBlockingReason(content, hookName, context) {
  if (!/## 阻塞原因/.test(content)) return content;
  const lines = content.split('\n');
  let inSection = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (/^##\s/.test(line)) {
      if (inSection) break; // 已离开本节，说明没有裸「无」（可能已有实质内容）
      inSection = /^##\s*阻塞原因\s*$/.test(line);
      continue;
    }
    if (!inSection) continue;
    if (line !== '无') continue;
    lines[i] = [
      `- 阻塞原因：门禁 fail-open 异常（${hookName}/${context}），待项目经理处理`,
      '- 待决事项：核查 stderr 与「## 门禁异常事件」，修复后门禁后清除 blocking',
      '- 已产出成果物：见门禁异常事件',
    ].join('\n');
    return lines.join('\n');
  }
  return content;
}

/**
 * `.cursor/harness/spec/mechanical-gates.md` §8.4：fail-open 时将异常持久化为 process.md 阻塞事件（cancelled 流程不写）。
 * 写入失败时仅 stderr，不影响 fail-open 放行。
 *
 * **R35 联动**：`process.md` 落盘成功后，同一条事件还会登记到 Hook 独占写入的旁路台账
 * （`recordGateExceptionLedgerEntry`）。stop 门禁的「机器起源」释放分支要两侧指纹对得上，
 * 否则代理自己往表格里补一行就能解除阻塞。登记放在写盘**之后**：若顺序反过来，
 * `process.md` 写失败会留下一条无主台账条目，反倒成了可被抄用的凭证。
 */
export function recordFailOpenEvent(hookName, context, err) {
  if (!err) return { ok: false, reason: 'no-error' };
  try {
    const processPath = getActiveProcessPath();
    if (!fs.existsSync(processPath)) return { ok: false, reason: 'no-process' };
    let content = readTextFileSafe(processPath) ?? ''; // R30
    const fm = parseProcessFrontmatter(content);
    if (fm.cancelled === true) return { ok: false, reason: 'cancelled' };

    if (/^---\r?\n/.test(content)) {
      content = content.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (block) => {
        if (/^blocking:\s*/m.test(block)) {
          return block.replace(/^blocking:\s*.*$/m, 'blocking: true');
        }
        return block.replace(/\n---\s*$/, '\nblocking: true\n---');
      });
    }

    const ts = new Date().toISOString();
    const msg = String(err?.message ?? err)
      .replace(/\|/g, '/')
      .replace(/\r?\n/g, ' ')
      .slice(0, 200);
    const row = `| ${ts} | ${hookName} | ${context} | ${msg} | 待处理 |`;
    const header = [
      '## 门禁异常事件',
      '',
      '| 时间 | Hook | 上下文 | 异常摘要 | 处理状态 |',
      '| ---- | ---- | ------ | -------- | -------- |',
      row,
      '',
    ].join('\n');

    if (/## 门禁异常事件/.test(content)) {
      content = content.replace(
        /(## 门禁异常事件\s*\n\s*\| 时间 \| Hook \| 上下文 \| 异常摘要 \| 处理状态 \|\s*\n\|[^\n]+\|\s*\n)/,
        `$1${row}\n`,
      );
      if (!content.includes(row)) {
        content = content.replace(/(## 门禁异常事件\s*\n)/, `$1\n${row}\n`);
      }
    } else {
      content = `${content.trimEnd()}\n\n${header}`;
    }

    content = fillBlockingReason(content, hookName, context);

    fs.writeFileSync(processPath, content, 'utf8');
    recordGateExceptionLedgerEntry({ ts, hook: hookName, context, summary: msg });
    return { ok: true, reason: 'recorded' };
  } catch (writeErr) {
    process.stderr.write(
      `[recordFailOpenEvent] failed: ${writeErr?.message ?? writeErr}\n`,
    );
    return { ok: false, reason: 'write-failed' };
  }
}

function isNaRequirementRef(raw) {
  return /^(无|不适用|n\/a|—|-)$/i.test(String(raw ?? '').trim());
}

/**
 * R18：设计问题清单结构机读——必填表头、12 维齐全、未解决行可修复字段完备。
 */
export function checkDesignProblemListStructure(content) {
  if (!content) {
    return {
      ok: false,
      reason: 'empty-design-problem-list',
      message: 'R18：设计问题清单为空。',
    };
  }

  const tables = parseMarkdownTables(content);
  const issueTable = tables.find((t) => t.headers.some((h) => /检查维度/.test(h)));
  if (!issueTable) {
    return {
      ok: false,
      reason: 'missing-issue-table',
      message: 'R18：设计问题清单缺少含「检查维度」列的审核问题表。',
    };
  }

  for (const required of REQUIRED_DPL_HEADERS) {
    if (!issueTable.headers.some((h) => h === required || h.includes(required))) {
      return {
        ok: false,
        reason: 'missing-dpl-header',
        message: `R18：设计问题清单缺少必填列「${required}」（含关联需求编号/建议责任角色/修复建议等可修复字段）。`,
      };
    }
  }

  const dimIdx = issueTable.headers.findIndex((h) => /检查维度/.test(h));
  const existIdx = issueTable.headers.findIndex((h) => /是否存在/.test(h));
  const resolvedIdx = issueTable.headers.findIndex((h) => /是否解决/.test(h));
  const artifactIdx = issueTable.headers.findIndex((h) => /关联成果物/.test(h));
  const reqIdx = issueTable.headers.findIndex((h) => /关联需求编号/.test(h));
  const roleIdx = issueTable.headers.findIndex((h) => /建议责任角色/.test(h));
  const fixIdx = issueTable.headers.findIndex((h) => /修复建议/.test(h));

  const presentDims = new Set(
    issueTable.rows.map((row) => normalizeDimensionName(row[dimIdx])).filter(Boolean),
  );
  for (const dim of REQUIRED_DESIGN_REVIEW_DIMENSIONS) {
    if (!presentDims.has(dim)) {
      return {
        ok: false,
        reason: 'missing-review-dimension',
        message: `R18：设计问题清单缺少必审维度「${dim}」（含需求覆盖度/目标达成性等 12 维）。`,
      };
    }
  }

  for (const row of issueTable.rows) {
    const exists = (row[existIdx] ?? '').trim();
    const resolved = (row[resolvedIdx] ?? '').trim();
    if (!/^是$/.test(exists) || /^是$/.test(resolved)) continue;

    const artifact = (row[artifactIdx] ?? '').trim();
    const reqRef = (row[reqIdx] ?? '').trim();
    const role = (row[roleIdx] ?? '').trim();
    const fix = (row[fixIdx] ?? '').trim();

    if (isBlankOrPlaceholder(artifact)) {
      return {
        ok: false,
        reason: 'unresolved-missing-artifact',
        message: 'R18：未解决设计问题缺少「关联成果物」，无法供其他 Agent 定位修复。',
      };
    }
    if (isBlankOrPlaceholder(reqRef)) {
      return {
        ok: false,
        reason: 'unresolved-missing-req-ref',
        message: 'R18：未解决设计问题缺少「关联需求编号」（流程类问题可填「无」）。',
      };
    }
    if (!isNaRequirementRef(reqRef)) {
      const parts = reqRef.split(/[,，\s]+/).filter(Boolean);
      if (parts.length === 0 || !parts.every((p) => normalizeRequirementId(p))) {
        return {
          ok: false,
          reason: 'unresolved-bad-req-ref',
          message: 'R18：未解决设计问题的「关联需求编号」格式无效（须为 R-xxx 或「无」）。',
        };
      }
    }
    if (isBlankOrPlaceholder(role) || !KNOWN_FIX_ROLE_RE.test(role)) {
      return {
        ok: false,
        reason: 'unresolved-missing-role',
        message:
          'R18：未解决设计问题缺少合法「建议责任角色」（如 system-architect / 系统架构师）。',
      };
    }
    if (isBlankOrPlaceholder(fix)) {
      return {
        ok: false,
        reason: 'unresolved-missing-fix',
        message: 'R18：未解决设计问题缺少「修复建议」，无法供其他 Agent 执行返工。',
      };
    }
  }

  return { ok: true, reason: 'checked' };
}

/**
 * R18：需求覆盖矩阵机读——章节存在；全部 P0 出现且结论为「已覆盖」；
 * 「验收标准」「设计落点/设计支撑点」「设计落点原文摘录」「任务包」均非空；
 * 在设计/任务清单非 stub 时交叉校验可解析性；「设计落点原文摘录」额外校验最短长度、
 * 是否为设计文档正文中真实存在的原文（非 stub 时）、是否落在设计落点 §N 章节窗口内、
 * 以及是否跨多个 P0 行重复摘录同一句话
 * （见 excerptFoundInDesign / excerptInDesignAnchorWindow）——均为可机械判定的
 * 「文字真实性/定位/多样性」检查；语义相关性仍不可机械判定，由人工核验。
 */
export function checkRequirementCoverageMatrix(dplContent, reqListContent) {
  const section = extractSection(dplContent, '需求覆盖矩阵');
  if (section == null) {
    return {
      ok: false,
      reason: 'missing-coverage-matrix',
      message: 'R18：设计问题清单缺少「## 需求覆盖矩阵」章节。',
    };
  }

  const p0Ids = extractP0RequirementIds(reqListContent);
  const tables = parseMarkdownTables(section);
  const matrix = tables.find(
    (t) =>
      t.headers.some((h) => /需求编号/.test(h)) && t.headers.some((h) => /覆盖结论/.test(h)),
  );
  if (!matrix) {
    return {
      ok: false,
      reason: 'missing-coverage-table',
      message: 'R18：需求覆盖矩阵缺少含「需求编号」「覆盖结论」列的表格。',
    };
  }

  const idIdx = matrix.headers.findIndex((h) => /需求编号/.test(h));
  const acIdx = matrix.headers.findIndex((h) => /验收标准/.test(h));
  // 「设计落点原文摘录」亦含「设计落点」字样，须显式排除，避免列索引串位
  const anchorIdx = matrix.headers.findIndex(
    (h) => /设计落点|设计支撑点/.test(h) && !/原文摘录/.test(h),
  );
  const excerptIdx = matrix.headers.findIndex((h) => /原文摘录/.test(h));
  const taskIdx = matrix.headers.findIndex((h) => /任务包/.test(h));
  const verdictIdx = matrix.headers.findIndex((h) => /覆盖结论/.test(h));
  if (acIdx === -1) {
    return {
      ok: false,
      reason: 'missing-acceptance-column',
      message: 'R18：需求覆盖矩阵缺少「验收标准」列（须固化验收标准 ↔ 设计支撑 ↔ 任务包）。',
    };
  }
  if (anchorIdx === -1 || taskIdx === -1) {
    return {
      ok: false,
      reason: 'missing-coverage-columns',
      message: 'R18：需求覆盖矩阵缺少「设计落点/设计支撑点」或「任务包」列。',
    };
  }
  if (excerptIdx === -1) {
    return {
      ok: false,
      reason: 'missing-excerpt-column',
      message:
        'R18：需求覆盖矩阵缺少「设计落点原文摘录」列（须摘录设计文档相关原句，供人工核验；机读仅校验列存在与非空）。',
    };
  }

  const docsBase = getActiveDocsBase();
  const designPath = path.join(docsBase, 'design/detail-design-spec.md');
  const taskListPath = path.join(docsBase, 'design/develop-task-list.md');
  const designContent = readTextFileSafe(designPath) ?? ''; // R30
  const taskListContent = readTextFileSafe(taskListPath) ?? ''; // R30

  const rowById = new Map();
  for (const row of matrix.rows) {
    const id = normalizeRequirementId(row[idIdx]);
    if (id) rowById.set(id, row);
  }

  const excerptsSeen = [];
  for (const id of p0Ids) {
    const row = rowById.get(id);
    if (!row) {
      return {
        ok: false,
        reason: 'p0-missing-in-matrix',
        message: `R18：P0 需求 ${id} 未出现在需求覆盖矩阵中。`,
      };
    }
    const verdict = (row[verdictIdx] ?? '').trim();
    if (!/^已覆盖$/.test(verdict)) {
      return {
        ok: false,
        reason: 'p0-not-covered',
        message: `R18：P0 需求 ${id} 覆盖结论不是「已覆盖」（当前：${verdict || '空'}）。`,
      };
    }
    if (isBlankOrPlaceholder(row[acIdx])) {
      return {
        ok: false,
        reason: 'p0-empty-acceptance',
        message: `R18：P0 需求 ${id} 的「验收标准」为空（须填写可读验收断言或编号）。`,
      };
    }
    if (isBlankOrPlaceholder(row[anchorIdx])) {
      return {
        ok: false,
        reason: 'p0-empty-design-anchor',
        message: `R18：P0 需求 ${id} 的「设计落点/设计支撑点」为空。`,
      };
    }
    if (isBlankOrPlaceholder(row[excerptIdx])) {
      return {
        ok: false,
        reason: 'p0-empty-design-excerpt',
        message: `R18：P0 需求 ${id} 的「设计落点原文摘录」为空（须摘录设计文档中与该验收标准直接相关的一句原文）。`,
      };
    }
    const excerptNormalized = normalizeExcerptText(row[excerptIdx]);
    if (excerptNormalized.length < MIN_DESIGN_EXCERPT_LENGTH) {
      return {
        ok: false,
        reason: 'p0-design-excerpt-too-short',
        message: `R18：P0 需求 ${id} 的「设计落点原文摘录」过短（归一化后不足 ${MIN_DESIGN_EXCERPT_LENGTH} 字），须摘录完整的一句设计原文，不得用「见§x」类占位敷衍。`,
      };
    }
    if (!excerptFoundInDesign(row[excerptIdx], designContent)) {
      return {
        ok: false,
        reason: 'p0-design-excerpt-not-found',
        message: `R18：P0 需求 ${id} 的「设计落点原文摘录」在 detail-design-spec.md 正文中找不到对应原文（去除空白/引号后仍无法匹配），须摘录设计文档中真实存在的语句，不得自行编写、转述或摘录其他文档内容。`,
      };
    }
    if (!excerptInDesignAnchorWindow(row[excerptIdx], row[anchorIdx], designContent)) {
      return {
        ok: false,
        reason: 'p0-design-excerpt-outside-anchor-window',
        message: `R18：P0 需求 ${id} 的「设计落点原文摘录」未出现在设计落点「${row[anchorIdx]}」对应章节窗口内（疑似张冠李戴摘录其他章节），须摘录该落点章节内与验收标准相关的原句。`,
      };
    }
    excerptsSeen.push(excerptNormalized);
    if (isBlankOrPlaceholder(row[taskIdx])) {
      return {
        ok: false,
        reason: 'p0-empty-task-anchor',
        message: `R18：P0 需求 ${id} 的「任务包」为空。`,
      };
    }
    if (!designAnchorResolvable(row[anchorIdx], designContent)) {
      return {
        ok: false,
        reason: 'p0-design-anchor-unresolved',
        message: `R18：P0 需求 ${id} 的设计落点「${row[anchorIdx]}」在 detail-design-spec.md 中无法解析到对应章节。`,
      };
    }
    const taskIds = extractTaskPackIds(row[taskIdx]);
    if (taskIds.length === 0) {
      return {
        ok: false,
        reason: 'p0-task-id-unparseable',
        message: `R18：P0 需求 ${id} 的「任务包」须含可识别编号（如 T0-1）。`,
      };
    }
    for (const tid of taskIds) {
      if (!taskPackExistsInList(tid, taskListContent)) {
        return {
          ok: false,
          reason: 'p0-task-not-found',
          message: `R18：P0 需求 ${id} 引用的任务包 ${tid} 未出现在 develop-task-list.md 中。`,
        };
      }
    }
  }

  // 跨行摘录去重（≥3 个 P0 时才有统计意义）：防止用同一句话复制粘贴糊弄多条 P0 行。
  // 只判定「文字是否雷同」，不判定语义，属可机械化的多样性检查。
  if (p0Ids.length >= 3) {
    const freq = new Map();
    for (const t of excerptsSeen) {
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
    for (const count of freq.values()) {
      if (count > p0Ids.length / 2) {
        return {
          ok: false,
          reason: 'excerpt-duplicated-across-rows',
          message:
            'R18：需求覆盖矩阵中超过半数 P0 行的「设计落点原文摘录」完全相同（疑似复制同一句话糊弄多行），须逐条摘录与各自验收标准对应的设计原文。',
        };
      }
    }
  }

  return { ok: true, reason: p0Ids.length === 0 ? 'no-p0' : 'checked' };
}

/**
 * R25：设计阶段「同构模块识别」章节机读（供发起 requirement-reviewer 前机械校验）。
 * 背景：QE R16 全仓重复代码复盘（2026-07-28）发现相似资源族（CRUD 路由、页面脚手架、
 * 测试 fixture、E2E helper）在设计阶段未被前置识别，并行开发工程师各自「复制改」
 * 导致大量克隆对，QE 首轮必然打回。本规则要求设计阶段显式排查并声明共享 primitive。
 * 设计文档为 stub（仅标题、无正文，selftest/scenario 惯用极简 fixture）时跳过，
 * 与 R18 覆盖矩阵等既有 stub 豁免策略一致，不代表真实项目可跳过本章节。
 * 校验规则：章节须存在且非空；要么显式声明「已排查，无同构资源族」并附非空排查依据，
 * 要么提供含「同构组」「共享 Primitive」列的表格且至少一条真实数据行、每行两列均非空。
 * **判定前须剥离引用块（`>` 开头的模板说明文字）**：出厂模板的机制说明中本身含有
 * 「已排查，无同构资源族」示例句，若不剥离，未填写的出厂模板会被误判为通过（门禁空转）。
 * 只有架构师撰写的正文（非引用行）才计入判定。
 */
export function checkIsomorphicModuleSection(designContent) {
  const body = String(designContent ?? '').replace(/^#.+$/m, '').trim();
  if (!body) {
    return { ok: true, reason: 'stub-design' };
  }
  const section = extractSection(designContent, '同构模块识别');
  if (section == null) {
    return {
      ok: false,
      reason: 'missing-isomorphic-module-section',
      message:
        'R25：detail-design-spec.md 缺少「## 同构模块识别（须逐项列出）」章节，须排查是否存在同构 CRUD 路由/页面脚手架/测试 fixture/E2E helper 并声明共享 primitive 名称与落点，或写明「已排查，无同构资源族」及理由，不得发起 requirement-reviewer。',
    };
  }
  const authored = section
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');
  const sectionTrimmed = authored.trim();
  if (!sectionTrimmed) {
    return {
      ok: false,
      reason: 'empty-isomorphic-module-section',
      message: 'R25：「同构模块识别」章节为空，不得留空跳过，不得发起 requirement-reviewer。',
    };
  }
  const noGroupMatch = sectionTrimmed.match(/已排查[，,]\s*无同构资源族([^\n]*)/);
  if (noGroupMatch) {
    const rationale = (noGroupMatch[1] ?? '').replace(/[（）()。.\s]/g, '');
    if (rationale.length < 4) {
      return {
        ok: false,
        reason: 'isomorphic-no-group-missing-rationale',
        message:
          'R25：声明「已排查，无同构资源族」须附最短排查依据（如涉及范围、排查方式），不得只写结论敷衍，不得发起 requirement-reviewer。',
      };
    }
    return { ok: true, reason: 'no-isomorphic-groups' };
  }
  const tables = parseMarkdownTables(authored);
  const table = tables.find(
    (t) => t.headers.some((h) => /同构组/.test(h)) && t.headers.some((h) => /primitive/i.test(h)),
  );
  if (!table) {
    return {
      ok: false,
      reason: 'missing-isomorphic-module-table',
      message:
        'R25：「同构模块识别」章节须为含「同构组名称」与「共享 Primitive 名称」列的表格，或声明「已排查，无同构资源族」及理由，不得发起 requirement-reviewer。',
    };
  }
  const groupIdx = table.headers.findIndex((h) => /同构组/.test(h));
  const primitiveIdx = table.headers.findIndex((h) => /primitive/i.test(h));
  const rows = table.rows.filter((row) => row.some((cell) => cell.trim()));
  if (rows.length === 0) {
    return {
      ok: false,
      reason: 'isomorphic-module-table-empty',
      message: 'R25：「同构模块识别」表格无真实数据行，不得发起 requirement-reviewer。',
    };
  }
  for (const row of rows) {
    if (!(row[groupIdx] ?? '').trim() || !(row[primitiveIdx] ?? '').trim()) {
      return {
        ok: false,
        reason: 'isomorphic-module-row-incomplete',
        message:
          'R25：「同构模块识别」表格每行「同构组名称」与「共享 Primitive 名称」均须非空，不得发起 requirement-reviewer。',
      };
    }
  }
  return { ok: true, reason: 'checked' };
}

/** R25：读取活跃 detail-design-spec.md 并校验「同构模块识别」章节（供发起 requirement-reviewer 前机械校验） */
export function checkIsomorphicModuleSectionReady() {
  const docsBase = getActiveDocsBase();
  const designPath = path.join(docsBase, 'design/detail-design-spec.md');
  const designContent = readTextFileSafe(designPath) ?? ''; // R30
  return checkIsomorphicModuleSection(designContent);
}

/** R13：设计成果物是否就绪（供发起 requirement-reviewer 设计审核 / development-engineer 前机械校验） */
export function checkDesignReady() {
  const docsBase = getActiveDocsBase();
  const designPath = path.join(docsBase, 'design/detail-design-spec.md');
  const taskListPath = path.join(docsBase, 'design/develop-task-list.md');
  if (!fs.existsSync(designPath) || !fs.existsSync(taskListPath)) {
    return { ok: false, reason: 'missing-design-artifacts' };
  }
  return { ok: true, reason: 'checked' };
}

/**
 * R13 + R18：设计审核是否通过（供发起 development-engineer 前机械校验）。
 * 校验：清单存在 → 结构/12 维/可修复字段 → 无未解决问题 → P0 需求覆盖矩阵
 * （含验收标准列与落点交叉校验）→ 审核结论（返工后须复审通过）。
 */
export function checkDesignReviewClean() {
  const docsBase = getActiveDocsBase();
  const designProblemPath = path.join(docsBase, 'design/design-problem-list.md');
  if (!fs.existsSync(designProblemPath)) {
    return {
      ok: false,
      reason: 'missing-design-problem-list',
      message: '设计问题清单缺失，设计审核未通过，不得发起开发工程师。',
    };
  }
  const content = readTextFileSafe(designProblemPath) ?? ''; // R30

  const structure = checkDesignProblemListStructure(content);
  if (!structure.ok) return structure;

  if (hasUnresolvedIssues(content)) {
    return {
      ok: false,
      reason: 'unresolved-design-issues',
      message: '设计问题清单存在未解决问题，设计审核未通过，不得发起开发工程师。',
    };
  }

  const reqListPath = path.join(docsBase, 'requirement/requirement-list.md');
  if (!fs.existsSync(reqListPath)) {
    return {
      ok: false,
      reason: 'missing-requirement-list-for-coverage',
      message: 'R18：缺少 requirement-list.md，无法校验需求覆盖矩阵。',
    };
  }
  const reqList = readTextFileSafe(reqListPath) ?? ''; // R30
  const coverage = checkRequirementCoverageMatrix(content, reqList);
  if (!coverage.ok) return coverage;

  const conclusion = checkDesignReviewConclusion(content);
  if (!conclusion.ok) return conclusion;

  return { ok: true, reason: 'checked' };
}

