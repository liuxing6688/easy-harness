#!/usr/bin/env node
/**
 * Stop 门禁：代理拟结束回合时，若流程未完成则阻断收尾，防止开发后直接收尾。
 *
 * 触发：`.claude/settings.json` → `Stop`。
 * 放行（输出 `{}`，省略 decision）条件（命中即放行）：
 *   - 活跃 process.md 不存在 / 读不到内容；
 *   - R10 `cancelled`（已取消流程不再被催促）；
 *   - `blocking: true` **且**通过 **R35** 阻塞释放证据校验（机器起源，或实质阻塞原因 + 用户决策留痕）；
 *   - 全流程测试闭环：`finalTestRequired && finalTestComplete && lintPassed && staticScanPassed`。
 *
 * 判据顺序的说明权威见 `.claude/harness/spec/mechanical-gates.md` §8.2（执行权威：Hook/脚本）。
 * 修改行为须同步更新该节与 `parseWorkflowState`（dispatch.mjs）。
 * 关键判据概览（按优先级，命中即阻断）：
 *   R35 阻塞无证据 → R31 回退上限 → 开发进行中 → 待分派 QE → QE 未完成
 *   → R34 执行证明 → R38 工具不可用 → R15 lint → R16 静态扫描
 *   →（hotfix R11 折叠通道 | **R37** single-task 折叠通道（含 R14/R17/R32）
 *      | 全量：批次 E2E/R14/R17/R32 启动冒烟/批次测试 → 最终 E2E/R32 启动冒烟/最终整体测试）
 *
 * 软性副作用：hotfix 唯一测试通道完成后，R9 可向 process.md 写一次性接口/存储提醒，
 * 但绝不影响本次 allow/阻断判定（best-effort，异常吞掉）。
 *
 * 自锁防护（§8.4）：**lib 加载失败** fail-open（输出 `{}`）；**判定期异常**按 **R36**
 * 默认 fail-closed（阻断收尾），可由用户在 harness.config.json 改回 allow。
 * 共享判据：`./workflow-gate-lib.mjs`（实现按域拆在 `./lib/`）。
 *
 * ── Claude Code Stop 契约（官方：https://code.claude.com/docs/en/hooks）──
 * 阻断（阻止收尾、让 Claude 继续）——顶层 decision，exit 0：
 *   { "decision": "block", "reason": "说明" }
 * 放行（允许收尾）——省略 decision，exit 0： {}
 *
 * 两个必须注意的官方语义（历史实现在此踩坑，勿回退）：
 *   1. 「exit 2 时任何 JSON 都被忽略」，Claude 只读 stderr。因此**不可**既 exit 2 又把
 *      原因写 stdout——那会让阻断生效但原因被完全丢弃。本文件统一走
 *      「exit 0 + stdout JSON」这一条通道。
 *   2. `continue` 是顶层**通用**字段且语义相反：`continue: false` 表示 Claude 整体停止
 *      处理，并会**覆盖** decision。它不是 Stop 的阻断契约，不得用于此处。
 *
 * ── 与 Cursor 版的差异（仅 I/O 契约翻译，判据不变）──
 * lib 的 `buildGateExceptionVerdict({channel:'stop'})` 按历史契约返回
 * `{ followup_message }`（且刻意不带 permission 字段，见 r36-gate-exception 断言），
 * 该形状被 selftest 基线钉住，故**不改 lib**——在本文件的出口边界翻译为
 * `decision:'block' + reason`。
 */

import fs from 'node:fs';

const HOOK_NAME = 'gate-stop-workflow';

/**
 * 阻断收尾：顶层 decision:"block" + reason，exit 0。
 * reason 会被送回 Claude，故必须写明「缺什么 / 下一步做什么」。
 * @param {string} reason
 */
