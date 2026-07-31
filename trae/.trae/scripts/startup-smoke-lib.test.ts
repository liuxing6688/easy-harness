/**
 * startup-smoke-lib.mjs 纯函数 vitest 单测（R32：命令解析 / 两段判据 / 产物有效性与新鲜度）。
 * 运行：npx vitest run --config .trae/scripts/vitest.config.ts
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_AGE_HOURS,
  computeStartupSmokeGate,
  evaluateStartupSmokeResult,
  resolveStartupCommand,
} from './startup-smoke-lib.mjs';

describe('resolveStartupCommand', () => {
  it('config 覆盖优先于架构师声明与 package.json', () => {
    expect(
      resolveStartupCommand({
        override: 'node dist/server.js',
        declared: 'npm run serve',
        packageScripts: { start: 'node dist/index.js' },
      }),
    ).toEqual({ command: 'node dist/server.js', source: 'harness.config.te.startupSmoke.command' });
  });

  it('架构师声明优先于 package.json 探测', () => {
    expect(
      resolveStartupCommand({ declared: 'npm run serve', packageScripts: { start: 'x' } }),
    ).toEqual({ command: 'npm run serve', source: 'gated-artifacts.productionStartupCommand' });
  });

  it('回退到 package.json 的 start 脚本', () => {
    expect(resolveStartupCommand({ packageScripts: { start: 'node dist/index.js' } })).toEqual({
      command: 'npm run start',
      source: 'package.json.scripts.start',
    });
  });

  it('不把 dev/preview 当生产启动路径（猜错比不冒烟更危险）', () => {
    expect(resolveStartupCommand({ packageScripts: { dev: 'vite', preview: 'vite preview' } })).toBeNull();
  });

  it('全部缺失时返回 null', () => {
    expect(resolveStartupCommand()).toBeNull();
    expect(resolveStartupCommand({ override: '   ', declared: '' })).toBeNull();
  });
});

describe('computeStartupSmokeGate', () => {
  const passed = { passed: true };

  it('两段皆过才 gatePassed', () => {
    expect(computeStartupSmokeGate({ command: 'npm run start', cleanStart: passed, restartAfterKill: passed }))
      .toEqual({ gatePassed: true, reason: 'passed' });
  });

  it('解析不到启动命令时不通过', () => {
    expect(computeStartupSmokeGate({ command: null })).toEqual({
      gatePassed: false,
      reason: 'no-startup-command',
    });
  });

  it('干净启动失败 → clean-start-failed', () => {
    expect(
      computeStartupSmokeGate({
        command: 'npm run start',
        cleanStart: { passed: false, exitCode: 1 },
        restartAfterKill: passed,
      }).reason,
    ).toBe('clean-start-failed');
  });

  it('强杀后再启动失败 → restart-after-kill-failed（陈旧锁类缺陷）', () => {
    expect(
      computeStartupSmokeGate({
        command: 'npm run start',
        cleanStart: passed,
        restartAfterKill: { passed: false, exitCode: 1 },
      }).reason,
    ).toBe('restart-after-kill-failed');
  });
});

describe('evaluateStartupSmokeResult', () => {
  const validBase = {
    command: 'npm run start',
    gatePassed: true,
    restartAfterKill: { passed: true },
  };

  it('缺产物时不通过', () => {
    expect(evaluateStartupSmokeResult(null).reason).toBe('no-startup-smoke-result');
  });

  it('gatePassed 非 true 时带出具体 reason', () => {
    expect(
      evaluateStartupSmokeResult({ ...validBase, gatePassed: false, reason: 'clean-start-failed' }).reason,
    ).toBe('startup-smoke-not-passed:clean-start-failed');
  });

  it('缺重启段记录时不通过（不得只做一次性启动验证）', () => {
    expect(
      evaluateStartupSmokeResult({
        command: 'npm run start',
        gatePassed: true,
        capturedAt: new Date().toISOString(),
      }).reason,
    ).toBe('startup-smoke-missing-restart-phase');
  });

  it('缺可解析时间戳时不通过', () => {
    expect(evaluateStartupSmokeResult(validBase).reason).toBe('startup-smoke-missing-timestamp');
    expect(evaluateStartupSmokeResult({ ...validBase, capturedAt: 'not-a-date' }).reason).toBe(
      'startup-smoke-missing-timestamp',
    );
  });

  it('超过新鲜度上限时判为陈旧，不得复用历史结果', () => {
    const now = Date.parse('2026-07-29T12:00:00.000Z');
    const stale = new Date(now - (DEFAULT_MAX_AGE_HOURS + 1) * 3600_000).toISOString();
    expect(evaluateStartupSmokeResult({ ...validBase, capturedAt: stale }, { now }).reason).toBe(
      'startup-smoke-stale',
    );
    const fresh = new Date(now - 3600_000).toISOString();
    expect(evaluateStartupSmokeResult({ ...validBase, capturedAt: fresh }, { now }).ok).toBe(true);
  });

  it('maxAgeHours 可由配置放宽/收紧', () => {
    const now = Date.parse('2026-07-29T12:00:00.000Z');
    const capturedAt = new Date(now - 5 * 3600_000).toISOString();
    expect(evaluateStartupSmokeResult({ ...validBase, capturedAt }, { now, maxAgeHours: 2 }).ok).toBe(false);
    expect(evaluateStartupSmokeResult({ ...validBase, capturedAt }, { now, maxAgeHours: 8 }).ok).toBe(true);
  });
});
