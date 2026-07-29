#!/usr/bin/env node
/**
 * stop 门禁：代理拟结束回合时，若流程未完成则注入 `followup_message`，防止开发后直接收尾。
 *
 * 触发：`hooks.json` → `stop`（`loop_limit: 3`）。
 * 放行（输出 `{}`，不注入 followup）条件（命中即放行）：
 *   - 活跃 process.md 不存在 / 读不到内容；
 *   - R10 `cancelled`（已取消流程不再被催促）；
 *   - `blocking: true`（阻塞等待用户决策）；
 *   - 全流程测试闭环：`finalTestRequired && finalTestComplete && lintPassed && staticScanPassed`。
 *
 * 判据顺序的说明权威见 `.cursor/harness/spec/mechanical-gates.md` §8.2（执行权威：Hook/脚本）。
 * 修改行为须同步更新该节与 `parseWorkflowState`（dispatch.mjs）。
 * 关键判据概览（按优先级，命中即 followup）：
 *   R31 回退上限 → 开发进行中 → 待分派 QE → QE 未完成
 *   → R15 lint → R16 静态扫描
 *   →（hotfix R11 折叠通道 | 全量：批次 E2E/R14/R17/批次测试 → 最终 E2E/最终整体测试）
 *
 * 软性副作用：hotfix 唯一测试通道完成后，R9 可向 process.md 写一次性接口/存储提醒，
 * 但绝不影响本次 allow/followup 判定（best-effort，异常吞掉）。
 *
 * 自锁防护（§8.4）：与 gate-dev-workflow 一致；此处「fail-open」= 输出 `{}`（不注入 followup）。
 * 共享判据：`./workflow-gate-lib.mjs`。
 */
