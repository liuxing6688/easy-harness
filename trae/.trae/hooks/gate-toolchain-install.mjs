#!/usr/bin/env node
/**
 * PreToolUse 门禁（matcher: `RunCommand`，与 gate-dev-shell 串联）：系统级工具链安装须经用户确认。
 *
 * 触发：与 gate-dev-shell 同挂在 PreToolUse（matcher: `RunCommand`）；
 * 本 Hook 只关心 `harness.config.json` → `toolchain.installPatterns`
 * （winget / brew / apt / mise / asdf / nix / VS Build Tools 等）。
 *
 * 放行条件（满足其一即可）：
 *   1. 命令未命中安装模式 → 与本 Hook 无关，allow；
 *   2. 存在有效 `.toolchain-install-approved.json` 凭证：
 *      `userConfirmed: true` + 有效时间戳 + **commandHash 与本次命令匹配**（R29 加强，§8.5）；
 *   3. 否则输出 `ask`，由 PreToolUse 通道请用户批准。
 *
 * 重要（R29）：代理**不得**自签 `.toolchain-install-approved.json`
 * （该路径属门禁自治资产，gate-dev-workflow / gate-dev-shell 会 deny）。
 * 凭证仅可由用户本人创建，用于一段时间内的批量预授权。
 *
 * 共享判据：`./workflow-gate-lib.mjs`（`isToolchainInstallCommand` / `hasToolchainInstallApproval`）。
 * 自锁防护（§8.4 / **R36**）：**lib 加载失败** fail-open；**判定期异常**默认 fail-closed，
 * 但降级为 `ask`（本 Hook 的正常拦截语义即 ask，deny 会把缺工具链的机器彻底锁死）。
 */
function failOpenAllow(context, err, lib) {
  process.stderr.write(`[gate-toolchain-install] fail-open (${context}): ${err?.message ?? err}\n`);
  try {
    lib?.recordFailOpenEvent?.('gate-toolchain-install', context, err);
  } catch {
    /* 落盘失败不影响 fail-open 放行 */
  }
  // Trae PreToolUse stdout 契约
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }));
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

  const { allow, ask, isToolchainInstallCommand, hasToolchainInstallApproval, readStdinJsonAsync } = lib;

  try {
    const input = await readStdinJsonAsync();
    // Trae PreToolUse stdin：命令在 tool_input.command 中
    const command = input.tool_input?.command ?? input.command ?? '';

    if (!isToolchainInstallCommand(command)) {
      allow();
    }

    if (hasToolchainInstallApproval(command)) {
      allow();
    }

    ask(
      '工具链安装门禁：须先询问用户现有工具链路径或安装目标目录（避免未经确认的默认系统路径），在用户明确确认前不得自动安装。',
      'AGENTS.md gate-toolchain-install：请先使用 `AskUserQuestion` 询问用户工具链的现有路径或安装目录（若当前为 Subagent 上下文，须在返回结果中标注「需要用户确认：[工具链路径/安装目录]」由顶层 Agent 代为询问），然后直接重试本命令——本通道（PreToolUse）的 `ask` 会请用户批准，这就是有效的用户确认。**不要**自行创建 `.trae/hooks/.toolchain-install-approved.json`：该凭证已按 **R29** 禁止代理写入（自签授权），只有用户本人可创建它来做一段时间内的批量预授权（须含 userConfirmed、有效时间戳、与本命令匹配的 commandHash）。',
    );
  } catch (err) {
    // R36：判定期异常默认 fail-closed。本 Hook 的正常「未授权」出口就是 `ask`，
    // 故异常时降级为 `ask` 而非 `deny`——既不静默放行，也不把一台缺工具链的机器锁死。
    if (lib.getGateExceptionPolicy?.().failClosed) {
      try {
        lib.recordFailOpenEvent?.('gate-toolchain-install', 'runtime', err);
      } catch {
        /* 落盘失败不影响本次判定 */
      }
      process.stderr.write(
        `[gate-toolchain-install] fail-closed→ask (runtime): ${err?.message ?? err}\n`,
      );
      process.stdout.write(
        JSON.stringify(
          lib.buildGateExceptionVerdict({
            hook: 'gate-toolchain-install',
            context: 'runtime',
            err,
            channel: 'toolchain',
          }).output,
        ),
      );
      process.exit(0);
    }
    failOpenAllow('runtime', err, lib);
  }
}

main();

