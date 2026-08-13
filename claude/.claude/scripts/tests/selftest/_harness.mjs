/**
 * 门禁单元自测共享脚手架（fixture / assert / 快照还原）。
 *
 * 各规则套件从本模块导入 `test` / `fixtureProcess` / `cleanup` 等，勿在套件内重复造轮子。
 * 跨套件常量与 Markdown 工厂放 `./_fixtures.mjs`。
 * 修改本文件后跑：`node .claude/scripts/gate-selftest.mjs`。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  isGatedDevPath,
  parseWorkflowState,
  checkIterationArtifacts,
  checkHotfixDesign,
  isCancelledProcessFile,
  checkRoleDispatchGate,
  checkBatchApiTestReport,
  isApiTestExempt,
  checkBatchStorageReconciliationReport,
  isStorageReconciliationExempt,
  isE2eExempt,
  isAlternativeE2eStartupCommand,
  isAlternativeE2eStartupExempt,
  checkTeAlternativeE2eStartup,
  isStartupSmokeExempt,
  checkStartupSmoke,
  readStartupSmokeResult,
  hasUiExpectationConfirmation,
  checkUiExpectationConfirmed,
  isLintExempt,
  readLintResult,
  checkLintClean,
  isDupCheckExempt,
  isSecurityScanExempt,
  readStaticScanResult,
  checkStaticScanClean,
  hasUnresolvedIssues,
  isProcessBlocked,
  checkDesignProblemListStructure,
  checkRequirementCoverageMatrix,
  extractP0RequirementIds,
  checkDesignReviewClean,
  checkTechSelectionConfirmed,
  checkDesignReviewConclusion,
  checkHotfixP0Impact,
  checkHotfixP0InterfaceStorageMention,
  recordHotfixP0SoftReminder,
  recordFailOpenEvent,
  hasResolvedDesignIssues,
  extractQeDispatchTaskPacks,
  getDevLineStatusForTaskPack,
  ROOT_CONVERSATION_STATE,
  DISPATCHED_ROLES_STATE,
  recordRootConversationId,
  checkLiteModeConfirmed,
  hasLiteModeConfirmation,
  LITE_WORKFLOW_MODES,
  getWorkflowMode,
  getDeclaredWorkflowMode,
  readRootConversationId,
  isRootConversationCaller,
  recordDispatchedRole,
  readRecentlyDispatchedRoles,
  isGatedRoleArtifactPath,
  expectedRolesForPath,
  checkRolePathPermission,
  collectActiveRoleSlugs,
  checkReconEvidenceRef,
  excerptInDesignAnchorWindow,
  extractDesignSectionWindow,
  checkIsomorphicModuleSection,
  checkIsomorphicModuleSectionReady,
  // R28/R29/R30/R31 与 R5/R6 加强项
  decodeTextBuffer,
  readTextFileSafe,
  readJsonFileSafe,
  parseProcessFrontmatter,
  classifyHarnessSelfGovernedPath,
  harnessSelfGovernedVerdict,
  isHarnessStatePath,
  classifyShellWriteIntent,
  extractShellPathCandidates,
  hasToolchainInstallApproval,
  hashCommandForApproval,
  TOOLCHAIN_APPROVAL_MARKER,
  readRootConversationRecord,
  isRootConversationBaselineStale,
  isRootConversationBaselineExpired,
  inspectIdentityBaseline,
  parseRollbackCounts,
  checkRollbackLimit,
  getRollbackLimit,
  // 出厂模板 ↔ 出厂门禁一致性（templates-vs-gates）
  extractSection,
  extractSectionAll,
  getIterationRound,
  mentionsIterationRound,
  sectionHasDataRow,
  splitTableRow,
  isTableSeparatorLine,
  parseMarkdownTables,
  checkImplicitRequirementRecord,
  isGatedArtifactsConfigPath,
  // R34 执行证明 / R35 阻塞释放证据 / R36 判定期异常 / R37 增量档 / R38 工具不可用
  verifyExecutionProof,
  attachExecutionProof,
  issueExecutionProof,
  detectRunnerExecProofKind,
  getExecProofPolicy,
  canonicalJson,
  buildGateExceptionVerdict,
  EXEC_PROOF_LEDGER,
  EXEC_PROOF_PENDING_DIR,
  checkE2eGate,
  evaluateGateArtifact,
  hasSubstantiveBlockingReason,
  hasPendingGateExceptionEvent,
  hasBlockingDecisionTrace,
  checkBlockingReleaseEvidence,
  findCorroboratedGateExceptionEvent,
  consumeGateExceptionRelease,
  readGateExceptionLedger,
  GATE_EXCEPTION_LEDGER,
  getGateExceptionPolicy,
  checkArtifactFreshness,
  latestSourceChangeMs,
  resolveGateRepairPaths,
  isActiveProcessFilePath,
  parseIncrementScope,
  checkIncrementScopeDeclared,
  checkSingleTaskBaseDesign,
  checkSingleTaskPreconditions,
  INCREMENT_SCOPE_DIMENSIONS,
  isCompatOnlySchemaChange,
  checkIncrementCompatRegressionReport,
  // F-09 增量档交叉校验 / F-22 台账反向对账
  checkIncrementScopeRequirementCrossCheck,
  extractRoundRequirementIds,
  getIncrementScopeYesRows,
  findOrphanGateExceptionLedgerEntries,
  checkGateExceptionLedgerReconciled,
} from '../../../hooks/workflow-gate-lib.mjs';
import {
  resolveLintCommand,
  computeLintGate,
  detectStackFromFileNames,
  buildLintRemediation,
  isLintNotConfigured,
  STACK_MANIFESTS,
  STACK_LINT_COMMANDS,
} from '../../lint-run-lib.mjs';
import {
  resolveStartupCommand,
  computeStartupSmokeGate,
  evaluateStartupSmokeResult,
} from '../../startup-smoke-lib.mjs';
import {
  resolveDupCommand,
  resolveSecurityCommand,
  computeSubGate,
  computeStaticScanGate,
  parseDupThreshold,
  extractDupPercentage,
  evaluateDuplicationReport,
  DEFAULT_DUP_THRESHOLD,
} from '../../static-scan-run-lib.mjs';
import {
  classifyCommandFailure,
  applyToolAvailability,
} from '../../tool-availability-lib.mjs';
import {
  signFixtureArtifact,
  snapshotExecProofState,
  restoreExecProofState,
} from '../exec-proof-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
export const FIXTURE_ROOT = path.join(PROJECT_ROOT, 'test-results/.gate-selftest');

export const state = { passCount: 0, failCount: 0, failures: [] };

export function test(name, fn) {
  try {
    fn();
    state.passCount += 1;
    console.log(`  ok   - ${name}`);
  } catch (err) {
    state.failCount += 1;
    state.failures.push({ name, error: err.message });
    console.error(`  FAIL - ${name}: ${err.message}`);
  }
}

/**
 * 删除夹具目录（Windows 抗抖）。
 *
 * 每个用例都要重建 FIXTURE_ROOT，Windows 上刚写完的文件常仍被杀毒/索引/文件系统缓存短暂持有，
 * 裸 `rmSync(recursive)` 会随机抛 `ENOTEMPTY` / `EPERM`，表现为「每次跑失败用例不同」的
 * 假失败（曾把它们误读为判据回归）。`maxRetries` 让 Node 内部退避重试，仍失败则再退避一轮。
 */
