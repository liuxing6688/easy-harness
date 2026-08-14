/**
 * 审核加固回归：R28（Shell 写文件门禁）/ R29（门禁自治资产）/ R30（编码鲁棒性）/
 * R31（回退计数上限），以及 R5（身份基准 TTL 自愈）与 R6（代码扩展名默认门禁）的加强项。
 *
 * 每条用例都对应一个**实测可复现**的绕过链或静默失效，
 * 见 `.claude/harness/spec/mechanical-gates.md` §8.5「审核加固项」。
 */
import {
  test, fixtureProcess, assert, path, decodeTextBuffer, readTextFileSafe, readJsonFileSafe,
  parseProcessFrontmatter, isCancelledProcessFile, isProcessBlocked, getWorkflowMode,
  isGatedDevPath, isGatedRoleArtifactPath, expectedRolesForPath, isHarnessStatePath,
  classifyHarnessSelfGovernedPath, harnessSelfGovernedVerdict, classifyShellWriteIntent,
  extractShellPathCandidates, hasToolchainInstallApproval, hashCommandForApproval,
  recordRootConversationId, readRootConversationId, readRootConversationRecord,
  isRootConversationBaselineStale, isRootConversationBaselineExpired, inspectIdentityBaseline,
  parseRollbackCounts, checkRollbackLimit, getRollbackLimit, writeEncodedFixture,
  snapshotRootConversationState, restoreRootConversationState, clearRootConversationState,
  writeRootConversationState, snapshotToolchainMarker, restoreToolchainMarker,
  writeToolchainMarker, clearToolchainMarker, FIXTURE_ROOT, PROJECT_ROOT,
} from './_harness.mjs';

const CANCELLED_PROCESS = [
  '---',
  'workflow_mode: full',
  'blocking: false',
  'cancelled: true',
  'cancelReason: 用户取消',
  '---',
  '',
  '# 流程进度记录（已取消）',
  '',
].join('\n');

const HOUR = 60 * 60 * 1000;

function relFixture(abs) {
  return path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
console.log('== R30：门禁输入编码鲁棒性（BOM / UTF-16 不得使门禁静默失效）==');

test('R30: decodeTextBuffer 剥离 UTF-8 BOM', () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('---\na: 1\n---\n', 'utf8')]);
  assert.equal(decodeTextBuffer(buf).startsWith('---'), true);
});

test('R30: decodeTextBuffer 解码带 BOM 的 UTF-16LE', () => {
  const body = '---\ncancelled: true\n---\n';
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, 'utf16le')]);
  assert.equal(decodeTextBuffer(buf), body);
});

test('R30: decodeTextBuffer 探测无 BOM 的 UTF-16LE（PowerShell 5.1 重定向默认编码）', () => {
  const body = '---\ncancelled: true\n---\n';
  assert.equal(decodeTextBuffer(Buffer.from(body, 'utf16le')), body);
});

test('R30: 无 BOM 的 UTF-16LE 含 U+xx00 汉字时仍被正确探测', () => {
  // 「一」U+4E00 的低位字节为 0x00，会落在偶数位。若探测要求「另一侧严格为 0」，
  // 整份文件都会被漏判成 UTF-8 —— 实测曾导致 UTF-16 的 cancelled 流程被解冻。
  const body = ['---', 'cancelled: true', '---', '', '# 第一阶段：一致性一览', ''].join('\n');
  assert.equal(decodeTextBuffer(Buffer.from(body, 'utf16le')), body);
});

test('R30: 无 BOM 的 UTF-16BE 也能被探测', () => {
  const body = '---\ncancelled: true\n---\n';
  const be = Buffer.from(Buffer.from(body, 'utf16le'));
  be.swap16();
  assert.equal(decodeTextBuffer(be), body);
});

test('R30: decodeTextBuffer 对普通 UTF-8（含中文）保持原样', () => {
  const body = '## 进度列表\n| 开发工程师 | T0-1 | 执行完成 | |\n';
  assert.equal(decodeTextBuffer(Buffer.from(body, 'utf8')), body);
});

