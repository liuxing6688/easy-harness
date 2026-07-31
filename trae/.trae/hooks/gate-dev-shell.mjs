#!/usr/bin/env node
/**
 * PreToolUse 门禁（matcher: `RunCommand`，与 gate-toolchain-install 串联）。
 *
 * 职责：在 Shell 真正执行前拦截高风险命令，防止绕过写文件门禁或无分派计划直接初始化/构建。
 * 拦截范围：
 *   - R22：最近派发为 test-engineer 时的替代 E2E 启动命令
 *   - R28：写文件类 Shell（目标路径套用与 Write 同等判据；opaque 写拒绝；工作树改写 ask）
 *   - R29：经 Shell 触及的门禁自治资产一律 deny（刻意不降级为 ask，防「Write 被拒→改 Shell」）
 *   - `harness.config.json` → `gatedShellPatterns`（项目初始化、依赖安装等）
 *
 * 另一项非拦截职责（**R34**）：放行框架自带运行器命令时**签发执行证明**（nonce + 私钥），
 * 使运行器产出的 `test-results/**` 机读产物可被门禁验签，见 `lib/execproof.mjs`。
 *
 * 判定顺序（说明权威见 mechanical-gates.md §8.1 / §8.5）：
 *   R22 TE 冒烟 → R28 写文件意图（R29 / opaque / 目标路径 R5+分派计划）
 *   → 未命中 gatedShellPatterns 则 allow（顺带 R34 签发）→ 命中则再做 R5 顶层代执行 + assertDevGateOrDeny
 *
 * 共享判据：`./workflow-gate-lib.mjs`。
 * 自锁防护（§8.4 / **R36**）：**lib 加载失败** fail-open；**判定期异常**默认 fail-closed → deny。
 */
/**
 * 门禁自锁逃生：写 stderr、可选落盘、stdout 输出 allow 后退出。
 * Trae PreToolUse stdout 契约：
 * `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }`
 * @param {string} context
 * @param {unknown} err
 * @param {object} [lib]
 */
function failOpenAllow(context, err, lib) {
  process.stderr.write(`[gate-dev-shell] fail-open (${context}): ${err?.message ?? err}\n`);
  try {
    lib?.recordFailOpenEvent?.('gate-dev-shell', context, err);
  } catch {
    /* 落盘失败不影响 fail-open 放行 */
  }
  // Trae PreToolUse stdout 契约
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }));
  process.exit(0);
}

/**
 * **R36**：判定期异常 fail-closed（理由见 gate-dev-workflow.mjs 同名函数注释）。
 *
 * Shell 通道没有「修复通道」例外：修 `process.md` 应当用 Write 类工具，
 * 那条路径已在 `gate-dev-workflow` 里保留了例外，此处再开一个只会平添绕过面。
 */
