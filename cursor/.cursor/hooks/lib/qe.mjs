/**
 * 门禁域：qe — R14–R17 接口测试/存储对账、R15–R16 lint/静态扫描豁免与机读、
 * R22 TE 替代启动拦截、R32 生产启动冒烟正向证据。
 *
 * 「双要素豁免」统一在本域实现（gated-artifacts Applicability + process.md 用户确认关键词）。
 * 主要消费方：gate-stop-workflow / gate-role-sequence / gate-dev-shell（R22）。域对照见 ./README.md。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  PROJECT_ROOT,
  RECON_EVIDENCE_DIR,
  RECON_EVIDENCE_PATH_RE,
  getActiveDocsBase,
  loadGatedArtifacts,
  readProcessMd,
  getWorkflowMode,
  extractSection,
  parseMarkdownTables,
  sectionHasDataRow,
  hasUnresolvedIssues,
  ROLE_ALIASES,
  readTextFileSafe,
  readJsonFileSafe,
  getStartupSmokeMaxAgeHours,
} from './core.mjs';
import {
  readLintResult,
  readStaticScanResult,
  readStartupSmokeResult,
  readE2eResult,
  evaluateGateArtifact,
  toolUnavailableMessage,
} from './iteration.mjs';
import { verifyExecutionProof, checkArtifactFreshness } from './execproof.mjs';
import { evaluateStartupSmokeResult } from '../../scripts/startup-smoke-lib.mjs';
import { readRecentlyDispatchedRoles } from './identity.mjs';
import {
  extractTaskCode
} from './role-path.mjs';

function hasE2eExemptionConfirmation(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (/e2e/i.test(t) && /豁免|不适用|n\/a|无/i.test(t)) return true;
  }
  return false;
}

export function isE2eExempt(content) {
  const artifacts = loadGatedArtifacts();
  if (artifacts.e2eApplicability !== 'n/a') return false;
  const md = content ?? readProcessMd();
  if (!md) return false;
  return hasE2eExemptionConfirmation(md);
}

/**
 * 是否为「替代 E2E WebServer 启动」命令（补强项 3 / TE 冒烟，**R22**）。
 * 命中 `E2E_WEB_SERVER_COMMAND=` 显式覆盖，或 `npx vite-node` 与 e2e/playwright 同现。
 */
export function isAlternativeE2eStartupCommand(command) {
  if (!command || typeof command !== 'string') return false;
  if (/\bE2E_WEB_SERVER_COMMAND\s*=/.test(command)) return true;
  if (/\bnpx\s+vite-node\b/i.test(command) && /e2e|webserver|playwright/i.test(command)) return true;
  return false;
}

function hasAlternativeE2eStartupConfirmation(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    // 须含「允许非 dist 启动做 E2E」语义（与 test-engineer.md 强制约束对齐）
    if (/非\s*dist\s*启动/i.test(t) && /允许|确认/i.test(t)) return true;
    if (/替代启动/i.test(t) && /E2E|e2e/i.test(t) && /允许|确认/i.test(t)) return true;
  }
  return false;
}

/**
 * 替代 E2E 启动双要素：gated-artifacts `e2eAlternativeStartup:"allowed"` + 用户确认。
 */
export function isAlternativeE2eStartupExempt(content) {
  const artifacts = loadGatedArtifacts();
  if (artifacts.e2eAlternativeStartup !== 'allowed') return false;
  const md = content ?? readProcessMd();
  if (!md) return false;
  return hasAlternativeE2eStartupConfirmation(md);
}

/**
 * TE 冒烟门禁：最近派发为 test-engineer 时，禁止未经双要素确认的替代 E2E 启动命令。
 * @returns {{ ok: boolean, reason: string, message?: string }}
 */
export function checkTeAlternativeE2eStartup(command) {
  if (!isAlternativeE2eStartupCommand(command)) {
    return { ok: true, reason: 'not-alternative-startup' };
  }
  const recent = readRecentlyDispatchedRoles();
  const mostRecent = recent[0];
  if (mostRecent !== 'test-engineer') {
    return { ok: true, reason: 'not-te-dispatch' };
  }
  if (isAlternativeE2eStartupExempt()) {
    return { ok: true, reason: 'dual-element-exempt' };
  }
  return {
    ok: false,
    reason: 'te-alternative-startup-denied',
    message:
      'R5/R22（TE 冒烟）：最近派发为 test-engineer，禁止使用 E2E_WEB_SERVER_COMMAND / vite-node 等替代启动命令掩盖生产启动失败。须先用 design/默认生产启动命令（如 npm run start）冒烟；失败则测试不通过并回派 DE。仅当 gated-artifacts.json 声明 e2eAlternativeStartup:"allowed" 且用户在「## 用户确认记录」确认「允许非 dist 启动做 E2E」时方可变通。',
  };
}