test('R30: parseProcessFrontmatter 容忍前导 BOM（否则 frontmatter 整体失配）', () => {
  assert.equal(parseProcessFrontmatter('\uFEFF---\ncancelled: true\n---\n').cancelled, true);
});

test('R30: UTF-8 BOM 的 cancelled process.md 仍被识别为冻结', () => {
  fixtureProcess('placeholder');
  const abs = writeEncodedFixture('docs/process/process.md', CANCELLED_PROCESS, 'utf8-bom');
  assert.equal(isCancelledProcessFile(relFixture(abs)), true);
});

test('R30: UTF-16LE 的 cancelled process.md 仍被识别为冻结', () => {
  fixtureProcess('placeholder');
  const abs = writeEncodedFixture('docs/process/process.md', CANCELLED_PROCESS, 'utf16le');
  assert.equal(isCancelledProcessFile(relFixture(abs)), true);
});

test('R30: UTF-16LE 的 docs-only 声明仍能被读到（不退化为 full）', () => {
  const body = [
    '---', 'workflow_mode: docs-only', 'cancelled: false', '---', '',
    '## 用户确认记录', '',
    '| 确认项 | 时间 | 用户原话摘要 |',
    '| ------ | ---- | ------------ |',
    '| 工作流模式确认 | 2026-01-01 | 确认 docs-only，只改文档 |',
    '',
  ].join('\n');
  assert.equal(getWorkflowMode(decodeTextBuffer(Buffer.from(body, 'utf16le'))), 'docs-only');
});

test('R30: UTF-16LE 的 blocking 标志不丢失', () => {
  const body = ['---', 'blocking: true', 'cancelled: false', '---', ''].join('\n');
  assert.equal(isProcessBlocked(decodeTextBuffer(Buffer.from(body, 'utf16le'))), true);
});

test('R30: readJsonFileSafe 解析带 BOM 的 JSON（否则门禁配置静默回落默认值）', () => {
  fixtureProcess('placeholder');
  const abs = writeEncodedFixture('cfg/gated.json', '{"apiTestApplicability":"n/a"}', 'utf8-bom');
  assert.deepEqual(readJsonFileSafe(abs), { apiTestApplicability: 'n/a' });
});

test('R30: readTextFileSafe 对不存在的文件返回 null（不抛异常触发 fail-open）', () => {
  assert.equal(readTextFileSafe(path.join(FIXTURE_ROOT, 'nope/none.md')), null);
});

// ---------------------------------------------------------------------------
console.log('== R6 加强：代码扩展名默认受门禁（白名单 → 黑名单）==');

const UNCOVERED_LAYOUTS = [
  ['Sources/App/main.swift', 'SwiftPM 官方布局'],
  ['myapp/main.py', 'Python 根包'],
  ['main.py', '根目录脚本'],
  ['index.js', '根目录入口'],
  ['MyApp/Program.cs', '.NET 默认布局'],
  ['functions/index.ts', 'Serverless 官方布局'],
  ['R/analysis.R', 'R 包官方布局'],
  ['Modules/Core/Core.psm1', 'PowerShell 模块'],
  ['assets/scripts/player.lua', '游戏脚本'],
  ['ui/Main.kt', '自定义模块名'],
  ['charts/values.yaml', 'Helm（非 helm/ 目录名）'],
  ['ansible/site.yml', '运维编排'],
  ['docker/entrypoint.sh', '容器启动脚本'],
];

for (const [p, note] of UNCOVERED_LAYOUTS) {
  test(`R6 加强: ${p} 纳入门禁（${note}）`, () => {
    assert.equal(isGatedDevPath(p), true);
    assert.deepEqual(expectedRolesForPath(p), ['development-engineer']);
  });
}