function emitBlock(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

/**
 * 允许收尾：省略 decision（官方：「To allow the action to proceed, omit `decision`」）。
 * @param {string|null} [note] 可选说明；仅用于 fail-open 等需留痕场景，经 systemMessage
 *   呈现给用户（不进 Claude 的判定路径）。
 */
function emitAllow(note = null) {
  process.stdout.write(JSON.stringify(note ? { systemMessage: note } : {}));
  process.exit(0);
}

/**
 * 门禁自锁逃生：写 stderr、可选落盘、放行收尾（不催促推进）。
 * @param {string} context
 * @param {unknown} err
 * @param {object} [lib]
 */
function failOpenAllow(context, err, lib) {
  process.stderr.write(`[${HOOK_NAME}] fail-open (${context}): ${err?.message ?? err}\n`);
  try {
    lib?.recordFailOpenEvent?.(HOOK_NAME, context, err);
  } catch {
    /* 落盘失败不影响 fail-open 放行 */
  }
  emitAllow();
}

/**
 * **R36**：判定期异常的 fail-closed 分支。
 *
 * stop 通道没有 `deny` 语义，「收紧」在这里等价于**不放行收尾**——阻断并要求代理把门禁
 * 异常摆到用户面前，而不是当作「门禁没意见」直接结束回合。
 * 仍会落盘门禁异常事件（`recordFailOpenEvent` 同时置 `blocking: true`），
 * 因此下一轮 stop 会经 R35 的「机器起源阻塞」分支正常放行——不会形成死循环。
 * @param {string} context
 * @param {unknown} err
 * @param {object} lib
 */
function failClosedBlock(context, err, lib) {
  process.stderr.write(`[${HOOK_NAME}] fail-closed (${context}): ${err?.message ?? err}\n`);
  try {
    lib?.recordFailOpenEvent?.(HOOK_NAME, context, err);
  } catch {
    /* 落盘失败不影响本次判定 */
  }
  const { output } = lib.buildGateExceptionVerdict({
    hook: HOOK_NAME,
    context,
    err,
    channel: 'stop',
  });
  // lib 返回历史形状 { followup_message }（被 selftest 基线钉住）→ 在此翻译为官方 Stop 契约。
  emitBlock(output?.followup_message ?? `【流程门禁】（R36 判定期异常）${context}：不放行收尾。`);
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
    getActiveProcessPath,
    readProcessMd,
    parseWorkflowState,
    recordHotfixP0SoftReminder,
    checkRollbackLimit,
    checkBlockingReleaseEvidence,
    checkGateExceptionLedgerReconciled,
    consumeGateExceptionRelease,
    getGateExceptionPolicy,
  } = lib;

  try {
    const content = readProcessMd();
    const processPath = getActiveProcessPath();
    if (!content || !fs.existsSync(processPath)) {
      emitAllow();
    }

    const state = parseWorkflowState(content);

    // R10：已取消的流程不再被催促推进（无论处于哪个阶段）。
    if (state.cancelled) {
      emitAllow();
    }

    // R35 / F-22 反向对账（台账 → 表格行）：门禁自己写过的 fail-open 事件不得被静默抹掉。
    // 置于 blocking 分支**之前**——否则「删掉异常行 + 留着 blocking」正好落进上面的
    // 无条件放行区间，删行这条路径永远不被追究。cancelled 之后：已取消的流程不再催促。
    const ledgerRecon = checkGateExceptionLedgerReconciled?.(content);
    if (ledgerRecon && !ledgerRecon.ok) {
      emitBlock(`【流程门禁】（R35 门禁异常台账对账）${ledgerRecon.message}`);
    }

    // 阻塞态：等待用户决策，stop 不追加催促——但 **R35** 要求先拿出配套证据。
    // 历史实现在此无条件放行，使「写一行 blocking: true」成为绕过全部推进判据的
    // 零成本释放阀（比 loop 预算便宜得多，见 §8.7 边界 3 的修正）。
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
        emitAllow();
      }
      emitBlock(
        `【流程门禁】（R35 阻塞释放证据）${evidence.message}\n\n` +
        'R35 要求阻塞释放证据须满足以下之一：\n' +
        '1. **机器起源**：门禁异常事件表中有未处理事件，且台账可验证\n' +
        '2. **人类起源**：阻塞原因有实质内容 + 用户确认记录有阻塞决策留痕'
      );
    }

    // R9 软性提醒（非阻塞，见 gate-chain.md R9 脚注 / checkHotfixP0InterfaceStorageMention）：
    // P0 影响的 hotfix 唯一测试通道完成后，若测试报告未提及接口/存储关键字，
    // 写一次性提醒到 process.md，但绝不影响本次 allow/阻断判定。
    if (state.workflowMode === 'hotfix' && state.finalTestRowComplete && state.finalE2ePassed) {
      try {
        recordHotfixP0SoftReminder?.(content);
      } catch {
        /* 软性提醒写入失败不影响正常门禁判定 */
      }
    }

    // 放行（全流程测试闭环）：含 R15 lint + R16 静态扫描。
    if (
      state.finalTestRequired &&
      state.finalTestComplete &&
      state.lintPassed &&
      state.staticScanPassed
    ) {
      emitAllow();
    }

    // R31：回退计数上限。置于「全流程闭环放行」之后——已全绿的流程不因历史回退次数被倒扣。
    // 权威：rollback.md；实现补齐见 mechanical-gates.md（R12：文档声称须有实现）。
    const rollback = checkRollbackLimit(content);
    if (!rollback.ok) {
      emitBlock(
        `【流程门禁】（R31 回退上限）${rollback.message}按 rollback.md，同一对象累计回退超过 ${rollback.limit} 次即须停止推进：请调用 project-manager 将 frontmatter \`blocking\` 置为 true、在「## 阻塞原因」写明反复回退的根因与已产出成果物，并用 AskUserQuestion 请用户决策（继续投入 / 调整方案 / 终止流程）。不得在未阻塞的情况下继续推进或收尾。`,
      );
    }

    // 开发进行中 → 催分派 QE。
    if (state.devInProgress) {
      emitBlock(
        '【流程门禁】开发工程师任务仍为「正在执行」。禁止直接收尾。请在本回合：1) 调用 project-manager 更新进度；2) 在 ## 待派发角色列表 分派 quality-engineer；3) 发起 QE Task。',
      );
    }

    // 开发完成但尚未分派 QE。
    if (state.devComplete && !state.hasQeRecord) {
      emitBlock(
        '【流程门禁】开发已标记完成，但尚未分派质量工程师。请先调用 project-manager 分派 quality-engineer 并发起 QE Task。',
      );
    }

    // QE 已分派但未完成。
    if (state.devComplete && state.hasQeRecord && !state.qeComplete) {
      emitBlock(
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
    const execProofBlock = () =>
      emitBlock(
        `【流程门禁】（R34 执行证明）以下门禁的机读产物未通过执行证明验签：${state.execProofFailedGates.join('、')}。` +
          '这意味着产物不是「由框架运行器在门禁签发下写出并未经改动」的——可能是手工编辑、旧版残留，或运行器是在代理 Shell 通道之外执行的。' +
          '请由对应角色（QE：lint / 静态扫描；TE：E2E / 启动冒烟）**在本回合内重新实际运行**相应运行器，' +
          '让 Shell 门禁签发 nonce 并由运行器落签；**禁止**手工编辑 test-results 下的机读产物。' +
          '若本机确实无法经门禁通道运行（如用户自行在外部终端执行），须由**用户本人**在 `.claude/harness.config.json` 设 `execProof.enforce: false`（R29 锁定，代理不得修改）。',
      );
    /**
     * F-24：产物**过期**（源码已变更、产物是上一版代码的结果）与产物**验签失败**
     * 是两回事。过期在开发中高频发生且完全正常，处置只是「重跑」；把它并入
     * 验签失败的文案会让用户/代理去排查一个并不存在的伪造行为。
     */
    const staleArtifactBlock = () =>
      emitBlock(
        `【流程门禁】（R34 产物新鲜度）以下门禁的机读产物早于最后一次源码变更，属**已过期**：${state.staleArtifactGates.join('、')}。` +
          '这不是伪造——签名有效，只是代码在产物写出之后又改过，旧结果不能证明当前代码。' +
          '请由对应角色（QE：lint / 静态扫描；TE：E2E / 启动冒烟）在本回合内**重新运行**相应运行器即可；' +
          '改动越靠后的产物越需要重跑，顺序上先跑 QE 两项再跑 TE 两项可避免相互作废。',
      );
    const toolUnavailableBlock = () =>
      emitBlock(
        `【流程门禁】（R38 工具不可用）以下门禁失败的原因是**检查工具本身不可用**（依赖拉取 / 网络 / 代理 / 证书 / 命令缺失），而非代码质量不达标：${state.toolUnavailableGates.join('、')}。` +
          '请**不要**按「整改质量问题」处理——那会让开发工程师去修一个不存在的缺陷。' +
          '本门禁不因工具不可用而放行（R12：网络一断即免检属放松），须由 project-manager 将 `blocking` 置为 true、' +
          '在「## 阻塞原因」写明具体证据（产物中的 `toolUnavailableCategory` / `toolUnavailableDetail`），' +
          '并用 AskUserQuestion 请用户在三条路径中决策：①修复工具/网络（含企业代理、证书、离线镜像）；' +
          '②由**用户本人**在 `.claude/harness.config.json` 配置可离线执行的等价命令覆盖（`qe.commands.*` / `te.startupSmoke.command`）；' +
          '③确认本项目确不适用该检查，走对应门禁的双要素豁免。代理不得自行选择其中任何一条。',
      );

    /** R32：生产启动冒烟（干净启动 + 强杀后再启动）未拿出通过证据时的阻断文案 */
    const startupSmokeReason = () =>
      `【流程门禁】（R32 生产启动冒烟）测试记录与 E2E 已完成，但缺少生产启动冒烟的通过证据（判定：${state.startupSmokeReason}）。请由 test-engineer 运行 \`node .claude/scripts/startup-smoke-run.mjs\`，对 design 声明的生产启动命令完成两段冒烟：①干净启动（进程稳定存活/健康检查通过）；②强杀后再启动（覆盖陈旧锁、PID 残留、端口未释放等异常退出恢复场景），机读产物 test-results/e2e/.startup-smoke-result.json 须 gatePassed=true。冒烟失败属**产品缺陷**：须判定测试不通过、标 blocking 并回派 development-engineer，**不得**改用替代启动命令绕过（R22）。确无可冒烟启动路径（纯库/纯静态资源包）时，须由 system-architect 在 gated-artifacts.json 声明 startupSmokeApplicability:"n/a" 且项目经理在 process.md「## 用户确认记录」补一行生产启动冒烟豁免确认。`;

    // docs-only 不要求 lint/scan/E2E/接口/对账等开发窗口门禁。
    if (!isDocsOnly && state.qeComplete) {
      // R34 / R38：先判失败的**性质**，再判各门禁自己的推进文案。
      if (state.execProofFailedGates.length > 0) execProofBlock();
      // F-24：验签失败（可能伪造）优先，其次才是过期（日常状态）。
      if (state.staleArtifactGates?.length > 0) staleArtifactBlock();
      if (state.toolUnavailableGates.length > 0) toolUnavailableBlock();
      // R15：编程规范（lint）硬门禁——QE 完成后、推进测试/收尾前必须通过。
      // 「没命令」「没配 linter」重跑都不会变，判据自带精确指引（`LINT_FAILURE_GUIDANCE`，
      // 与 TE 派发门禁共用一份），不得被下面笼统的「请整改违规」覆盖——那会让 DE 去修一个
      // 从未被检查过的代码库（与 R34/R38 同源的错误指引）。
      if (!state.lintPassed) {
        if (state.lintMessage) emitBlock(`【流程门禁】（R15）${state.lintMessage}`);
        emitBlock(
          '【流程门禁】（R15）QE 记录已完成，但编程规范（lint）门禁未通过。请由 quality-engineer 运行 `node .claude/scripts/lint-run.mjs` 并将违规整改至 gatePassed=true（机读产物 test-results/qe/.lint-result.json）；确无可用 linter 时须由 system-architect 在 gated-artifacts.json 声明 lintApplicability:"n/a" 且项目经理在 process.md「## 用户确认记录」补一行编程规范豁免确认。lint 未通过前不得推进测试或宣告完成。',
        );
      }
      // R16：静态代码质量硬门禁（重复代码 DRY + 安全静态扫描）。
      if (!state.staticScanPassed) {
        emitBlock(
          '【流程门禁】（R16）QE 记录已完成，但静态代码质量门禁（重复代码 DRY + 安全静态扫描）未通过。请由 quality-engineer 运行 `node .claude/scripts/static-scan-run.mjs` 并将问题整改至 gatePassed=true（机读产物 test-results/qe/.static-scan-result.json）；确无法运行时须由 system-architect 在 gated-artifacts.json 分别声明 dupCheckApplicability/securityScanApplicability:"n/a" 且项目经理在 process.md「## 用户确认记录」补对应豁免确认。未通过前不得推进测试或宣告完成。',
        );
      }
      if (isHotfix) {
        // R11：hotfix 折叠批次/最终为单次通道，跳过批次相关判据，直接要求最终（唯一一次）E2E。
        if (!state.finalTestRowComplete) {
          emitBlock(
            '【流程门禁】（R11 hotfix 折叠通道）QE 已通过，但测试工程师尚未执行集成测试。请先调用 project-manager 分派 test-engineer 执行一次集成测试 + E2E（--scope=final 语义，无需区分批次）。',
          );
        }
        if (state.finalTestRowComplete && !state.finalE2ePassed) {
          emitBlock(
            '【流程门禁】（R11 hotfix 折叠通道）测试记录已完成，但 E2E 门禁未通过。请由 test-engineer 运行 `node .claude/scripts/e2e-run.mjs --scope=final --baseline=<requirement-list.md 或热修影响面>`；`gatePassed` 为 true 前禁止宣告完成。',
          );
        }
        // R32 并入 hotfix 折叠通道：热修本身常常就是启动缺陷修复，冒烟不可省。
        if (state.finalTestRowComplete && state.finalE2ePassed && !state.startupSmokePassed) {
          emitBlock(startupSmokeReason());
        }
      } else if (isSingleTask) {
        // R37：single-task 折叠通道——只跑一轮集成测试 + E2E，但 R14/R17/R32 一条不减。
        // 与 hotfix 的差别就在这里：热修不新增接口/存储面所以能跳过 R14/R17，
        // 增量功能没有这个前提，跳过就等于「小改动免做接口测试与存储对账」（放松，R12）。
        if (!state.finalTestRowComplete) {
          emitBlock(
            '【流程门禁】（R37 single-task 折叠通道）QE 已通过，但测试工程师尚未执行集成测试。请调用 project-manager 分派 test-engineer 执行**一次**集成测试 + E2E（`--scope=final` 语义，进度行须含「最终整体集成测试」以便机读；无需再分批次/最终两轮）。该轮仍须覆盖 R14 接口测试报告、R17 存储对账与 R32 生产启动冒烟。',
          );
        }
        if (!state.finalE2ePassed) {
          emitBlock(
            '【流程门禁】（R37 single-task 折叠通道）测试记录已完成，但 E2E 门禁未通过。请由 test-engineer 运行 `node .claude/scripts/e2e-run.mjs --scope=final --baseline=<requirement-list.md 或本次增量范围>`；`gatePassed` 为 true 前禁止宣告完成。',
          );
        }
        if (!state.batchApiReportPresent) {
          emitBlock(
            '【流程门禁】（R14 接口测试报告）single-task 折叠通道的唯一测试轮次同样必须做接口测试：测试报告须含非空「## 接口测试报告」章节（至少一条真实用例数据行）。\n\n' +
            '**与 hotfix R11 的区别**：增量迭代常常新增或改动对外接口，故 R14 接口测试**不**随折叠而豁免（hotfix 折叠通道可跳过 R14，因为热修不新增接口）。\n\n' +
            '若本次增量确无对外接口，须在「## 增量范围」如实声明「新增/变更对外接口：否」，并由 system-architect 在 gated-artifacts.json 声明 apiTestApplicability:"n/a" 且项目经理补一行接口测试豁免确认。',
          );
        }
        if (!state.batchStorageReconPresent) {
          emitBlock(
            '【流程门禁】（R37 + R17）single-task 折叠通道的唯一测试轮次同样必须做业务数据存储对账：测试报告须含非空「## 存储对账记录」（分类型适用行 + 描述列完备 + 介质列 + 适用行 `test-results/recon/*.json` 证据文件，判据同 `mechanical-gates.md` §8.3）。若本次增量确无业务数据写入，须走 R17 双要素豁免，不得以「改动很小」为由跳过。',
          );
        }
        // F-08：走「形状变、兼容未破」路径时，本轮须落地兼容性回归用例的执行记录。
        // 这是 schema 硬禁用被拆分放松后换取的新增判据，缺了就等于白拿放松。
        if (state.compatOnlySchemaChange && !state.incrementCompatRegressionPresent) {
          emitBlock(
            '【流程门禁】（R37/F-08 兼容性回归）「## 增量范围」声明「数据形状变更：是」+「需要迁移/破坏兼容：否」，' +
            '故本次增量档可用——代价是本轮唯一测试必须落地**兼容性回归用例**。当前测试报告中未找到「兼容性回归」用例数据行。\n\n' +
            '请由 test-engineer 在活跃 docs 子树 `test/` 的测试报告中补一条兼容性回归用例行（验证历史数据在新形状下仍可读写），' +
            '例如：`| 兼容性回归 | R-00x | T-x | 历史无新字段的记录仍可读取与更新 | 通过 |`。\n\n' +
            '若无法给出该用例，说明这次变更的兼容性其实没被验证过，须经 AskUserQuestion 改回 `workflow_mode: full` 走两轮测试。',
          );
        }
        if (!state.startupSmokePassed) {
          emitBlock(startupSmokeReason());
        }
      } else {
        // 全量模式：批次 E2E → R14 接口 → R17 对账 → 批次集成测试 → 最终 E2E → 最终整体集成测试。
        if (state.batchTestRowComplete && !state.batchE2ePassed) {
          emitBlock(
            '【流程门禁】本批次测试记录已完成，但批次 E2E 未通过。请由 test-engineer 运行 `node .claude/scripts/e2e-run.mjs --scope=batch --required-ids=<本批次P0>`；未通过前不得推进下一批次。',
          );
        }
        if (state.batchTestRowComplete && state.batchE2ePassed && !state.batchApiReportPresent) {
          emitBlock(
            '【流程门禁】（R14）本批次集成测试记录与批次 E2E 均已完成，但测试报告缺少非空的「## 接口测试报告」章节。开发窗口批次集成测试阶段必须做接口测试：请由 test-engineer 补做接口测试并在测试报告补全「## 接口测试报告」章节（须含实际用例数据行）后再推进。若本项目确无对外接口，须由 system-architect 在 gated-artifacts.json 声明 apiTestApplicability:"n/a" 且项目经理在 process.md「## 用户确认记录」补一行接口测试豁免确认，方可豁免本判据。',
          );
        }
        if (state.batchTestRowComplete && state.batchE2ePassed && !state.batchStorageReconPresent) {
          emitBlock(
            '【流程门禁】（R17）本批次集成测试记录与批次 E2E 均已完成，但存储对账机读判据未满足。请由 test-engineer 在测试报告补全非空「## 存储对账记录」：须含适用分类型行（未豁免 R14 须含接口+非「不适用」介质行；未豁免 E2E 须含 E2E+非「不适用」介质行；至少一条真实对账适用行）；每行「关联任务包/对账方式/预期存储结果/实际存储结果/是否通过」非空；「存储介质」为数据库/文件/缓存/对象存储/其他/不适用（「其他」须备注具体系统；「不适用」仅用于无写入任务包留痕且须备注理由，不计入分类型真实对账）；且进度列表中已完成批次测试的任务包编号须全部出现在对账「关联任务包」列（见 `.claude/harness/spec/mechanical-gates.md` §8.3）。若本项目确无业务数据持久化，须由 system-architect 在 gated-artifacts.json 声明 storageReconciliationApplicability:"n/a" 且项目经理在 process.md「## 用户确认记录」补一行存储对账豁免确认，方可豁免本判据。',
          );
        }
        if (
          state.batchTestRowComplete &&
          state.batchE2ePassed &&
          state.batchApiReportPresent &&
          state.batchStorageReconPresent &&
          !state.startupSmokePassed
        ) {
          emitBlock(startupSmokeReason());
        }
        if (!state.batchTestComplete) {
          emitBlock(
            '【流程门禁】本批次 QE 已通过，但测试工程师尚未执行批次集成测试（含批次 E2E、接口测试报告、存储对账与生产启动冒烟）。请先调用 project-manager 分派 test-engineer 做批次集成测试。',
          );
        }
        if (state.finalTestRequired) {
          if (state.finalTestRowComplete && !state.finalE2ePassed) {
            emitBlock(
              '【流程门禁】最终测试记录已完成，但最终 E2E 未通过。请由 test-engineer 运行 `node .claude/scripts/e2e-run.mjs --scope=final --baseline=<requirement-list.md>`；未通过前禁止宣告完成。',
            );
          }
          if (state.finalTestRowComplete && state.finalE2ePassed && !state.startupSmokePassed) {
            emitBlock(startupSmokeReason());
          }
          if (!state.finalTestComplete) {
            emitBlock(
              '【流程门禁】全部任务包开发+QE+各批次集成测试已完成，但尚未执行最终整体集成测试。请先调用 project-manager 分派 test-engineer 执行最终整体集成测试（含全量 E2E）。',
            );
          }
        }
      }
    }

    emitAllow();
  } catch (err) {
    // R36：判定期异常默认 fail-closed（不放行收尾）；lib 加载失败仍 fail-open（见上方）。
    if (getGateExceptionPolicy?.().failClosed) {
      failClosedBlock('runtime', err, lib);
    }
    failOpenAllow('runtime', err, lib);
  }
}

main();
