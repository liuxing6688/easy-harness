/**
 * 门禁域：dispatch — R13 角色派发门禁（checkRoleDispatchGate）、parseWorkflowState（stop 门禁状态机）。
 *
 * 主要消费方：gate-role-sequence、gate-stop-workflow。
 * 修改 ROLE_GATE 分支或 state 字段时须同步 mechanical-gates.md §8.1/§8.2 与场景回归。
 * 域对照见 ./README.md。
 */
import {
  readProcessMd,
  parseProcessFrontmatter,
  isProcessBlocked,
  getDeclaredWorkflowMode,
  getWorkflowMode,
  LITE_WORKFLOW_MODES,
  checkLiteModeConfirmed,
  hasValidDispatchPlan,
} from './core.mjs';
import {
  checkRequirementReady,
  checkHotfixDesign,
  checkSingleTaskPreconditions,
} from './iteration.mjs';
import {
  checkDesignReady,
  checkDesignReviewClean,
  checkTechSelectionConfirmed,
  checkHotfixP0Impact,
  checkIsomorphicModuleSectionReady,
} from './design.mjs';
import {
  extractQeDispatchTaskPacks,
  getDevLineStatusForTaskPack,
  checkQeClean,
  checkLintClean,
  checkStaticScanClean,
  isApiTestExempt,
  isStorageReconciliationExempt,
  isLintExempt,
  isDupCheckExempt,
  isSecurityScanExempt,
  isStartupSmokeExempt,
  checkStartupSmoke,
  checkE2eGate,
  checkBatchApiTestReport,
  checkBatchStorageReconciliationReport,
} from './qe.mjs';
import { roleProgressStats, testEngineerStats } from './role-path.mjs';

/**
 * R13：按角色校验门禁链前置条件是否满足。
 * @param {string} role agent slug（如 `development-engineer`）
 * @returns {{ ok: boolean, reason: string, message?: string }}
 */