/**
 * R32：生产启动冒烟适用性豁免——确无可冒烟启动路径的项目（纯库、纯静态资源包、
 * 无常驻进程的 CLI 单次命令等）可豁免，判定与 R14/R17 同构（`mechanical-gates.md` §8.2 双要素）：
 * ①`gated-artifacts.json` 声明 `startupSmokeApplicability: "n/a"`；
 * ②`process.md`「## 用户确认记录」含一行生产启动/启动冒烟豁免确认。两项皆满足才豁免（R12）。
 *
 * 注意：**「暂时起不来」不是豁免理由**——冒烟失败属产品缺陷，须回派 DE，而非声明不适用。
 */
function hasStartupSmokeExemptionConfirmation(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (/启动冒烟|生产启动/.test(t) && /豁免|不适用|n\/a|无启动|无常驻/i.test(t)) return true;
  }
  return false;
}

export function isStartupSmokeExempt(content) {
  const artifacts = loadGatedArtifacts();
  if (artifacts.startupSmokeApplicability !== 'n/a') return false;
  const md = content ?? readProcessMd();
  if (!md) return false;
  return hasStartupSmokeExemptionConfirmation(md);
}

/**
 * R32：生产启动冒烟硬门禁（正向证据）——测试工程师须实际运行
 * `node .cursor/scripts/startup-smoke-run.mjs` 并取得 `gatePassed=true`。
 *
 * 与 R22 的分工：R22 拦「用替代启动命令掩盖失败」（负向、Shell 通道），本判据要求
 * 「拿出冒烟通过的证据」（正向、产物通道）。只有两者同时存在，才堵住「干脆不冒烟」
 * 这条在 2026-07-29 复盘中真实发生过的路径。
 *
 * docs-only 无开发窗口视为满足；双要素豁免视为满足。
 */
export function checkStartupSmoke(content) {
  const md = content ?? readProcessMd() ?? '';
  if (getWorkflowMode(md) === 'docs-only') return { ok: true, reason: 'docs-only' };
  if (isStartupSmokeExempt(md)) return { ok: true, reason: 'startup-smoke-exempt' };
  const artifact = readStartupSmokeResult();
  // 产物缺失/新鲜度/两段完整性等具体理由由 evaluateStartupSmokeResult 给出（TE 需要它们定位失败段），
  // 故此处**不套用** evaluateGateArtifact 的 `gatePassed` 分支，只前置它的两段判据：
  //   R34 验签——未验签的产物，其 capturedAt 与两段结果都不可信，须先拦；
  //   R38 工具不可用——启动命令压根不存在时，问题在环境而非产品（本门禁刻意只认这一类，见运行器注释）。
  if (artifact) {
    const proof = verifyExecutionProof('startup-smoke', artifact);
    if (!proof.ok) return proof;
    // R34 新鲜度：R32 本就有 24h 上限，但「24 小时内」不等于「这份代码」——
    // 上午跑绿、下午改坏代码，冒烟产物仍在有效期内。故同样要求晚于最后一次源码变更。
    const fresh = checkArtifactFreshness('startup-smoke', artifact);
    if (!fresh.ok) return fresh;
    if (artifact.toolUnavailable === true && artifact.gatePassed !== true) {
      return {
        ok: false,
        reason: 'startup-tool-unavailable',
        toolUnavailable: true,
        message: toolUnavailableMessage('startup-smoke', artifact),
      };
    }
  }
  return evaluateStartupSmokeResult(artifact, { maxAgeHours: getStartupSmokeMaxAgeHours() });
}

/**
 * 批次/最终 E2E 门禁判据（**R34** 验签 + **R38** 工具不可用分类 + 既有 `gatePassed`）。
 * 抽出成独立判据后，`parseWorkflowState` 不再直接读 `gatePassed`，与 R15/R16/R32 同构。
 * @param {'batch'|'final'} scope
 */
export function checkE2eGate(scope) {
  return evaluateGateArtifact({
    kind: scope === 'final' ? 'e2e-final' : 'e2e-batch',
    artifact: readE2eResult(scope),
    missingReason: `no-e2e-${scope}-result`,
    unavailableReason: `e2e-${scope}-tool-unavailable`,
    isPassed: (a) => a.gatePassed === true,
    failedReason: `e2e-${scope}-not-passed`,
  });
}

/**
 * R17：业务数据存储对账适用性豁免——无业务数据持久化（数据库/文件/缓存/对象存储等）
 * 的项目可豁免 R17 机读判据，判定与 R14 同构（`mechanical-gates.md` §8.2 双要素）：
 * ①`gated-artifacts.json` 声明 `storageReconciliationApplicability: "n/a"`；
 * ②`process.md`「## 用户确认记录」含一行存储对账豁免确认。两项皆满足才豁免（R12）。
 */
