/**
 * 门禁单元自测共享脚手架（fixture / assert / 快照还原）。
 * 各规则套件从本模块导入 test/fixtureProcess 等，勿在套件内重复造轮子。
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
} from '../../../hooks/workflow-gate-lib.mjs';
import { resolveLintCommand, computeLintGate } from '../../lint-run-lib.mjs';
import {
  resolveDupCommand,
  resolveSecurityCommand,
  computeSubGate,
  computeStaticScanGate,
} from '../../static-scan-run-lib.mjs';

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

export function fixtureProcess(processContent, extraFiles = {}) {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
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
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
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
export function writeLintResult(result) {
  fs.mkdirSync(path.dirname(LINT_RESULT_PATH), { recursive: true });
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
export function writeStaticScanResult(result) {
  fs.mkdirSync(path.dirname(STATIC_SCAN_RESULT_PATH), { recursive: true });
  fs.writeFileSync(STATIC_SCAN_RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
export function clearStaticScanResult() {
  fs.rmSync(STATIC_SCAN_RESULT_PATH, { force: true });
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
  isLintExempt, readLintResult, checkLintClean, isDupCheckExempt, isSecurityScanExempt,
  readStaticScanResult, checkStaticScanClean, hasUnresolvedIssues, isProcessBlocked,
  checkDesignProblemListStructure, checkRequirementCoverageMatrix, extractP0RequirementIds,
  checkDesignReviewClean, checkTechSelectionConfirmed, checkDesignReviewConclusion,
  checkHotfixP0Impact, checkHotfixP0InterfaceStorageMention, recordHotfixP0SoftReminder,
  recordFailOpenEvent, hasResolvedDesignIssues, extractQeDispatchTaskPacks,
  getDevLineStatusForTaskPack, ROOT_CONVERSATION_STATE, DISPATCHED_ROLES_STATE,
  recordRootConversationId, checkLiteModeConfirmed, hasLiteModeConfirmation, getWorkflowMode,
  getDeclaredWorkflowMode, readRootConversationId, isRootConversationCaller, recordDispatchedRole,
  readRecentlyDispatchedRoles, isGatedRoleArtifactPath, expectedRolesForPath,
  checkRolePathPermission, collectActiveRoleSlugs, checkReconEvidenceRef,
  excerptInDesignAnchorWindow, extractDesignSectionWindow,
  resolveLintCommand, computeLintGate, resolveDupCommand, resolveSecurityCommand,
  computeSubGate, computeStaticScanGate,
};

export function finishSelftest() {
  cleanup();
  console.log('');
  console.log(`结果：${state.passCount} passed, ${state.failCount} failed`);
  if (state.failCount > 0) {
    console.error('失败用例：');
    for (const f of state.failures) console.error(`  - ${f.name}: ${f.error}`);
    process.exit(1);
  }
  process.exit(0);
}