export function checkRoleDispatchGate(role) {
  const content = readProcessMd();
  if (!content) return { ok: true, reason: 'no-process-yet' };

  const fm = parseProcessFrontmatter(content);
  if (fm.cancelled === true) {
    return {
      ok: false,
      reason: 'cancelled',
      message: '该流程已被用户取消终止（不可逆，R10），不得再对其发起任何角色 Task；请发起新流程/迭代。',
    };
  }
  if (isProcessBlocked(content)) {
    return {
      ok: false,
      reason: 'blocked',
      message: 'process.md 处于阻塞状态，须等待用户确认后才能继续分派。',
    };
  }

  const declared = getDeclaredWorkflowMode(content);
  const mode = getWorkflowMode(content);
  // R20：声明轻量模式但未确认时，对受门禁角色大声拒绝（PM/RA 仍可继续分诊与留痕）
  if (
    LITE_WORKFLOW_MODES.includes(declared) &&
    role !== 'project-manager' &&
    role !== 'requirements-analyst'
  ) {
    const lite = checkLiteModeConfirmed(content);
    if (!lite.ok) {
      return { ok: false, reason: lite.reason, message: lite.message };
    }
  }

  switch (role) {
    case 'system-architect': {
      if (mode === 'hotfix' || mode === 'docs-only') return { ok: true, reason: `${mode}-exempt` };
      // R37：single-task 须先证明「这是增量」——基线设计存在 + 增量范围四维已声明。
      // 置于需求就绪校验之前：范围没界定清楚，需求澄清的边界本身就无从判断。
      if (mode === 'single-task') {
        const st = checkSingleTaskPreconditions(content);
        if (!st.ok) return st;
      }
      const r = checkRequirementReady();
      return r.ok
        ? { ok: true, reason: 'checked' }
        : {
            ok: false,
            reason: r.reason,
            message:
              r.message ??
              (r.reason === 'no-implicit-requirement-record'
                ? '需求说明书「6. 隐性需求确认记录」缺少真实数据行（R19），需求分析师须先将苏格拉底式追问挖出的隐性要点（或合规的「排查结论」）落表，不得发起 system-architect。'
                : r.reason === 'invalid-implicit-requirement-record-header'
                  ? 'R19：需求说明书「6. 隐性需求确认记录」表头须含类别、要点、用户确认摘要、关联需求/§7 追溯、状态、影响/决策点，不得发起 system-architect。'
                  : r.reason === 'incomplete-implicit-requirement-record'
                    ? 'R19：隐性需求确认记录每条真实数据行均须完整填写，不得发起 system-architect。'
                    : r.reason === 'invalid-implicit-requirement-record-enum'
                      ? 'R19：隐性需求确认记录的类别或状态不在允许枚举内，不得发起 system-architect。'
                      : r.reason === 'missing-implicit-requirement-trace'
                        ? 'R19：每条隐性需求确认记录须关联 requirement-list.md 的 R-编号并引用 §7 追溯，不得发起 system-architect。'
                        : r.reason === 'incomplete-pending-assumption-decision'
                          ? 'R19：待决假设须在影响/决策点中写明责任方与最晚决策点，不得发起 system-architect。'
                          : '需求成果物未就绪（requirement-spec.md/requirement-list.md 缺失，或用户确认记录为空），不得发起 system-architect。'),
          };
    }
    case 'requirement-reviewer': {
      const r = checkDesignReady();
      if (!r.ok) {
        return {
          ok: false,
          reason: r.reason,
          message:
            '设计成果物未就绪（detail-design-spec.md/develop-task-list.md 缺失），不得发起 requirement-reviewer 设计审核。',
        };
      }
      if (mode !== 'hotfix' && mode !== 'docs-only') {
        // R37：single-task 豁免 R26 技术选型确认——技术栈在基线项目里已经过 AskQuestion
        // 确认并落痕，增量迭代不换栈，再要求一次确认只是重复劳动。**R25 同构模块识别
        // 不豁免**：增量最容易「复制既有实现改两行」，正是 R25 要拦的场景。
        if (mode !== 'single-task') {
          const tech = checkTechSelectionConfirmed(content);
          if (!tech.ok) {
            return {
              ok: false,
              reason: tech.reason,
              message: tech.message,
            };
          }
        }
        // R25：非 stub 设计文档须已排查同构模块并声明共享 primitive
        const iso = checkIsomorphicModuleSectionReady();
        if (!iso.ok) {
          return {
            ok: false,
            reason: iso.reason,
            message: iso.message,
          };
        }
      }
      return { ok: true, reason: 'checked' };
    }
    case 'development-engineer': {
      if (mode === 'docs-only') {
        return { ok: false, reason: 'docs-only', message: 'docs-only 模式禁止分派开发工程师。' };
      }
      if (mode === 'hotfix') {
        const h = checkHotfixDesign(content);
        if (!h.ok) {
          return {
            ok: false,
            reason: 'hotfix-design-missing',
            message: 'R9：hotfix 前置校验未通过，detail-design-spec.md 不存在，须先由 system-architect 补最小热修设计。',
          };
        }
        const p0 = checkHotfixP0Impact(content);
        if (!p0.ok) {
          return {
            ok: false,
            reason: p0.reason,
            message: p0.message,
          };
        }
      } else if (mode === 'single-task') {
        // R37：增量档——前置校验（基线设计 + 增量范围）+ 设计就绪 + 设计审核通过。
        // 豁免的只有 R26 技术选型确认；R18 设计审核一条不减。
        const st = checkSingleTaskPreconditions(content);
        if (!st.ok) return st;
        const d = checkDesignReady();
        if (!d.ok) {
          return { ok: false, reason: d.reason, message: '设计成果物未就绪，不得发起开发工程师。' };
        }
        const clean = checkDesignReviewClean();
        if (!clean.ok) {
          return {
            ok: false,
            reason: clean.reason,
            message:
              clean.message ??
              '设计问题清单存在未解决问题或 R18 机读未通过，设计审核未通过，不得发起开发工程师。',
          };
        }
      } else {
        const tech = checkTechSelectionConfirmed(content);
        if (!tech.ok) {
          return {
            ok: false,
            reason: tech.reason,
            message: tech.message,
          };
        }
        const d = checkDesignReady();
        if (!d.ok) {
          return { ok: false, reason: d.reason, message: '设计成果物未就绪，不得发起开发工程师。' };
        }
        const clean = checkDesignReviewClean();
        if (!clean.ok) {
          return {
            ok: false,
            reason: clean.reason,
            message:
              clean.message ??
              '设计问题清单存在未解决问题或 R18 机读未通过，设计审核未通过，不得发起开发工程师。',
          };
        }
      }
      if (!hasValidDispatchPlan(content)) {
        return { ok: false, reason: 'no-dispatch-plan', message: '尚无项目经理有效分派计划，不得发起开发工程师。' };
      }
      return { ok: true, reason: 'checked' };
    }
    case 'quality-engineer': {
      const state = parseWorkflowState(content);
      if (!(state.devComplete || state.devInProgress)) {
        return {
          ok: false,
          reason: 'dev-not-started',
          message: '开发工程师尚未产出/尚未标记执行状态，不得发起质量工程师。',
        };
      }
      const qePacks = extractQeDispatchTaskPacks(content);
      if (qePacks.length === 0) {
        return {
          ok: false,
          reason: 'qe-missing-task-packs',
          message:
            '分派 quality-engineer 前，须在「## 当前分派计划」或「## 待派发角色列表」标明本次审查的任务包编号（分派角色/角色列为 quality-engineer）。',
        };
      }
      const incomplete = [];
      for (const tid of qePacks) {
        const status = getDevLineStatusForTaskPack(content, tid);
        if (status !== 'complete') {
          const label =
            status === 'inProgress'
              ? '正在执行'
              : status === 'other'
                ? '非执行完成'
                : '未找到开发行';
          incomplete.push(`${tid}（${label}）`);
        }
      }
      if (incomplete.length > 0) {
        return {
          ok: false,
          reason: 'qe-dev-line-not-complete',
          message: `质量工程师对应开发线尚未「执行完成」：${incomplete.join('、')}。须等开发完成并更新进度后再派发 QE。`,
        };
      }
      return { ok: true, reason: 'checked' };
    }
    case 'test-engineer': {
      const state = parseWorkflowState(content);
      if (!state.qeComplete) {
        return { ok: false, reason: 'qe-not-complete', message: '质量审核尚未全部通过，不得发起测试工程师。' };
      }
      const qeClean = checkQeClean();
      if (!qeClean.ok) {
        return { ok: false, reason: qeClean.reason, message: '质量报告存在未解决高/中严重等级问题或质量判定未通过，不得发起测试工程师。' };
      }
      const lintClean = checkLintClean(content);
      if (!lintClean.ok) {
        // R34/R38：执行证明未通过或工具不可用时，判据自带精确文案，不可被笼统的
        // 「请整改 lint 违规」覆盖——那正是把环境问题误导成质量问题的旧行为。
        return { ok: false, reason: lintClean.reason, message: lintClean.message ?? 'R15：编程规范（lint）门禁未通过（.lint-result.json 缺失或 gatePassed≠true），QE 阶段须运行 `node .cursor/scripts/lint-run.mjs` 并整改至通过；确无可用 linter 时须走「架构师声明 lintApplicability:"n/a" + 用户确认」双要素豁免。不得发起测试工程师。' };
      }
      const staticScanClean = checkStaticScanClean(content);
      if (!staticScanClean.ok) {
        return { ok: false, reason: staticScanClean.reason, message: staticScanClean.message ?? 'R16：静态代码质量门禁未通过（.static-scan-result.json 缺失或重复代码/安全扫描任一 gatePassed≠true），QE 阶段须运行 `node .cursor/scripts/static-scan-run.mjs` 并整改至通过；确无法运行时须分别走「架构师声明 dupCheckApplicability/securityScanApplicability:"n/a" + 用户确认」双要素豁免。不得发起测试工程师。' };
      }
      return { ok: true, reason: 'checked' };
    }
    default:
      // project-manager / requirements-analyst 及未识别角色：无强前置或不可机械判定，放行
      return { ok: true, reason: 'not-gated' };
  }
}