function hasStorageReconciliationExemptionConfirmation(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (/存储对账|对账/i.test(t) && /豁免|不适用|n\/a|无持久化/i.test(t)) return true;
  }
  return false;
}

export function isStorageReconciliationExempt(content) {
  const artifacts = loadGatedArtifacts();
  if (artifacts.storageReconciliationApplicability !== 'n/a') return false;
  const md = content ?? readProcessMd();
  if (!md) return false;
  return hasStorageReconciliationExemptionConfirmation(md);
}

/** R17：具名存储介质关键词（与 `.cursor/harness/spec/mechanical-gates.md` §8.3 一致；不含「其他」「不适用」） */
const STORAGE_MEDIUM_NAMED_RE =
  /数据库|\bdb\b|database|文件|filesystem|\bfile\b|缓存|\bcache\b|对象存储|\bobject\b|\bblob\b|\bs3\b|\boss\b|\bminio\b/i;

/** R17：兜底介质「其他」——须另填非空备注说明具体系统（真实落盘介质，不可用于「无写入」） */
const STORAGE_MEDIUM_OTHER_RE = /其他|\bother\b/i;

/**
 * R17：任务包级「不适用」介质——仅用于批次内确无业务数据写入的任务包留痕；
 * 只参与任务包覆盖，不计入接口/E2E 分类型真实对账判定（防用「其他」伪装绕过）。
 */
const STORAGE_MEDIUM_NA_RE = /不适用|n\/a/i;

/** R17：场景类型=接口 */
const STORAGE_SCENE_API_RE = /接口|\bapi\b/i;

/** R17：场景类型=E2E */
const STORAGE_SCENE_E2E_RE = /e2e|\bui\b/i;

/** R17：该行是否为「不适用」留痕行（非真实对账） */
function isStorageReconNaRow(row) {
  if (!row?.medium) return false;
  if (STORAGE_MEDIUM_NAMED_RE.test(row.medium)) return false;
  if (STORAGE_MEDIUM_OTHER_RE.test(row.medium)) return false;
  return STORAGE_MEDIUM_NA_RE.test(row.medium);
}

/** R17：从进度行提取全部任务包编号（同一行可含多个，如 T0-1 与 T0-2） */
function extractAllTaskCodes(rowText) {
  const re = /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+(?:\/\d+)*)\b/g;
  const codes = [];
  for (const m of rowText.matchAll(re)) codes.push(m[1]);
  return codes;
}

/**
 * R17：收集「## 进度列表」中测试工程师**已完成**的批次集成测试行所关联的任务包编号。
 * 用于按批次强制覆盖——每条已完成批次测试进度中的任务包，须在「## 存储对账记录」
 * 「关联任务包」列中至少出现一次（避免首批填过一次后后续批次空跑过门禁）。
 */
function collectCompletedBatchTestTaskCodes(content) {
  const body = extractSection(content, '进度列表');
  if (!body) return [];
  const roleAliases = ROLE_ALIASES['测试工程师'] ?? ['测试工程师'];
  const codes = new Set();
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (!roleAliases.some((alias) => t.includes(alias))) continue;
    if (/最终整体集成测试|最终集成测试|TE-FINAL|TE-最终/i.test(t)) continue;
    if (/已作废|superseded/i.test(t)) continue;
    if (!t.includes('执行完成')) continue;
    for (const code of extractAllTaskCodes(t)) codes.add(code);
  }
  return [...codes];
}

/**
 * 解析「## 存储对账记录」章节内表格的数据行。
 * 要求表头含：场景类型、关联任务包、存储介质、对账方式、预期存储结果、实际存储结果、是否通过；
 * 「备注」列可选（介质为「其他」时必填，在校验阶段强制）。
 * @returns {{ ok: false, reason: string } | { ok: true, rows: object[] }}
 */
