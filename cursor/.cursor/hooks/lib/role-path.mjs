/**
 * 门禁域：role-path — 角色↔成果物路径权限、进度统计（B1 最新有效状态 / tombstone）。
 *
 * 主要消费方：gate-dev-workflow / gate-dev-shell（checkRolePathPermission）、
 * gate-stop-workflow / dispatch（roleProgressStats / testEngineerStats）。域对照见 ./README.md。
 */
import {
  normalizePath,
  normalizeRoleSlug,
  readProcessMd,
  extractSection,
  ROLE_ALIASES,
  ROLE_SLUG_BY_ALIAS,
  } from './core.mjs';
import { readRecentlyDispatchedRoles } from './identity.mjs';
import { isProcessFilePath,
  isGatedDevPath,
  isE2eTestPath,
  isHarnessStatePath
} from './paths.mjs';

/**
 * 从 process.md 汇聚当前「活跃」角色 slug。
 * - 默认：最近派发 ∪ 进度「正在执行」∪ 当前分派计划 ∪ 待派发列表；
 * - `forSource: true`：仅保留 development-engineer（源码写入只认 DE 活跃）。
 * @param {string|null|undefined} content
 * @param {{ forSource?: boolean }} [opts]
 * @returns {string[]}
 */
export function collectActiveRoleSlugs(content, { forSource = false } = {}) {
  const roles = new Set();
  const md = content ?? readProcessMd() ?? '';

  if (!forSource) {
    for (const r of readRecentlyDispatchedRoles()) roles.add(r);
  }

  const progress = extractSection(md, '进度列表');
  if (progress) {
    for (const line of progress.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('|') || /^\|[\s|:-]+\|?$/.test(t)) continue;
      if (!t.includes('正在执行')) continue;
      for (const [alias, slug] of Object.entries(ROLE_SLUG_BY_ALIAS)) {
        if (t.includes(alias)) roles.add(slug);
      }
    }
  }

  const plan = extractSection(md, '当前分派计划');
  if (plan) {
    for (const line of plan.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('|') || /^\|[\s|:-]+\|?$/.test(t)) continue;
      if (/任务包编号|分派角色/.test(t)) continue;
      const cells = t.split('|').map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
      // | 任务包 | 角色 | 并行 | 状态 |
      if (cells.length >= 2) {
        const slug = normalizeRoleSlug(cells[1]);
        if (slug) roles.add(slug);
      }
    }
  }

  if (!forSource) {
    const pending = extractSection(md, '待派发角色列表');
    if (pending) {
      for (const line of pending.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('|') || /^\|[\s|:-]+\|?$/.test(t)) continue;
        if (/^\|\s*角色\s*\|/.test(t)) continue;
        const cells = t.split('|').map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
        if (cells.length >= 1) {
          const slug = normalizeRoleSlug(cells[0]);
          if (slug) roles.add(slug);
        }
      }
    }
  }

  if (forSource) {
    return [...roles].filter((r) => r === 'development-engineer');
  }
  return [...roles];
}

/**
 * docs 下受 R5 角色写入门禁保护的成果物路径（含 process.md / 需求 / 设计 / 质量 / 测试）。
 * 与 isGatedDevPath 互补：后者管源码；本函数管文档类角色成果物。
 */
export function isGatedRoleArtifactPath(filePath) {
  const p = normalizePath(filePath);
  if (!p) return false;
  if (isProcessFilePath(p)) return true;
  // **R29**：harness-state.json 决定所有门禁读哪一份 process.md（改写它即可把门禁指向
  // 一份伪造流程），归项目经理维护，纳入角色门禁而非放任豁免。
  if (isHarnessStatePath(p)) return true;
  if (/(^|\/)docs\/(.+\/)?requirement\/.+\.(md|mdx|txt)$/.test(p)) return true;
  if (/(^|\/)docs\/(.+\/)?design\/.+\.(md|mdx|txt)$/.test(p)) return true;
  if (/(^|\/)docs\/(.+\/)?quality\/.+\.(md|mdx|txt)$/.test(p)) return true;
  if (/(^|\/)docs\/(.+\/)?test\/.+\.(md|mdx|txt)$/.test(p)) return true;
  return false;
}

