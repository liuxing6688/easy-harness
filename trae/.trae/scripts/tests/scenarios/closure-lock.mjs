/**
 * 场景套件：closureLockScenarios（CL1–CL14）
 *
 * **R40** 闭环锁的端到端验证（真正 spawn Hook 入口读 allow/deny/followup）。
 * 与 `selftest/r40-closure-lock.mjs`（库函数单元级）互补：本套件验证 stop hook
 * 写 marker → PreToolUse 读 marker 收紧 DE 的**跨回合约束**确实生效。
 *
 * 核心断言：
 *   - stop block 落盘 marker、stop allow 清 marker（CL1–CL2）；
 *   - marker 存在时 DE 的 Write/Shell/Task 三通道前置阻断（CL3–CL5）；
 *   - dev-incomplete 不拦 DE（CL6）、rollback-exceeded/blocking-no-evidence 拦（CL7–CL8）；
 *   - 回退计数 > 0 视为 PM 回派 DE，放行（CL9）；
 *   - R29 保护 marker 不被代理写/删（CL10–CL11）；
 *   - 跨回合模拟：stop block → 下一轮 PreToolUse 拦 → 补完后 stop allow 清 marker（CL12）；
 *   - 闭环锁优先于 R21（R21 只看最近派发，可被 PM→DE 链绕过）（CL13）；
 *   - 顶层代理写源码仍被 R5 拦（闭环锁不削弱既有门禁）（CL14）。
 *
 * 入口：node .trae/scripts/gate-scenarios.mjs；脚手架：./_harness.mjs
 */
import {
  CONFIRM_SECTION,
  DISPATCH_SECTION,
  ARTIFACT_REF,
  BLOCK_OK,
  REQ_SPEC,
  REQ_LIST,
  DESIGN_SPEC,
  TASK_LIST,
  DPL_CLEAN,
  GATED_EMPTY,
  progressSection,
  greenfieldReady,
  cancelledProcess,
  relToProject,
  writeFixture,
  check,
  runHook,
  recordPass,
  recordFail,
  clearClosureLock,
  readClosureLockFile,
  writeClosureLockFile,
  clearDispatchedRoles,
  path,
  fs,
} from './_harness.mjs';
import { recordDispatchedRole } from '../../../hooks/workflow-gate-lib.mjs';