function parseStorageReconciliationRows(content) {
  const body = extractSection(content, '存储对账记录');
  if (!body) return { ok: false, reason: 'no-storage-recon-section' };
  const tables = parseMarkdownTables(body);
  if (tables.length === 0) return { ok: false, reason: 'no-storage-recon-table' };
  for (const table of tables) {
    const sceneIdx = table.headers.findIndex((h) => /场景类型/.test(h));
    const taskIdx = table.headers.findIndex((h) => /关联任务包/.test(h));
    const mediumIdx = table.headers.findIndex((h) => /存储介质/.test(h));
    const methodIdx = table.headers.findIndex((h) => /对账方式/.test(h));
    const expectedIdx = table.headers.findIndex((h) => /预期存储结果/.test(h));
    const actualIdx = table.headers.findIndex((h) => /实际存储结果/.test(h));
    const passIdx = table.headers.findIndex((h) => /是否通过/.test(h));
    const noteIdx = table.headers.findIndex((h) => /^备注$/.test(h) || /备注/.test(h));
    if (
      sceneIdx === -1 ||
      taskIdx === -1 ||
      mediumIdx === -1 ||
      methodIdx === -1 ||
      expectedIdx === -1 ||
      actualIdx === -1 ||
      passIdx === -1
    ) {
      continue;
    }
    const rows = [];
    for (const row of table.rows) {
      const scene = (row[sceneIdx] ?? '').trim();
      const taskPkg = (row[taskIdx] ?? '').trim();
      const medium = (row[mediumIdx] ?? '').trim();
      const method = (row[methodIdx] ?? '').trim();
      const expected = (row[expectedIdx] ?? '').trim();
      const actual = (row[actualIdx] ?? '').trim();
      const passed = (row[passIdx] ?? '').trim();
      const note = noteIdx >= 0 ? (row[noteIdx] ?? '').trim() : '';
      // 跳过全空占位行
      if (
        !scene &&
        !taskPkg &&
        !medium &&
        !method &&
        !expected &&
        !actual &&
        !passed &&
        !note &&
        row.every((c) => !(c ?? '').trim())
      ) {
        continue;
      }
      rows.push({ scene, taskPkg, medium, method, expected, actual, passed, note });
    }
    if (rows.length === 0) return { ok: false, reason: 'no-storage-recon-data-row' };
    return { ok: true, rows };
  }
  return { ok: false, reason: 'no-storage-recon-required-columns' };
}

/**
 * 校验单行存储对账字段完备性（描述列非空、「其他」/「不适用」备注、介质关键词）。
 * 「不适用」行：备注必填说明理由；描述列可填「不适用」；不校验具名介质。
 * @returns {string|null} 失败 reason，通过则 null
 */
/**
 * R17：适用（非「不适用」）对账行须在「对账方式」中引用证据文件
 * `test-results/recon/<name>.json`，且文件存在、含非空 command/summary 与数值 exitCode。
 * 「不适用」行不要求证据（仍须备注理由）。
 */
export function checkReconEvidenceRef(method) {
  const m = String(method ?? '').match(RECON_EVIDENCE_PATH_RE);
  if (!m) {
    return {
      ok: false,
      reason: 'missing-recon-evidence-path',
      message:
        'R17：适用对账行的「对账方式」须包含证据路径 test-results/recon/<name>.json（由测试工程师实际查验后落盘）。',
    };
  }
  const rel = m[0].replace(/\\/g, '/');
  const abs = path.join(PROJECT_ROOT, rel);
  if (!fs.existsSync(abs)) {
    return {
      ok: false,
      reason: 'missing-recon-evidence-file',
      message: `R17：对账证据文件不存在：${rel}`,
    };
  }
  let data;
  try {
    data = readJsonFileSafe(abs); // R30
    if (data === null) throw new Error('unreadable');
  } catch {
    return {
      ok: false,
      reason: 'invalid-recon-evidence-json',
      message: `R17：对账证据文件不是合法 JSON：${rel}`,
    };
  }
  if (typeof data?.command !== 'string' || !data.command.trim()) {
    return {
      ok: false,
      reason: 'recon-evidence-missing-command',
      message: `R17：对账证据 ${rel} 缺少非空 command 字段。`,
    };
  }
  if (typeof data?.summary !== 'string' || !data.summary.trim()) {
    return {
      ok: false,
      reason: 'recon-evidence-missing-summary',
      message: `R17：对账证据 ${rel} 缺少非空 summary 字段。`,
    };
  }
  if (typeof data?.exitCode !== 'number' || !Number.isFinite(data.exitCode)) {
    return {
      ok: false,
      reason: 'recon-evidence-missing-exitcode',
      message: `R17：对账证据 ${rel} 缺少数值型 exitCode 字段。`,
    };
  }
  return { ok: true, reason: 'checked', path: rel };
}

function validateStorageReconRow(row) {
  if (!row.taskPkg) return 'missing-task-package';
  if (!extractTaskCode(row.taskPkg)) return 'invalid-task-package';
  if (!row.method) return 'missing-recon-method';
  if (!row.expected) return 'missing-expected-result';
  if (!row.actual) return 'missing-actual-result';
  if (!row.passed) return 'missing-pass-result';
  if (!row.medium) return 'invalid-storage-medium';
  if (isStorageReconNaRow(row)) {
    if (!row.note) return 'na-medium-requires-note';
    return null;
  }
  const named = STORAGE_MEDIUM_NAMED_RE.test(row.medium);
  const other = STORAGE_MEDIUM_OTHER_RE.test(row.medium);
  if (!named && !other) return 'invalid-storage-medium';
  if (other && !named && !row.note) return 'other-medium-requires-note';
  const evidence = checkReconEvidenceRef(row.method);
  if (!evidence.ok) return evidence.reason;
  return null;
}