test('R6 加强: 依赖/构建产物目录仍豁免（否则包管理器产物会把门禁打爆）', () => {
  assert.equal(isGatedDevPath('node_modules/left-pad/index.js'), false);
  assert.equal(isGatedDevPath('dist/bundle.js'), false);
  assert.equal(isGatedDevPath('build/out.js'), false);
  assert.equal(isGatedDevPath('target/debug/app.rs'), false);
  assert.equal(isGatedDevPath('.venv/lib/site.py'), false);
  assert.equal(isGatedDevPath('coverage/lcov.js'), false);
  assert.equal(isGatedDevPath('test-results/qe/.lint-result.json'), false);
});

test('R6 加强: 非代码扩展名不被扩展名规则牵连', () => {
  assert.equal(isGatedDevPath('NOTES.md'), false);
  assert.equal(isGatedDevPath('LICENSE'), false);
  assert.equal(isGatedDevPath('data/sample.csv'), false);
});

test('R6 加强: docs/ 与 .claude/ 分支优先级不被扩展名规则改变（回归）', () => {
  assert.equal(isGatedDevPath('docs/requirement/requirement-list.md'), false);
  assert.equal(isGatedDevPath('docs/design/notes.py'), true);
  assert.equal(isGatedDevPath('.claude/templates/process.md'), false);
  assert.equal(isGatedDevPath('.claude/hooks/gate-foo.mjs'), true);
});

// ---------------------------------------------------------------------------
console.log('== R29：门禁自治资产（运行时标记禁写 / 门禁配置须人工批准）==');

test('R29: R5 运行时标记归类为 runtime-marker（deny）', () => {
  for (const p of [
    '.claude/hooks/.root-conversation-id.json',
    '.claude/hooks/.dispatched-roles.json',
  ]) {
    assert.equal(classifyHarnessSelfGovernedPath(p), 'runtime-marker');
    assert.equal(harnessSelfGovernedVerdict('runtime-marker', p).permission, 'deny');
  }
});

test('R29: 工具链授权凭证归类为 approval-marker（deny）', () => {
  const p = '.claude/hooks/.toolchain-install-approved.json';
  assert.equal(classifyHarnessSelfGovernedPath(p), 'approval-marker');
  assert.equal(harnessSelfGovernedVerdict('approval-marker', p).permission, 'deny');
});

test('R29: Hook 注册表与门禁配置归类为 gate-config（deny）', () => {
  for (const p of ['.claude/hooks.json', '.claude/harness.config.json']) {
    assert.equal(classifyHarnessSelfGovernedPath(p), 'gate-config');
    assert.equal(harnessSelfGovernedVerdict('gate-config', p).permission, 'deny');
  }
});

test('R29: 宪章与说明权威归类为 gate-config（改动等于调门禁口径）', () => {
  assert.equal(classifyHarnessSelfGovernedPath('AGENTS.md'), 'gate-config');
  assert.equal(
    classifyHarnessSelfGovernedPath('.claude/harness/spec/mechanical-gates.md'),
    'gate-config',
  );
});

test('R29: 普通源码与成果物不被误判为自治资产', () => {
  for (const p of ['src/app.ts', 'docs/process/process.md', 'e2e/specs/a.spec.ts', 'README.md']) {
    assert.equal(classifyHarnessSelfGovernedPath(p), null);
  }
});

// F-21：锁配置而不锁代码 → 改写运行器即可产出「恒 gatePassed」且被真实私钥签名的产物，
// R34 验签通过、stop 门禁照单全收。故门禁代码/运行器/角色约束一律 gate-code（deny）。
test('R29 加强（F-21）: settings.json 属 Hook 注册表，归 gate-config', () => {
  for (const p of ['.claude/settings.json', '.claude/settings.local.json']) {
    assert.equal(classifyHarnessSelfGovernedPath(p), 'gate-config');
    assert.equal(harnessSelfGovernedVerdict('gate-config', p).permission, 'deny');
  }
});

test('R29 加强（F-21）: 门禁判据本体与 lib/** 归类为 gate-code（deny）', () => {
  for (const p of [
    '.claude/hooks/gate-dev-workflow-enhanced.mjs',
    '.claude/hooks/gate-stop-workflow.mjs',
    '.claude/hooks/lib/execproof.mjs',
    '.claude/hooks/lib/paths.mjs',
  ]) {
    assert.equal(classifyHarnessSelfGovernedPath(p), 'gate-code');
    assert.equal(harnessSelfGovernedVerdict('gate-code', p).permission, 'deny');
  }
});