function removeFixtureRoot() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
      return;
    } catch (err) {
      if (attempt === 2) throw err;
    }
  }
}

export function fixtureProcess(processContent, extraFiles = {}) {
  removeFixtureRoot();
  const processAbsPath = path.join(FIXTURE_ROOT, 'docs/process/process.md');
  fs.mkdirSync(path.dirname(processAbsPath), { recursive: true });
  fs.writeFileSync(processAbsPath, processContent, 'utf8');
  for (const [rel, content] of Object.entries(extraFiles)) {
    const abs = path.join(FIXTURE_ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  process.env.HARNESS_PROCESS_PATH = path
    .relative(PROJECT_ROOT, processAbsPath)
    .replace(/\\/g, '/');
  return processContent;
}

/** 获取当前测试的 process.md 绝对路径（供测试读取文件用） */
export function getTestProcessPath() {
  return path.join(FIXTURE_ROOT, 'docs/process/process.md');
}

export function cleanup() {
  removeFixtureRoot();
  delete process.env.HARNESS_PROCESS_PATH;
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
}

const LINT_RESULT_PATH = path.join(PROJECT_ROOT, 'test-results/qe/.lint-result.json');
let _lintSnapshot;
export function snapshotLintResult() {
  _lintSnapshot = fs.existsSync(LINT_RESULT_PATH) ? fs.readFileSync(LINT_RESULT_PATH, 'utf8') : null;
}
export function restoreLintResult() {
  if (_lintSnapshot === null || _lintSnapshot === undefined) fs.rmSync(LINT_RESULT_PATH, { force: true });
  else fs.writeFileSync(LINT_RESULT_PATH, _lintSnapshot, 'utf8');
}
/**
 * **R34 新鲜度**：真实运行器写的产物一定带 `executedAt`/`capturedAt`（缺失即判不新鲜），
 * 故夹具默认补一个「刚刚」的时间戳。用例要构造「过期产物」时显式传 `executedAt`。
 */
function withFreshStamp(result) {
  if (result && typeof result === 'object' && !result.executedAt && !result.capturedAt) {
    result.executedAt = new Date().toISOString();
  }
  return result;
}

/**
 * 写 lint 机读产物。默认按 **R34** 附加**有效**执行证明（走真实签发+落签实现），
 * 使既有「gatePassed=true ⇒ 门禁通过」类用例仍测的是判据本身而非验签缺失。
 * 需要构造「无执行证明」场景时传 `{ sign: false }`。
 */
export function writeLintResult(result, { sign = true } = {}) {
  fs.mkdirSync(path.dirname(LINT_RESULT_PATH), { recursive: true });
  withFreshStamp(result);
  if (sign) signFixtureArtifact('lint', result);
  fs.writeFileSync(LINT_RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
export function clearLintResult() {
  fs.rmSync(LINT_RESULT_PATH, { force: true });
}

const STATIC_SCAN_RESULT_PATH = path.join(PROJECT_ROOT, 'test-results/qe/.static-scan-result.json');
let _staticScanSnapshot;
export function snapshotStaticScanResult() {
  _staticScanSnapshot = fs.existsSync(STATIC_SCAN_RESULT_PATH)
    ? fs.readFileSync(STATIC_SCAN_RESULT_PATH, 'utf8')
    : null;
}
export function restoreStaticScanResult() {
  if (_staticScanSnapshot === null || _staticScanSnapshot === undefined) {
    fs.rmSync(STATIC_SCAN_RESULT_PATH, { force: true });
  } else {
    fs.writeFileSync(STATIC_SCAN_RESULT_PATH, _staticScanSnapshot, 'utf8');
  }
}
export function writeStaticScanResult(result, { sign = true } = {}) {
  fs.mkdirSync(path.dirname(STATIC_SCAN_RESULT_PATH), { recursive: true });
  withFreshStamp(result);
  if (sign) signFixtureArtifact('static-scan', result);
  fs.writeFileSync(STATIC_SCAN_RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
export function clearStaticScanResult() {
  fs.rmSync(STATIC_SCAN_RESULT_PATH, { force: true });
}

// R32：生产启动冒烟机读产物
const STARTUP_SMOKE_RESULT_PATH = path.join(
  PROJECT_ROOT,
  'test-results/e2e/.startup-smoke-result.json',
);
let _startupSmokeSnapshot;
export function snapshotStartupSmokeResult() {
  _startupSmokeSnapshot = fs.existsSync(STARTUP_SMOKE_RESULT_PATH)
    ? fs.readFileSync(STARTUP_SMOKE_RESULT_PATH, 'utf8')
    : null;
}
export function restoreStartupSmokeResult() {
  if (_startupSmokeSnapshot === null || _startupSmokeSnapshot === undefined) {
    fs.rmSync(STARTUP_SMOKE_RESULT_PATH, { force: true });
  } else {
    fs.writeFileSync(STARTUP_SMOKE_RESULT_PATH, _startupSmokeSnapshot, 'utf8');
  }
}
export function writeStartupSmokeResult(result, { sign = true } = {}) {
  fs.mkdirSync(path.dirname(STARTUP_SMOKE_RESULT_PATH), { recursive: true });
  withFreshStamp(result);
  if (sign) signFixtureArtifact('startup-smoke', result);
  fs.writeFileSync(STARTUP_SMOKE_RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
/** 写一份「两段皆过、时间新鲜」的冒烟证据（默认按 R34 落真实签名） */
export function writeStartupSmokePassResult(overrides = {}, options) {
  writeStartupSmokeResult(
    {
      gatePassed: true,
      reason: 'passed',
      command: 'npm run start',
      commandSource: 'package.json.scripts.start',
      cleanStart: { passed: true, exited: false, exitCode: null },
      restartAfterKill: { passed: true, exited: false, exitCode: null },
      capturedAt: new Date().toISOString(),
      ...overrides,
    },
    options,
  );
}
export function clearStartupSmokeResult() {
  fs.rmSync(STARTUP_SMOKE_RESULT_PATH, { force: true });
}

// 批次/最终 E2E 机读产物（**F-06** 门禁侧 requiredIds 复核用）
const E2E_RESULT_PATHS = {
  batch: path.join(PROJECT_ROOT, 'test-results/e2e/.e2e-batch-result.json'),
  final: path.join(PROJECT_ROOT, 'test-results/e2e/.e2e-final-result.json'),
};
const _e2eSnapshots = {};
export function snapshotE2eResults() {
  for (const [scope, file] of Object.entries(E2E_RESULT_PATHS)) {
    _e2eSnapshots[scope] = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }
}
export function restoreE2eResults() {
  for (const [scope, file] of Object.entries(E2E_RESULT_PATHS)) {
    const snap = _e2eSnapshots[scope];
    if (snap === null || snap === undefined) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, snap, 'utf8');
  }
}
/**
 * 写 E2E 机读产物。默认按 **R34** 落**有效**签名，使 F-06 用例测的是
 * `requiredIds` 复核本身，而不是验签缺失（后者已有 r34 套件覆盖）。
 */
export function writeE2eResult(scope, result, { sign = true } = {}) {
  fs.mkdirSync(path.dirname(E2E_RESULT_PATHS[scope]), { recursive: true });
  withFreshStamp(result);
  if (sign) signFixtureArtifact(scope === 'final' ? 'e2e-final' : 'e2e-batch', result);
  fs.writeFileSync(E2E_RESULT_PATHS[scope], `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
/** 写一份「全过、时间新鲜」的 E2E 证据；`requiredIds` 由用例指定 */
export function writeE2ePassResult(scope, requiredIds, overrides = {}, options) {
  writeE2eResult(
    scope,
    {
      scope,
      gatePassed: true,
      allPassed: true,
      requiredIds,
      waivedIds: [],
      missingIds: [],
      failedIds: [],
      playwrightExitCode: 0,
      ...overrides,
    },
    options,
  );
}
export function clearE2eResult(scope) {
  fs.rmSync(E2E_RESULT_PATHS[scope], { force: true });
}

let _rootConversationSnapshot;
export function snapshotRootConversationState() {
  _rootConversationSnapshot = fs.existsSync(ROOT_CONVERSATION_STATE)
    ? fs.readFileSync(ROOT_CONVERSATION_STATE, 'utf8')
    : null;
}
export function restoreRootConversationState() {
  if (_rootConversationSnapshot === null || _rootConversationSnapshot === undefined) {
    fs.rmSync(ROOT_CONVERSATION_STATE, { force: true });
  } else {
    fs.writeFileSync(ROOT_CONVERSATION_STATE, _rootConversationSnapshot, 'utf8');
  }
}
export function clearRootConversationState() {
  fs.rmSync(ROOT_CONVERSATION_STATE, { force: true });
}
/** 以指定 id 与时间戳直接写入基准（R5 TTL 自愈用例需要构造陈旧基准） */
export function writeRootConversationState(rootConversationId, recordedAt) {
  fs.mkdirSync(path.dirname(ROOT_CONVERSATION_STATE), { recursive: true });
  const payload = { rootConversationId };
  if (recordedAt !== undefined) payload.recordedAt = recordedAt;
  fs.writeFileSync(ROOT_CONVERSATION_STATE, JSON.stringify(payload), 'utf8');
}

const RECON_DIR = path.join(PROJECT_ROOT, 'test-results/recon');
let _reconSnapshot;
export function snapshotReconDir() {
  _reconSnapshot = fs.existsSync(RECON_DIR)
    ? Object.fromEntries(
        fs.readdirSync(RECON_DIR).map((n) => [n, fs.readFileSync(path.join(RECON_DIR, n), 'utf8')]),
      )
    : null;
}
export function restoreReconDir() {
  fs.rmSync(RECON_DIR, { recursive: true, force: true });
  if (_reconSnapshot) {
    fs.mkdirSync(RECON_DIR, { recursive: true });
    for (const [n, c] of Object.entries(_reconSnapshot)) {
      fs.writeFileSync(path.join(RECON_DIR, n), c, 'utf8');
    }
  }
}
export function writeReconEvidence(name, data = {}) {
  fs.mkdirSync(RECON_DIR, { recursive: true });
  const payload = {
    command: data.command ?? 'echo recon-check',
    exitCode: data.exitCode ?? 0,
    summary: data.summary ?? 'row exists',
    capturedAt: data.capturedAt ?? '2026-01-01T00:00:00.000Z',
  };
  fs.writeFileSync(path.join(RECON_DIR, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}
export function clearReconDir() {
  fs.rmSync(RECON_DIR, { recursive: true, force: true });
}
export function ensureDefaultReconEvidence() {
  writeReconEvidence('t0-1-api.json');
  writeReconEvidence('t0-1-e2e.json');
  writeReconEvidence('t0-2-api.json');
}

let _dispatchedRolesSnapshot;
export function snapshotDispatchedRoles() {
  _dispatchedRolesSnapshot = fs.existsSync(DISPATCHED_ROLES_STATE)
    ? fs.readFileSync(DISPATCHED_ROLES_STATE, 'utf8')
    : null;
}
export function restoreDispatchedRoles() {
  if (_dispatchedRolesSnapshot === null || _dispatchedRolesSnapshot === undefined) {
    fs.rmSync(DISPATCHED_ROLES_STATE, { force: true });
  } else {
    fs.writeFileSync(DISPATCHED_ROLES_STATE, _dispatchedRolesSnapshot, 'utf8');
  }
}
export function clearDispatchedRoles() {
  fs.rmSync(DISPATCHED_ROLES_STATE, { force: true });
}

// Re-export commonly used symbols so suites can import from one place
export {
  fs, path, assert,
  isGatedDevPath, parseWorkflowState, checkIterationArtifacts, checkHotfixDesign,
  isCancelledProcessFile, checkRoleDispatchGate, checkBatchApiTestReport, isApiTestExempt,
  checkBatchStorageReconciliationReport, isStorageReconciliationExempt, isE2eExempt,
  isAlternativeE2eStartupCommand, isAlternativeE2eStartupExempt, checkTeAlternativeE2eStartup,
  isStartupSmokeExempt, checkStartupSmoke, readStartupSmokeResult,
  hasUiExpectationConfirmation, checkUiExpectationConfirmed,
  resolveStartupCommand, computeStartupSmokeGate, evaluateStartupSmokeResult,
  isLintExempt, readLintResult, checkLintClean, isDupCheckExempt, isSecurityScanExempt,
  readStaticScanResult, checkStaticScanClean, hasUnresolvedIssues, isProcessBlocked,
  checkDesignProblemListStructure, checkRequirementCoverageMatrix, extractP0RequirementIds,
  checkDesignReviewClean, checkTechSelectionConfirmed, checkDesignReviewConclusion,
  checkHotfixP0Impact, checkHotfixP0InterfaceStorageMention, recordHotfixP0SoftReminder,
  recordFailOpenEvent, hasResolvedDesignIssues, extractQeDispatchTaskPacks,
  getDevLineStatusForTaskPack, ROOT_CONVERSATION_STATE, DISPATCHED_ROLES_STATE,
  recordRootConversationId, checkLiteModeConfirmed, hasLiteModeConfirmation, getWorkflowMode,
  LITE_WORKFLOW_MODES,
  getDeclaredWorkflowMode, readRootConversationId, isRootConversationCaller, recordDispatchedRole,
  readRecentlyDispatchedRoles, isGatedRoleArtifactPath, expectedRolesForPath,
  checkRolePathPermission, collectActiveRoleSlugs,   checkReconEvidenceRef,
  excerptInDesignAnchorWindow, extractDesignSectionWindow,
  checkIsomorphicModuleSection, checkIsomorphicModuleSectionReady,
  resolveLintCommand, computeLintGate, detectStackFromFileNames, buildLintRemediation,
  isLintNotConfigured, STACK_MANIFESTS, STACK_LINT_COMMANDS,
  resolveDupCommand, resolveSecurityCommand,
  computeSubGate, computeStaticScanGate,
  parseDupThreshold, extractDupPercentage, evaluateDuplicationReport, DEFAULT_DUP_THRESHOLD,
  decodeTextBuffer, readTextFileSafe, readJsonFileSafe, parseProcessFrontmatter,
  classifyHarnessSelfGovernedPath, harnessSelfGovernedVerdict, isHarnessStatePath,
  classifyShellWriteIntent, extractShellPathCandidates,
  hasToolchainInstallApproval, hashCommandForApproval, TOOLCHAIN_APPROVAL_MARKER,
  readRootConversationRecord, isRootConversationBaselineStale,
  isRootConversationBaselineExpired, inspectIdentityBaseline,
  parseRollbackCounts, checkRollbackLimit, getRollbackLimit,
  extractSection, extractSectionAll, getIterationRound, mentionsIterationRound,
  sectionHasDataRow, checkImplicitRequirementRecord,
  splitTableRow, isTableSeparatorLine, parseMarkdownTables,
  isGatedArtifactsConfigPath,
  // R34 / R35 / R36 / R37 / R38
  verifyExecutionProof, attachExecutionProof, issueExecutionProof, detectRunnerExecProofKind,
  getExecProofPolicy, canonicalJson, buildGateExceptionVerdict,
  EXEC_PROOF_LEDGER, EXEC_PROOF_PENDING_DIR, checkE2eGate, evaluateGateArtifact,
  hasSubstantiveBlockingReason, hasPendingGateExceptionEvent, hasBlockingDecisionTrace,
  checkBlockingReleaseEvidence, getGateExceptionPolicy,
  findCorroboratedGateExceptionEvent, consumeGateExceptionRelease,
  readGateExceptionLedger, GATE_EXCEPTION_LEDGER,
  checkArtifactFreshness, latestSourceChangeMs,
  resolveGateRepairPaths, isActiveProcessFilePath,
  parseIncrementScope, checkIncrementScopeDeclared, checkSingleTaskBaseDesign,
  checkSingleTaskPreconditions, INCREMENT_SCOPE_DIMENSIONS,
  isCompatOnlySchemaChange, checkIncrementCompatRegressionReport,
  checkIncrementScopeRequirementCrossCheck, extractRoundRequirementIds,
  getIncrementScopeYesRows,
  findOrphanGateExceptionLedgerEntries, checkGateExceptionLedgerReconciled,
  classifyCommandFailure, applyToolAvailability,
  signFixtureArtifact, snapshotExecProofState, restoreExecProofState,
};

/** 以指定编码写出 fixture 文件（R30 编码鲁棒性用） */
export function writeEncodedFixture(relPath, content, encoding = 'utf8') {
  const abs = path.join(FIXTURE_ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (encoding === 'utf8-bom') {
    fs.writeFileSync(abs, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, 'utf8')]));
  } else if (encoding === 'utf16le') {
    fs.writeFileSync(abs, Buffer.from(content, 'utf16le'));
  } else if (encoding === 'utf16le-bom') {
    fs.writeFileSync(abs, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')]));
  } else {
    fs.writeFileSync(abs, content, 'utf8');
  }
  return abs;
}

let _toolchainMarkerSnapshot;
export function snapshotToolchainMarker() {
  _toolchainMarkerSnapshot = fs.existsSync(TOOLCHAIN_APPROVAL_MARKER)
    ? fs.readFileSync(TOOLCHAIN_APPROVAL_MARKER, 'utf8')
    : null;
}
export function restoreToolchainMarker() {
  if (_toolchainMarkerSnapshot === null || _toolchainMarkerSnapshot === undefined) {
    fs.rmSync(TOOLCHAIN_APPROVAL_MARKER, { force: true });
  } else {
    fs.writeFileSync(TOOLCHAIN_APPROVAL_MARKER, _toolchainMarkerSnapshot, 'utf8');
  }
}
export function writeToolchainMarker(data) {
  fs.mkdirSync(path.dirname(TOOLCHAIN_APPROVAL_MARKER), { recursive: true });
  fs.writeFileSync(TOOLCHAIN_APPROVAL_MARKER, JSON.stringify(data), 'utf8');
}
export function clearToolchainMarker() {
  fs.rmSync(TOOLCHAIN_APPROVAL_MARKER, { force: true });
}

// R34：套件会真实签发 nonce 到 `.claude/hooks/`，故整轮自测前后做一次快照/还原，
// 与 lint / E2E / root-conversation 等受控运行产物同一处理方式。
snapshotExecProofState();

// R35：`recordFailOpenEvent` 会往门禁异常旁路台账写条目，同样是宿主真实路径下的运行时状态。
const _gateExceptionLedgerSnapshot = fs.existsSync(GATE_EXCEPTION_LEDGER)
  ? fs.readFileSync(GATE_EXCEPTION_LEDGER, 'utf8')
  : null;

export function restoreGateExceptionLedger() {
  if (_gateExceptionLedgerSnapshot === null) fs.rmSync(GATE_EXCEPTION_LEDGER, { force: true });
  else fs.writeFileSync(GATE_EXCEPTION_LEDGER, _gateExceptionLedgerSnapshot, 'utf8');
}

export function finishSelftest() {
  cleanup();
  restoreExecProofState();
  restoreGateExceptionLedger();
  console.log('');
  console.log(`结果：${state.passCount} passed, ${state.failCount} failed`);
  if (state.failCount > 0) {
    console.error('失败用例：');
    for (const f of state.failures) console.error(`  - ${f.name}: ${f.error}`);
    process.exit(1);
  }
  process.exit(0);
}
