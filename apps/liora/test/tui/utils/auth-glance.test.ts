import { describe, expect, it } from 'vitest';
import { SUPERLIORA_PROVIDER_NAME } from '@superliora/oauth';

import {
  ACCOUNTS_POOL_RESILIENCE_HINT,
  buildNeverHaltOAuthResilienceLines,
  formatOpsAuthLine,
  formatOpsAuthLineFromSessionStatus,
  formatOpsPermissionLine,
  formatOAuthProactivePollLabel,
  OPS_AUTH_OK_ACCOUNTS_TIP,
  OPS_AUTH_OK_SECRETS_TIP,
  oauthAccountsResilienceTips,
  resolveOAuthPoolGlance,
  resolveOAuthPoolGlanceFromConfig,
  resolveOAuthPoolGlanceFromStatus,
} from '#/tui/utils/never-halt/auth-glance';

describe('auth-glance', () => {
  it('shows bare ok when oauth is not degraded (legacy call)', () => {
    expect(formatOpsAuthLine(null)).toBe('Auth: ok');
    expect(formatOpsAuthLine(undefined)).toBe('Auth: ok');
    expect(formatOpsAuthLine({ scope: 'search', reason: 'paid_channels_cooling' })).toBe('Auth: ok');
  });

  it('appends /accounts tip on ok when showOkTip is set', () => {
    expect(formatOpsAuthLine({ degraded: null, showOkTip: true })).toBe(
      `Auth: ok · ${OPS_AUTH_OK_ACCOUNTS_TIP}`,
    );
    expect(formatOpsAuthLine({ degraded: undefined, showOkTip: true })).toBe(
      `Auth: ok · ${OPS_AUTH_OK_ACCOUNTS_TIP}`,
    );
  });

  it('prefers secrets tip when provider keys are missing', () => {
    expect(
      formatOpsAuthLine({ degraded: null, secretsMissing: true, showOkTip: true }),
    ).toBe(`Auth: ok · ${OPS_AUTH_OK_SECRETS_TIP}`);
  });

  it('shows refresh due from runtimeDegraded oauth scope', () => {
    const line = formatOpsAuthLine({
      scope: 'oauth',
      reason: 'token_refresh_failed',
      hint: 'Run /login or check Accounts pool',
    });
    expect(line).toBe('Auth: refresh due · token_refresh_failed · Run /login or check Accounts po…');
  });

  it('soft-wires pool status and oauth↓ TTL for proactive refresh degraded', () => {
    const now = 50_000;
    expect(
      formatOpsAuthLine({
        degraded: null,
        showOkTip: true,
        poolSize: 2,
        nextRefreshAtMs: now + 180_000,
        nowMs: now,
      }),
    ).toBe('Auth: ok · pool×2 · next refresh 3m');

    expect(
      formatOpsAuthLine({
        degraded: null,
        showOkTip: true,
      }),
    ).toBe(`Auth: ok · ${OPS_AUTH_OK_ACCOUNTS_TIP}`);

    const degradedAt = now - 30_000;
    const line = formatOpsAuthLine({
      scope: 'oauth',
      reason: 'refresh failed',
      atMs: degradedAt,
      nowMs: now,
    });
    expect(line).toBe('Auth: refresh due · refresh failed · oauth↓ 1m 30s');

    const statusGlance = resolveOAuthPoolGlanceFromStatus({
      oauth: { poolSize: 3, nextRefreshAtMs: now + 60_000 },
    });
    expect(statusGlance).toEqual({ poolSize: 3, nextRefreshAtMs: now + 60_000 });
    const neverHalt = buildNeverHaltOAuthResilienceLines(statusGlance, now);
    expect(neverHalt.some((row) => row.startsWith('Live: pool×3'))).toBe(true);
  });

  it('merges SessionStatus.oauth nextRefresh with config poolSize fallback', () => {
    const now = 100_000;
    const providers = {
      [SUPERLIORA_PROVIDER_NAME]: {
        type: 'kimi',
        oauth: { storage: 'file', key: 'oauth/kimi-code' },
        oauths: [{ storage: 'file', key: 'oauth/kimi-code-account-b' }],
      },
    };
    expect(resolveOAuthPoolGlanceFromConfig(providers, SUPERLIORA_PROVIDER_NAME)).toEqual({
      poolSize: 2,
    });

    const glance = resolveOAuthPoolGlance(
      { oauth: { nextRefreshAtMs: now + 120_000 } },
      providers,
      SUPERLIORA_PROVIDER_NAME,
    );
    expect(glance).toEqual({ poolSize: 2, nextRefreshAtMs: now + 120_000 });

    const line = formatOpsAuthLineFromSessionStatus({
      degraded: null,
      showOkTip: true,
      status: { oauth: { poolSize: 3, nextRefreshAtMs: now + 60_000 } },
      nowMs: now,
    });
    expect(line).toBe('Auth: ok · pool×3 · next refresh 1m');
  });

  it('buildNeverHaltOAuthResilienceLines covers proactive refresh and pool failover', () => {
    const lines = buildNeverHaltOAuthResilienceLines();
    expect(lines.join('\n')).toContain('OAuth proactive refresh');
    expect(lines.join('\n')).toContain(formatOAuthProactivePollLabel());
    expect(lines.join('\n')).toContain('failover on 401/quota');
    expect(lines.join('\n')).toContain('/login --add');
  });

  it('oauthAccountsResilienceTips mention proactive poll and pool failover', () => {
    const tips = oauthAccountsResilienceTips().join('\n');
    expect(tips).toContain('Proactive refresh');
    expect(tips).toContain('Account pool');
    expect(tips).toContain('401 failover');
  });

  it('exports Accounts picker resilience hint', () => {
    expect(ACCOUNTS_POOL_RESILIENCE_HINT).toContain('Proactive refresh');
    expect(ACCOUNTS_POOL_RESILIENCE_HINT).toContain('401/quota');
  });

  it('truncates long oauth degradation text', () => {
    const line = formatOpsAuthLine({
      scope: 'oauth',
      reason: 'A'.repeat(80),
    });
    expect(line.startsWith('Auth: refresh due · ')).toBe(true);
    expect(line).toContain('…');
    expect(line.length).toBeLessThan(90);
  });

  it('formats Ops permission line with live session SSOT', () => {
    expect(formatOpsPermissionLine('auto')).toBe('Permission: auto');
    expect(formatOpsPermissionLine('auto', 'auto')).toBe('Permission: auto · live session confirms');
    expect(formatOpsPermissionLine('auto', 'manual')).toBe('Permission: auto (TUI) · session manual');
    expect(formatOpsPermissionLine('yolo', 'yolo')).toBe(
      'Permission: yolo · live session · trusted workspace assumed',
    );
  });
});
