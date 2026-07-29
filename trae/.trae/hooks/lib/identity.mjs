/**
 * 门禁域：identity — R5 顶层会话 id 基准（双源 + TTL 自愈）、最近派发角色落盘、身份健康度告警。
 *
 * 主要消费方：gate-subagent-track（写入基准）、gate-dev-workflow / gate-dev-shell（顶层代写拦截）、
 * gate-role-sequence（recordDispatchedRole）。域对照见 ./README.md。
 *
 * **Trae 双源策略**（P2-2/P2-3 修复）：
 * - 主源：`process.env.ROOT_SESSION_ID`，由 SessionStart Hook 写入 `$TRAE_ENV_FILE`
 *   （Trae 官方会话级隔离机制，仅在 SessionStart 事件注入；后续 Hook 与 RunCommand
 *   可读）。跨会话天然隔离，避免持久化文件陈旧导致 R5 fail-open。
 * - 兜底：`.root-conversation-id.json`（TTL 自愈，供无 env 的子代理会话等场景）。
 * Trae `source: "startup"` 表明 SessionStart 仅新建会话时触发，子代理 Task 不触发
 * SessionStart（无 SubagentStart 事件），故 env var 仅存在于根会话后续 Hook 中。
 *
 * **TTL 自愈**（R5 加强）：历史实现「文件存在就永不覆盖」，其本意是防止嵌套子代理把自己
 * 的 id 误写成基准；但作用域被放大成了「整个仓库永久只记一次」。Trae 引入 env var 主源后
 * 已大幅缓解该问题，但兜底文件仍可能因遗留夹具值或跨会话陈旧值占据而使 R5 fail-open。
 * 故兜底文件同样采用 TTL 自愈：TTL 之内不覆盖（保留防嵌套语义），超过 TTL 视为上一次会话
 * 的残留，允许被新会话的首个 SessionStart 覆盖。
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
 * 但作用域被放大成了「整个仓库永久只记一次」。改为：TTL 之内不覆盖（保留防嵌套语义），
 * 超过 TTL 视为上一次会话的残留，允许被新会话的首个 SessionStart 覆盖，实现自愈。
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
 * 弃用它只会平白削弱拦截；而它若是错的，下一次 SessionStart 就会把它覆盖掉。
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
    /* 记录失败不影响 SessionStart 放行（fail-open，见 §8.4） */
  }
}

/**
 * P2-2/P2-3 修复：将根会话 id 写入 `$TRAE_ENV_FILE`（SessionStart 专属，会话级隔离）。
 * 后续 PreToolUse/Stop Hook 与 RunCommand（gate-check.mjs）可通过 `process.env.ROOT_SESSION_ID`
 * 读取，避免持久化文件跨会话陈旧导致 R5 fail-open。仅在 SessionStart 上下文调用
 * （`TRAE_ENV_FILE` 仅在该事件注入）。写入失败 best-effort 吞掉，不影响 fail-open 放行。
 */
export function writeRootSessionIdToEnvFile(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return false;
  const envFilePath = process.env.TRAE_ENV_FILE || process.env.CLAUDE_ENV_FILE;
  if (!envFilePath) return false; // 非 SessionStart 上下文（如测试直调），跳过
  try {
    // dotenv 格式：跨平台、Trae/Claude Code 兼容；append 模式避免覆盖其他变量
    fs.appendFileSync(envFilePath, `ROOT_SESSION_ID=${sessionId}\n`, 'utf8');
    return true;
  } catch {
    return false; /* 写入失败不影响 fail-open 放行（见 §8.4） */
  }
}

/** 从 process.env.ROOT_SESSION_ID 读取根会话 id（SessionStart 写入 $TRAE_ENV_FILE 后生效） */
export function readRootSessionIdFromEnv() {
  const v = (process.env.ROOT_SESSION_ID || '').trim();
  return v || null;
}

/**
 * 读取根会话 id。优先 `process.env.ROOT_SESSION_ID`（$TRAE_ENV_FILE 注入，会话级隔离，
 * 跨会话不陈旧）；缺失时回退持久化文件（仅在「可证明已过期」时弃用，无时间戳的历史/外部
 * 写入基准仍参与判定，见 `isRootConversationBaselineExpired`）。
 */
