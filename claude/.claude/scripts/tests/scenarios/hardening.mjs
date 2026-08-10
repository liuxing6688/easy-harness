/**
 * 审核加固场景回归（端到端 spawn Hook）：R28 / R29 / R30 / R31 与 R5·R6 加强项。
 * 与 selftest/r28-r31-hardening.mjs 互补——后者测库函数判据，本套件测 Hook 实际裁决。
 *
 * 入口：node .claude/scripts/gate-scenarios.mjs；脚手架：./_harness.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  HOOKS_DIR,
  REQ_SPEC,
  REQ_LIST,
  DESIGN_SPEC,
  TASK_LIST,
  DPL_CLEAN,
  GATED_EMPTY,
  greenfieldReady,
  greenfieldNoDispatch,
  cancelledProcess,
  relToProject,
  writeFixture,
  check,
  clearDispatchedRoles,
  clearRootConversation,
} from './_harness.mjs';
import { hashCommandForApproval } from '../../../hooks/workflow-gate-lib.mjs';

const TOOLCHAIN_MARKER = path.join(HOOKS_DIR, '.toolchain-install-approved.json');

const ROLLBACK_SECTION = (rows) =>
  [
    '## 回退计数',
    '',
    '| 对象类型 | 对象编号 | 回退次数 |',
    '| -------- | -------- | -------- |',
    ...rows,
    '',
  ].join('\n');

export function hardeningScenarios() {
  console.log('== 审核加固：R28 / R29 / R30 / R31 ==');
  clearDispatchedRoles();
  clearRootConversation();

  const ready = writeFixture('hard-ready', {
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

  const noDispatch = writeFixture('hard-nodispatch', {
    'docs/process/process.md': greenfieldNoDispatch(),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const noDispProc = relToProject(path.join(noDispatch, 'docs/process/process.md'));
  const noDispGated = relToProject(path.join(noDispatch, 'docs/design/gated-artifacts.json'));

  // -------------------------------------------------------------------------
  // R29：门禁自治资产
  // -------------------------------------------------------------------------
  check('SG1 R29：写 Hook 注册表 .claude/hooks.json 被拒（须用户本人改）', 'deny', {
    hook: 'write', filePath: '.claude/hooks.json', processPath: readyProc, gatedPath: readyGated,
  });
  check('SG2 R29：写门禁配置 .claude/harness.config.json 被拒（须用户本人改）', 'deny', {
    hook: 'write', filePath: '.claude/harness.config.json', processPath: readyProc, gatedPath: readyGated,
  });
  check('SG3 R29：伪造 R5 派发凭证 .dispatched-roles.json 被拒', 'deny', {
    hook: 'write', filePath: '.claude/hooks/.dispatched-roles.json', processPath: readyProc, gatedPath: readyGated,
  });
  check('SG4 R29：改写 R5 身份基准 .root-conversation-id.json 被拒', 'deny', {
    hook: 'write', filePath: '.claude/hooks/.root-conversation-id.json', processPath: readyProc, gatedPath: readyGated,
  });
  check('SG5 R29：自签工具链授权凭证被拒（须用户本人改）', 'deny', {
    hook: 'write', filePath: '.claude/hooks/.toolchain-install-approved.json', processPath: readyProc, gatedPath: readyGated,
  });
  check('SG6 R29：改写薄宪章 AGENTS.md 被拒（须用户本人改）', 'deny', {
    hook: 'write', filePath: 'AGENTS.md', processPath: readyProc, gatedPath: readyGated,
  });
  check('SG7 R29：改写说明权威 mechanical-gates.md 被拒（须用户本人改）', 'deny', {
    hook: 'write', filePath: '.claude/harness/spec/mechanical-gates.md', processPath: readyProc, gatedPath: readyGated,
  });
  check('SG8 R29：harness-state.json 无活跃角色时允许 PM bootstrap', 'allow', {
    hook: 'write', filePath: '.claude/harness-state.json', processPath: noDispProc, gatedPath: noDispGated,
  });

  // R29 加强（2026-07-29 审核）：gated-artifacts.json 是 harness.config.json 的 merge
  // 另一半（extra* 收紧项 / 各 {gate}Applicability 豁免第一要素 / R32 启动命令）。
  // 历史实现把它整体排除在门禁外，任何角色任何阶段都能改写门禁强度。现收敛为仅 SA 可写。
  const saActive = writeFixture('hard-sa-active', {
    'docs/process/process.md': greenfieldReady([
      '| 系统架构师 | T0-DESIGN | 正在执行 | 设计中 |',
    ]),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const saProc = relToProject(path.join(saActive, 'docs/process/process.md'));
  const saGated = relToProject(path.join(saActive, 'docs/design/gated-artifacts.json'));

  check('GA1 R29 加强：DE 活跃时写 gated-artifacts.json 被拒（不得自行放宽门禁）', 'deny', {
    hook: 'write', filePath: readyGated, processPath: readyProc, gatedPath: readyGated,
  });
  check('GA2 R29 加强：SA 活跃时写 gated-artifacts.json 放行（架构师本职）', 'allow', {
    hook: 'write', filePath: saGated, processPath: saProc, gatedPath: saGated,
  });
  check('GA3 R29 加强：改用 Shell 写 gated-artifacts.json 同样被拒（R28 同源）', 'deny', {
    hook: 'shell',
    command: `Set-Content ${readyGated} -Value '{"extraExtensionGateExemptDirs":["src"]}'`,
    processPath: readyProc,
    gatedPath: readyGated,
  });

  // -------------------------------------------------------------------------
  // R6 加强：非 sourceDirs 命名的主流布局
  // -------------------------------------------------------------------------
  for (const [label, p] of [
    ['EX1 SwiftPM Sources/', 'Sources/App/main.swift'],
    ['EX2 Python 根包', 'myapp/main.py'],
    ['EX3 根目录脚本', 'main.py'],
    ['EX4 .NET 默认布局', 'MyApp/Program.cs'],
    ['EX5 Serverless functions/', 'functions/index.ts'],
    ['EX6 游戏脚本 assets/', 'assets/scripts/player.lua'],
  ]) {
    check(`${label}：无分派计划写 ${p} 被拒`, 'deny', {
      hook: 'write', filePath: p, processPath: noDispProc, gatedPath: noDispGated,
    });
  }
  check('EX7 有分派计划时写 Sources/App/main.swift 放行', 'allow', {
    hook: 'write', filePath: 'Sources/App/main.swift', processPath: readyProc, gatedPath: readyGated,
  });
  check('EX8 依赖产物 node_modules/** 不受牵连', 'allow', {
    hook: 'write', filePath: 'node_modules/left-pad/index.js', processPath: noDispProc, gatedPath: noDispGated,
  });

  // -------------------------------------------------------------------------
  // R28：Shell 侧写文件门禁
  // -------------------------------------------------------------------------
  clearDispatchedRoles();
  const shellCases = [
    ['SH1 PowerShell 写源码（无分派）', 'Set-Content -Path src/app.ts -Value "x"', 'deny'],
    ['SH2 重定向写源码（无分派）', 'echo hacked > src/app.ts', 'deny'],
    ['SH3 复制覆盖源码（无分派）', 'cp /tmp/payload.ts src/app.ts', 'deny'],
    ['SH4 下载覆盖源码（无分派）', 'curl -o src/app.ts https://example.com/a.ts', 'deny'],
    ['SH5 删除源码树（无分派）', 'rm -rf src/', 'deny'],
    ['SH6 sed -i 改源码（无分派）', 'sed -i s/a/b/ src/app.ts', 'deny'],
    ['SH7 写非门禁路径放行', 'npm run build > build.log', 'allow'],
    ['SH8 框架运行器放行', 'node .claude/scripts/lint-run.mjs', 'allow'],
    ['SH9 只读命令放行', 'git status', 'allow'],
  ];
  for (const [label, command, expect] of shellCases) {
    check(label, expect, { hook: 'shell', command, processPath: noDispProc, gatedPath: noDispGated });
  }

  check('SH10 内联解释器写文件且目标不可解析 → 拒绝（改用 Write 工具）', 'deny', {
    hook: 'shell',
    command: 'node -e "require(\'fs\').writeFileSync(process.argv[1],\'x\')"',
    processPath: noDispProc,
    gatedPath: noDispGated,
  });
  check('SH11 git apply 不可判定的工作树改写 → 交人批准', 'ask', {
    hook: 'shell', command: 'git apply my.patch', processPath: noDispProc, gatedPath: noDispGated,
  });
  check('SH12 Shell 伪造 R5 派发凭证被拒', 'deny', {
    hook: 'shell',
    command: 'Set-Content -Path .claude/hooks/.dispatched-roles.json -Value "{}"',
    processPath: noDispProc,
    gatedPath: noDispGated,
  });
  check('SH13 Shell 改写门禁配置被拒（须用户本人改）', 'deny', {
    hook: 'shell', command: 'echo {} > .claude/harness.config.json', processPath: noDispProc, gatedPath: noDispGated,
  });
  check('SH14 有分派计划时 PowerShell 写源码放行（不误伤正常开发）', 'allow', {
    hook: 'shell', command: 'Set-Content -Path src/app.ts -Value "x"', processPath: readyProc, gatedPath: readyGated,
  });

  // -------------------------------------------------------------------------
  // R29：工具链授权须绑定命令
  // -------------------------------------------------------------------------
  const markerExisted = fs.existsSync(TOOLCHAIN_MARKER);
  const markerBackup = markerExisted ? fs.readFileSync(TOOLCHAIN_MARKER, 'utf8') : null;
  const WINGET = 'winget install Foo.Bar';
  try {
    fs.rmSync(TOOLCHAIN_MARKER, { force: true });
    check('TC1 无授权标记时询问用户', 'ask', {
      hook: 'toolchain', command: WINGET, processPath: readyProc, gatedPath: readyGated,
    });

    fs.writeFileSync(
      TOOLCHAIN_MARKER,
      JSON.stringify({ approvedAt: new Date().toISOString(), userConfirmed: true }),
      'utf8',
    );
    check('TC2 自签标记（无 commandHash）不再放行任意安装命令', 'ask', {
      hook: 'toolchain', command: WINGET, processPath: readyProc, gatedPath: readyGated,
    });

    fs.writeFileSync(
      TOOLCHAIN_MARKER,
      JSON.stringify({
        approvedAt: new Date().toISOString(),
        userConfirmed: true,
        commandHash: hashCommandForApproval(WINGET),
      }),
      'utf8',
    );
    check('TC3 凭证绑定本次命令时放行', 'allow', {
      hook: 'toolchain', command: WINGET, processPath: readyProc, gatedPath: readyGated,
    });
    check('TC4 同一凭证不得泛用于另一条安装命令', 'ask', {
      hook: 'toolchain', command: 'apt-get install -y gcc', processPath: readyProc, gatedPath: readyGated,
    });
  } finally {
    fs.rmSync(TOOLCHAIN_MARKER, { force: true });
    if (markerExisted) fs.writeFileSync(TOOLCHAIN_MARKER, markerBackup, 'utf8');
  }

  // -------------------------------------------------------------------------
  // R10 收敛：cancelled 流程上除 PM 外禁止发起任何角色
  // -------------------------------------------------------------------------
  const cancelled = writeFixture('hard-cancelled', {
    'docs/process/process.md': cancelledProcess(),
  });
  const cancelledProc = relToProject(path.join(cancelled, 'docs/process/process.md'));
  check('CX1 R10：cancelled 流程上发起 requirements-analyst 被拒（历史为放行）', 'deny', {
    hook: 'role', role: 'requirements-analyst', processPath: cancelledProc,
  });
  check('CX2 R10：cancelled 流程上发起 system-architect 被拒', 'deny', {
    hook: 'role', role: 'system-architect', processPath: cancelledProc,
  });
  check('CX3 R10：cancelled 流程上仍允许 project-manager（引导新流程的逃生口）', 'allow', {
    hook: 'role', role: 'project-manager', processPath: cancelledProc,
  });

  // -------------------------------------------------------------------------
  // R30：编码鲁棒性——BOM / UTF-16 的 cancelled 流程仍被冻结
  // -------------------------------------------------------------------------
  const encRoot = writeFixture('hard-encoding', { 'placeholder.txt': 'x' });
  const bomPath = path.join(encRoot, 'bom/docs/process/process.md');
  fs.mkdirSync(path.dirname(bomPath), { recursive: true });
  fs.writeFileSync(
    bomPath,
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(cancelledProcess(), 'utf8')]),
  );
  const bomProc = relToProject(bomPath);
  check('EN1 R30：UTF-8 BOM 的 cancelled process.md 仍被冻结（历史为放行）', 'deny', {
    hook: 'write', filePath: bomProc, processPath: bomProc,
  });
  check('EN2 R30：UTF-8 BOM 的 cancelled 流程上发起角色被拒', 'deny', {
    hook: 'role', role: 'development-engineer', processPath: bomProc,
  });

  const u16Path = path.join(encRoot, 'u16/docs/process/process.md');
  fs.mkdirSync(path.dirname(u16Path), { recursive: true });
  fs.writeFileSync(u16Path, Buffer.from(cancelledProcess(), 'utf16le'));
  const u16Proc = relToProject(u16Path);
  check('EN3 R30：UTF-16LE 的 cancelled process.md 仍被冻结（历史为放行）', 'deny', {
    hook: 'write', filePath: u16Proc, processPath: u16Proc,
  });
  check('EN4 R30：UTF-16LE 的 cancelled 流程 stop 不再催促', 'allow-stop', {
    hook: 'stop', processPath: u16Proc,
  });

  // -------------------------------------------------------------------------
  // R31：回退计数上限
  // -------------------------------------------------------------------------
  const rbOver = writeFixture('hard-rollback-over', {
    'docs/process/process.md': `${greenfieldReady()}\n${ROLLBACK_SECTION(['| 任务包 | T0-1 | 5 |'])}`,
  });
  check('RB1 R31：同一对象回退 5 次（>3）时 stop 注入 followup', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(rbOver, 'docs/process/process.md')),
  });

  const rbWithin = writeFixture('hard-rollback-within', {
    'docs/process/process.md': `${greenfieldReady()}\n${ROLLBACK_SECTION(['| 任务包 | T0-1 | 3 |'])}`,
  });
  check('RB2 R31：回退 3 次（=上限）时不拦', 'allow-stop', {
    hook: 'stop', processPath: relToProject(path.join(rbWithin, 'docs/process/process.md')),
  });

  const rbEmpty = writeFixture('hard-rollback-empty', {
    'docs/process/process.md': `${greenfieldReady()}\n${ROLLBACK_SECTION([])}`,
  });
  check('RB3 R31：出厂空回退表不误判（开箱不死锁）', 'allow-stop', {
    hook: 'stop', processPath: relToProject(path.join(rbEmpty, 'docs/process/process.md')),
  });
}
