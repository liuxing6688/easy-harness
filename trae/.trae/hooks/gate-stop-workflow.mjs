#!/usr/bin/env node
/**
 * Stop 门禁：代理拟结束回合时，若流程未完成则注入 reason（阻断并作为新 Query），防止开发后直接收尾。
 *
 * 触发：`hooks.json` → `Stop`（`loop_limit: 3`）。
 * 放行（输出 `{}`，不阻断）条件（命中即放行）：
 *   - 活跃 process.md 不存在 / 读不到内容；
 *   - R10 `cancelled`（已取消流程不再被催促）；
 *   - `blocking: true` **且**通过 **R35** 阻塞释放证据校验（机器起源，或实质阻塞原因 + 用户决策留痕）；
 *   - 全流程测试闭环：`finalTestRequired && finalTestComplete && lintPassed && staticScanPassed`。
 *
 * 判据顺序的说明权威见 `.trae/harness/spec/mechanical-gates.md` §8.2（执行权威：Hook/脚本）。
 * 修改行为须同步更新该节与 `parseWorkflowState`（dispatch.mjs）。
 * 关键判据概览（按优先级，命中即阻断并注入 reason）：
 *   R35 阻塞无证据 → R31 回退上限 → 开发进行中 → 待分派 QE → QE 未完成
 *   → R34 执行证明 → R38 工具不可用 → R15 lint → R16 静态扫描
 *   →（hotfix R11 折叠通道 | **R37** single-task 折叠通道（含 R14/R17/R32）
 *      | 全量：批次 E2E/R14/R17/R32 启动冒烟/批次测试 → 最终 E2E/R32 启动冒烟/最终整体测试）
 *
 * 软性副作用：hotfix 唯一测试通道完成后，R9 可向 process.md 写一次性接口/存储提醒，
 * 但绝不影响本次 allow/阻断 判定（best-effort，异常吞掉）。
 *
 * Trae Stop stdout 契约（https://docs.trae.cn/ide_hook-configuration-reference）：
 *   - 放行：`{}`
 *   - 阻断并注入为新 Query：`{ decision: 'block', reason: string }`（**不**用 `followup_message`，Trae 不识别）
 *
 * 自锁防护（§8.4）：**lib 加载失败** fail-open（输出 `{}`）；**判定期异常**按 **R36**
 * 默认 fail-closed（注入 reason，不放行收尾），可由用户在 harness.config.json 改回 allow。
 * 共享判据：`./workflow-gate-lib.mjs`。
 */
