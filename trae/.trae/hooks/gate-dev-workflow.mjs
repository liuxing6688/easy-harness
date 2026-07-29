#!/usr/bin/env node
/**
 * PreToolUse 门禁（Write / Edit）。
 *
 * 职责：在写文件工具真正落盘前，对受门禁路径做确定性拦截。
 * 拦截范围（与 `hooks.json` matcher 对齐）：
 *   - 源码 / 构建 / 根敏感路径（`isGatedDevPath`）
 *   - docs 角色成果物（`isGatedRoleArtifactPath`）
 *   - R6：`.trae/scripts|agents|hooks/**` 与代码扩展名默认门禁
 *   - R29：门禁自治资产（运行时标记 / 授权凭证 / 门禁配置与权威文本）
 *
 * 判定顺序（命中即 deny；说明权威见 mechanical-gates.md §8.1）：
 *   R10 cancelled -> R29 自治资产 -> R5 agent_id 降级告警 -> R5 顶层 agent_id
 *   → R5 角色↔路径 →（仅源码路径，排除 e2e）分派计划 + R3/R9/阻塞 → allow
 *
 * 共享判据：`./workflow-gate-lib.mjs`（实现按域拆在 `./lib/`）。
 * 自锁防护（§8.4）：lib 加载失败或未预期运行时异常时 fail-open 放行并 stderr 告警，
 * 避免门禁自身故障导致全流程硬死锁；同时 best-effort 落盘 fail-open 事件。
 */
/**
 * 门禁自锁逃生：写 stderr、可选落盘、stdout 输出 allow 后退出。
 * Trae PreToolUse stdout 契约：
 * `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }`
 * @param {string} context 失败场景标识（如 `lib-load` / `runtime`）
 * @param {unknown} err
 * @param {object} [lib] 已成功加载的 workflow-gate-lib（加载失败时为空）
 */
function failOpenAllow(context, err, lib) {
  process.stderr.write(`[gate-dev-workflow] fail-open (${context}): ${err?.message ?? err}\n`);
  try {
    lib?.recordFailOpenEvent?.('gate-dev-workflow', context, err);
  } catch {
    /* 落盘失败不影响 fail-open 放行 */
  }
  // Trae PreToolUse stdout 契约
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }));
  process.exit(0);
}

/**
 * 从 ApplyPatch 文本中提取 `*** Add|Update|Delete File:` 目标路径。
 * @param {unknown} text
 * @returns {string[]}
 */
function extractPatchPaths(text) {
  if (typeof text !== 'string') return [];
  const paths = [];
  const re = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
  let match;
  while ((match = re.exec(text)) !== null) {
    paths.push(match[1].trim());
  }
  return paths;
}

/**
 * 从 tool_input / arguments 中收集本次写入涉及的全部路径。
 * 同时覆盖直接字段（path / file_path 等）与嵌套 patch/diff 文本。
 * @param {unknown} value
 * @returns {string[]}
 */
function extractToolPaths(value) {
  const paths = [];
  if (!value) return paths;

  if (typeof value === 'string') {
    return extractPatchPaths(value);
  }

  const directFields = ['path', 'file_path', 'target_file', 'target_notebook', 'notebook_path'];
  for (const field of directFields) {
    if (typeof value[field] === 'string') paths.push(value[field]);
  }

  for (const field of ['patch', 'diff', 'content', 'input']) {
    paths.push(...extractPatchPaths(value[field]));
  }

  return paths;
}