test('R29 加强（F-21）: 机读证据运行器归类为 gate-code（含 *-run / *-lib）', () => {
  for (const p of [
    '.claude/scripts/e2e-run.mjs',
    '.claude/scripts/e2e-run-lib.mjs',
    '.claude/scripts/lint-run.mjs',
    '.claude/scripts/static-scan-run.mjs',
    '.claude/scripts/startup-smoke-run.mjs',
    '.claude/scripts/exec-proof-sign.mjs',
  ]) {
    assert.equal(classifyHarnessSelfGovernedPath(p), 'gate-code');
  }
});

test('R29 加强（F-21）: 角色强制约束与门禁自测归类为 gate-code', () => {
  for (const p of [
    '.claude/agents/development-engineer.md',
    '.claude/agents/project-manager.md',
    '.claude/scripts/tests/selftest/r6-paths.mjs',
    '.claude/scripts/tests/scenarios/hardening.mjs',
  ]) {
    assert.equal(classifyHarnessSelfGovernedPath(p), 'gate-code');
  }
});

test('R29 加强（F-21）: gate-code 提示指向「用户本人落盘」而非放行 DE', () => {
  const v = harnessSelfGovernedVerdict('gate-code', '.claude/scripts/lint-run.mjs');
  assert.equal(v.permission, 'deny');
  assert.ok(/用户本人/.test(v.agentMessage));
  assert.ok(/diff/i.test(v.agentMessage));
});

// R28 豁免的是「**调用**运行器」，不是「命令里**出现**运行器路径」。历史实现只匹配路径，
// 于是 Shell 改写运行器会在 R29 归类之前早退放行，与 Write 通道判据相反。
test('R28 加强（F-21）: 正常调用运行器仍豁免（不误伤日常执行）', () => {
  for (const c of [
    'node .claude/scripts/e2e-run.mjs --scope=final --baseline=docs/requirement/requirement-list.md',
    'node .claude/scripts/lint-run.mjs',
    'npx node .claude/scripts/static-scan-run.mjs',
  ]) {
    assert.deepEqual(classifyShellWriteIntent(c).selfGoverned, [], c);
  }
});

test('R28 加强（F-21）: Shell 改写/删除运行器不再被豁免早退，归 gate-code', () => {
  for (const c of [
    'Set-Content .claude/scripts/lint-run.mjs -Value x',
    'echo x > .claude/scripts/e2e-run.mjs',
    'cp evil.mjs .claude/scripts/lint-run.mjs',
    'rm .claude/scripts/e2e-run.mjs',
  ]) {
    const sg = classifyShellWriteIntent(c).selfGoverned;
    assert.equal(sg.length, 1, c);
    assert.equal(sg[0].kind, 'gate-code', c);
  }
});

// 规则层（2026-08-14）：`.claude/rules/*.md` 经 Claude Code 官方规则机制自动注入代理上下文，
// 与 CLAUDE.md 同属「写给代理看的强制文本」。历史上整个目录在 dotClaudeExemptPatterns 里被
// 豁免（理由「仅为提醒」），规则真正生效后该理由不再成立——可写等于可把「禁止手工编辑
// test-results」改成「必要时可补字段」，然后自己按改后的规则行事。
test('R29: 规则层 .claude/rules/**.md 归类为 gate-config（deny）', () => {
  for (const p of [
    '.claude/rules/harness-process.md',
    '.claude/rules/harness-test-artifacts.md',
    '.claude/rules/harness-gate-assets.md',
    '.claude/rules/frontend/style.md',
  ]) {
    assert.equal(classifyHarnessSelfGovernedPath(p), 'gate-config', p);
    assert.equal(harnessSelfGovernedVerdict('gate-config', p).permission, 'deny', p);
  }
});

