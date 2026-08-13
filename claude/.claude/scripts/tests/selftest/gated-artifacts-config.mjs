/**
 * R29 加强：项目级门禁配置 `docs/**\/design/gated-artifacts.json` 纳入角色门禁。
 *
 * 背景（2026-07-29 规约审核）：R29 把 `harness.config.json` / `hooks.json` 锁成 deny，
 * 却把与之 merge 的另一半——架构师声明的 `gated-artifacts.json`——整体排除在门禁外
 * （`isGatedDevPath` 直接 return false，且不在角色成果物判据内）。后果是任何角色、
 * 任何阶段都能改写门禁强度：
 *   - `extraExtensionGateExemptDirs: ["src"]` ⇒ R6 代码扩展名门禁对整个 src/ 失效；
 *   - `{gate}Applicability: "n/a"` ⇒ 自行备齐双要素豁免的第一要素。
 *
 * 现：期望角色收敛为 system-architect；放松型旋钮 `extraExtensionGateExemptDirs`
 * 不再被合并（只认 R29 锁定的 harness.config.json）。
 *
 * 入口：node .claude/scripts/gate-selftest.mjs
 */
import {
  test, assert, cleanup, fixtureProcess, isGatedArtifactsConfigPath, isGatedRoleArtifactPath,
  expectedRolesForPath, checkRolePathPermission, classifyShellWriteIntent, isGatedDevPath,
  snapshotDispatchedRoles, restoreDispatchedRoles, clearDispatchedRoles,
} from './_harness.mjs';

// `checkRolePathPermission` 对非源码路径会把「最近 Task 派发角色」并入活跃集合（见
// collectActiveRoleSlugs）。该状态是**仓库级**文件 `.claude/hooks/.dispatched-roles.json`，
// 不随 fixtureProcess 隔离：宿主仓库里若残留一份含全部 7 个角色的记录（真实开发中很常见），
// 本套件的「越权角色应被拒」用例会因活跃集合恒含 system-architect 而假通过/假失败。
// 故进程级快照 + 清空，退出时还原，使判据只由夹具 process.md 决定。
snapshotDispatchedRoles();
clearDispatchedRoles();

const GA = 'docs/design/gated-artifacts.json';
const GA_FEATURE = 'docs/my-feature/design/gated-artifacts.json';

function processWithActiveRole(roleCell) {
  return [
    '---', 'workflow_mode: full', '---', '',
    '## 进度列表',
    '',
    '| 任务名称 | 角色 | 状态 |',
    '| -------- | ---- | ---- |',
    `| T0-1 | ${roleCell} | 正在执行 |`,
    '',
  ].join('\n');
}

console.log('== R29 加强：gated-artifacts.json 纳入角色门禁 ==');

test('R29 加强: 识别 greenfield 与 feature 两种路径', () => {
  assert.equal(isGatedArtifactsConfigPath(GA), true);
  assert.equal(isGatedArtifactsConfigPath(GA_FEATURE), true);
  assert.equal(isGatedArtifactsConfigPath('docs/design/detail-design-spec.md'), false);
  assert.equal(isGatedArtifactsConfigPath('src/gated-artifacts.json'), false);
});

test('R29 加强: 纳入角色成果物门禁（历史为整体豁免）', () => {
  assert.equal(isGatedRoleArtifactPath(GA), true);
});

test('R29 加强: 期望角色为 system-architect', () => {
  assert.deepEqual(expectedRolesForPath(GA), ['system-architect']);
  assert.deepEqual(expectedRolesForPath(GA_FEATURE), ['system-architect']);
});

test('R29 加强: 仍不走 DE 源码门禁（避免 SA 在开发前产出它时死锁）', () => {
  assert.equal(isGatedDevPath(GA), false);
});

test('R29 加强: 架构师活跃时放行', () => {
  fixtureProcess(processWithActiveRole('系统架构师'));
  assert.equal(checkRolePathPermission(GA).ok, true);
});

test('R29 加强: 开发工程师活跃时禁止改写门禁配置', () => {
  fixtureProcess(processWithActiveRole('开发工程师'));
  const r = checkRolePathPermission(GA);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'role-path-mismatch');
});

test('R29 加强: 测试工程师不得自行声明豁免以过门禁', () => {
  fixtureProcess(processWithActiveRole('测试工程师'));
  assert.equal(checkRolePathPermission(GA).ok, false);
});

test('R29 加强: Shell 通道写该文件也纳入目标判据（R28 同源）', () => {
  const intent = classifyShellWriteIntent(`Set-Content ${GA} -Value '{}'`);
  assert.equal(intent.mutates, true);
  assert.ok(
    intent.targets.some((t) => isGatedArtifactsConfigPath(t)),
    'Shell 写门禁配置未被解析为受门禁目标——Write 被拒后可改用 Shell 绕过',
  );
});

cleanup();
restoreDispatchedRoles();