export function closureLockScenarios() {
  console.log('== R40 闭环锁：跨回合约束（stop 写 marker → PreToolUse 收紧 DE）==');

  // 共用「DE 可写源码」基线：greenfieldReady 已含 DE 分派计划 + 全部前置成果物。
  // 闭环锁的检查点在 assertDevGateOrDeny 之前，故即便分派计划有效也会被 marker 拦下。
  const ready = writeFixture('cl-ready', {
    'docs/process/process.md': greenfieldReady(),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const readyProc = relToProject(path.join(ready, 'docs/process/process.md'));
  const readyGated = relToProject(path.join(ready, 'docs/design/gated-artifacts.json'));

  /** 基线：无 marker 时 DE 写源码放行（确认基线绿，否则后续拦截断言无意义） */
  clearClosureLock();
  clearDispatchedRoles();
  check('CL0 基线：无 marker 时 DE 写源码放行（确认基线绿）', 'allow', {
    hook: 'write', filePath: 'src/app.ts', processPath: readyProc, gatedPath: readyGated,
    agentId: 'development-engineer',
  });

  // -------------------------------------------------------------------------
  // CL1–CL2：stop hook 写/清 marker
  // -------------------------------------------------------------------------
  const devInProgress = writeFixture('cl-stop-block', {
    'docs/process/process.md': greenfieldReady(['| 开发工程师 | T0-1 | 正在执行 | |']),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const devProc = relToProject(path.join(devInProgress, 'docs/process/process.md'));

  clearClosureLock();
  check('CL1 stop block（开发进行中）落盘 marker', 'followup', {
    hook: 'stop', processPath: devProc,
  });
  {
    const raw = readClosureLockFile();
    if (!raw) {
      recordFail('CL1 marker 落盘', 'marker-on-disk', 'empty');
    } else {
      try {
        const m = JSON.parse(raw);
        // devInProgress 分支 → stage=dev-incomplete
        if (m.stage === 'dev-incomplete') recordPass('CL1 marker 落盘且 stage=dev-incomplete');
        else recordFail(`CL1 marker stage=${m.stage}`, 'dev-incomplete', m.stage);
      } catch (e) {
        recordFail('CL1 marker 解析', 'valid-json', String(e));
      }
    }
  }

  // CL2：stop allow（cancelled 流程）清 marker
  const cancelled = writeFixture('cl-stop-allow', {
    'docs/process/process.md': cancelledProcess(),
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const cancelledProc = relToProject(path.join(cancelled, 'docs/process/process.md'));
  // 先写一份 marker，再让 stop allow 清掉它
  writeClosureLockFile('qe-incomplete', ['lint'], '残留 marker');
  check('CL2 stop allow（cancelled）清 marker', 'allow-stop', {
    hook: 'stop', processPath: cancelledProc,
  });
  {
    const raw = readClosureLockFile();
    if (raw === null) recordPass('CL2 stop allow 后 marker 已清除');
    else recordFail('CL2 marker 清除', 'empty', 'still-exists');
  }

  // -------------------------------------------------------------------------
  // CL3–CL5：marker 存在时 DE 三通道前置阻断
  // -------------------------------------------------------------------------
  // 构造 qe-incomplete marker（无回退计数 → 阻拦）
  clearClosureLock();
  writeClosureLockFile('qe-incomplete', ['lint', 'staticScan'], 'QE 未完成');
  check('CL3 marker=qe-incomplete 时 DE Write 源码被拒', 'deny', {
    hook: 'write', filePath: 'src/app.ts', processPath: readyProc, gatedPath: readyGated,
    agentId: 'development-engineer',
  });
  check('CL4 marker=qe-incomplete 时 DE Shell 写源码被拒（Set-Content）', 'deny', {
    hook: 'shell', command: 'Set-Content -Path src/app.ts -Value "x"',
    processPath: readyProc, gatedPath: readyGated,
    agentId: 'development-engineer',
  });
  check('CL5 marker=qe-incomplete 时 DE 子代理首次工具调用被拒（r13-subagent）', 'deny', {
    hook: 'r13',
    processPath: readyProc, gatedPath: readyGated,
    agentId: 'development-engineer',
  });

  // -------------------------------------------------------------------------
  // CL6：dev-incomplete 不拦 DE（DE 任务未完成，继续开发合法）
  // -------------------------------------------------------------------------
  clearClosureLock();
  writeClosureLockFile('dev-incomplete', [], 'DE 任务未完成');
  check('CL6 marker=dev-incomplete 时 DE Write 源码放行（继续开发合法）', 'allow', {
    hook: 'write', filePath: 'src/app.ts', processPath: readyProc, gatedPath: readyGated,
    agentId: 'development-engineer',
  });

  // -------------------------------------------------------------------------
  // CL7–CL8：rollback-exceeded / blocking-no-evidence 阻拦
  // -------------------------------------------------------------------------
  clearClosureLock();
  writeClosureLockFile('rollback-exceeded', [], '回退超上限');
  check('CL7 marker=rollback-exceeded 时 DE Write 源码被拒', 'deny', {
    hook: 'write', filePath: 'src/app.ts', processPath: readyProc, gatedPath: readyGated,
    agentId: 'development-engineer',
  });

  clearClosureLock();
  writeClosureLockFile('blocking-no-evidence', [], '阻塞缺证据');
  check('CL8 marker=blocking-no-evidence 时 DE Write 源码被拒', 'deny', {
    hook: 'write', filePath: 'src/app.ts', processPath: readyProc, gatedPath: readyGated,
    agentId: 'development-engineer',
  });

  // -------------------------------------------------------------------------
  // CL9：qe-incomplete + 回退计数 > 0 → 放行（PM 回派 DE）
  // -------------------------------------------------------------------------
  clearClosureLock();
  writeClosureLockFile('qe-incomplete', ['lint'], 'QE 未完成');
  const withRollback = writeFixture('cl-rollback', {
    'docs/process/process.md': [
      ...greenfieldReady().split('\n'),
      '',
      '## 回退计数',
      '',
      '| 对象类型 | 对象编号 | 回退次数 |',
      '| -------- | -------- | -------- |',
      '| 任务包 | T0-1 | 1 |',
      '',
    ].join('\n'),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('CL9 marker=qe-incomplete + 回退计数>0 时 DE Write 放行（PM 回派）', 'allow', {
    hook: 'write', filePath: 'src/app.ts',
    processPath: relToProject(path.join(withRollback, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(withRollback, 'docs/design/gated-artifacts.json')),
    agentId: 'development-engineer',
  });

  // -------------------------------------------------------------------------
  // CL10–CL11：R29 保护 marker 不被代理写/删
  // -------------------------------------------------------------------------
  clearClosureLock();
  check('CL10/R29 代理 Write 写 marker 路径被拒（runtime-marker）', 'deny', {
    hook: 'write', filePath: '.trae/hooks/.workflow-closure-pending.json',
    processPath: readyProc, gatedPath: readyGated,
    agentId: 'development-engineer',
  });
  check('CL11/R29 代理 Shell 删 marker 被拒（runtime-marker 一律 deny）', 'deny', {
    hook: 'shell', command: 'rm -f .trae/hooks/.workflow-closure-pending.json',
    processPath: readyProc, gatedPath: readyGated,
    agentId: 'development-engineer',
  });

  // -------------------------------------------------------------------------
  // CL12：跨回合模拟——stop block → 下一轮 PreToolUse 拦 → 补完后 stop allow 清 marker
  // -------------------------------------------------------------------------
  // CL12a 须产生**阻拦型** stage（qe-incomplete / test-incomplete 等）才能在 CL12b 拦住 DE。
  // dev-incomplete 不拦 DE（DE 任务未完成时继续开发合法），故此处用「DE 完成、QE 未分派」
  // fixture，stop 命中「待分派 QE」分支 → determineClosureStage 返回 qe-incomplete（fallback）。
  const devDoneQePending = writeFixture('cl-stop-block-qe', {
    'docs/process/process.md': greenfieldReady(['| 开发工程师 | T0-1 | 执行完成 | |']),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const devDoneQePendingProc = relToProject(path.join(devDoneQePending, 'docs/process/process.md'));

  clearClosureLock();
  // 第一回合：stop block（DE 完成、QE 未分派）写 marker stage=qe-incomplete
  check('CL12a 第一回合 stop block 写 marker', 'followup', {
    hook: 'stop', processPath: devDoneQePendingProc,
  });
  {
    const raw = readClosureLockFile();
    if (raw === null) recordFail('CL12a marker 落盘', 'non-null', 'null');
    else recordPass('CL12a marker 已落盘（跨回合约束已建立）');
  }
  // 第二回合：代理硬结束后回来，PreToolUse 读 marker 拦 DE 写源码
  check('CL12b 第二回合 DE Write 被 marker 拦（跨回合约束生效）', 'deny', {
    hook: 'write', filePath: 'src/app.ts', processPath: devDoneQePendingProc, gatedPath: readyGated,
    agentId: 'development-engineer',
  });
  // 补完流程：cancelled 流程让 stop allow 清 marker
  check('CL12c 补完后 stop allow 清 marker', 'allow-stop', {
    hook: 'stop', processPath: cancelledProc,
  });
  {
    const raw = readClosureLockFile();
    if (raw === null) recordPass('CL12c marker 已清除（跨回合约束解除）');
    else recordFail('CL12c marker 清除', 'null', 'still-exists');
  }
  // 之后再写源码不再被拦
  check('CL12d marker 清除后 DE Write 恢复放行', 'allow', {
    hook: 'write', filePath: 'src/app.ts', processPath: readyProc, gatedPath: readyGated,
    agentId: 'development-engineer',
  });

  // -------------------------------------------------------------------------
  // CL13：闭环锁优先于 R21（R21 只看最近派发，可被 PM→DE 链绕过）
  // -------------------------------------------------------------------------
  // R21 读 .dispatched-roles.json；若代理通过 PM→DE 分派链让 DE 重新活跃，
  // R21 会放行。但闭环锁读 marker，不依赖「最近派发」，故仍拦。
  clearClosureLock();
  writeClosureLockFile('test-incomplete', ['finalE2E'], '测试未完成');
  // 模拟 PM 已派发 DE（.dispatched-roles.json 含 DE）——R21 会放行，但闭环锁仍拦。
  // 注意：gate-dev-workflow 的 R5 角色匹配读 .dispatched-roles.json，故须先派发 DE
  // 使 R5/R21 通过，再由闭环锁拦下——这正是闭环锁补 R21 漏洞的价值。
  clearDispatchedRoles();
  try { recordDispatchedRole('development-engineer'); } catch { /* best-effort */ }
  check('CL13 闭环锁优先于 R21：即便 DE 最近派发，marker 存在仍拦', 'deny', {
    hook: 'write', filePath: 'src/app.ts', processPath: readyProc, gatedPath: readyGated,
    agentId: 'development-engineer',
  });

  // -------------------------------------------------------------------------
  // CL14：顶层代理写源码仍被 R5 拦（闭环锁不削弱既有门禁）
  // -------------------------------------------------------------------------
  clearClosureLock();
  check('CL14 无 marker 时顶层代理（solo_agent）写源码仍被 R5 拦', 'deny', {
    hook: 'write', filePath: 'src/app.ts', processPath: readyProc, gatedPath: readyGated,
    agentId: 'solo_agent',
  });

  clearClosureLock();
  clearDispatchedRoles();
}