test('R29: Shell 通道改写规则层同样拦截（R28 同源）', () => {
  for (const c of [
    'echo x > .claude/rules/harness-process.md',
    'Set-Content .claude/rules/harness-test-artifacts.md -Value x',
    'rm .claude/rules/harness-gate-assets.md',
  ]) {
    const sg = classifyShellWriteIntent(c).selfGoverned;
    assert.equal(sg.length, 1, c);
    assert.equal(sg[0].kind, 'gate-config', c);
  }
});

test('R29 加强（F-21）: 非门禁脚本与产品代码仍不受 gate-code 影响', () => {
  for (const p of [
    '.claude/scripts/bootstrap-docs.mjs',
    '.claude/scripts/mode-wizard.mjs',
    'src/server.ts',
    'tests/unit/app.test.ts',
  ]) {
    assert.notEqual(classifyHarnessSelfGovernedPath(p), 'gate-code');
  }
});

test('R29: harness-state.json 纳入角色门禁，期望 project-manager', () => {
  assert.equal(isHarnessStatePath('.claude/harness-state.json'), true);
  assert.equal(isGatedRoleArtifactPath('.claude/harness-state.json'), true);
  assert.deepEqual(expectedRolesForPath('.claude/harness-state.json'), ['project-manager']);
});

// ---------------------------------------------------------------------------
console.log('== R29：工具链安装授权须绑定具体命令（commandHash 由可选改为必需）==');

snapshotToolchainMarker();
const WINGET = 'winget install Foo.Bar';

test('R29: 无标记文件时未获授权', () => {
  clearToolchainMarker();
  assert.equal(hasToolchainInstallApproval(WINGET), false);
});

test('R29: 仅 userConfirmed 而无 commandHash 时不再放行（历史泛用授权已关闭）', () => {
  writeToolchainMarker({ approvedAt: new Date().toISOString(), userConfirmed: true });
  assert.equal(hasToolchainInstallApproval(WINGET), false);
  assert.equal(hasToolchainInstallApproval('apt-get install -y gcc'), false);
});

test('R29: commandHash 匹配本次命令时放行', () => {
  writeToolchainMarker({
    approvedAt: new Date().toISOString(),
    userConfirmed: true,
    commandHash: hashCommandForApproval(WINGET),
  });
  assert.equal(hasToolchainInstallApproval(WINGET), true);
});

test('R29: 同一标记不得泛用于另一条安装命令', () => {
  writeToolchainMarker({
    approvedAt: new Date().toISOString(),
    userConfirmed: true,
    commandHash: hashCommandForApproval(WINGET),
  });
  assert.equal(hasToolchainInstallApproval('apt-get install -y gcc'), false);
});

test('R29: 过期标记不放行', () => {
  writeToolchainMarker({
    approvedAt: new Date(Date.now() - 999 * 60 * 1000).toISOString(),
    userConfirmed: true,
    commandHash: hashCommandForApproval(WINGET),
  });
  assert.equal(hasToolchainInstallApproval(WINGET), false);
});

test('R29: 无任何时间戳的标记不放行（无法判定有效期）', () => {
  writeToolchainMarker({ userConfirmed: true, commandHash: hashCommandForApproval(WINGET) });
  assert.equal(hasToolchainInstallApproval(WINGET), false);
});

restoreToolchainMarker();

// ---------------------------------------------------------------------------
console.log('== R28：Shell 侧写文件门禁 ==');

test('R28: PowerShell / 重定向 / 复制 / 下载 / sed -i 写源码均被解析出受门禁目标', () => {
  for (const cmd of [
    'Set-Content -Path src/app.ts -Value "x"',
    'echo hacked > src/app.ts',
    'Add-Content src/app.ts "x"',
    'cp /tmp/payload.ts src/app.ts',
    'mv old.ts src/app.ts',
    'curl -o src/app.ts https://example.com/a.ts',
    'sed -i s/a/b/ src/app.ts',
  ]) {
    const intent = classifyShellWriteIntent(cmd);
    assert.equal(intent.mutates, true, `未识别为写文件：${cmd}`);
    assert.equal(
      intent.targets.some((t) => /src\/app\.ts$/i.test(t)),
      true,
      `未解析出受门禁目标：${cmd}`,
    );
  }
});

