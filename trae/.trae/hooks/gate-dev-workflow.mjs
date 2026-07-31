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
 * 自锁防护（§8.4 / **R36**）：**lib 加载失败** fail-open 放行（门禁整体损坏时不锁死项目）；
 * **判定期异常**默认 fail-closed → `deny`，仅当本次调用**整体**就是对活跃 `process.md`
 * 的直接写入时才走修复通道例外（`resolveGateRepairPaths`）。
 * 两种情况都写 stderr 并 best-effort 落盘门禁异常事件。
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
 * **R36**：判定期异常 fail-closed。
 *
 * §8.4 长期披露：入口脚本自行 `try/catch` 并以退出码 0 输出合法 allow JSON，属
 * 「Hook 成功」，故 `hooks.json` 的 `failClosed: true` 永不触发——**任何能让判定逻辑
 * 抛异常的 `process.md` 都能打开门禁**，而 `process.md` 恰由被约束方书写。本函数实施
 * §8.4 自己给出的修法：区分「lib 加载失败」（继续 fail-open，防门禁损坏即全局死锁）
 * 与「判定期异常」（deny）。
 *
 * **防死锁例外**：`repairPaths` 非空时放行。判定期异常最常见的成因就是 `process.md`
 * 结构损坏，而修复它必须能写它；若一并拒绝，用户会拿到一个代理无法自愈、只能手工
 * 编辑的死局——正是本框架反复警惕的「把项目锁死」失效模式。
 * 该口子有多窄由 `resolveGateRepairPaths`（paths.mjs）定义：只认活跃 `process.md`、
 * 只认直接路径字段、且本次调用不得夹带任何其他路径。
 */
function failClosedDeny(context, err, lib, repairPaths = []) {
  process.stderr.write(`[gate-dev-workflow] fail-closed (${context}): ${err?.message ?? err}\n`);
  try {
    lib?.recordFailOpenEvent?.('gate-dev-workflow', context, err);
  } catch {
    /* 落盘失败不影响本次判定 */
  }
  const { verdict, output } = lib.buildGateExceptionVerdict({
    hook: 'gate-dev-workflow',
    context,
    err,
    channel: 'write',
    repairPaths,
  });
  if (verdict === 'allow') {
    process.stderr.write(
      `[gate-dev-workflow] fail-closed 例外放行（流程文件修复通道）：${repairPaths.join(', ')}\n`,
    );
  }
  process.stdout.write(JSON.stringify(output));
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
 * 直接路径字段（工具参数明写的写入目标）。
 *
 * 与内容里解析出来的路径分开返回：前者是平台交给 Hook 的事实，后者是代理可以随手
 * 编造的文本。收紧判据（是否受门禁）两者都要看，**放松判据**（R36 修复例外）只认前者。
 * @param {unknown} value
 * @returns {string[]}
 */
function extractDirectToolPaths(value) {
  if (!value || typeof value === 'string') return [];
  const directFields = ['path', 'file_path', 'target_file', 'target_notebook', 'notebook_path'];
  const paths = [];
  for (const field of directFields) {
    if (typeof value[field] === 'string') paths.push(value[field]);
  }
  return paths;
}

/**
 * 从嵌套的 patch/diff/content 文本中解析出的写入目标。
 * @param {unknown} value
 * @returns {string[]}
 */
function extractContentToolPaths(value) {
  if (!value) return [];
  if (typeof value === 'string') return extractPatchPaths(value);
  const paths = [];
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
    readClosureLock,
    closureLockBlocksDev,
  } = lib;

  // R36：判定期异常的兜底例外——记录本次涉及的流程文件路径，供 failClosedDeny 判断
  // 是否放行「修复通道」。须在 try 之外声明，异常时才拿得到。
  let repairPaths = [];

  try {
    const input = await readStdinJsonAsync();
    const toolInput = input.tool_input ?? input.arguments ?? {};
    const directPaths = extractDirectToolPaths(toolInput);
    const filePaths = [...directPaths, ...extractContentToolPaths(toolInput)];
    try {
      repairPaths = lib.resolveGateRepairPaths({
        toolName: input.tool_name ?? input.toolName,
        directPaths,
        allPaths: filePaths,
      });
    } catch {
      /* 路径判定本身失败时不给例外，走正常 fail-closed */
    }

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
      // R40 闭环锁：marker 存在时收紧 DE 源码写入——未闭环不得开始新开发。与 R21 区别：
      // R21 读 .dispatched-roles.json（最近派发，可被 PM→DE 链绕过）；闭环锁读持久化
      // marker + 回派依据（## 回退计数 > 0），跨回合有效。dev-incomplete 不拦（DE 任务未完成）。
      const lock = readClosureLock();
      if (lock) {
        const devBlock = closureLockBlocksDev(null, lock);
        if (devBlock.blocked) {
          deny(
            devBlock.reason,
            'AGENTS.md R40（闭环锁）：Trae 对 stop 门禁 loop_limit 的强制力未保证，故未闭环状态由 marker 持久化、在 PreToolUse 前置阻断。须先补完流程（跑运行器/写 test-results/推进 process.md）或由 PM 回派 DE（## 回退计数表留痕作回派依据）。',
          );
        }
      }
      assertDevGateOrDeny();
    }

    allow();
  } catch (err) {
    // R36：判定期异常默认 fail-closed；lib 加载失败仍走上方 failOpenAllow。
    if (lib.getGateExceptionPolicy?.().failClosed) {
      failClosedDeny('runtime', err, lib, repairPaths);
    }
    failOpenAllow('runtime', err, lib);
  }
}

main();
