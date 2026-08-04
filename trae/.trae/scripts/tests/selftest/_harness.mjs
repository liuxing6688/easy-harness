/**
 * 门禁单元自测共享脚手架（fixture / assert / 快照还原）。
 *
 * 各规则套件从本模块导入 `test` / `fixtureProcess` / `cleanup` 等，勿在套件内重复造轮子。
 * 跨套件常量与 Markdown 工厂放 `./_fixtures.mjs`。
 * 修改本文件后跑：`node .trae/scripts/gate-selftest.mjs`。
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
  getActiveProcessPath,
  hasResolvedDesignIssues,
  extractQeDispatchTaskPacks,
  getDevLineStatusForTaskPack,
  ROOT_CONVERSATION_STATE,
  DISPATCHED_ROLES_STATE,
  recordRootConversationId,
  writeRootSessionIdToEnvFile,
  readRootSessionIdFromEnv,
  checkLiteModeConfirmed,
  hasLiteModeConfirmation,
  getWorkflowMode,
  getDeclaredWorkflowMode,
  readRootConversationId,
  isRootConversationCaller,
  isTopLevelAgent,
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
  isGatedShellCommand,
  // R28/R29/R30/R31 与 R6 加强项
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
  parseRollbackCounts,
  checkRollbackLimit,
  getRollbackLimit,
  // 出厂模板 ↔ 出厂门禁一致性（templates-vs-gates）
  extractSection,
  sectionHasDataRow,
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
  extractPlannedRoles,
  checkDispatchPlanMatch,
  // R40 闭环锁
  CLOSURE_LOCK_MARKER,
  CLOSURE_STAGES,
  readClosureLock,
  writeClosureLock,
  clearClosureLock,
  closureLockBlocksDev,
  normalizePath,
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
 * Windows 上 fs.rmSync(recursive) 有时会静默失败（文件句柄延迟释放 / 索引服务占用），
 * 导致残留文件污染后续测试。改用逐文件删除 + 重试机制确保清理彻底。
 */
function rmSyncRobust(target) {
  if (!fs.existsSync(target)) return;
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    /* 忽略，下面逐文件重试 */
  }
  if (!fs.existsSync(target)) return;
  // 逐文件删除兜底（Windows rmSync recursive 偶发静默失败）
  function walkAndDelete(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkAndDelete(full);
        try { fs.rmdirSync(full); } catch { /* ignore */ }
      } else {
        for (let i = 0; i < 3; i++) {
          try {
            fs.unlinkSync(full);
            break;
          } catch {
            // 重试：可能被索引服务短暂占用
          }
        }
      }
    }
  }
  walkAndDelete(target);
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* best-effort */ }
}

export function fixtureProcess(processContent, extraFiles = {}) {
  rmSyncRobust(FIXTURE_ROOT);
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

export function cleanup() {
  rmSyncRobust(FIXTURE_ROOT);
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

// P2-2/P2-3: process.env.ROOT_SESSION_ID 快照/还原（env var 主源测试隔离）
let _rootSessionEnvSnapshot;
export function snapshotRootSessionEnv() {
  _rootSessionEnvSnapshot = process.env.ROOT_SESSION_ID;
}
export function restoreRootSessionEnv() {
  if (_rootSessionEnvSnapshot === undefined || _rootSessionEnvSnapshot === null) {
    delete process.env.ROOT_SESSION_ID;
  } else {
    process.env.ROOT_SESSION_ID = _rootSessionEnvSnapshot;
  }
}
export function clearRootSessionEnv() {
  delete process.env.ROOT_SESSION_ID;
}
export function setRootSessionEnv(value) {
  if (value === null || value === undefined || value === '') {
    delete process.env.ROOT_SESSION_ID;
  } else {
    process.env.ROOT_SESSION_ID = String(value);
  }
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
  rmSyncRobust(RECON_DIR);
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
  rmSyncRobust(RECON_DIR);
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
  recordFailOpenEvent, getActiveProcessPath, hasResolvedDesignIssues, extractQeDispatchTaskPacks,
  getDevLineStatusForTaskPack, ROOT_CONVERSATION_STATE, DISPATCHED_ROLES_STATE,
  recordRootConversationId, writeRootSessionIdToEnvFile, readRootSessionIdFromEnv,
  checkLiteModeConfirmed, hasLiteModeConfirmation, getWorkflowMode,
  getDeclaredWorkflowMode, readRootConversationId, isRootConversationCaller, isTopLevelAgent, recordDispatchedRole,
  readRecentlyDispatchedRoles, isGatedRoleArtifactPath, expectedRolesForPath,
  checkRolePathPermission, collectActiveRoleSlugs, checkReconEvidenceRef,
  excerptInDesignAnchorWindow, extractDesignSectionWindow,
  checkIsomorphicModuleSection, checkIsomorphicModuleSectionReady, isGatedShellCommand,
  resolveLintCommand, computeLintGate, detectStackFromFileNames, buildLintRemediation,
  isLintNotConfigured, STACK_MANIFESTS, STACK_LINT_COMMANDS,
  resolveDupCommand, resolveSecurityCommand,
  computeSubGate, computeStaticScanGate,
  decodeTextBuffer, readTextFileSafe, readJsonFileSafe, parseProcessFrontmatter,
  classifyHarnessSelfGovernedPath, harnessSelfGovernedVerdict, isHarnessStatePath,
  classifyShellWriteIntent, extractShellPathCandidates,
  hasToolchainInstallApproval, hashCommandForApproval, TOOLCHAIN_APPROVAL_MARKER,
  parseRollbackCounts, checkRollbackLimit, getRollbackLimit,
  extractSection, sectionHasDataRow, checkImplicitRequirementRecord,
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
  classifyCommandFailure, applyToolAvailability,
  signFixtureArtifact, snapshotExecProofState, restoreExecProofState,
  extractPlannedRoles, checkDispatchPlanMatch,
  // R40 闭环锁
  CLOSURE_LOCK_MARKER, CLOSURE_STAGES,
  readClosureLock, writeClosureLock, clearClosureLock, closureLockBlocksDev,
  normalizePath,
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

// R34：套件会真实签发 nonce 到 `.trae/hooks/`，故整轮自测前后做一次快照/还原，
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

// R40：闭环锁 marker 同样是宿主真实路径下的运行时状态（.trae/hooks/ 下），
// 整轮自测前后快照/还原，避免套件间互相污染。
const CLOSURE_LOCK_ABS = path.join(PROJECT_ROOT, CLOSURE_LOCK_MARKER);
const _closureLockSnapshot = fs.existsSync(CLOSURE_LOCK_ABS)
  ? fs.readFileSync(CLOSURE_LOCK_ABS, 'utf8')
  : null;

export function restoreClosureLock() {
  if (_closureLockSnapshot === null) fs.rmSync(CLOSURE_LOCK_ABS, { force: true });
  else fs.writeFileSync(CLOSURE_LOCK_ABS, _closureLockSnapshot, 'utf8');
}

export function finishSelftest() {
  cleanup();
  restoreExecProofState();
  restoreGateExceptionLedger();
  restoreClosureLock();
  console.log('');
  console.log(`结果：${state.passCount} passed, ${state.failCount} failed`);
  if (state.failCount > 0) {
    console.error('失败用例：');
    for (const f of state.failures) console.error(`  - ${f.name}: ${f.error}`);
    process.exit(1);
  }
  process.exit(0);
}
