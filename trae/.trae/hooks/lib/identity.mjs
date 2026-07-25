/**
 * 门禁域：identity — R5 顶层会话 id、最近派发角色记录
 *
 * P2-2/P2-3 修复：根会话 id 采用「env var 主源 + 持久化文件兜底」双源策略。
 * - 主源：`process.env.ROOT_SESSION_ID`，由 SessionStart Hook 写入 `$TRAE_ENV_FILE`
 *   （Trae 官方会话级隔离机制，仅在 SessionStart 事件注入；后续 Hook 与 RunCommand
 *   可读）。跨会话天然隔离，避免持久化文件陈旧导致 R5 fail-open。
 * - 兜底：`.root-conversation-id.json`（first-write-wins，供无 env 的子代理会话等场景）。
 * Trae `source: "startup"` 表明 SessionStart 仅新建会话时触发，子代理 Task 不触发
 * SessionStart（无 SubagentStart 事件），故 env var 仅存在于根会话后续 Hook 中。
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
 * 跨会话不陈旧）；缺失时回退持久化文件（first-write-wins，供子代理会话等无 env 场景兜底）。
 */
export function readRootConversationId() {
  const envRootId = readRootSessionIdFromEnv();
  if (envRootId) return envRootId;
  if (!fs.existsSync(ROOT_CONVERSATION_STATE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(ROOT_CONVERSATION_STATE, 'utf8'));
    return typeof data?.rootConversationId === 'string' ? data.rootConversationId : null;
  } catch {
    return null;
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
 * R5 角色↔路径匹配补强：在 Task 放行时记录目标角色 slug。
 * Trae SessionStart/PreToolUse 无法可靠把「子代理 session_id」映射回角色
 * （子代理 hooks 无 parent 回链），故改用「最近派发角色 + process.md 进度/分派」
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


