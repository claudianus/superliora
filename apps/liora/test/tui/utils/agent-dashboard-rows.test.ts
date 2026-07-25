import type { JsonObject, SessionSummary } from '@superliora/sdk';
import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_GROUP_ORDER,
  dashboardGroupCounts,
  dashboardRowsFromSessions,
  flattenDashboardGroups,
  groupDashboardRows,
  maskSecretLikePrompt,
  resolveDashboardStatus,
} from '#/tui/utils/agent-dashboard-rows';

function summary(input: {
  readonly id: string;
  readonly title?: string;
  readonly lastPrompt?: string;
  readonly metadata?: JsonObject;
  readonly updatedAt?: number;
}): SessionSummary {
  return {
    id: input.id,
    title: input.title,
    lastPrompt: input.lastPrompt,
    workDir: '/tmp/project',
    sessionDir: `/tmp/home/sessions/${input.id}`,
    createdAt: 1,
    updatedAt: input.updatedAt ?? 2,
    metadata: input.metadata,
  };
}

describe('maskSecretLikePrompt', () => {
  it('returns null for empty input', () => {
    expect(maskSecretLikePrompt(null)).toBeNull();
    expect(maskSecretLikePrompt('')).toBeNull();
    expect(maskSecretLikePrompt('   ')).toBeNull();
  });

  it('masks KEY/SECRET/TOKEN assignments without leaking values', () => {
    const fake = ['sk', 'example', 'abcdef'].join('-');
    const masked = maskSecretLikePrompt(`set OPENAI_API_KEY=${fake} and continue`);
    expect(masked).not.toContain(fake);
    expect(masked).toContain('OPENAI_API_KEY=***');
  });

  it('masks Bearer tokens', () => {
    // Avoid JWT/API-key shaped literals (secret scanners flag fixtures).
    const token = ['Bearer', 'test-token-value-for-masking'].join(' ');
    const masked = maskSecretLikePrompt(`Authorization: ${token}`);
    expect(masked).not.toContain('test-token-value-for-masking');
    expect(masked?.toLowerCase()).toContain('bearer');
    expect(masked).toContain('***');
  });

  it('masks provider-style secret prefixes', () => {
    const fake = ['sk', 'proj', 'exampleplaceholder'].join('-');
    const masked = maskSecretLikePrompt(`use ${fake} now`);
    expect(masked).not.toContain('exampleplaceholder');
    expect(masked).toContain('***');
  });

  it('passes through ordinary prompts', () => {
    expect(maskSecretLikePrompt('fix the login button')).toBe('fix the login button');
  });
});

describe('resolveDashboardStatus', () => {
  it('prefers explicit status hints', () => {
    const s = summary({ id: 'a', metadata: { status: 'idle' } });
    expect(resolveDashboardStatus(s, { a: 'needs_input' })).toBe('needs_input');
  });

  it('reads metadata.dashboardStatus', () => {
    const s = summary({ id: 'a', metadata: { dashboardStatus: 'working' } });
    expect(resolveDashboardStatus(s)).toBe('working');
  });

  it('maps pendingApproval to needs_input', () => {
    const s = summary({ id: 'a', metadata: { pendingApproval: true } });
    expect(resolveDashboardStatus(s)).toBe('needs_input');
  });

  it('defaults to idle', () => {
    expect(resolveDashboardStatus(summary({ id: 'a' }))).toBe('idle');
  });
});

describe('dashboardRowsFromSessions + groupDashboardRows', () => {
  it('groups in Needs input → Working → Idle order', () => {
    const rows = dashboardRowsFromSessions(
      [
        summary({ id: 'idle-1', title: 'Idle', updatedAt: 10 }),
        summary({
          id: 'need-1',
          title: 'Need',
          lastPrompt: 'API_KEY=should-mask',
          metadata: { needsInput: true },
          updatedAt: 30,
        }),
        summary({
          id: 'work-1',
          title: 'Work',
          metadata: { streaming: true },
          updatedAt: 20,
        }),
      ],
      { statusHints: {} },
    );

    const groups = groupDashboardRows(rows);
    expect(groups.map((g) => g.id)).toEqual([...DASHBOARD_GROUP_ORDER]);
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(['need-1']);
    expect(groups[1]!.sessions.map((s) => s.id)).toEqual(['work-1']);
    expect(groups[2]!.sessions.map((s) => s.id)).toEqual(['idle-1']);

    // Masked prompt on needs_input row
    expect(groups[0]!.sessions[0]!.last_prompt).not.toContain('should-mask');
    expect(groups[0]!.sessions[0]!.last_prompt).toContain('***');
  });

  it('supports Enter-attach selection order via flatten', () => {
    const rows = dashboardRowsFromSessions([
      summary({ id: 'i', metadata: { status: 'idle' }, updatedAt: 1 }),
      summary({ id: 'n', metadata: { needsInput: true }, updatedAt: 2 }),
      summary({ id: 'w', metadata: { busy: true }, updatedAt: 3 }),
    ]);
    const flat = flattenDashboardGroups(groupDashboardRows(rows));
    expect(flat.map((r) => r.id)).toEqual(['n', 'w', 'i']);
    // First Enter target in dashboard component prefers needs_input (index 0).
    expect(flat[0]!.status).toBe('needs_input');
  });

  it('counts groups for chrome summary', () => {
    const rows = dashboardRowsFromSessions([
      summary({ id: 'a', metadata: { needsInput: true } }),
      summary({ id: 'b', metadata: { busy: true } }),
      summary({ id: 'c' }),
      summary({ id: 'd' }),
    ]);
    const counts = dashboardGroupCounts(groupDashboardRows(rows));
    expect(counts).toEqual({ needs_input: 1, working: 1, idle: 2 });
  });

  it('uses Korean group labels by default', () => {
    const groups = groupDashboardRows([]);
    expect(groups.find((g) => g.id === 'needs_input')?.label).toBe('입력 필요');
    expect(groups.find((g) => g.id === 'working')?.label).toBe('작업 중');
    expect(groups.find((g) => g.id === 'idle')?.label).toBe('대기');
  });
});