test('R28: 删除受门禁源码树被识别', () => {
  const intent = classifyShellWriteIntent('rm -rf src/');
  assert.equal(intent.mutates, true);
  assert.equal(intent.targets.length > 0, true);
});

test('R28: 内联解释器写文件且目标不可解析时标记 opaqueWrite（应 deny）', () => {
  const intent = classifyShellWriteIntent(
    'node -e "require(\'fs\').writeFileSync(process.argv[1],\'x\')"',
  );
  assert.equal(intent.mutates, true);
  assert.equal(intent.opaqueWrite, true);
});

test('R28: 内联解释器写文件且目标可解析时走路径判据（非 opaque）', () => {
  const intent = classifyShellWriteIntent('python -c "open(\'src/app.py\',\'w\').write(\'x\')"');
  assert.equal(intent.opaqueWrite, false);
  assert.equal(intent.targets.some((t) => /src\/app\.py$/i.test(t)), true);
});

test('R28: git apply 等不可判定的工作树改写标记 opaqueWorktree（应 ask）', () => {
  for (const cmd of ['git apply my.patch', 'git reset --hard HEAD~1', 'git stash pop']) {
    const intent = classifyShellWriteIntent(cmd);
    assert.equal(intent.mutates, true, cmd);
    assert.equal(intent.opaqueWorktree, true, cmd);
  }
});

test('R28: git checkout <ref> -- <path> 目标可解析时按路径判据', () => {
  const intent = classifyShellWriteIntent('git checkout other-branch -- src/');
  assert.equal(intent.mutates, true);
  assert.equal(intent.targets.length > 0, true);
});

test('R28: 自治资产目标经 Shell 写入时按 R29 分级（而非普通路径判据）', () => {
  const forge = classifyShellWriteIntent(
    'Set-Content -Path .claude/hooks/.dispatched-roles.json -Value "{}"',
  );
  assert.equal(forge.selfGoverned.some((s) => s.kind === 'runtime-marker'), true);
  const cfg = classifyShellWriteIntent('echo {} > .claude/harness.config.json');
  assert.equal(cfg.selfGoverned.some((s) => s.kind === 'gate-config'), true);
});

test('R28: 只读 / 构建 / 框架运行器命令不被判为写文件（防误伤）', () => {
  for (const cmd of [
    'node .claude/scripts/lint-run.mjs',
    'node .claude/scripts/e2e-run.mjs --scope=batch --required-ids=R-001',
    'node .claude/scripts/static-scan-run.mjs',
    'npm run lint',
    'npm test',
    'npx playwright test',
    'git status',
    'git add -A',
    'git commit -m "feat: x"',
    'ls -la src',
    'cat src/app.ts',
    'node --version',
  ]) {
    assert.equal(classifyShellWriteIntent(cmd).mutates, false, `误判为写文件：${cmd}`);
  }
});

test('R28: 写非门禁路径不产生受门禁目标（不该阻断日常操作）', () => {
  const intent = classifyShellWriteIntent('npm run build > build.log');
  assert.equal(intent.targets.length, 0);
  assert.equal(intent.opaqueWrite, false);
  assert.equal(intent.opaqueWorktree, false);
});

test('R28: fd 复制（2>&1）不被误判为重定向写文件', () => {
  assert.equal(classifyShellWriteIntent('npm test 2>&1').mutates, false);
});

test('R28: extractShellPathCandidates 能取出引号内与 -Path: 形式的路径', () => {
  const cands = extractShellPathCandidates('Set-Content -Path:"src/a b.ts" -Value x');
  assert.equal(cands.some((c) => c.includes('src/a b.ts')), true);
});

// ---------------------------------------------------------------------------
console.log('== R5 加强：顶层会话 id 基准 TTL 自愈 ==');

snapshotRootConversationState();

test('R5 加强: 无时间戳的基准视为可覆盖（stale），但仍参与身份判定（不 expired）', () => {
  const record = { rootConversationId: 'legacy', recordedAt: null };
  assert.equal(isRootConversationBaselineStale(record), true);
  assert.equal(isRootConversationBaselineExpired(record), false);
});