/**
 * 门禁自锁逃生：写 stderr、可选落盘、stdout 输出空对象后退出（不催促推进）。
 * @param {string} context
 * @param {unknown} err
 * @param {object} [lib]
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
    checkRollbackLimit,
  } = lib;

  /** 放行：不注入 followup。 */
  function exitAllow() {
    output({});
    process.exit(0);
  }

  /** 拦截收尾：注入 followup_message 催促代理继续流程。 */
  function exitFollowup(message) {
    output({ followup_message: message });
    process.exit(0);
  }

  try {
    const content = readProcessMd();
    const processPath = getActiveProcessPath();
    if (!content || !fs.existsSync(processPath)) {
      exitAllow();
    }

    const state = parseWorkflowState(content);

    // R10：已取消的流程不再被催促推进（无论处于哪个阶段）。
    if (state.cancelled) {
      exitAllow();
    }

    // 阻塞态：等待用户决策，stop 不追加催促。
    if (state.blocking) {
      exitAllow();
    }

    // R9 软性提醒（非阻塞，见 gate-chain.md R9 脚注 / checkHotfixP0InterfaceStorageMention）：
    // P0 影响的 hotfix 唯一测试通道完成后，若测试报告未提及接口/存储关键字，
    // 写一次性提醒到 process.md，但绝不影响本次 allow/followup 判定。
    if (state.workflowMode === 'hotfix' && state.finalTestRowComplete && state.finalE2ePassed) {
      try {
        recordHotfixP0SoftReminder?.(content);
      } catch {
        /* 软性提醒写入失败不影响正常门禁判定 */
      }
    }

    // 放行（全流程测试闭环）：含 R15 lint + R16 静态扫描。
    if (state.finalTestRequired && state.finalTestComplete && state.lintPassed && state.staticScanPassed) {
      exitAllow();
    }

    // R31：回退计数上限。置于「全流程闭环放行」之后——已全绿的流程不因历史回退次数被倒扣。
    // 权威：rollback.md；实现补齐见 mechanical-gates.md（R12：文档声称须有实现）。
    const rollback = checkRollbackLimit(content);
    if (!rollback.ok) {
      exitFollowup(
        `【流程门禁】（R31 回退上限）${rollback.message}按 rollback.md，同一对象累计回退超过 ${rollback.limit} 次即须停止推进：请调用 project-manager 将 frontmatter \`blocking\` 置为 true、在「## 阻塞原因」写明反复回退的根因与已产出成果物，并用 AskQuestion 请用户决策（继续投入 / 调整方案 / 终止流程）。不得在未阻塞的情况下继续推进或收尾。`,
      );
    }

    // 开发进行中 → 催分派 QE。
    if (state.devInProgress) {
      exitFollowup(
        '【流程门禁】开发工程师任务仍为「正在执行」。禁止直接收尾。请在本回合：1) 调用 project-manager 更新进度；2) 在 ## 待派发角色列表 分派 quality-engineer；3) 发起 QE Task。',
      );
    }

    // 开发完成但尚未分派 QE。
    if (state.devComplete && !state.hasQeRecord) {
      exitFollowup(
        '【流程门禁】开发已标记完成，但尚未分派质量工程师。请先调用 project-manager 分派 quality-engineer 并发起 QE Task。',
      );
    }

    // QE 已分派但未完成。
    if (state.devComplete && state.hasQeRecord && !state.qeComplete) {
      exitFollowup(
        '【流程门禁】质量审核尚未完成。请继续 quality-engineer Task，不得宣告项目完成。',
      );
    }

    const isHotfix = state.workflowMode === 'hotfix';
    const isDocsOnly = state.workflowMode === 'docs-only';

    // docs-only 不要求 lint/scan/E2E/接口/对账等开发窗口门禁。
    if (!isDocsOnly && state.qeComplete) {
      // R15：编程规范（lint）硬门禁——QE 完成后、推进测试/收尾前必须通过。
      if (!state.lintPassed) {
        exitFollowup(
          '【流程门禁】（R15）QE 记录已完成，但编程规范（lint）门禁未通过。请由 quality-engineer 运行 `node .cursor/scripts/lint-run.mjs` 并将违规整改至 gatePassed=true（机读产物 test-results/qe/.lint-result.json）；确无可用 linter 时须由 system-architect 在 gated-artifacts.json 声明 lintApplicability:"n/a" 且项目经理在 process.md「## 用户确认记录」补一行编程规范豁免确认。lint 未通过前不得推进测试或宣告完成。',
        );
      }
      // R16：静态代码质量硬门禁（重复代码 DRY + 安全静态扫描）。
      if (!state.staticScanPassed) {
        exitFollowup(
          '【流程门禁】（R16）QE 记录已完成，但静态代码质量门禁（重复代码 DRY + 安全静态扫描）未通过。请由 quality-engineer 运行 `node .cursor/scripts/static-scan-run.mjs` 并将问题整改至 gatePassed=true（机读产物 test-results/qe/.static-scan-result.json）；确无法运行时须由 system-architect 在 gated-artifacts.json 分别声明 dupCheckApplicability/securityScanApplicability:"n/a" 且项目经理在 process.md「## 用户确认记录」补对应豁免确认。未通过前不得推进测试或宣告完成。',
        );
      }
      if (isHotfix) {
        // R11：hotfix 折叠批次/最终为单次通道，跳过批次相关判据，直接要求最终（唯一一次）E2E。
        if (!state.finalTestRowComplete) {
          exitFollowup(
            '【流程门禁】（R11 hotfix 折叠通道）QE 已通过，但测试工程师尚未执行集成测试。请先调用 project-manager 分派 test-engineer 执行一次集成测试 + E2E（--scope=final 语义，无需区分批次）。',
          );
        }
        if (state.finalTestRowComplete && !state.finalE2ePassed) {
          exitFollowup(
            '【流程门禁】（R11 hotfix 折叠通道）测试记录已完成，但 E2E 门禁未通过。请由 test-engineer 运行 `node .cursor/scripts/e2e-run.mjs --scope=final --baseline=<requirement-list.md 或热修影响面>`；`gatePassed` 为 true 前禁止宣告完成。',
          );
        }
      } else {
        // 全量模式：批次 E2E → R14 接口 → R17 对账 → 批次集成测试 → 最终 E2E → 最终整体集成测试。
        if (state.batchTestRowComplete && !state.batchE2ePassed) {
          exitFollowup(
            '【流程门禁】本批次测试记录已完成，但批次 E2E 未通过。请由 test-engineer 运行 `node .cursor/scripts/e2e-run.mjs --scope=batch --required-ids=<本批次P0>`；未通过前不得推进下一批次。',
          );
        }
        if (state.batchTestRowComplete && state.batchE2ePassed && !state.batchApiReportPresent) {
          exitFollowup(
            '【流程门禁】（R14）本批次集成测试记录与批次 E2E 均已完成，但测试报告缺少非空的「## 接口测试报告」章节。开发窗口批次集成测试阶段必须做接口测试：请由 test-engineer 补做接口测试并在测试报告补全「## 接口测试报告」章节（须含实际用例数据行）后再推进。若本项目确无对外接口，须由 system-architect 在 gated-artifacts.json 声明 apiTestApplicability:"n/a" 且项目经理在 process.md「## 用户确认记录」补一行接口测试豁免确认，方可豁免本判据。',
          );
        }
        if (state.batchTestRowComplete && state.batchE2ePassed && !state.batchStorageReconPresent) {
          exitFollowup(
            '【流程门禁】（R17）本批次集成测试记录与批次 E2E 均已完成，但存储对账机读判据未满足。请由 test-engineer 在测试报告补全非空「## 存储对账记录」：须含适用分类型行（未豁免 R14 须含接口+非「不适用」介质行；未豁免 E2E 须含 E2E+非「不适用」介质行；至少一条真实对账适用行）；每行「关联任务包/对账方式/预期存储结果/实际存储结果/是否通过」非空；「存储介质」为数据库/文件/缓存/对象存储/其他/不适用（「其他」须备注具体系统；「不适用」仅用于无写入任务包留痕且须备注理由，不计入分类型真实对账）；且进度列表中已完成批次测试的任务包编号须全部出现在对账「关联任务包」列（见 `.cursor/harness/spec/mechanical-gates.md` §8.3）。若本项目确无业务数据持久化，须由 system-architect 在 gated-artifacts.json 声明 storageReconciliationApplicability:"n/a" 且项目经理在 process.md「## 用户确认记录」补一行存储对账豁免确认，方可豁免本判据。',
          );
        }
        if (!state.batchTestComplete) {
          exitFollowup(
            '【流程门禁】本批次 QE 已通过，但测试工程师尚未执行批次集成测试（含批次 E2E、接口测试报告与存储对账）。请先调用 project-manager 分派 test-engineer 做批次集成测试。',
          );
        }
        if (state.finalTestRequired) {
          if (state.finalTestRowComplete && !state.finalE2ePassed) {
            exitFollowup(
              '【流程门禁】最终测试记录已完成，但最终 E2E 未通过。请由 test-engineer 运行 `node .cursor/scripts/e2e-run.mjs --scope=final --baseline=<requirement-list.md>`；未通过前禁止宣告完成。',
            );
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
    failOpenAllow('runtime', err, lib);
  }
}

main();