function failClosedDeny(context, err, lib) {
  process.stderr.write(`[gate-dev-shell] fail-closed (${context}): ${err?.message ?? err}\n`);
  try {
    lib?.recordFailOpenEvent?.('gate-dev-shell', context, err);
  } catch {
    /* 落盘失败不影响本次判定 */
  }
  process.stdout.write(
    JSON.stringify(
      lib.buildGateExceptionVerdict({ hook: 'gate-dev-shell', context, err, channel: 'shell' })
        .output,
    ),
  );
  process.exit(0);
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
    ask,
    assertDevGateOrDeny,
    checkRolePathPermission,
    checkTeAlternativeE2eStartup,
    classifyShellWriteIntent,
    deny,
    harnessSelfGovernedVerdict,
    isE2eTestPath,
    isGatedDevPath,
    isGatedShellCommand,
    isTopLevelAgent,
    normalizePath,
    readStdinJsonAsync,
    detectRunnerExecProofKind,
    issueExecutionProof,
    readClosureLock,
    closureLockBlocksDev,
  } = lib;

  try {
    const input = await readStdinJsonAsync();
    // Trae PreToolUse stdin：命令在 tool_input.command 中
    const command = input.tool_input?.command ?? input.command ?? '';

    /**
     * **R34**：本次命令若是框架自带运行器，在**放行的那一刻**签发执行证明
     * （公钥入台账、私钥入交接文件），运行器随后落签、门禁再验签。
     *
     * 刻意放在每个 `allow()` 之前而非函数开头：被 deny 的命令不会真的执行，
     * 提前签发只会在盘上留下无人消费的私钥（虽有清扫，但没必要制造）。
     */
    const execProofKind = detectRunnerExecProofKind(command);
    function allowRunnerAware() {
      if (execProofKind) {
        try {
          issueExecutionProof({ kind: execProofKind, command });
        } catch (issueErr) {
          // 签发失败绝不阻断 Shell——否则门禁自身故障会变成「运行器全跑不了」。
          // 代价是本次产物验签会失败，届时 R34 followup 会指引重跑。
          process.stderr.write(
            `[gate-dev-shell] exec-proof issue failed: ${issueErr?.message ?? issueErr}\n`,
          );
        }
      }
      allow();
    }

    // R22：TE 冒烟——替代 E2E 启动命令须在普通 Shell 白名单判定之前拦截。
    const altStartup = checkTeAlternativeE2eStartup(command);
    if (!altStartup.ok) {
      deny(
        `流程门禁（TE 冒烟）：${altStartup.message ?? altStartup.reason}`,
        `AGENTS.md / test-engineer.md：${altStartup.message ?? altStartup.reason}`,
      );
    }

    // R28：Shell 侧写文件门禁——必须在 isGatedShellCommand 早退之前判定，
    // 否则 `Set-Content src/app.ts` 之类命令会因未命中包管理正则而被直接放行，
    // 使 R5/R3/R9/R21/R23 只覆盖 Write 类工具（历史实现即如此）。
    const intent = classifyShellWriteIntent(command);

    // R29：与写文件通道同一裁决（一律 deny）。此处刻意不降级为 `ask`——否则
    // 「Write 被拒 → 改用 Shell → 用户点批准」会成为绕过门禁的标准路径（违反 §5.16）。
    for (const item of intent.selfGoverned) {
      const verdict = harnessSelfGovernedVerdict(item.kind, item.path);
      deny(verdict.userMessage, verdict.agentMessage);
    }

    // 内联解释器写文件且无法静态解析目标 → 无法套用路径门禁，直接拒绝。
    if (intent.opaqueWrite) {
      deny(
        '流程门禁（R28）：检测到用内联解释器（node -e / python -c 等）执行写文件操作，但无法静态判定写入目标，故无法套用角色↔路径与分派计划门禁。',
        'AGENTS.md R28：禁止用内联解释器绕过写文件门禁。请改用 Write / Edit 等写文件工具（这样 gate-dev-workflow 才能按 R5/R3/R9 裁决），或把目标路径以字面量写进命令以便门禁判定。',
      );
    }

    // 工作树任意改写（git apply / reset --hard 等）无法静态判定目标 → 交由用户批准。
    if (intent.opaqueWorktree) {
      ask(
        '工作树改写门禁（R28）：该命令（git apply / reset --hard / stash pop 等）可任意改写工作树，但改动目标无法静态判定，门禁无法代为裁决。请确认这是你期望的操作。',
        'AGENTS.md R28：此类命令绕开了按路径判定的写入门禁。如目的是修改源码，应由 development-engineer 通过写文件工具完成；确需执行时须经用户批准。',
      );
    }

    // 可解析目标路径：套用与 Write 同等的 R5 顶层代写 + 角色↔路径 + 分派计划判据。
    // R5 身份基于 agent_id（2026-07-29 修复，见 identity.mjs isTopLevelAgent）。
    if (intent.targets.length > 0) {
      if (isTopLevelAgent(input?.agent_id)) {
        deny(
          '流程门禁（R5/R28）：检测到本次写文件类 Shell 命令由顶层代理直接发起（agent_id = solo_agent）。',
          'AGENTS.md §5.1（R5）：顶层代理不得代行子角色职责。受门禁路径的写入必须在对应子 agent 的 Task 内完成，且不得改用 Shell 绕过写文件门禁（§5.16）。',
        );
      }
      for (const target of intent.targets) {
        const roleCheck = checkRolePathPermission(target);
        if (!roleCheck.ok) {
          deny(
            `流程门禁（R28/R5 角色路径）：Shell 命令将写入「${normalizePath(target)}」——${roleCheck.message ?? roleCheck.reason}`,
            `AGENTS.md R28：Shell 写文件与 Write 工具适用同一套角色↔路径判据。${roleCheck.message ?? roleCheck.reason}`,
          );
        }
      }
      if (intent.targets.some((t) => isGatedDevPath(t) && !isE2eTestPath(t))) {
        // R40 闭环锁（与 gate-dev-workflow 同源判据）：marker 存在时收紧 DE 源码写入。
        // 防止代理在未闭环时改用 Shell 通道（Set-Content / tee 等）写源码绕过 Write 门禁。
        const lock = readClosureLock();
        if (lock) {
          const devBlock = closureLockBlocksDev(null, lock);
          if (devBlock.blocked) {
            deny(
              devBlock.reason,
              'AGENTS.md R40（闭环锁）：Shell 通道与 Write 通道适用同一套闭环锁判据。须先补完流程或由 PM 回派 DE（## 回退计数表留痕）。',
            );
          }
        }
        assertDevGateOrDeny();
      }
    }

    // 未命中 gatedShellPatterns（初始化/依赖安装等）则与本 Hook 无关，放行。
    // 运行器命令正是走这条早退路径（`node .trae/scripts/*-run.mjs` 不匹配包管理正则）。
    if (!isGatedShellCommand(command)) {
      allowRunnerAware();
    }

    // R5：顶层代理直接执行受门禁 Shell（同 gate-dev-workflow 的顶层代写拦截）。
    if (isTopLevelAgent(input?.agent_id)) {
      deny(
        '流程门禁（R5，机械化补强）：检测到本次 Shell 命令由顶层代理直接发起（agent_id = solo_agent），而非通过 Task 派发的子代理。受门禁 Shell 操作必须由对应子 agent（如 development-engineer / test-engineer）在 Task 内执行。',
        'AGENTS.md §5.1（R5）：顶层代理不得代行子角色职责，禁止直接执行受门禁 Shell 命令。请先经项目经理分派，再以 Task 发起对应子 agent 执行。',
      );
    }

    assertDevGateOrDeny();
    allowRunnerAware();
  } catch (err) {
    // R36：判定期异常默认 fail-closed；lib 加载失败仍走上方 failOpenAllow。
    if (lib.getGateExceptionPolicy?.().failClosed) {
      failClosedDeny('runtime', err, lib);
    }
    failOpenAllow('runtime', err, lib);
  }
}

main();
