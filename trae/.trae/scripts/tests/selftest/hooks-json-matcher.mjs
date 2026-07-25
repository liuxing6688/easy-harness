/**
 * P0-1 回归防护：hooks.json matcher 静态校验。
 *
 * 防止再次出现「matcher 用错工具名导致 Hook 在 Trae 运行时静默失效」的致命盲区
 * （原审核报告 P0-1：`gate-dev-shell`/`gate-toolchain-install` 用 `Bash` 单名 matcher，
 * 但 Trae PreToolUse 的 tool_name 标准化为 `RunCommand`，导致两个 Hook 永不触发）。
 *
 * 本套件只做静态结构校验，不实测 Trae 路由（后者需挂 `matcher:"*"` 日志 Hook 实测，
 * 见 mechanical-gates.md §8.4「未验证项」）。
 */
import {
  test,
  assert,
  fs,
  path,
  PROJECT_ROOT,
} from './_harness.mjs';

const HOOKS_JSON_PATH = path.join(PROJECT_ROOT, '.trae', 'hooks.json');

function loadHooksJson() {
  const raw = fs.readFileSync(HOOKS_JSON_PATH, 'utf8');
  return JSON.parse(raw);
}

function findHookGroup(hooksObj, eventName, commandBasename) {
  const groups = hooksObj[eventName];
  if (!Array.isArray(groups)) return null;
  for (const group of groups) {
    const cmds = (group.hooks || []).filter(
      (h) => typeof h.command === 'string' && h.command.endsWith(commandBasename),
    );
    if (cmds.length > 0) return group;
  }
  return null;
}

console.log('== hooks.json matcher 静态校验（P0-1 回归防护）==');

test('hooks.json 可解析且为 Trae 嵌套结构（version + hooks 对象）', () => {
  const cfg = loadHooksJson();
  assert.equal(cfg.version, 1);
  assert.ok(cfg.hooks && typeof cfg.hooks === 'object', 'hooks 必须是对象');
});

test('gate-dev-workflow matcher 覆盖写入/编辑/删除类工具（含 Delete|DeleteFile）', () => {
  const cfg = loadHooksJson();
  const g = findHookGroup(cfg.hooks, 'PreToolUse', 'gate-dev-workflow.mjs');
  assert.ok(g, 'gate-dev-workflow Hook 组必须存在');
  const m = g.matcher || '';
  // 必须覆盖写入、编辑、删除三类（删除类至少含 Delete 或 DeleteFile）
  assert.ok(/Write/.test(m), `matcher 必须覆盖 Write，实际：${m}`);
  assert.ok(/Edit/.test(m), `matcher 必须覆盖 Edit，实际：${m}`);
  assert.ok(/Delete/.test(m), `matcher 必须覆盖 Delete/DeleteFile，实际：${m}`);
});

test('P0-1 回归：gate-dev-shell matcher 必须含 RunCommand（不能只用 Bash）', () => {
  const cfg = loadHooksJson();
  const g = findHookGroup(cfg.hooks, 'PreToolUse', 'gate-dev-shell.mjs');
  assert.ok(g, 'gate-dev-shell Hook 组必须存在');
  const m = g.matcher || '';
  assert.ok(
    /RunCommand/.test(m),
    `matcher 必须含 RunCommand（Trae 标准 tool_name）。实际：${m}`,
  );
  // 同时建议覆盖 Bash（Subagent tools 字段命名面，零风险兼容）
  assert.ok(/Bash/.test(m), `建议同时覆盖 Bash 命名面。实际：${m}`);
});

test('P0-1 回归：gate-toolchain-install matcher 必须含 RunCommand（不能只用 Bash）', () => {
  const cfg = loadHooksJson();
  const g = findHookGroup(cfg.hooks, 'PreToolUse', 'gate-toolchain-install.mjs');
  assert.ok(g, 'gate-toolchain-install Hook 组必须存在');
  const m = g.matcher || '';
  assert.ok(
    /RunCommand/.test(m),
    `matcher 必须含 RunCommand（Trae 标准 tool_name）。实际：${m}`,
  );
  assert.ok(/Bash/.test(m), `建议同时覆盖 Bash 命名面。实际：${m}`);
});

test('gate-role-sequence matcher 含 Task（Trae 顶层代理确有 Task 工具）', () => {
  const cfg = loadHooksJson();
  const g = findHookGroup(cfg.hooks, 'PreToolUse', 'gate-role-sequence.mjs');
  assert.ok(g, 'gate-role-sequence Hook 组必须存在');
  const m = g.matcher || '';
  assert.ok(/Task/.test(m), `matcher 必须含 Task。实际：${m}`);
});

test('SessionStart 不配 matcher（matcher 仅对 PreToolUse/PostToolUse/Notification 有效）', () => {
  const cfg = loadHooksJson();
  const groups = cfg.hooks.SessionStart || [];
  for (const g of groups) {
    assert.ok(
      g.matcher === undefined || g.matcher === '' || g.matcher === '*',
      `SessionStart 不应配限定性 matcher，实际：${g.matcher}`,
    );
  }
});

test('Stop 配 loop_limit（防无限循环）', () => {
  const cfg = loadHooksJson();
  const groups = cfg.hooks.Stop || [];
  assert.ok(groups.length > 0, 'Stop 必须至少有一个 Hook 组');
  for (const g of groups) {
    assert.ok(
      typeof g.loop_limit === 'number' && g.loop_limit > 0 && g.loop_limit <= 10,
      `Stop loop_limit 须为 1-10 的数字，实际：${g.loop_limit}`,
    );
  }
});

test('全部 Hook 定义层仅用 type/command/timeout（无 Cursor 的 failClosed 字段）', () => {
  const cfg = loadHooksJson();
  const allGroups = [
    ...(cfg.hooks.PreToolUse || []),
    ...(cfg.hooks.SessionStart || []),
    ...(cfg.hooks.Stop || []),
  ];
  for (const g of allGroups) {
    for (const h of g.hooks || []) {
      assert.ok(
        h.failClosed === undefined,
        `Trae 不支持 failClosed 字段，发现于 ${h.command}`,
      );
      assert.ok(h.type === undefined || h.type === 'command', `type 仅支持 command`);
      assert.ok(typeof h.command === 'string' && h.command.length > 0, 'command 必填');
      if (h.timeout !== undefined) {
        assert.ok(typeof h.timeout === 'number' && h.timeout > 0, 'timeout 须为正数');
      }
    }
  }
});