test('R5 加强: TTL 内的基准既不可覆盖也不过期', () => {
  const record = { rootConversationId: 'fresh', recordedAt: new Date().toISOString() };
  assert.equal(isRootConversationBaselineStale(record), false);
  assert.equal(isRootConversationBaselineExpired(record), false);
});

test('R5 加强: 超出 TTL 的基准同时 stale 与 expired', () => {
  const record = {
    rootConversationId: 'old',
    recordedAt: new Date(Date.now() - 72 * HOUR).toISOString(),
  };
  assert.equal(isRootConversationBaselineStale(record), true);
  assert.equal(isRootConversationBaselineExpired(record), true);
});

test('R5 加强: 遗留夹具值（无时间戳）会被新会话覆盖 —— 修复「永久静默失效」', () => {
  clearRootConversationState();
  writeRootConversationState('root-conv-abc'); // 复现本仓库工作树曾处于的状态
  recordRootConversationId('real-root-id');
  assert.equal(readRootConversationRecord().rootConversationId, 'real-root-id');
  assert.equal(readRootConversationId(), 'real-root-id');
});

test('R5 加强: 过期基准会被新会话覆盖（跨会话自愈）', () => {
  clearRootConversationState();
  writeRootConversationState('yesterday-root', new Date(Date.now() - 72 * HOUR).toISOString());
  recordRootConversationId('today-root');
  assert.equal(readRootConversationId(), 'today-root');
});

test('R5 加强: TTL 内不被嵌套子代理覆盖（保留原防护语义）', () => {
  clearRootConversationState();
  recordRootConversationId('real-root');
  recordRootConversationId('nested-subagent');
  assert.equal(readRootConversationId(), 'real-root');
});

test('R5 加强: 过期基准不参与身份判定（避免用陈旧值得出错误结论）', () => {
  clearRootConversationState();
  writeRootConversationState('expired-root', new Date(Date.now() - 72 * HOUR).toISOString());
  assert.equal(readRootConversationId(), null);
});

test('R5 加强: inspectIdentityBaseline 区分「确实失效」与「payload 无 id」', () => {
  clearRootConversationState();
  const missing = inspectIdentityBaseline('any');
  assert.equal(missing.healthy, false);
  assert.equal(missing.reason, 'baseline-missing');
  assert.equal(missing.shouldNotify, true);

  recordRootConversationId('root-x');
  assert.equal(inspectIdentityBaseline('root-x').healthy, true);

  const noId = inspectIdentityBaseline(undefined);
  assert.equal(noId.reason, 'no-conversation-id');
  assert.equal(noId.shouldNotify, false);
});

test('R5 加强: 过期基准的 inspect 结果标记为须提醒', () => {
  clearRootConversationState();
  writeRootConversationState('expired-root', new Date(Date.now() - 72 * HOUR).toISOString());
  const r = inspectIdentityBaseline('whatever');
  assert.equal(r.reason, 'baseline-expired');
  assert.equal(r.shouldNotify, true);
});

restoreRootConversationState();

// ---------------------------------------------------------------------------
console.log('== R31：回退计数上限机械化 ==');

const ROLLBACK_HEADER = [
  '## 回退计数',
  '',
  '| 对象类型 | 对象编号 | 回退次数 |',
  '| -------- | -------- | -------- |',
];

test('R31: 出厂空表不产生超限（开箱不死锁）', () => {
  const content = [...ROLLBACK_HEADER, ''].join('\n');
  assert.deepEqual(parseRollbackCounts(content), []);
  assert.equal(checkRollbackLimit(content).ok, true);
});

test('R31: 解析出对象与次数', () => {
  const content = [...ROLLBACK_HEADER, '| 任务包 | T0-1 | 2 |', '| 设计审核 | D-1 | 4 |', ''].join('\n');
  const rows = parseRollbackCounts(content);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].count, 4);
  assert.equal(rows[1].label.includes('D-1'), true);
});

