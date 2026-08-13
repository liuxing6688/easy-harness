/**
 * 门禁域：identity — R5 顶层会话 id 基准（TTL 自愈）、最近派发角色落盘、身份健康度告警。
 *
 * 主要消费方：gate-subagent-track（写入基准）、gate-dev-workflow / gate-dev-shell（顶层代写拦截）、
 * gate-role-sequence（recordDispatchedRole）。域对照见 ./README.md。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT_CONVERSATION_STATE,
  DISPATCHED_ROLES_STATE,
  normalizeRoleSlug,
  readJsonFileSafe,
  readTextFileSafe,
  getIdentityBaselineTtlMs,
  getActiveProcessPath,
  parseProcessFrontmatter,
} from './core.mjs';

/**
 * 读取顶层会话 id 基准的原始记录（含 recordedAt），供 TTL 判定使用。
 */
export function readRootConversationRecord() {
  const data = readJsonFileSafe(ROOT_CONVERSATION_STATE);
  if (!data || typeof data.rootConversationId !== 'string' || !data.rootConversationId) return null;
  return {
    rootConversationId: data.rootConversationId,
    recordedAt: typeof data.recordedAt === 'string' ? data.recordedAt : null,
  };
}

/**
 * **R5 加强**：基准是否已过期。
 * 历史实现是「文件存在就永不覆盖」，其本意是防止嵌套子代理把自己的 id 误写成基准；
 * 但作用域被放大成了「整个仓库永久只记一次」。实测后果：一旦基准被遗留夹具值或
 * 跨会话陈旧值占据，`isRootConversationCaller` 恒为 false，顶层代写拦截**静默永久失效**
 * （本仓库工作树即处于该状态）。改为：TTL 之内不覆盖（保留防嵌套语义），
 * 超过 TTL 视为上一次会话的残留，允许被新会话的首个 subagentStart 覆盖，实现自愈。
 */
export function isRootConversationBaselineStale(record, now = Date.now()) {
  if (!record) return true;
  // 无（或无法解析）时间戳：无法证明其属于本次会话，视为可被新会话覆盖
  if (!record.recordedAt) return true;
  const recordedAt = Date.parse(record.recordedAt);
  if (!Number.isFinite(recordedAt)) return true;
  return now - recordedAt > getIdentityBaselineTtlMs();
}

/**
 * 基准是否**已确定过期**（有合法时间戳且超出 TTL）。
 *
 * 与 `isRootConversationBaselineStale` 刻意区分：
 * - 「可被覆盖（stale）」用于**自愈**决策，无时间戳也算，宁可重写；
 * - 「已过期（expired）」用于**身份判定**决策，只有能证明过期时才弃用该基准。
 * 无时间戳的历史/外部写入的基准仍参与判定——它可能恰好是正确的顶层 id，
 * 弃用它只会平白削弱拦截；而它若是错的，下一次 subagentStart 就会把它覆盖掉。
 */
export function isRootConversationBaselineExpired(record, now = Date.now()) {
  if (!record || !record.recordedAt) return false;
  const recordedAt = Date.parse(record.recordedAt);
  if (!Number.isFinite(recordedAt)) return false;
  return now - recordedAt > getIdentityBaselineTtlMs();
}

export function recordRootConversationId(conversationId) {
  if (!conversationId || typeof conversationId !== 'string') return;
  const existing = readRootConversationRecord();
  // TTL 内已有基准：保持不覆盖（防嵌套子代理误写）；过期或损坏：允许自愈覆盖。
  if (existing && !isRootConversationBaselineStale(existing)) return;
  try {
    fs.mkdirSync(path.dirname(ROOT_CONVERSATION_STATE), { recursive: true });
    fs.writeFileSync(
      ROOT_CONVERSATION_STATE,
      JSON.stringify({ rootConversationId: conversationId, recordedAt: new Date().toISOString() }),
      'utf8',
    );
  } catch {
    /* 记录失败不影响 subagentStart 放行（fail-open，见 §8.4） */
  }
}

export function readRootConversationId() {
  const record = readRootConversationRecord();
  if (!record) return null;
  // 仅在「可证明已过期」时弃用；无时间戳的基准继续参与判定（见 isRootConversationBaselineExpired）
  if (isRootConversationBaselineExpired(record)) return null;
  return record.rootConversationId;
}

/**
 * **R5 加强**：身份基准健康度。
 * `isRootConversationCaller` 在无法判定时 fail-open（返回 false = 不拦截），这是刻意的
 * 防死锁设计，但历史实现**完全静默**——基准失效与「确实是子代理」在日志上无法区分。
 * 本函数供 Hook 在裁决受门禁写入时输出显式告警，使失效可被发现。
 */