/**
 * R17：批次（开发窗口）集成测试阶段必须做业务数据存储对账——测试报告须含非空的
 * 「## 存储对账记录」章节，且满足分类型行、描述列完备、「其他」/「不适用」备注、
 * 存储介质列、批次任务包覆盖，以及适用行的对账证据文件（test-results/recon/*.json）机读
 * （`.cursor/harness/spec/mechanical-gates.md` §8.3 说明权威；执行权威：Hook/脚本）。
 * 「不适用」行仅计入任务包覆盖，不计入接口/E2E 分类型真实对账、不要求证据文件；项目未整体豁免时
 * 至少须有一条适用（真实对账）行。
 * 扫描当前活跃 docs 子树 `test/` 目录下所有 `*.md`；合并全部对账行后整体判定。
 * 无业务持久化项目按 `isStorageReconciliationExempt()` 在 parseWorkflowState 侧豁免。
 */
export function checkBatchStorageReconciliationReport(content) {
  const docsBase = getActiveDocsBase();
  const testDir = path.join(docsBase, 'test');
  if (!fs.existsSync(testDir)) return { ok: false, reason: 'missing-test-dir' };
  let files;
  try {
    files = fs.readdirSync(testDir).filter((f) => f.toLowerCase().endsWith('.md'));
  } catch {
    return { ok: false, reason: 'test-dir-unreadable' };
  }
  if (files.length === 0) return { ok: false, reason: 'no-test-report' };

  const md = content ?? readProcessMd() ?? '';
  const needApiRow = !isApiTestExempt(md);
  const needE2eRow = !isE2eExempt(md);
  const requiredTaskCodes = collectCompletedBatchTestTaskCodes(md);

  const allRows = [];
  let lastReason = 'no-storage-recon-section';
  for (const f of files) {
    let fileContent;
    try {
      fileContent = readTextFileSafe(path.join(testDir, f)) ?? ''; // R30
    } catch {
      continue;
    }
    const parsed = parseStorageReconciliationRows(fileContent);
    if (!parsed.ok) {
      lastReason = parsed.reason;
      continue;
    }
    allRows.push(...parsed.rows);
  }
  if (allRows.length === 0) return { ok: false, reason: lastReason };

  for (const row of allRows) {
    const rowFail = validateStorageReconRow(row);
    if (rowFail) return { ok: false, reason: rowFail };
  }

  // 「不适用」行不计入分类型真实对账；项目未整体豁免时至少须有一条适用行
  const applicableRows = allRows.filter((r) => !isStorageReconNaRow(r));
  if (applicableRows.length === 0) {
    return { ok: false, reason: 'missing-applicable-recon-row' };
  }

  const hasApi = applicableRows.some((r) => STORAGE_SCENE_API_RE.test(r.scene));
  const hasE2e = applicableRows.some((r) => STORAGE_SCENE_E2E_RE.test(r.scene));
  if (needApiRow && !hasApi) return { ok: false, reason: 'missing-api-scene-row' };
  if (needE2eRow && !hasE2e) return { ok: false, reason: 'missing-e2e-scene-row' };

  // 按批次任务包覆盖：进度中已完成的批次测试任务包，须在对账「关联任务包」列出现
  // （含「不适用」留痕行——它们只服务覆盖，不服务分类型判定）
  if (requiredTaskCodes.length > 0) {
    const covered = new Set();
    for (const row of allRows) {
      for (const code of extractAllTaskCodes(row.taskPkg)) covered.add(code);
    }
    const missing = requiredTaskCodes.filter((c) => !covered.has(c));
    if (missing.length > 0) {
      return { ok: false, reason: `missing-batch-task-coverage:${missing.join(',')}` };
    }
  }

  return { ok: true, reason: 'checked' };
}

/**
 * R14：接口测试适用性豁免——无对外接口的项目（纯算法库、纯静态前端、无 HTTP/RPC/CLI
 * 契约的组件等）可豁免「必须做接口测试」判据，判定与 E2E 适用性豁免同构（`mechanical-gates.md` §8.3）：
 * 须同时满足①架构师在活跃 `gated-artifacts.json` 声明 `apiTestApplicability: "n/a"`；
 * ②`process.md`「## 用户确认记录」含一行接口测试豁免确认。两项皆满足才豁免，避免单方
 * 面弱化门禁（R12）。
 */