/** 路径期望的责任角色 slug 列表；非角色门禁路径返回 null */
export function expectedRolesForPath(filePath) {
  const p = normalizePath(filePath);
  if (!p) return null;
  if (isProcessFilePath(p)) return ['project-manager'];
  if (isHarnessStatePath(p)) return ['project-manager'];
  // docs 下角色成果物仅匹配文档扩展名；代码扩展名（如 docs/design/notes.py）走下方 isGatedDevPath → DE
  if (/(^|\/)docs\/(.+\/)?requirement\/.+\.(md|mdx|txt)$/.test(p)) return ['requirements-analyst'];
  if (/(^|\/)docs\/(.+\/)?design\/design-problem-list\.md$/.test(p)) {
    return ['requirement-reviewer', 'system-architect'];
  }
  if (/(^|\/)docs\/(.+\/)?design\/.+\.(md|mdx|txt)$/.test(p)) return ['system-architect'];
  if (/(^|\/)docs\/(.+\/)?quality\/.+\.(md|mdx|txt)$/.test(p)) return ['quality-engineer'];
  if (/(^|\/)docs\/(.+\/)?test\/.+\.(md|mdx|txt)$/.test(p)) return ['test-engineer'];
  // e2e 须在通用 isGatedDevPath 分支前：期望 TE，非 DE
  if (isE2eTestPath(p)) return ['test-engineer'];
  if (isGatedDevPath(p)) return ['development-engineer'];
  return null;
}

/**
 * 是否为「仅 DE 可写」的产品/基建源码路径（不含 e2e）。
 */
function isDeOnlySourcePath(filePath, expected) {
  return (
    Array.isArray(expected) &&
    expected.length === 1 &&
    expected[0] === 'development-engineer' &&
    isGatedDevPath(filePath) &&
    !isE2eTestPath(filePath)
  );
}

/**
 * R5：角色↔路径权限机读。
 * - 源码 / `.cursor/scripts|agents|hooks`：须 DE 在进度「正在执行」或当前分派计划中；
 *   且最近派发角色若为 TE/QE，直接 deny（不因进度表残留 DE 行而放行）（**R21**）；
 * - e2e/**：期望 test-engineer；非 TE（含 DE）默认 deny（**R23**）；
 * - 文档成果物：须活跃角色（含最近 Task 派发）命中期望角色；
 * - process.md 且尚无任何活跃角色：允许 PM 首次 bootstrap（空进度窗口）。
 */
export function checkRolePathPermission(filePath) {
  const expected = expectedRolesForPath(filePath);
  if (!expected) return { ok: true, reason: 'not-role-gated' };

  const content = readProcessMd() ?? '';
  const forSource = isDeOnlySourcePath(filePath, expected);

  // 最近派发明确为 TE/QE 时，禁止写产品源码（即便进度表仍残留 DE「正在执行」）
  if (forSource) {
    const recent = readRecentlyDispatchedRoles();
    const mostRecent = recent[0];
    const blockedNonDe = mostRecent === 'test-engineer' || mostRecent === 'quality-engineer';
    if (blockedNonDe) {
      return {
        ok: false,
        reason: 'non-de-dispatched-denied',
        message: `R5/R21：最近派发角色为 ${mostRecent}，禁止写入产品源码路径「${normalizePath(filePath)}」（仅 development-engineer 可写）。发现缺陷须阻塞并回派开发工程师，不得由测试/质量角色代修。`,
      };
    }
  }

  const active = collectActiveRoleSlugs(content, { forSource });

  // PM bootstrap 窗口：首次接收目标时进度/分派尚空，须允许 PM 建立 process.md 与活跃指针
  if ((isProcessFilePath(filePath) || isHarnessStatePath(filePath)) && active.length === 0) {
    return { ok: true, reason: 'pm-bootstrap-window' };
  }

  if (active.length === 0) {
    return {
      ok: false,
      reason: 'no-active-role',
      message:
        'R5：无法判定活跃角色（process.md 进度/分派为空且无最近 Task 派发记录）。须先由项目经理分派对应角色 Task 后，再由该子 agent 写入。',
    };
  }

  if (expected.some((r) => active.includes(r))) {
    return { ok: true, reason: 'role-matched' };
  }

  return {
    ok: false,
    reason: 'role-path-mismatch',
    message: `R5：路径「${normalizePath(filePath)}」期望角色 ${expected.join('/')}，当前活跃角色为 ${active.join('/') || '无'}。禁止越权写入。`,
  };
}