/** 从 process.md 解析流程状态（按开发线聚合，支持并行批次；含批次/最终 E2E 状态与 R11 hotfix 折叠） */
export function parseWorkflowState(content) {
  if (!content) {
    return {
      blocking: false,
      cancelled: false,
      devInProgress: false,
      devComplete: false,
      hasQeRecord: false,
      qeComplete: false,
      testComplete: false,
      batchTestRowComplete: false,
      finalTestRowComplete: false,
      batchE2ePassed: false,
      finalE2ePassed: false,
      apiTestExempt: false,
      batchApiReportPresent: false,
      storageReconciliationExempt: false,
      batchStorageReconPresent: false,
      lintExempt: false,
      lintPassed: false,
      lintReason: 'no-process',
      staticScanExempt: false,
      staticScanPassed: false,
      staticScanReason: 'no-process',
      startupSmokeExempt: false,
      startupSmokePassed: false,
      startupSmokeReason: 'no-process',
      batchE2eReason: 'no-process',
      finalE2eReason: 'no-process',
      toolUnavailableGates: [],
      execProofFailedGates: [],
      batchTestComplete: false,
      finalTestComplete: false,
      finalTestRequired: false,
      foldedTestChannel: false,
      phase: null,
      workflowMode: 'full',
    };
  }

  const fm = parseProcessFrontmatter(content);
  const blocking = fm.blocking === true || isProcessBlocked(content);
  const cancelled = fm.cancelled === true;
  const workflowMode = getWorkflowMode(content);
  const isHotfix = workflowMode === 'hotfix';
  const isDocsOnly = workflowMode === 'docs-only';
  // **R37**：`single-task` 与 `hotfix` 同属「折叠测试通道」——只跑一轮集成测试 + E2E，
  // 不再区分批次 / 最终。两者的**区别**在折叠通道里保留哪些判据：
  //   - hotfix（R11）：跳过 R14 接口测试与 R17 存储对账（热修不新增接口/存储面）；
  //   - single-task（R37）：**保留** R14 与 R17（增量功能常常新增接口与写入路径），
  //     只省掉「同一批改动测两遍」的冗余。
  const isSingleTask = workflowMode === 'single-task';
  const foldedTestChannel = isHotfix || isSingleTask;

  const dev = roleProgressStats(content, '开发工程师');
  const qe = roleProgressStats(content, '质量工程师');
  const te = testEngineerStats(content);

  const devInProgress = dev.inProgress > 0;
  const devComplete = dev.total > 0 && dev.complete === dev.total && dev.inProgress === 0;
  const hasQeRecord = qe.total > 0;
  const qeComplete = qe.total > 0 && qe.complete === qe.total && qe.inProgress === 0;

  const batchTestRowComplete = te.batch.total > 0 && te.batch.complete === te.batch.total && te.batch.inProgress === 0;
  const finalTestRowComplete = te.final.total > 0 && te.final.complete === te.final.total && te.final.inProgress === 0;

  // R34/R38：E2E 也走统一判据外壳（验签 → 工具不可用 → gatePassed），
  // 不再直接读 `gatePassed`。
  const batchE2e = checkE2eGate('batch');
  const finalE2e = checkE2eGate('final');
  const batchE2ePassed = batchE2e.ok;
  const finalE2ePassed = finalE2e.ok;

  // R14：开发窗口批次集成测试阶段必须做接口测试，测试报告须含「## 接口测试报告」章节；
  // 无对外接口项目经架构师声明 + 用户确认后豁免（batchApiReportPresent 视为满足）。
  const apiTestExempt = isApiTestExempt(content);
  const batchApiReportPresent = apiTestExempt || checkBatchApiTestReport().ok;

  // R17：开发窗口批次集成测试阶段必须做业务数据存储对账；无业务持久化项目经双要素豁免后
  // batchStorageReconPresent 视为满足（分类型行/存储介质列机读见 checkBatchStorageReconciliationReport）。
  const storageReconciliationExempt = isStorageReconciliationExempt(content);
  const batchStorageReconPresent =
    storageReconciliationExempt || checkBatchStorageReconciliationReport(content).ok;

  // R15：编程规范（lint）硬门禁——QE 阶段须实际运行 lint 且 gatePassed=true（机读产物
  // test-results/qe/.lint-result.json）。docs-only 无开发窗口视为满足；确无可用 linter 项目
  // 经「架构师声明 lintApplicability:"n/a" + 用户确认」双要素豁免后视为满足（防单方面弱化，R12）。
  const lintExempt = isLintExempt(content);
  const lint = checkLintClean(content);
  const lintPassed = lint.ok;

  // R16：静态代码质量硬门禁（重复代码 DRY + 安全静态扫描）——QE 阶段须实际运行且
  // 两项子检查均 gatePassed=true（机读产物 test-results/qe/.static-scan-result.json）。
  // docs-only 无开发窗口视为满足；重复代码/安全扫描可分别经「架构师声明
  // dupCheckApplicability|securityScanApplicability:"n/a" + 用户确认」双要素豁免后视为满足
  // （防单方面弱化，R12）。staticScanExempt 仅当两项子检查均处于豁免状态时为 true。
  const dupCheckExempt = isDupCheckExempt(content);
  const securityScanExempt = isSecurityScanExempt(content);
  const staticScanExempt = dupCheckExempt && securityScanExempt;
  const staticScan = checkStaticScanClean(content);
  const staticScanPassed = staticScan.ok;

  // R32：生产启动冒烟硬门禁——测试工程师须实际跑 startup-smoke-run.mjs（干净启动 +
  // 强杀后再启动）并取得 gatePassed=true。与 R14/R17 不同，本判据**同时**并入批次与最终
  // 两级（含 hotfix 折叠通道）：复盘中两次热修恰恰都是启动缺陷，折叠通道更不能少这道。
  const startupSmokeExempt = isStartupSmokeExempt(content);
  const startupSmoke = checkStartupSmoke(content);
  const startupSmokePassed = isDocsOnly ? true : startupSmoke.ok;
  const startupSmokeReason = startupSmoke.reason;

  // R11 / R37：折叠通道不要求独立的批次集成测试环节，直接以「最终」判据为准
  // （test-engineer 以 --scope=final 语义运行一次）。
  const batchTestComplete = foldedTestChannel
    ? true
    : batchTestRowComplete &&
      batchE2ePassed &&
      batchApiReportPresent &&
      batchStorageReconPresent &&
      startupSmokePassed;

  // R37 关键差异：single-task 的折叠通道把 R14/R17 **并入最终判据**。
  // hotfix 之所以能跳过，是因为热修不新增接口/存储面；增量功能没有这个前提，
  // 若照抄 R11 就等于「小改动可以不做接口测试和存储对账」——那是放松（R12）。
  const finalTestComplete = isDocsOnly
    ? true
    : finalTestRowComplete &&
      finalE2ePassed &&
      startupSmokePassed &&
      (isSingleTask ? batchApiReportPresent && batchStorageReconPresent : true);

  const finalTestRequired = isDocsOnly
    ? false
    : foldedTestChannel
      ? devComplete && qeComplete
      : devComplete && qeComplete && batchTestComplete;

  // R38：本轮哪些门禁是因「工具不可用」而失败（供 stop 门禁选择正确的处置文案）。
  // R34：哪些门禁是因「执行证明未通过」而失败（伪造/未签发/被改动）。
  const gateVerdicts = [
    ['R15 lint', lint],
    ['R16 静态扫描', staticScan],
    ['R32 启动冒烟', startupSmoke],
    ['批次 E2E', batchE2e],
    ['最终 E2E', finalE2e],
  ];
  const toolUnavailableGates = gateVerdicts
    .filter(([, v]) => v?.toolUnavailable === true)
    .map(([label]) => label);
  const execProofFailedGates = gateVerdicts
    .filter(([, v]) => typeof v?.reason === 'string' && v.reason.startsWith('exec-proof-'))
    .map(([label]) => label);

  return {
    blocking,
    cancelled,
    devInProgress,
    devComplete,
    hasQeRecord,
    qeComplete,
    testComplete: finalTestComplete, // 兼容旧字段名
    batchTestRowComplete,
    finalTestRowComplete,
    batchE2ePassed,
    finalE2ePassed,
    apiTestExempt,
    batchApiReportPresent,
    storageReconciliationExempt,
    batchStorageReconPresent,
    lintExempt,
    lintPassed,
    lintReason: lint.reason,
    staticScanExempt,
    staticScanPassed,
    staticScanReason: staticScan.reason,
    startupSmokeExempt,
    startupSmokePassed,
    startupSmokeReason,
    batchE2eReason: batchE2e.reason,
    finalE2eReason: finalE2e.reason,
    toolUnavailableGates,
    execProofFailedGates,
    batchTestComplete,
    finalTestComplete,
    finalTestRequired,
    foldedTestChannel,
    phase: fm.phase ?? null,
    workflowMode,
  };
}


