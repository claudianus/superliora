/**
 * scenario-dashboard-attach — AC2 evidence.
 *
 * Verifies the operator path: group Needs input → Working → Idle,
 * mask last_prompt secrets, and that Enter-attach targets needs_input first.
 */
import type { JsonObject, SessionSummary } from '@superliora/sdk';
import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_GROUP_LABELS_KO,
  DASHBOARD_GROUP_ORDER,
  dashboardRowsFromSessions,
  flattenDashboardGroups,
  groupDashboardRows,
  maskSecretLikePrompt,
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
    workDir: '/Users/modumaru/Desktop/code/superliora',
    sessionDir: `/tmp/sessions/${input.id}`,
    createdAt: 1,
    updatedAt: input.updatedAt ?? 2,
    metadata: input.metadata,
  };
}

describe('scenario-dashboard-attach', () => {
  it('orders groups Needs input → Working → Idle with Korean labels', () => {
    const rows = dashboardRowsFromSessions([
      summary({
        id: 'ses_idle',
        title: '정리 작업',
        lastPrompt: '정리해 줘',
        updatedAt: 100,
      }),
      summary({
        id: 'ses_need',
        title: '승인 대기',
        lastPrompt: `export OPENAI_API_KEY=${['sk', 'example', 'SHOULD-NOT-LEAK'].join('-')}`,
        metadata: { pendingApproval: true },
        updatedAt: 300,
      }),
      summary({
        id: 'ses_work',
        title: '빌드 중',
        lastPrompt: '빌드 돌려',
        metadata: { streaming: true },
        updatedAt: 200,
      }),
    ]);

    const groups = groupDashboardRows(rows);
    expect(groups.map((g) => g.id)).toEqual([...DASHBOARD_GROUP_ORDER]);
    expect(groups[0]!.label).toBe(DASHBOARD_GROUP_LABELS_KO.needs_input);
    expect(groups[1]!.label).toBe(DASHBOARD_GROUP_LABELS_KO.working);
    expect(groups[2]!.label).toBe(DASHBOARD_GROUP_LABELS_KO.idle);

    // Enter attach selection order: first flat row is needs_input
    const flat = flattenDashboardGroups(groups);
    expect(flat[0]!.id).toBe('ses_need');
    expect(flat[0]!.status).toBe('needs_input');
    expect(flat[1]!.status).toBe('working');
    expect(flat[2]!.status).toBe('idle');
  });

  it('masks secret-like last_prompt before operator surface', () => {
    // Avoid API-key shaped literals (secret scanners flag test fixtures).
    const keyVal = ['sk', 'example', 'abcdef'].join('-');
    const tokVal = ['tok', 'example', 'xyz'].join('-');
    const secret = `OPENAI_API_KEY=${keyVal} TOKEN=${tokVal}`;
    const masked = maskSecretLikePrompt(secret);
    expect(masked).not.toContain(keyVal);
    expect(masked).not.toContain(tokVal);
    expect(masked).toContain('***');

    const rows = dashboardRowsFromSessions([
      summary({
        id: 'ses_secret',
        lastPrompt: secret,
        metadata: { needsInput: true },
      }),
    ]);
    expect(rows[0]!.last_prompt).not.toContain(keyVal);
    expect(rows[0]!.last_prompt).toContain('***');
  });

  it('simulates attach selection: operator picks needs_input session id', () => {
    const rows = dashboardRowsFromSessions([
      summary({ id: 'a', metadata: { busy: true } }),
      summary({ id: 'b', metadata: { needsInput: true } }),
      summary({ id: 'c' }),
    ]);
    const flat = flattenDashboardGroups(groupDashboardRows(rows));
    // Dashboard component prefers needs_input as initial selection
    const preferredIndex = flat.findIndex((s) => s.status === 'needs_input');
    expect(preferredIndex).toBe(0);
    const attachTarget = flat[preferredIndex]!;
    // Attach contract: resume by id (wired in liora-tui handleAgentDashboardSelect)
    expect(attachTarget.id).toBe('b');
    expect(attachTarget.work_dir).toBe('/Users/modumaru/Desktop/code/superliora');
  });
});