export function readRootConversationId() {
  const envRootId = readRootSessionIdFromEnv();
  if (envRootId) return envRootId;
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
 *
 * Trae 双源策略下的健康度判定：
 * - env var 主源存在 → healthy（session-fresh，不会陈旧）；
 * - env var 缺失时检查兜底文件基准（与 Cursor 单源版同构）。
 */
export function inspectIdentityBaseline(conversationId) {
  // env var 主源存在：会话级隔离，直接判定为健康
  if (readRootSessionIdFromEnv()) {
    if (!conversationId || typeof conversationId !== 'string') {
      return { healthy: false, reason: 'no-conversation-id', shouldNotify: false };
    }
    return { healthy: true, reason: 'ok', shouldNotify: false };
  }
  // env var 缺失：回退兜底文件健康度判定
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
  'baseline-missing': '尚未记录顶层会话 id（本会话还没有任何 SessionStart 触发，且持久化兜底文件缺失）',
  'baseline-expired': '已记录的顶层会话 id 已超出有效期，视为上一次会话的残留',
  'no-conversation-id': '本次调用的 payload 未携带 session_id',
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
      `- [R5 身份判据降级] 本次受门禁写入在裁决时，顶层代写拦截处于 fail-open 降级态：${why}。此期间「顶层代理亲自写受门禁路径」**无法被机械拦截**，仅由 AGENTS.md §5.1 文字约束与回合自检兜底。若这不是预期状态，请检查 SessionStart Hook 是否生效、\`.trae/hooks/.root-conversation-id.json\` 是否被误写或被外部工具占用、\`$TRAE_ENV_FILE\` 是否注入了 ROOT_SESSION_ID。`,
      '',
    ].join('\n');

    fs.writeFileSync(processPath, `${content.trimEnd()}\n${note}`, 'utf8');
    return { ok: true, reason: 'recorded' };
  } catch (err) {
    process.stderr.write(`[recordIdentityBaselineNotice] failed: ${err?.message ?? err}\n`);
    return { ok: false, reason: 'write-failed' };
  }
}

/** 某次调用的 session_id 是否等于已记录的顶层会话 id（无法判定时返回 false，fail-open） */
export function isRootConversationCaller(conversationId) {
  if (!conversationId || typeof conversationId !== 'string') return false;
  const rootId = readRootConversationId();
  if (!rootId) return false;
  return conversationId === rootId;
}

/**
 * R5 身份判定（基于 agent_id，2026-07-29 修复）。
 *
 * 实测发现 Trae 子代理与顶层共享 session_id（PreToolUse stdin 中 session_id 相同），
 * 故 `isRootConversationCaller(session_id)` 无法区分顶层 vs 子代理--子代理写入会被
 * 误判为顶层代写而 deny。改用 `agent_id`：
 * - `"solo_agent"` = 顶层代理（deny 受门禁写入）
 * - 其他值（角色名 / `search` / `general_purpose_task` 等）= 子代理（放行，由 R21 等后续门禁裁决）
 * - 缺失/空 = 无法判定，fail-open 放行（与 isRootConversationCaller 一致的防死锁取舍）
 *
 * `agent_id` 由 Trae PreToolUse stdin 提供（实测字段名 `agent_id`，非 `agent_type`--
 * 项目级角色的 agent_type 为通用 `custom_solo`，无法区分具体角色）。
 *
 * `isRootConversationCaller` 保留供向后兼容与单元测试；生产门禁已改用本函数。
 */
export function isTopLevelAgent(agentId) {
  return agentId === 'solo_agent';
}

/**
 * R5 角色↔路径匹配补强：在 Task 放行时记录目标角色 slug。
 * Trae SessionStart/PreToolUse 无法可靠把「子代理 session_id」映射回角色
 * （子代理 hooks 无 parent 回链），故改用「最近派发角色 + process.md 进度/分派」
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
