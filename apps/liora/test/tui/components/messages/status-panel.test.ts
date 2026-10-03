import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildStatusReportLines,
  createStatusFieldMotionState,
} from '#/tui/components/messages/status-panel/index';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/features/appearance/appearance-effects';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('status panel report lines', () => {
  it('formats runtime status, context, and managed usage without account or AGENTS.md rows', () => {
    const lines = buildStatusReportLines({
      version: '1.2.3',
      model: 'k2',
      workDir: '/tmp/project',
      sessionId: 'ses-1',
      sessionTitle: 'Implement status',
      thinking: true,
      permissionMode: 'manual',
      contextUsage: 0.005,
      contextTokens: 50,
      maxContextTokens: 10000,
      availableModels: {
        k2: {
          provider: 'managed:kimi-api',
          model: 'kimi-k2',
          maxContextSize: 10000,
          displayName: 'Kimi K2',
        },
      },
      availableProviders: {
        'managed:kimi-api': {
          type: 'kimi',
          defaultModel: 'k2',
          oauth: {
            storage: 'file',
            key: 'managed-kimi-code',
          },
        },
      },
      status: {
        model: 'k2',
        thinkingLevel: 'high',
        permission: 'auto',
        contextTokens: 1440,
        maxContextTokens: 12000,
        contextUsage: 0.005,
      },
      gitStatus: {
        branch: 'main',
        dirty: false,
        ahead: 1,
        behind: 0,
        diffAdded: 12,
        diffDeleted: 3,
        changedFileCount: 0,
        changedFiles: [],
        pullRequest: null,
      },
      managedUsage: {
        summary: null,
        limits: [
          {
            label: '5h limit',
            used: 8,
            limit: 100,
            resetHint: 'resets in 1h',
          },
        ],
      },
    }).map(strip);

    const output = lines.join('\n');
    expect(output).toContain('>_ SuperLiora (v1.2.3)');
    expect(output).toMatch(/Model\s+Kimi K2 \(thinking high\)/);
    expect(output).toMatch(/Directory\s+\/tmp\/project/);
    expect(output).toMatch(/Worktree\s+main \[\+12 -3 ↑1\] clean/);
    expect(output).toMatch(/Permissions\s+auto/);
    expect(output).toMatch(/Session\s+ses-1/);
    expect(output).toMatch(/Title\s+Implement status/);
    expect(output).toContain('Context window');
    expect(output).toContain('0.5%');
    expect(output).toContain('(1.4K / 12.0K)');
    expect(output).toMatch(/Runtime\s+autonomous/);
    expect(output).toMatch(/Tools\s+Bash \+ SessionControl \(2\)/);
    expect(output).not.toContain('helpers');
    expect(output).not.toContain('Advanced');
    expect(output).not.toContain('manual workflow commands');
    expect(output).not.toContain('Diagnostics');
    expect(output).not.toContain('harness QA');
    expect(output).not.toContain('internal QA');
    expect(output).not.toContain('/preflight');
    expect(output).not.toContain('/bench');
    expect(output).not.toContain('Recovery');
    expect(output).not.toMatch(/\bBench\b/);
    expect(output).toContain('Plan usage');
    expect(output).toContain('8% used');
    expect(output).not.toContain('Account');
    expect(output).not.toContain('AGENTS.md');
  });

  it('shows the upstream baseline under the release version', () => {
    const lines = buildStatusReportLines({
      version: '0.20.1',
      upstreamBaseline: 'kimi-code 0.22.x @ main@8fbe8553 (sync 2026-07-05, 8fbe85531b05)',
      model: 'k2',
      workDir: '/tmp/project',
      sessionId: 'ses-1',
      sessionTitle: null,
      thinking: false,
      permissionMode: 'manual',
      contextUsage: 0,
      contextTokens: 0,
      maxContextTokens: 0,
      availableModels: {},
    }).map(strip);

    const output = lines.join('\n');
    expect(output).toContain('>_ SuperLiora (v0.20.1)');
    expect(output).toContain('Upstream  kimi-code 0.22.x @ main@8fbe8553 (sync 2026-07-05, 8fbe85531b05)');
  });

  it('falls back to app state and shows status load errors as warnings', () => {
    const lines = buildStatusReportLines({
      version: '1.2.3',
      model: '',
      workDir: '/tmp/project',
      sessionId: '',
      sessionTitle: null,
      thinking: false,
      permissionMode: 'manual',
      contextUsage: 0,
      contextTokens: 0,
      maxContextTokens: 0,
      availableModels: {},
      statusError: 'No active session',
    }).map(strip);

    const output = lines.join('\n');
    expect(output).toMatch(/Model\s+not set/);
    expect(output).toMatch(/Session\s+none/);
    expect(output).toMatch(/Warning\s+No active session/);
    expect(output).toContain('No context window data available.');
    expect(output).toMatch(/Permissions\s+manual/);
    expect(output).toMatch(/Runtime\s+autonomous/);
    expect(output).toMatch(/Tools\s+Bash \+ SessionControl \(2\)/);
    expect(output).not.toContain('Recovery');
    expect(output).not.toMatch(/\bBench\b/);
  });

  it('shows provider route health without exposing secret key values', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let lines: string[] = [];
    try {
      lines = buildStatusReportLines({
        version: '1.2.3',
        model: 'k2',
        workDir: '/tmp/project',
        sessionId: 'ses-1',
        sessionTitle: null,
        thinking: true,
        permissionMode: 'manual',
        contextUsage: 0.005,
        contextTokens: 50,
        maxContextTokens: 10000,
        availableModels: {},
        providerRouteStatus: {
          modelAlias: 'k2',
          strategy: 'round_robin',
          candidates: [
            {
              modelAlias: 'k2',
              providerName: 'openai',
              credentialLabel: 'api_key:1',
              providerModel: 'gpt-primary',
              weight: 3,
              rateLimits: [
                {
                  name: 'requests',
                  limit: 100,
                  remaining: 0,
                  resetAt: now + 60_000,
                },
              ],
              rateLimitHeadroom: 0,
              cooldownUntil: now + 60_000,
              cooldownKind: 'rate_limit',
              lastLatencyMs: 300,
              avgLatencyMs: 140,
              lastFailureAt: now,
              failureCount: 1,
            },
            {
              modelAlias: 'k2',
              providerName: 'openai',
              credentialLabel: 'api_key:2',
              providerModel: 'gpt-backup',
              lastSuccessAt: now,
              successCount: 3,
            },
          ],
        },
      }).map(strip);
    } finally {
      vi.useRealTimers();
    }

    const output = lines.join('\n');
    expect(output).toMatch(/Route\s+round_robin 1\/2 ready; 1 cooling/);
    expect(output).toContain('Provider route');
    expect(output).toMatch(/Strategy\s+round_robin 1\/2 ready; 1 cooling/);
    expect(output).toMatch(
      /#1\s+cooling rate_limit .* openai:api_key:1 -> k2\/gpt-primary weight 3 latency 140ms headroom 0% \[requests:0\/100@1m\] \(fail 1\)/,
    );
    expect(output).toMatch(/#2\s+ready openai:api_key:2 -> k2\/gpt-backup \(ok 3\)/);
    expect(output).not.toContain('sk-real');
  });



  it('shows privacy/ZDR posture when telemetry flag is known', () => {
    const on = buildStatusReportLines({
      version: '0.0.0-test',
      model: 'test-model',
      workDir: '/tmp/work',
      sessionId: 'sess-1',
      sessionTitle: null,
      thinking: false,
      permissionMode: 'manual',
      contextUsage: 0.005,
      contextTokens: 50,
      maxContextTokens: 10000,
      availableModels: {},
      privacyTelemetryEnabled: true,
    }).join('\n');
    expect(on).toContain('Privacy');
    expect(on).toContain('Telemetry ON');

    const off = buildStatusReportLines({
      version: '0.0.0-test',
      model: 'test-model',
      workDir: '/tmp/work',
      sessionId: 'sess-1',
      sessionTitle: null,
      thinking: false,
      permissionMode: 'manual',
      contextUsage: 0.005,
      contextTokens: 50,
      maxContextTokens: 10000,
      availableModels: {},
      privacyTelemetryEnabled: false,
    }).join('\n');
    expect(off).toContain('Telemetry OFF');
  });


  describe('field value crossfade', () => {
    const previous = {
      TERM: process.env['TERM'],
      CI: process.env['CI'],
      NO_COLOR: process.env['NO_COLOR'],
      chalkLevel: chalk.level,
    };

    beforeEach(() => {
      process.env['TERM'] = 'xterm-256color';
      delete process.env['CI'];
      delete process.env['NO_COLOR'];
      chalk.level = 3;
      setAppearanceRenderHealth('healthy');
      setAppearanceRenderQuality('full');
      setActiveAppearancePreferences({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'premium',
        particles: 'premium',
      });
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
      advanceAppearanceAnimationClock(Date.now());
    });

    afterEach(() => {
      vi.useRealTimers();
      chalk.level = previous.chalkLevel;
      setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
      if (previous.TERM === undefined) delete process.env['TERM'];
      else process.env['TERM'] = previous.TERM;
      if (previous.CI === undefined) delete process.env['CI'];
      else process.env['CI'] = previous.CI;
      if (previous.NO_COLOR === undefined) delete process.env['NO_COLOR'];
      else process.env['NO_COLOR'] = previous.NO_COLOR;
    });

    it('crossfades a changed Directory field toward the new value', () => {
      const fieldMotion = createStatusFieldMotionState();
      const base = {
        version: '1.0.0',
        model: 'k2',
        sessionId: 'ses-1',
        sessionTitle: null as string | null,
        thinking: false,
        permissionMode: 'manual' as const,
        contextUsage: 0.1,
        contextTokens: 100,
        maxContextTokens: 1000,
        availableModels: {
          k2: {
            provider: 'managed:kimi-api',
            model: 'kimi-k2',
            maxContextSize: 1000,
            displayName: 'Kimi K2',
          },
        },
        fieldMotion,
      };
      buildStatusReportLines({ ...base, workDir: '/tmp/old' });
      const mid = buildStatusReportLines({ ...base, workDir: '/tmp/new' }).map(strip);
      const dirLine = mid.find((line) => line.includes('Directory'));
      expect(dirLine).toBeDefined();
      // Mid-crossfade still carries the prior value until the window elapses.
      expect(dirLine).toContain('/tmp/old');

      vi.setSystemTime(Date.now() + 800);
      advanceAppearanceAnimationClock(Date.now());
      const settled = buildStatusReportLines({ ...base, workDir: '/tmp/new' }).map(strip);
      const settledDir = settled.find((line) => line.includes('Directory'));
      expect(settledDir).toContain('/tmp/new');
      expect(settledDir).not.toContain('/tmp/old');
    });
  });

  it('shows a Cache hit row when status.cacheHitRate is defined and omits it otherwise', () => {
    const base = {
      version: '1.2.3',
      model: 'k2',
      workDir: '/tmp/project',
      sessionId: 'ses-1',
      sessionTitle: null as string | null,
      thinking: false,
      permissionMode: 'manual' as const,
      contextUsage: 0.1,
      contextTokens: 100,
      maxContextTokens: 1000,
      availableModels: {},
    };
    const status = {
      model: 'k2',
      thinkingLevel: 'high',
      permission: 'auto' as const,
      contextTokens: 100,
      maxContextTokens: 1000,
      contextUsage: 0.1,
    };

    const withRate = buildStatusReportLines({
      ...base,
      status: { ...status, cacheHitRate: 0.42 },
    }).map(strip);
    const withRateOutput = withRate.join('\n');
    expect(withRateOutput).toContain('Cache hit');
    expect(withRateOutput).toContain('42%');

    const withoutRate = buildStatusReportLines({ ...base, status }).map(strip);
    expect(withoutRate.join('\n')).not.toContain('Cache hit');
  });

  it('shows cache warm streak and CacheFreezeGuard state when status exposes them', () => {
    const base = {
      version: '1.2.3',
      model: 'k2',
      workDir: '/tmp/project',
      sessionId: 'ses-1',
      sessionTitle: null as string | null,
      thinking: false,
      permissionMode: 'manual' as const,
      contextUsage: 0.1,
      contextTokens: 100,
      maxContextTokens: 1000,
      availableModels: {},
    };
    const status = {
      model: 'k2',
      thinkingLevel: 'high',
      permission: 'auto' as const,
      contextTokens: 100,
      maxContextTokens: 1000,
      contextUsage: 0.1,
      cacheHitRate: 0.995,
      cacheWarmStreak: 4,
      cacheFrozen: true,
    };

    const output = buildStatusReportLines({ ...base, status }).map(strip).join('\n');
    expect(output).toContain('Cache hit');
    expect(output).toContain('streak×4');
    expect(output).toContain('Cache freeze');
    expect(output).toContain('active (mid-turn)');

    const idle = buildStatusReportLines({
      ...base,
      status: { ...status, cacheFrozen: false },
    })
      .map(strip)
      .join('\n');
    expect(idle).toContain('Cache freeze');
    expect(idle).toContain('idle');
  });

  it('shows cache miss reason histogram when usage.cacheDiagnostics.missReasons has counts', () => {
    const base = {
      version: '1.2.3',
      model: 'k2',
      workDir: '/tmp/project',
      sessionId: 'ses-1',
      sessionTitle: null as string | null,
      thinking: false,
      permissionMode: 'manual' as const,
      contextUsage: 0.1,
      contextTokens: 100,
      maxContextTokens: 1000,
      availableModels: {},
    };
    const status = {
      model: 'k2',
      thinkingLevel: 'high',
      permission: 'auto' as const,
      contextTokens: 100,
      maxContextTokens: 1000,
      contextUsage: 0.1,
      usage: {
        total: {
          inputOther: 100,
          output: 10,
          inputCacheRead: 0,
          inputCacheCreation: 0,
        },
        cacheDiagnostics: {
          toolBlockHash: 'abc',
          toolBlockChanged: false,
          injectionCount: 0,
          messageCount: 3,
          missReasons: { schema_change: 2, prefix_drift: 1 },
        },
      },
    };

    // Runtime usage carries cacheDiagnostics (UsageStatus); SessionUsage typing lags.
    const output = buildStatusReportLines({
      ...base,
      status: status as Parameters<typeof buildStatusReportLines>[0]['status'],
    })
      .map(strip)
      .join('\n');
    expect(output).toContain('Miss reasons');
    expect(output).toContain('schema_change');
    expect(output).toContain('prefix_drift');

    const withoutCounts = buildStatusReportLines({
      ...base,
      status: {
        ...status,
        usage: {
          ...status.usage,
          cacheDiagnostics: {
            ...status.usage.cacheDiagnostics,
            missReasons: {},
          },
        },
      } as Parameters<typeof buildStatusReportLines>[0]['status'],
    })
      .map(strip)
      .join('\n');
    expect(withoutCounts).not.toContain('Miss reasons');
  });


  it('surfaces last effective model route and failover notice', () => {
    const base = {
      version: '1.2.3',
      model: 'k2',
      workDir: '/tmp/project',
      sessionId: 'ses-1',
      sessionTitle: null as string | null,
      thinking: false,
      permissionMode: 'manual' as const,
      contextUsage: 0.1,
      contextTokens: 100,
      maxContextTokens: 1000,
      availableModels: {
        k2: {
          provider: 'managed:kimi-api',
          model: 'kimi-k2',
          maxContextSize: 1000,
          displayName: 'Kimi K2',
        },
        turbo: {
          provider: 'managed:kimi-api',
          model: 'kimi-turbo',
          maxContextSize: 1000,
          displayName: 'Kimi Turbo',
        },
      },
    };
    const lines = buildStatusReportLines({
      ...base,
      lastProviderRouteSelection: {
        modelAlias: 'turbo',
        providerName: 'managed:kimi-api',
        credentialLabel: 'acct-a',
        providerModel: 'kimi-turbo',
      },
      lastModelRouteNotice: {
        kind: 'failover',
        fromAlias: 'k2',
        toAlias: 'turbo',
        reason: 'provider-failover',
        atMs: Date.now() - 2000,
      },
    }).map(strip);
    const output = lines.join('\n');
    expect(output).toContain('Last model route');
    expect(output).toContain('Kimi Turbo');
    expect(output).toMatch(/Kimi K2 → Kimi Turbo|Failover/);
    expect(output).toContain('provider-failover');
  });

  it('surfaces the recorded provider failover reason in Last model route', () => {
    const base = {
      version: '1.2.3',
      model: 'k2',
      workDir: '/tmp/project',
      sessionId: 'ses-1',
      sessionTitle: null as string | null,
      thinking: false,
      permissionMode: 'manual' as const,
      contextUsage: 0.1,
      contextTokens: 100,
      maxContextTokens: 1000,
      availableModels: {
        k2: {
          provider: 'managed:kimi-api',
          model: 'kimi-k2',
          maxContextSize: 1000,
          displayName: 'Kimi K2',
        },
        turbo: {
          provider: 'managed:kimi-api',
          model: 'kimi-turbo',
          maxContextSize: 1000,
          displayName: 'Kimi Turbo',
        },
      },
    };
    const lines = buildStatusReportLines({
      ...base,
      lastModelRouteNotice: {
        kind: 'failover',
        fromAlias: 'k2',
        toAlias: 'turbo',
        reason: 'rate_limit',
        atMs: Date.now() - 1000,
      },
    }).map(strip);
    const output = lines.join('\n');
    expect(output).toContain('Last model route');
    expect(output).toContain('Kimi K2 → Kimi Turbo');
    expect(output).toMatch(/Failover\s+Kimi K2 → Kimi Turbo · rate_limit/);
  });


});