async function main() {
  let lib;
  try {
    lib = await import('./workflow-gate-lib.mjs');
  } catch (err) {
    failOpenAllow('lib-load', err);
    return;
  }

  const {
    allow,
    assertDevGateOrDeny,
    checkRolePathPermission,
    classifyHarnessSelfGovernedPath,
    deny,
    harnessSelfGovernedVerdict,
    isCancelledProcessFile,
    isGatedDevPath,
    isE2eTestPath,
    isGatedRoleArtifactPath,
    isTopLevelAgent,
    normalizePath,
    readStdinJsonAsync,
  } = lib;

  try {
    const input = await readStdinJsonAsync();
    const toolInput = input.tool_input ?? input.arguments ?? {};
    const filePaths = extractToolPaths(toolInput);

    // R10：已取消（不可逆）的 process.md 一律冻结，优先于其余判定（含 docs 允许扩展名放行）。
    for (const filePath of filePaths) {
      if (isCancelledProcessFile(filePath)) {
        deny(
          '流程门禁（R10）：该 process.md 已被用户取消终止（不可逆），禁止任何后续写入/修改/删除。',
          'AGENTS.md R10：cancelled: true 的 process.md 永久冻结，任何角色（含 project-manager）均不得再修改。如需继续工作，请发起新的流程/迭代（新的 process.md）。',
        );
      }
    }

    // R29：门禁自治资产优先于其余判定——运行时标记、授权凭证与门禁配置/权威文本
    // 一律禁止由代理写入。这些路径刻意不在 isGatedDevPath 之内（否则会被当成 DE 源码
    // 要求分派计划），故须在 gatedPaths 过滤之前单独裁决。
    // 注意：此处不用 `ask`——Trae 文档明确 `preToolUse` 的 ask 行为依赖宿主实现，
    // 依赖它会使保护静默退化（见 paths.mjs 中 R29 注释与 mechanical-gates.md §8.5）。
    for (const filePath of filePaths) {
      const kind = classifyHarnessSelfGovernedPath(filePath);
      if (!kind) continue;
      const verdict = harnessSelfGovernedVerdict(kind, normalizePath(filePath));
      deny(verdict.userMessage, verdict.agentMessage);
    }

    // 仅对受门禁路径继续；其余路径直接放行（避免无关写入触发 R5/分派计划）。
    const gatedPaths = filePaths.filter(
      (filePath) => isGatedDevPath(filePath) || isGatedRoleArtifactPath(filePath),
    );
    if (gatedPaths.length === 0) {
      allow();
    }

    // R5 身份判据（基于 agent_id，2026-07-29 修复）：
    // 实测 Trae 子代理与顶层共享 session_id，故 session_id 无法区分顶层 vs 子代理。
    // 改用 agent_id：solo_agent = 顶层（deny），其他 = 子代理（放行）。
    // agent_id 缺失时为真正降级态（fail-open + stderr 告警）。
    if (!input?.agent_id || typeof input.agent_id !== 'string') {
      process.stderr.write(
        '[gate-dev-workflow] R5 identity degraded (no agent_id in payload): 顶层代写拦截本次不生效，仅靠文字约束兜底\n',
      );
    }

    // R5：顶层代理亲自写受门禁路径（源码或角色文档成果物）一律拒绝。
    if (isTopLevelAgent(input?.agent_id)) {
      deny(
        '流程门禁（R5，机械化补强）：检测到本次写入由顶层代理直接发起（agent_id = solo_agent），而非通过 Task 派发的子代理。受门禁路径必须由对应子 agent 在 Task 内执行。',
        'AGENTS.md §5.1（R5）：顶层代理不得代行子角色职责，禁止直接编写受门禁路径。请先经项目经理分派，再以 Task 发起对应子 agent 完成该写入。',
      );
    }

    // R5：角色↔路径匹配（含 docs 成果物；源码须 DE 活跃）。
    for (const filePath of gatedPaths) {
      const roleCheck = checkRolePathPermission(filePath);
      if (!roleCheck.ok) {
        deny(
          `流程门禁（R5，角色路径）：${roleCheck.message ?? roleCheck.reason}`,
          `AGENTS.md §5.1（R5）：${roleCheck.message ?? roleCheck.reason}。请确认 process.md 分派/进度中的活跃角色与写入路径匹配，并由对应子 agent 执行。`,
        );
      }
    }

    // 源码 / 构建产物等仍走分派计划 + R3/R9 门禁；e2e（期望 TE）与纯文档成果物不要求 DE 分派计划。
    if (filePaths.some((filePath) => isGatedDevPath(filePath) && !isE2eTestPath(filePath))) {
      assertDevGateOrDeny();
    }

    allow();
  } catch (err) {
    failOpenAllow('runtime', err, lib);
  }
}

main();