function hasApiExemptionConfirmation(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue; // 分隔行
    if (/接口测试|api/i.test(t) && /豁免|不适用|n\/a|无接口|无对外接口/i.test(t)) return true;
  }
  return false;
}

export function isApiTestExempt(content) {
  const artifacts = loadGatedArtifacts();
  if (artifacts.apiTestApplicability !== 'n/a') return false;
  const md = content ?? readProcessMd();
  if (!md) return false;
  return hasApiExemptionConfirmation(md);
}

/**
 * R15：编程规范（lint）适用性豁免——确无可用 linter 的项目（如无成熟 lint 工具的
 * 技术栈）可豁免「lint 门禁必须通过」判据，判定与 E2E / 接口测试适用性豁免同构：
 * 须同时满足①架构师在活跃 `gated-artifacts.json` 声明 `lintApplicability: "n/a"`；
 * ②`process.md`「## 用户确认记录」含一行编程规范/lint 豁免确认。两项皆满足才豁免，
 * 避免单方面弱化门禁（R12）。
 */
function hasLintExemptionConfirmation(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue; // 分隔行
    if (/编程规范|代码规范|lint/i.test(t) && /豁免|不适用|n\/a|无\s*lint|无可用/i.test(t)) return true;
  }
  return false;
}

export function isLintExempt(content) {
  const artifacts = loadGatedArtifacts();
  if (artifacts.lintApplicability !== 'n/a') return false;
  const md = content ?? readProcessMd();
  if (!md) return false;
  return hasLintExemptionConfirmation(md);
}

/**
 * R16：重复代码检测（DRY）适用性豁免——判定与 lint 豁免（R15）同构：须同时满足
 * ①架构师在活跃 `gated-artifacts.json` 声明 `dupCheckApplicability: "n/a"`；
 * ②`process.md`「## 用户确认记录」含一行重复代码/DRY 豁免确认。两项皆满足才豁免，
 * 避免单方面弱化门禁（R12）。与安全扫描豁免（isSecurityScanExempt）相互独立。
 */
function hasDupExemptionConfirmation(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue; // 分隔行
    if (/重复代码|dry|jscpd/i.test(t) && /豁免|不适用|n\/a|无/i.test(t)) return true;
  }
  return false;
}

export function isDupCheckExempt(content) {
  const artifacts = loadGatedArtifacts();
  if (artifacts.dupCheckApplicability !== 'n/a') return false;
  const md = content ?? readProcessMd();
  if (!md) return false;
  return hasDupExemptionConfirmation(md);
}

/**
 * R16：安全静态扫描（密钥泄露）适用性豁免——判定与 lint 豁免（R15）同构：须同时满足
 * ①架构师在活跃 `gated-artifacts.json` 声明 `securityScanApplicability: "n/a"`；
 * ②`process.md`「## 用户确认记录」含一行安全扫描豁免确认。两项皆满足才豁免，避免
 * 单方面弱化门禁（R12）。与重复代码豁免（isDupCheckExempt）相互独立。
 */
function hasSecurityExemptionConfirmation(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue; // 分隔行
    if (/安全扫描|安全静态扫描|密钥扫描|secretscan|gitleaks/i.test(t) && /豁免|不适用|n\/a|无/i.test(t)) return true;
  }
  return false;
}

export function isSecurityScanExempt(content) {
  const artifacts = loadGatedArtifacts();
  if (artifacts.securityScanApplicability !== 'n/a') return false;
  const md = content ?? readProcessMd();
  if (!md) return false;
  return hasSecurityExemptionConfirmation(md);
}

/**
 * R14：批次（开发窗口）集成测试阶段必须做接口测试——测试报告须含非空的
 * 「## 接口测试报告」章节（至少一条真实表格数据行）。扫描当前活跃 docs 子树
 * `test/` 目录下所有 `*.md` 测试报告，任一含有效「## 接口测试报告」章节即通过。
 * 仅约束「开发窗口批次集成测试阶段」，最终整体集成测试与 hotfix 折叠通道不由此判定。
 * 无对外接口项目按 `isApiTestExempt()` 豁免（见上）。
 */
export function checkBatchApiTestReport() {
  const docsBase = getActiveDocsBase();
  const testDir = path.join(docsBase, 'test');
  if (!fs.existsSync(testDir)) return { ok: false, reason: 'missing-test-dir' };
  let files;
  try {
    files = fs.readdirSync(testDir).filter((f) => f.toLowerCase().endsWith('.md'));
  } catch {
    return { ok: false, reason: 'test-dir-unreadable' };
  }
  if (files.length === 0) return { ok: false, reason: 'no-test-report' };
  for (const f of files) {
    let content;
    try {
      content = readTextFileSafe(path.join(testDir, f)) ?? ''; // R30
    } catch {
      continue;
    }
    if (sectionHasDataRow(content, '接口测试报告')) {
      return { ok: true, reason: 'checked' };
    }
  }
  return { ok: false, reason: 'no-api-test-report-section' };
}