export function inspectIdentityBaseline(conversationId) {
  const record = readRootConversationRecord();
  // shouldNotify 仅用于「门禁确实失效」的两种情形，避免 payload 形状差异刷满提醒
  if (!record) return { healthy: false, reason: 'baseline-missing', shouldNotify: true };
  if (isRootConversationBaselineExpired(record)) {
    return { healthy: false, reason: 'baseline-expired', shouldNotify: true };
  }
  if (!conversationId || typeof conversationId !== 'string') {
    return { healthy: false, reason: 'no-conversation-id', shouldNotify: false };
  }
  return { healthy: true, reason: 'ok', shouldNotify: false };
}

const IDENTITY_BASELINE_NOTICE_MARKER = '<!-- r5-identity-baseline-degraded -->';

const IDENTITY_BASELINE_REASON_TEXT = {
  'baseline-missing': '尚未记录顶层会话 id（本会话还没有任何 Task 触发 subagentStart）',
  'baseline-expired': '已记录的顶层会话 id 已超出有效期，视为上一次会话的残留',
  'no-conversation-id': '本次调用的 payload 未携带 conversation_id',
};

/**
 * **R5 加强**：把「身份判据处于 fail-open 降级态」一次性、非阻塞地写进活跃 process.md。
 * 历史实现里该降级完全静默，导致顶层代写拦截失效时无人察觉（实测可复现）。
 * 与 R9 软性提醒同构：幂等、不设 blocking、cancelled 流程不写、任何异常都吞掉，
 * 绝不影响本次 allow/deny 判定。
 */
export function recordIdentityBaselineNotice(reason) {
  try {
    const processPath = getActiveProcessPath();
    let content = readTextFileSafe(processPath);
    if (content === null) return { ok: false, reason: 'no-process' };
    if (parseProcessFrontmatter(content).cancelled === true) return { ok: false, reason: 'cancelled' };
    if (content.includes(IDENTITY_BASELINE_NOTICE_MARKER)) return { ok: true, reason: 'already-recorded' };

    const why = IDENTITY_BASELINE_REASON_TEXT[reason] ?? reason;
    const note = [
      '',
      '## 门禁软性提醒（非阻塞）',
      '',
      IDENTITY_BASELINE_NOTICE_MARKER,
      `- [R5 身份判据降级] 本次受门禁写入在裁决时，顶层代写拦截处于 fail-open 降级态：${why}。此期间「顶层代理亲自写受门禁路径」**无法被机械拦截**，仅由 CLAUDE.md §5.1 文字约束与回合自检兜底。若这不是预期状态，请检查 subagentStart Hook 是否生效、\`.claude/hooks/.root-conversation-id.json\` 是否被误写或被外部工具占用。`,
      '',
    ].join('\n');

    fs.writeFileSync(processPath, `${content.trimEnd()}\n${note}`, 'utf8');
    return { ok: true, reason: 'recorded' };
  } catch (err) {
    process.stderr.write(`[recordIdentityBaselineNotice] failed: ${err?.message ?? err}\n`);
    return { ok: false, reason: 'write-failed' };
  }
}

/** 某次调用的 conversation_id 是否等于已记录的顶层会话 id（无法判定时返回 false，fail-open） */
export function isRootConversationCaller(conversationId) {
  if (!conversationId || typeof conversationId !== 'string') return false;
  const rootId = readRootConversationId();
  if (!rootId) return false;
  return conversationId === rootId;
}

/**
 * R5 角色↔路径匹配补强：在 Task 放行时记录目标角色 slug。
 * Cursor 当前 subagentStart/preToolUse 无法可靠把「子代理 conversation_id」映射回角色
 * （见官方论坛：子代理 hooks 无 parent 回链），故改用「最近派发角色 + process.md 进度/分派」
 * 做路径权限机读，而不依赖子代理会话 id。
 */
export function recordDispatchedRole(role) {
  const slug = normalizeRoleSlug(role);
  if (!slug) return;
  let roles = [];
  const existing = readJsonFileSafe(DISPATCHED_ROLES_STATE);
  if (Array.isArray(existing?.roles)) {
    roles = existing.roles.filter((r) => typeof r === 'string');
  }
  roles = [slug, ...roles.filter((r) => r !== slug)].slice(0, 8);
  try {
    fs.mkdirSync(path.dirname(DISPATCHED_ROLES_STATE), { recursive: true });
    fs.writeFileSync(
      DISPATCHED_ROLES_STATE,
      JSON.stringify({ roles, updatedAt: new Date().toISOString() }),
      'utf8',
    );
  } catch {
    /* fail-open：记录失败不阻断 Task */
  }
}

export function readRecentlyDispatchedRoles() {
  const data = readJsonFileSafe(DISPATCHED_ROLES_STATE);
  if (!Array.isArray(data?.roles)) return [];
  return data.roles.map(normalizeRoleSlug).filter(Boolean);
}