function failOpenAllow(context, err, lib) {
  process.stderr.write(`[gate-stop-workflow] fail-open (${context}): ${err?.message ?? err}\n`);
  try {
    lib?.recordFailOpenEvent?.('gate-stop-workflow', context, err);
  } catch {
    /* 落盘失败不影响 fail-open 放行 */
  }
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

/**
 * **R36**：判定期异常的 fail-closed 分支。
 *
 * stop 通道没有 `deny` 语义，「收紧」在这里等价于**不放行收尾**——注入 reason，
 * 要求代理把门禁异常摆到用户面前，而不是当作「门禁没意见」直接结束回合。
 * 仍会落盘门禁异常事件（`recordFailOpenEvent` 同时置 `blocking: true`），
 * 因此下一轮 stop 会经 R35 的「机器起源阻塞」分支正常放行——不会形成死循环。
 */
function failClosedFollowup(context, err, lib) {
  process.stderr.write(`[gate-stop-workflow] fail-closed (${context}): ${err?.message ?? err}\n`);
  try {
    lib?.recordFailOpenEvent?.('gate-stop-workflow', context, err);
  } catch {
    /* 落盘失败不影响本次判定 */
  }
  process.stdout.write(
    JSON.stringify(
      lib.buildGateExceptionVerdict({ hook: 'gate-stop-workflow', context, err, channel: 'stop' })
        .output,
    ),
  );
  process.exit(0);
}

/**
 * R40 闭环锁 stage 推导：根据 `parseWorkflowState` 的结果映射到 `CLOSURE_STAGES`。
 * 个别分支（R31 rollback-exceeded）由调用点显式覆盖 `pendingStage`，不经过本函数。
 * 与 `gate-stop-workflow` 的 block 顺序对齐：blocking → devInProgress → QE → 测试。
 */
function determineClosureStage(state) {
  if (state.blocking) return 'blocking-no-evidence';
  if (state.devInProgress) return 'dev-incomplete';
  if (state.qeComplete) {
    if (!state.lintPassed || !state.staticScanPassed) return 'qe-incomplete';
    return 'test-incomplete';
  }
  return 'qe-incomplete';
}

/** R40 闭环锁 missingGates 推导：列出当前未满足的机读门禁，供 marker 提示补完方向 */
function determineMissingGates(state) {
  const missing = [];
  if (state.qeComplete) {
    if (!state.lintPassed) missing.push('lint');
    if (!state.staticScanPassed) missing.push('staticScan');
  }
  if (state.batchTestRowComplete && !state.batchE2ePassed) missing.push('batchE2E');
  if (state.finalTestRowComplete && !state.finalE2ePassed) missing.push('finalE2E');
  if (!state.startupSmokePassed) missing.push('startupSmoke');
  if (!state.batchApiReportPresent) missing.push('R14-api');
  if (!state.batchStorageReconPresent) missing.push('R17-storage');
  if (!state.finalTestComplete) missing.push('finalIntegrationTest');
  return missing;
}

async function main() {
  let lib;
  try {
    lib = await import('./workflow-gate-lib.mjs');
  } catch (err) {
    failOpenAllow('lib-load', err);
    return;
  }

  const fs = await import('node:fs');
  const {
    getActiveProcessPath,
    output,
    readProcessMd,
    parseWorkflowState,
    recordHotfixP0SoftReminder,
    checkHotfixP0InterfaceStorageMention,
    checkRollbackLimit,
    checkBlockingReleaseEvidence,
    consumeGateExceptionRelease,
    getGateExceptionPolicy,
    readClosureLock,
    writeClosureLock,
    clearClosureLock,
  } = lib;

  // R40 闭环锁：pendingStage 由个别 block 分支显式覆盖（如 R31=rollback-exceeded），
  // 默认由 determineClosureStage(state) 推导。exitFollowup 写 marker，exitAllow 清 marker。
  // 作用：代理硬结束回合后，下一轮 PreToolUse 读 marker 收紧 DE 权限（跨回合约束）。
  // state 须在 try 外声明，使 exitFollowup 闭包能访问（const 在 try 块内对闭包不可见）。
  let pendingStage = null;
  let pendingMissing = [];
  let state = null;

  function exitAllow() {
    try { clearClosureLock(); } catch { /* best-effort：清不掉的残留由下一轮 R40 处置 */ }
    output({});
    process.exit(0);
  }

  function exitFollowup(message) {
    const stage = pendingStage ?? determineClosureStage(state);
    const missing = pendingMissing.length > 0 ? pendingMissing : determineMissingGates(state);
    try { writeClosureLock(stage, missing, message); } catch { /* best-effort */ }
    // Trae Stop stdout 契约：{ decision: 'block', reason: '...' } 阻断停止并注入为新 Query
    output({ decision: 'block', reason: message });
    process.exit(0);
  }

  try {
    const content = readProcessMd();
    const processPath = getActiveProcessPath();
    if (!content || !fs.existsSync(processPath)) {
      exitAllow();
    }

    state = parseWorkflowState(content);
    // 注：state 在 try 外声明（let state = null），此处赋值使 exitFollowup 闭包可访问。

    // R10：已取消的流程不再被催促推进（无论处于哪个阶段）。
    if (state.cancelled) {
      exitAllow();
    }

    // 阻塞态：等待用户决策，stop 不追加催促——但 **R35** 要求先拿出配套证据。
    // 历史实现在此无条件放行，使「写一行 blocking: true」成为绕过全部推进判据的
    // 零成本释放阀（比 loop_limit: 3 的预算便宜得多，见 §8.7 边界 3 的修正）。
    if (state.blocking) {
      const evidence = checkBlockingReleaseEvidence(content);
      if (evidence.ok) {
        // R35：机器起源的释放是一次性的——用掉即在旁路台账里标记，防止同一条真实发生过的
        // 门禁异常被反复抄回「## 门禁异常事件」当成永久免死金牌。
        if (evidence.digest) {
          try {
            consumeGateExceptionRelease(evidence.digest);
          } catch {
            /* 标记失败不影响本次放行 */
          }
        }
        exitAllow();
      }
      exitFollowup(`【流程门禁】（R35 阻塞释放证据）${evidence.message}`);
    }

    // R9 软性提醒（非阻塞，见 `.trae/harness/spec/gate-chain.md` R9 脚注第 4 条 / workflow-gate-lib 的
    // checkHotfixP0InterfaceStorageMention）：P0 影响的 hotfix 唯一测试通道完成后，
    // 若测试报告未提及接口/存储关键字，写一次性提醒到 process.md，但绝不影响本次
    // allow/followup 判定——任何异常均 best-effort 吞掉，不得导致 stop 门禁行为改变。
    if (state.workflowMode === 'hotfix' && state.finalTestRowComplete && state.finalE2ePassed) {
      try {
        recordHotfixP0SoftReminder?.(content);
      } catch {
        /* 软性提醒写入失败不影响正常门禁判定 */
      }
    }

    // 放行（全流程测试闭环）：finalTestRequired && finalTestComplete && lintPassed（R15）
    // && staticScanPassed（R16）
    if (state.finalTestRequired && state.finalTestComplete && state.lintPassed && state.staticScanPassed) {
      // P2-6 修复（R12 加强：软提醒→硬门禁）：P0 影响的 hotfix 是最高风险场景，唯一测试通道
      // 已通过、即将放行收尾时，若本次测试报告仍缺结构化「## 接口测试报告」「## 存储对账记录」
      // 真实数据行，则升级为 Stop 硬门禁（阻断收尾）。复用 checkHotfixP0InterfaceStorageMention
      // 的判定（非 P0 / 非 hotfix 时 applicable=false，自动跳过，不影响其他模式）。
      // 闭合 §8.4 披露的「P0 影响 hotfix 接口/存储验证真实机制空白」。
      if (state.workflowMode === 'hotfix' && state.finalTestRowComplete && state.finalE2ePassed) {
        const p0Check = checkHotfixP0InterfaceStorageMention(content);
        if (p0Check.applicable && p0Check.needsReminder) {
          const missing = [];
          if (!p0Check.mentionsInterface) missing.push('## 接口测试报告（须含真实数据行）');
          if (!p0Check.mentionsStorage) missing.push('## 存储对账记录（须含真实数据行）');
          exitFollowup(
            `【流程门禁】（R9 升级·hotfix P0 硬门禁）唯一测试通道已通过（finalE2ePassed=true），但本次测试报告缺失：${missing.join('、')}。P0 影响的 hotfix 是最高风险场景，R14/R17 机读硬门禁按 R11 不并入折叠通道，此处为最低限度结构性补强。请由 test-engineer 在本次测试报告（process.md 引用或 test-report.md）补全对应章节（须含真实数据行）后再收尾。若本次热修确未触及接口或业务数据存储，须由 system-architect 在 gated-artifacts.json 声明 apiTestApplicability:"n/a" 和/或 storageReconciliationApplicability:"n/a" 且项目经理在 process.md「## 用户确认记录」补对应豁免确认。`,
          );
        }
      }
      exitAllow();
    }

    // R31：回退计数上限。置于「全流程闭环放行」之后——已全绿的流程不因历史回退次数被倒扣。
    // 权威：rollback.md；实现补齐见 mechanical-gates.md（R12：文档声称须有实现）。
    // R40：rollback-exceeded 是独立 stage（不属 determineClosureStage 覆盖范围），
    // 仅在此分支命中时显式设——若在 R31 检查前就赋值，后续 devInProgress / 待分派 QE
    // 等分支会借到 'rollback-exceeded' 作为 marker stage，造成 stage 与实际阻塞原因错配。
    const rollback = checkRollbackLimit(content);
    if (!rollback.ok) {
      pendingStage = 'rollback-exceeded';
      exitFollowup(
        `【流程门禁】（R31 回退上限）${rollback.message}按 rollback.md，同一对象累计回退超过 ${rollback.limit} 次即须停止推进：请调用 project-manager 将 frontmatter \`blocking\` 置为 true、在「## 阻塞原因」写明反复回退的根因与已产出成果物，并在返回结果中标注「需要用户确认：[继续投入/调整方案/终止流程]」由顶层 Agent 用 \`AskUserQuestion\` 代为请用户决策（Trae 适配：PM 为 Subagent，不含 \`AskUserQuestion\` 工具）。不得在未阻塞的情况下继续推进或收尾。`,
      );
    }

    // 开发进行中
    if (state.devInProgress) {
      exitFollowup(
        '【流程门禁】开发工程师任务仍为「正在执行」。禁止直接收尾。请在本回合：1) 调用 project-manager 更新进度；2) 在 ## 待派发角色列表 分派 quality-engineer；3) 发起 QE Task。',
      );
    }

    // 待分派 QE
    if (state.devComplete && !state.hasQeRecord) {
      exitFollowup(
        '【流程门禁】开发已标记完成，但尚未分派质量工程师。请先调用 project-manager 分派 quality-engineer 并发起 QE Task。',
      );
    }

    // QE 未完成
    if (state.devComplete && state.hasQeRecord && !state.qeComplete) {
      exitFollowup(
        '【流程门禁】质量审核尚未完成。请继续 quality-engineer Task，不得宣告项目完成。',
      );
    }

    const isHotfix = state.workflowMode === 'hotfix';
    const isDocsOnly = state.workflowMode === 'docs-only';
    const isSingleTask = state.workflowMode === 'single-task';

    /**
     * R34/R38：门禁失败的**性质**优先于门禁本身的推进文案。
     * 「工具装不上」与「代码有重复」若共用一句「请整改」，用户会被指向完全错误的方向；
     * 「产物被手写」若共用一句「请运行 lint」，代理会再手写一次。故两类都先行拦截。
     * 仅在开发窗口门禁生效时（`qeComplete` 之后）判定，避免流程早期被无关产物噪声打断。
     */
    const execProofFollowup = () =>
      exitFollowup(
        `【流程门禁】（R34 执行证明）以下门禁的机读产物未通过执行证明验签：${state.execProofFailedGates.join('、')}。` +
          '这意味着产物不是「由框架运行器在门禁签发下写出并未经改动」的——可能是手工编辑、旧版残留，或运行器是在代理 Shell 通道之外执行的。' +
          '请由对应角色（QE：lint / 静态扫描；TE：E2E / 启动冒烟）**在本回合内重新实际运行**相应运行器，' +
          '让 `PreToolUse` 门禁签发 nonce 并由运行器落签；**禁止**手工编辑 test-results 下的机读产物。' +
          '若本机确实无法经门禁通道运行（如用户自行在外部终端执行），须由**用户本人**在 `.trae/harness.config.json` 设 `execProof.enforce: false`（R29 锁定，代理不得修改）。',
      );
    const toolUnavailableFollowup = () =>
      exitFollowup(
        `【流程门禁】（R38 工具不可用）以下门禁失败的原因是**检查工具本身不可用**（依赖拉取 / 网络 / 代理 / 证书 / 命令缺失），而非代码质量不达标：${state.toolUnavailableGates.join('、')}。` +
          '请**不要**按「整改质量问题」处理——那会让开发工程师去修一个不存在的缺陷。' +
          '本门禁不因工具不可用而放行（R12：网络一断即免检属放松），须由 project-manager 将 `blocking` 置为 true、' +
          '在「## 阻塞原因」写明具体证据（产物中的 `toolUnavailableCategory` / `toolUnavailableDetail`），' +
          '并用 AskUserQuestion 请用户在三条路径中决策：①修复工具/网络（含企业代理、证书、离线镜像）；' +
          '②由**用户本人**在 `.trae/harness.config.json` 配置可离线执行的等价命令覆盖（`qe.commands.*` / `te.startupSmoke.command`）；' +
          '③确认本项目确不适用该检查，走对应门禁的双要素豁免。代理不得自行选择其中任何一条。',
      );

    /** R32：生产启动冒烟（干净启动 + 强杀后再启动）未拿出通过证据时的 followup 文案 */
    const startupSmokeFollowup = () =>
      `【流程门禁】（R32 生产启动冒烟）测试记录与 E2E 已完成，但缺少生产启动冒烟的通过证据（判定：${state.startupSmokeReason}）。请由 test-engineer 运行 \`node .trae/scripts/startup-smoke-run.mjs\`，对 design 声明的生产启动命令完成两段冒烟：①干净启动（进程稳定存活/健康检查通过）；②强杀后再启动（覆盖陈旧锁、PID 残留、端口未释放等异常退出恢复场景），机读产物 test-results/e2e/.startup-smoke-result.json 须 gatePassed=true。冒烟失败属**产品缺陷**：须判定测试不通过、标 blocking 并回派 development-engineer，**不得**改用替代启动命令绕过（R22）。确无可冒烟启动路径（纯库/纯静态资源包）时，须由 system-architect 在 gated-artifacts.json 声明 startupSmokeApplicability:"n/a" 且项目经理在 process.md「## 用户确认记录」补一行生产启动冒烟豁免确认。`;

    if (!isDocsOnly && state.qeComplete) {
      // R34 / R38：先判失败的**性质**，再判各门禁自己的推进文案。
      if (state.execProofFailedGates.length > 0) execProofFollowup();
      if (state.toolUnavailableGates.length > 0) toolUnavailableFollowup();
      // R15：编程规范（lint）硬门禁——QE 记录完成后、推进测试/收尾前，lint 必须通过。
      // 「没命令」「没配 linter」重跑都不会变，判据自带精确指引（`LINT_FAILURE_GUIDANCE`，
      // 与 TE 派发门禁共用一份），不得被下面笼统的「请整改违规」覆盖——那会让 DE 去修一个
      // 从未被检查过的代码库（与 R34/R38 同源的错误指引）。
      if (!state.lintPassed) {
        if (state.lintMessage) exitFollowup(`【流程门禁】（R15）${state.lintMessage}`);
        exitFollowup(
          '【流程门禁】（R15）QE 记录已完成，但编程规范（lint）门禁未通过。请由 quality-engineer 运行 `node .trae/scripts/lint-run.mjs` 并将违规整改至 gatePassed=true（机读产物 test-results/qe/.lint-result.json）；确无可用 linter 时须由 system-architect 在 gated-artifacts.json 声明 lintApplicability:"n/a" 且项目经理在 process.md「## 用户确认记录」补一行编程规范豁免确认。lint 未通过前不得推进测试或宣告完成。',
        );
      }
      // R16：静态代码质量硬门禁——QE 记录完成后、推进测试/收尾前，重复代码检测与
      // 安全静态扫描均须通过。
      if (!state.staticScanPassed) {
        exitFollowup(
          '【流程门禁】（R16）QE 记录已完成，但静态代码质量门禁（重复代码 DRY + 安全静态扫描）未通过。请由 quality-engineer 运行 `node .trae/scripts/static-scan-run.mjs` 并将问题整改至 gatePassed=true（机读产物 test-results/qe/.static-scan-result.json）；确无法运行时须由 system-architect 在 gated-artifacts.json 分别声明 dupCheckApplicability/securityScanApplicability:"n/a" 且项目经理在 process.md「## 用户确认记录」补对应豁免确认。未通过前不得推进测试或宣告完成。',
        );
      }
      if (isHotfix) {
        // R11：hotfix 折叠批次/最终为单次通道，跳过批次相关两条判据，直接要求最终（唯一一次）E2E。
        if (!state.finalTestRowComplete) {
          exitFollowup(
            '【流程门禁】（R11 hotfix 折叠通道）QE 已通过，但测试工程师尚未执行集成测试。请先调用 project-manager 分派 test-engineer 执行一次集成测试 + E2E（--scope=final 语义，无需区分批次）。',
          );
        }
        if (state.finalTestRowComplete && !state.finalE2ePassed) {
          exitFollowup(
            '【流程门禁】（R11 hotfix 折叠通道）测试记录已完成，但 E2E 门禁未通过。请由 test-engineer 运行 `node .trae/scripts/e2e-run.mjs --scope=final --baseline=<requirement-list.md 或热修影响面>`；`gatePassed` 为 true 前禁止宣告完成。',
          );
        }
        // R32 并入 hotfix 折叠通道：热修本身常常就是启动缺陷修复，冒烟不可省。
        if (state.finalTestRowComplete && state.finalE2ePassed && !state.startupSmokePassed) {
          exitFollowup(startupSmokeFollowup());
        }
      } else if (isSingleTask) {
        // R37：single-task 折叠通道——只跑一轮集成测试 + E2E，但 R14/R17/R32 一条不减。
        // 与 hotfix 的差别就在这里：热修不新增接口/存储面所以能跳过 R14/R17，
        // 增量功能没有这个前提，跳过就等于「小改动免做接口测试与存储对账」（放松，R12）。
        if (!state.finalTestRowComplete) {
          exitFollowup(
            '【流程门禁】（R37 single-task 折叠通道）QE 已通过，但测试工程师尚未执行集成测试。请调用 project-manager 分派 test-engineer 执行**一次**集成测试 + E2E（`--scope=final` 语义，进度行须含「最终整体集成测试」以便机读；无需再分批次/最终两轮）。该轮仍须覆盖 R14 接口测试报告、R17 存储对账与 R32 生产启动冒烟。',
          );
        }
        if (!state.finalE2ePassed) {
          exitFollowup(
            '【流程门禁】（R37 single-task 折叠通道）测试记录已完成，但 E2E 门禁未通过。请由 test-engineer 运行 `node .trae/scripts/e2e-run.mjs --scope=final --baseline=<requirement-list.md 或本次增量范围>`；`gatePassed` 为 true 前禁止宣告完成。',
          );
        }
        if (!state.batchApiReportPresent) {
          exitFollowup(
            '【流程门禁】（R37 + R14）single-task 折叠通道的唯一测试轮次同样必须做接口测试：测试报告须含非空「## 接口测试报告」章节（至少一条真实用例数据行）。增量迭代常常新增或改动对外接口，故本判据**不**随折叠而豁免（区别于 hotfix 的 R11）。若本次增量确无对外接口，须在「## 增量范围」如实声明「新增/变更对外接口：否」，并由 system-architect 在 gated-artifacts.json 声明 apiTestApplicability:"n/a" 且项目经理补一行接口测试豁免确认。',
          );
        }
        if (!state.batchStorageReconPresent) {
          exitFollowup(
            '【流程门禁】（R37 + R17）single-task 折叠通道的唯一测试轮次同样必须做业务数据存储对账：测试报告须含非空「## 存储对账记录」（分类型适用行 + 描述列完备 + 介质列 + 适用行 `test-results/recon/*.json` 证据文件，判据同 `mechanical-gates.md` §8.3）。若本次增量确无业务数据写入，须走 R17 双要素豁免，不得以「改动很小」为由跳过。',
          );
        }
        if (!state.startupSmokePassed) {
          exitFollowup(startupSmokeFollowup());
        }
      } else {
        // 全量模式：批次 E2E → R14 接口 → R17 对账 → 批次集成测试 → 最终 E2E → 最终整体集成测试。
        if (state.batchTestRowComplete && !state.batchE2ePassed) {
          exitFollowup(
            '【流程门禁】本批次测试记录已完成，但批次 E2E 未通过。请由 test-engineer 运行 `node .trae/scripts/e2e-run.mjs --scope=batch --required-ids=<本批次P0>`；未通过前不得推进下一批次。',
          );
        }
        if (state.batchTestRowComplete && state.batchE2ePassed && !state.batchApiReportPresent) {
          exitFollowup(
            '【流程门禁】（R14）本批次集成测试记录与批次 E2E 均已完成，但测试报告缺少非空的「## 接口测试报告」章节。开发窗口批次集成测试阶段必须做接口测试：请由 test-engineer 补做接口测试并在测试报告补全「## 接口测试报告」章节（须含实际用例数据行）后再推进。若本项目确无对外接口，须由 system-architect 在 gated-artifacts.json 声明 apiTestApplicability:"n/a" 且项目经理在 process.md「## 用户确认记录」补一行接口测试豁免确认，方可豁免本判据。',
          );
        }
        if (state.batchTestRowComplete && state.batchE2ePassed && !state.batchStorageReconPresent) {
          exitFollowup(
            '【流程门禁】（R17）本批次集成测试记录与批次 E2E 均已完成，但存储对账机读判据未满足。请由 test-engineer 在测试报告补全非空「## 存储对账记录」：须含适用分类型行（未豁免 R14 须含接口+非「不适用」介质行；未豁免 E2E 须含 E2E+非「不适用」介质行；至少一条真实对账适用行）；每行「关联任务包/对账方式/预期存储结果/实际存储结果/是否通过」非空；「存储介质」为数据库/文件/缓存/对象存储/其他/不适用（「其他」须备注具体系统；「不适用」仅用于无写入任务包留痕且须备注理由，不计入分类型真实对账）；且进度列表中已完成批次测试的任务包编号须全部出现在对账「关联任务包」列（见 `.trae/harness/spec/mechanical-gates.md` §8.3）。若本项目确无业务数据持久化，须由 system-architect 在 gated-artifacts.json 声明 storageReconciliationApplicability:"n/a" 且项目经理在 process.md「## 用户确认记录」补一行存储对账豁免确认，方可豁免本判据。',
          );
        }
        if (
          state.batchTestRowComplete &&
          state.batchE2ePassed &&
          state.batchApiReportPresent &&
          state.batchStorageReconPresent &&
          !state.startupSmokePassed
        ) {
          exitFollowup(startupSmokeFollowup());
        }
        if (!state.batchTestComplete) {
          exitFollowup(
            '【流程门禁】本批次 QE 已通过，但测试工程师尚未执行批次集成测试（含批次 E2E、接口测试报告、存储对账与生产启动冒烟）。请先调用 project-manager 分派 test-engineer 做批次集成测试。',
          );
        }
        if (state.finalTestRequired) {
          if (state.finalTestRowComplete && !state.finalE2ePassed) {
            exitFollowup(
              '【流程门禁】最终测试记录已完成，但最终 E2E 未通过。请由 test-engineer 运行 `node .trae/scripts/e2e-run.mjs --scope=final --baseline=<requirement-list.md>`；未通过前禁止宣告完成。',
            );
          }
          if (state.finalTestRowComplete && state.finalE2ePassed && !state.startupSmokePassed) {
            exitFollowup(startupSmokeFollowup());
          }
          if (!state.finalTestComplete) {
            exitFollowup(
              '【流程门禁】全部任务包开发+QE+各批次集成测试已完成，但尚未执行最终整体集成测试。请先调用 project-manager 分派 test-engineer 执行最终整体集成测试（含全量 E2E）。',
            );
          }
        }
      }
    }

    exitAllow();
  } catch (err) {
    // R36：判定期异常默认 fail-closed（不放行收尾）；lib 加载失败仍 fail-open（见上方）。
    if (getGateExceptionPolicy?.().failClosed) {
      failClosedFollowup('runtime', err, lib);
    }
    failOpenAllow('runtime', err, lib);
  }
}

main();