/** R13：质量报告是否无未解决高/中问题、且质量判定通过（供发起 test-engineer 前机械校验） */
export function checkQeClean() {
  const docsBase = getActiveDocsBase();
  const qualityDir = path.join(docsBase, 'quality');
  if (!fs.existsSync(qualityDir)) return { ok: false, reason: 'missing-quality-dir' };
  const files = fs.readdirSync(qualityDir).filter((f) => /^quality-report.*\.md$/.test(f));
  if (files.length === 0) return { ok: false, reason: 'no-quality-report' };
  for (const f of files) {
    const content = readTextFileSafe(path.join(qualityDir, f)) ?? ''; // R30
    if (hasUnresolvedIssues(content)) return { ok: false, reason: `unresolved-in-${f}` };
    if (/质量判定[:：]\s*不通过/.test(content)) return { ok: false, reason: `qe-fail-${f}` };
  }
  return { ok: true, reason: 'checked' };
}

/**
 * R15：编程规范（lint）门禁是否通过（供发起 test-engineer 前机械校验，与 checkQeClean 并列）。
 * docs-only 模式或经双要素适用性豁免时视为通过；否则须存在 lint-run.mjs 机读产物、
 * **R34** 执行证明验签通过、且 gatePassed=true。
 *
 * `content` 可选（缺省读活跃 process.md）：`parseWorkflowState` 传入自己手上的内容，
 * 使 stop 门禁与 R13 派发门禁走**同一份判据**，不再各算一遍（历史实现两处各自读产物、
 * 各自判 gatePassed，任何一侧加判据都可能与另一侧漂移）。
 */
export function checkLintClean(content) {
  const md = content ?? readProcessMd() ?? '';
  if (getWorkflowMode(md) === 'docs-only') return { ok: true, reason: 'docs-only' };
  if (isLintExempt(md)) return { ok: true, reason: 'lint-exempt' };
  const verdict = evaluateGateArtifact({
    kind: 'lint',
    artifact: readLintResult(),
    missingReason: 'no-lint-result',
    unavailableReason: 'lint-tool-unavailable',
    isPassed: (a) => a.gatePassed === true,
    // 「探测不到 lint 命令」与「项目没配 linter」都不是代码违规，须原样上浮到 stop 门禁，
    // 否则会被压成 lint-not-passed，指引变成「让 DE 去整改」一个还没被检查过的代码库。
    failedReason: (a) =>
      a.reason === 'no-lint-command' || a.reason === 'lint-not-configured'
        ? a.reason
        : 'lint-not-passed',
  });
  const guidance = LINT_FAILURE_GUIDANCE[verdict.reason];
  return guidance && !verdict.ok ? { ...verdict, message: guidance } : verdict;
}

/**
 * R15 中两类「跑了也没检查成」的失败的处置指引（§8.2 失败性质四分）。
 *
 * 由判据本身携带、stop 门禁与 TE 派发门禁共用同一份文案：这两处历史上各写各的
 * 「请整改 lint 违规」，任何一侧改口径都不会带上另一侧。指引的要害是**别把方向指错**——
 * 让 DE 去整改一个一条规则都没跑过的代码库，比不给指引更浪费。
 */
export const LINT_FAILURE_GUIDANCE = Object.freeze({
  'no-lint-command':
    'lint 门禁未通过的原因是**框架探测不到本项目的默认 lint 命令**（reason=no-lint-command），不是代码有违规——重跑 `lint-run.mjs` 不会改变结果。' +
    '请查看 test-results/qe/.lint-result.json 的 `remediation` 字段（含探测到的技术栈、monorepo 子项目清单与可直接粘贴的配置片段），' +
    '由 project-manager 标 blocking 并用 AskQuestion 请用户在两条路径中决策：' +
    '①由**用户本人**在 `.cursor/harness.config.json` 写 `qe.commands.lint` 覆盖（该文件受 R29 锁定，system-architect 与其它任何代理都不得代写，只能呈现片段请用户粘贴）；' +
    '②确无可用 linter 时走双要素豁免（gated-artifacts.json 声明 lintApplicability:"n/a" + process.md「## 用户确认记录」补一行编程规范豁免确认）。' +
    '「框架没有默认命令」本身不是豁免理由，代理不得自行选择路径，也不得据此推进测试或宣告完成。',
  'lint-not-configured':
    'lint 门禁未通过的原因是**本项目还没配置 linter**（reason=lint-not-configured，如 package.json 缺 `scripts.lint`），命令跑起来了但一条规则都没检查过——既不是代码违规，也不是环境问题。' +
    '请由 project-manager 分派 development-engineer 补齐 linter 配置（如 eslint/ruff 配置文件 + 对应 `scripts.lint`，属产品工程化资产，走正常开发门禁），' +
    '再由 quality-engineer 重跑 `node .cursor/scripts/lint-run.mjs` 至 gatePassed=true。' +
    '**不得**把它当成「整改 lint 违规」，也不得改走双要素豁免绕过（本项目并非无可用 linter）。',
});

