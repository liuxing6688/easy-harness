/**
 * 门禁域：identity — R5 顶层会话 id、最近派发角色记录
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT_CONVERSATION_STATE,
  DISPATCHED_ROLES_STATE,
  normalizeRoleSlug,
} from './core.mjs';

export function recordRootConversationId(conversationId) {
  if (!conversationId || typeof conversationId !== 'string') return;
  if (fs.existsSync(ROOT_CONVERSATION_STATE)) return;
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
  if (!fs.existsSync(ROOT_CONVERSATION_STATE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(ROOT_CONVERSATION_STATE, 'utf8'));
    return typeof data?.rootConversationId === 'string' ? data.rootConversationId : null;
  } catch {
    return null;
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
  try {
    if (fs.existsSync(DISPATCHED_ROLES_STATE)) {
      const data = JSON.parse(fs.readFileSync(DISPATCHED_ROLES_STATE, 'utf8'));
      if (Array.isArray(data?.roles)) roles = data.roles.filter((r) => typeof r === 'string');
    }
  } catch {
    roles = [];
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
  if (!fs.existsSync(DISPATCHED_ROLES_STATE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(DISPATCHED_ROLES_STATE, 'utf8'));
    if (!Array.isArray(data?.roles)) return [];
    return data.roles.map(normalizeRoleSlug).filter(Boolean);
  } catch {
    return [];
  }
}
