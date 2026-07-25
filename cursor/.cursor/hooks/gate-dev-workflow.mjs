#!/usr/bin/env node
/**
 * preToolUse 门禁：无项目经理分派计划时，禁止写入开发产物；
 * R5：拦截顶层代理代写 + 角色↔路径越权写入（含 docs 成果物）。
 * 自锁防护（`.cursor/harness/spec/mechanical-gates.md` §8.4）：workflow-gate-lib.mjs 动态加载失败或执行期出现未预期
 * 异常时 fail-open 放行并打印 stderr 告警，避免门禁自身故障导致全流程硬死锁。
 */
function failOpenAllow(context, err, lib) {
  process.stderr.write(`[gate-dev-workflow] fail-open (${context}): ${err?.message ?? err}\n`);
  try {
    lib?.recordFailOpenEvent?.('gate-dev-workflow', context, err);
  } catch {
    /* 落盘失败不影响 fail-open 放行 */
  }
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
}

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
    deny,
    isCancelledProcessFile,
    isGatedDevPath,
    isGatedRoleArtifactPath,
    isRootConversationCaller,
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

    const gatedPaths = filePaths.filter(
      (filePath) => isGatedDevPath(filePath) || isGatedRoleArtifactPath(filePath),
    );
    if (gatedPaths.length === 0) {
      allow();
    }

    // R5：顶层代理亲自写受门禁路径（源码或角色文档成果物）一律拒绝
    if (isRootConversationCaller(input?.conversation_id)) {
      deny(
        '流程门禁（R5，机械化补强）：检测到本次写入由顶层代理直接发起（conversation_id 与顶层会话一致），而非通过 Task 派发的子代理。受门禁路径必须由对应子 agent 在 Task 内执行。',
        'AGENTS.md §5.1（R5）：顶层代理不得代行子角色职责，禁止直接编写受门禁路径。请先经项目经理分派，再以 Task 发起对应子 agent 完成该写入。',
      );
    }

    // R5：角色↔路径匹配（含 docs 成果物；源码须 DE 活跃）
    for (const filePath of gatedPaths) {
      const roleCheck = checkRolePathPermission(filePath);
      if (!roleCheck.ok) {
        deny(
          `流程门禁（R5，角色路径）：${roleCheck.message ?? roleCheck.reason}`,
          `AGENTS.md §5.1（R5）：${roleCheck.message ?? roleCheck.reason}。请确认 process.md 分派/进度中的活跃角色与写入路径匹配，并由对应子 agent 执行。`,
        );
      }
    }

    // 源码 / 构建产物等仍走分派计划 + R3/R9 门禁；纯文档成果物不要求 DE 分派计划
    if (filePaths.some((filePath) => isGatedDevPath(filePath))) {
      assertDevGateOrDeny();
    }

    allow();
  } catch (err) {
    failOpenAllow('runtime', err, lib);
  }
}

main();