/**
 * R16：静态代码质量门禁是否通过（供发起 test-engineer 前机械校验，与 checkLintClean 并列）。
 * docs-only 模式视为通过；否则须存在 static-scan-run.mjs 机读产物、**R34** 执行证明验签通过、
 * 且两项子检查均 gatePassed=true，或重复代码/安全扫描分别经双要素豁免后各自视为满足。
 */
export function checkStaticScanClean(content) {
  const md = content ?? readProcessMd() ?? '';
  if (getWorkflowMode(md) === 'docs-only') return { ok: true, reason: 'docs-only' };
  const dupExempt = isDupCheckExempt(md);
  const securityExempt = isSecurityScanExempt(md);
  if (dupExempt && securityExempt) return { ok: true, reason: 'checked' };
  return evaluateGateArtifact({
    kind: 'static-scan',
    artifact: readStaticScanResult(),
    missingReason: 'no-static-scan-result',
    unavailableReason: 'static-scan-tool-unavailable',
    isPassed: (a) =>
      (dupExempt || a.duplication?.gatePassed === true) &&
      (securityExempt || a.security?.gatePassed === true),
    failedReason: (a) =>
      dupExempt || a.duplication?.gatePassed === true
        ? 'security-scan-not-passed'
        : 'dup-check-not-passed',
  });
}

/**
 * 从「## 当前分派计划 / ## 待派发角色列表」提取本次 quality-engineer 审查的任务包编号。
 * 分派计划行：分派角色为 quality-engineer/质量工程师，任务包编号列（或整行）含 B1 编号；
 * 待派发行：角色列为 quality-engineer，说明列含任务包编号。
 */
export function extractQeDispatchTaskPacks(content) {
  const packs = new Set();
  const qeAliases = ROLE_ALIASES['质量工程师'] ?? ['quality-engineer', '质量工程师'];

  const planSection = extractSection(content, '当前分派计划');
  if (planSection) {
    const tables = parseMarkdownTables(planSection);
    for (const table of tables) {
      const roleIdx = table.headers.findIndex((h) => /分派角色|角色/.test(h));
      const packIdx = table.headers.findIndex((h) => /任务包/.test(h));
      for (const row of table.rows) {
        const roleCell = roleIdx >= 0 ? row[roleIdx] ?? '' : row.join(' ');
        if (!qeAliases.some((a) => String(roleCell).includes(a))) continue;
        const raw = packIdx >= 0 ? row[packIdx] ?? '' : row.join(' ');
        for (const id of extractAllTaskCodes(raw)) packs.add(id);
      }
    }
  }

  const pendingSection = extractSection(content, '待派发角色列表');
  if (pendingSection) {
    const tables = parseMarkdownTables(pendingSection);
    for (const table of tables) {
      const roleIdx = table.headers.findIndex((h) => /角色/.test(h));
      const noteIdx = table.headers.findIndex((h) => /说明|任务包|范围/.test(h));
      for (const row of table.rows) {
        const roleCell = roleIdx >= 0 ? row[roleIdx] ?? '' : row.join(' ');
        if (!qeAliases.some((a) => String(roleCell).includes(a))) continue;
        const raw = noteIdx >= 0 ? row[noteIdx] ?? '' : row.join(' ');
        for (const id of extractAllTaskCodes(raw)) packs.add(id);
      }
    }
  }

  return [...packs];
}

/**
 * 查询「## 进度列表」中指定任务包对应开发工程师行的最新有效状态（B1）。
 * @returns {'complete'|'inProgress'|'other'|null} null = 未找到该任务包的开发行
 */
export function getDevLineStatusForTaskPack(content, taskId) {
  const body = extractSection(content, '进度列表');
  if (!body || !taskId) return null;
  const roleAliases = ROLE_ALIASES['开发工程师'] ?? ['开发工程师', 'development-engineer'];
  let latest = null;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (!roleAliases.some((alias) => t.includes(alias))) continue;
    const code = extractTaskCode(t);
    if (code !== taskId) continue;
    if (/已作废|superseded/i.test(t)) {
      latest = null; // tombstone
      continue;
    }
    if (t.includes('执行完成')) latest = 'complete';
    else if (t.includes('正在执行')) latest = 'inProgress';
    else latest = 'other';
  }
  return latest;
}