/** 从行文本中提取任务包编号（B1），如 A-DOC-1、B-LIB-1/2/3、T0-1、TE-FINAL */
export function extractTaskCode(rowText) {
  const m = rowText.match(/\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+(?:\/\d+)*)\b/);
  return m ? m[1] : null;
}

/**
 * 统计「## 进度列表」中某角色的开发线状态（B1：按任务包编号取最新有效状态）。
 * 角色既可能以中文职责名记录，也可能以 `.cursor/agents` 的 slug 记录。
 * 同一任务包编号出现多行时，取**最后一次出现**的状态；`已作废`/`superseded` 行
 * 作为 tombstone，使该任务包编号退出统计（不计入 total/complete/inProgress）。
 * 无法提取编号的行各自独立计数（不做跨行去重），避免误合并不同任务。
 */
export function roleProgressStats(content, roleKey) {
  const body = extractSection(content, '进度列表');
  const stats = { total: 0, complete: 0, inProgress: 0 };
  const roleAliases = ROLE_ALIASES[roleKey] ?? [roleKey];
  if (!body) return stats;

  const latestByCode = new Map();
  let anonymousIndex = 0;

  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue; // 分隔行
    if (!roleAliases.some((alias) => t.includes(alias))) continue; // 仅本角色的开发线行

    const code = extractTaskCode(t) ?? `__row_${anonymousIndex++}`;
    const isTombstone = /已作废|superseded/i.test(t);
    let status = 'other';
    if (t.includes('执行完成')) status = 'complete';
    else if (t.includes('正在执行')) status = 'inProgress';

    latestByCode.set(code, isTombstone ? { status: 'tombstoned' } : { status });
  }

  for (const entry of latestByCode.values()) {
    if (entry.status === 'tombstoned') continue;
    stats.total += 1;
    if (entry.status === 'complete') stats.complete += 1;
    else if (entry.status === 'inProgress') stats.inProgress += 1;
  }

  return stats;
}

/**
 * 测试工程师专属统计：区分「批次集成测试」与「最终整体集成测试」两类行
 * （含「最终整体集成测试」「最终集成测试」「TE-FINAL」「TE-最终」之一者计入 final，其余计入 batch），
 * 同样应用 B1 去重/tombstone 规则（分桶后各自去重）。
 */
export function testEngineerStats(content) {
  const body = extractSection(content, '进度列表');
  const batch = { total: 0, complete: 0, inProgress: 0 };
  const final = { total: 0, complete: 0, inProgress: 0 };
  if (!body) return { batch, final };

  const roleAliases = ROLE_ALIASES['测试工程师'];
  const latestByCode = new Map();
  let anonymousIndex = 0;

  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (!roleAliases.some((alias) => t.includes(alias))) continue;

    const isFinal = /最终整体集成测试|最终集成测试|TE-FINAL|TE-最终/i.test(t);
    const baseCode = extractTaskCode(t) ?? `__row_${anonymousIndex++}`;
    const code = `${baseCode}__${isFinal ? 'final' : 'batch'}`;
    const isTombstone = /已作废|superseded/i.test(t);
    let status = 'other';
    if (t.includes('执行完成')) status = 'complete';
    else if (t.includes('正在执行')) status = 'inProgress';

    latestByCode.set(code, isTombstone ? { status: 'tombstoned', isFinal } : { status, isFinal });
  }

  for (const entry of latestByCode.values()) {
    if (entry.status === 'tombstoned') continue;
    const bucket = entry.isFinal ? final : batch;
    bucket.total += 1;
    if (entry.status === 'complete') bucket.complete += 1;
    else if (entry.status === 'inProgress') bucket.inProgress += 1;
  }

  return { batch, final };
}