test('R31: 未超上限（=3）时通过', () => {
  const content = [...ROLLBACK_HEADER, '| 任务包 | T0-1 | 3 |', ''].join('\n');
  assert.equal(checkRollbackLimit(content).ok, true);
});

test('R31: 超上限（>3）时失败并指明对象', () => {
  const content = [...ROLLBACK_HEADER, '| 任务包 | T0-1 | 4 |', ''].join('\n');
  const r = checkRollbackLimit(content);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'rollback-limit-exceeded');
  assert.equal(r.exceeded[0].count, 4);
  assert.equal(r.message.includes('T0-1'), true);
});

test('R31: 无「## 回退计数」章节时不误判超限（向后兼容旧 process.md）', () => {
  assert.equal(checkRollbackLimit('# 无该章节\n').ok, true);
});

test('R31: 非数字次数被忽略（不因占位符误判）', () => {
  const content = [...ROLLBACK_HEADER, '| 任务包 | T0-1 | — |', ''].join('\n');
  assert.deepEqual(parseRollbackCounts(content), []);
});

test('R31: 默认上限为 3', () => {
  assert.equal(getRollbackLimit(), 3);
});

// ── F-26（2026-08-11 审核修复）：R28 由「枚举写文件命令」升级为「路径出现即裁决」 ──
// 历史 SHELL_MUTATION_RE 只枚举 `sed -i` 一类命令名，于是同类工具换个名字即绕过。
// 下面每条都是评审报告实测 ALLOW 的绕过链；`npx json -I -f docs/design/gated-artifacts.json`
// 尤为严重——它能单方面取得 R22 双钥之一（该文件 Write 通道期望角色为 system-architect）。
const F26_BYPASSES = [
  ['npx --yes json -I -f package.json -e "this.scripts.start=1"', 'json -I 原地改写'],
  ['npx --yes replace-in-file "/a/g" b src/server.js', 'replace-in-file'],
  ['perl -pi -e "s/a/b/" src/server.js', 'perl -pi'],
  ['yq -i ".a=1" src/config.yaml', 'yq -i'],
  ['dasel -i -f src/config.json ".a=1"', 'dasel -i'],
  ['ex -sc "%s/a/b/|wq" src/server.js', 'ex -sc'],
  ['npm pkg set scripts.start="node evil.js"', 'npm pkg set（隐含 package.json）'],
  ['npm version patch', 'npm version（隐含 package.json）'],
];

for (const [command, label] of F26_BYPASSES) {
  test(`F-26: ${label} 须判定为写入并解析出受门禁目标`, () => {
    const intent = classifyShellWriteIntent(command);
    assert.equal(intent.mutates, true);
    assert.equal(intent.targets.length + intent.selfGoverned.length > 0, true);
  });
}

test('F-26: `npx json -I` 改写 gated-artifacts.json 须落进 targets（R22 双钥不得单方面取得）', () => {
  const intent = classifyShellWriteIntent(
    'npx --yes json -I -f docs/design/gated-artifacts.json -e "this.e2eAlternativeStartup=1"',
  );
  assert.equal(intent.mutates, true);
  assert.equal(
    intent.targets.some((t) => t.includes('gated-artifacts.json')),
    true,
  );
});

test('F-26: 路径敏感兜底不误伤纯读命令', () => {
  for (const command of [
    'cat src/server.js',
    'grep -n foo src/server.js',
    'rg --files-with-matches todo src',
    'git diff docs/design/detail-design-spec.md',
    'node --check src/server.js',
  ]) {
    assert.equal(classifyShellWriteIntent(command).mutates, false, command);
  }
});

test('F-26: 路径敏感兜底不误伤正常构建/测试与门禁运行器', () => {
  for (const command of [
    'npm install',
    'npm test',
    'npm run build',
    'npx playwright test',
    'node .claude/scripts/lint-run.mjs',
    'node .claude/scripts/e2e-run.mjs --scope=final',
  ]) {
    assert.equal(classifyShellWriteIntent(command).mutates, false, command);
  }
});
