import { describe, expect, it } from 'vitest';
import type { ConductorJobCard } from '#/tui/utils/job/job-strip';
import { buildSessionOutcomeBoard, flattenSessionOutcomes, formatSessionOutcomeLine, isOutcomeChild, summarizeBlockedReason } from '#/tui/utils/job/session-outcome-board';
function card(partial: Partial<ConductorJobCard> & Pick<ConductorJobCard, 'id' | 'status'>): ConductorJobCard {
  return { title: partial.id, kind: 'task', priority: 0, updatedAtMs: 1000, ...partial };
}
describe('recorded session Job outcomes', () => {
  it('groups only children with a recorded parent and keeps orphan Jobs visible', () => {
    const child = card({ id: 'verify', status: 'running', kind: 'verify', parentJobId: 'parent' });
    const board = buildSessionOutcomeBoard([
      card({ id: 'parent', title: 'Fix login', status: 'done' }), child,
      card({ id: 'orphan', status: 'queued', parentJobId: 'absent' }),
    ]);
    expect(isOutcomeChild(child)).toBe(true);
    expect(board.totalJobs).toBe(3);
    expect(board.totalOutcomes).toBe(2);
    expect(board.remaining.find((row) => row.id === 'parent')).toMatchObject({ title: 'Fix login', status: 'running', collapsedChildCount: 1 });
    expect(board.remaining.some((row) => row.id === 'orphan')).toBe(true);
  });
  it('orders failures and remaining work ahead of completed Jobs', () => {
    const board = buildSessionOutcomeBoard([
      card({ id: 'done', status: 'done' }),
      card({ id: 'running', status: 'running' }),
      card({ id: 'failed', status: 'failed', resultSummary: 'Command failed' }),
    ]);
    expect(flattenSessionOutcomes(board).map((row) => row.bucket)).toEqual(['blocked', 'remaining', 'done']);
    expect(board.blocked[0]?.reason).toBe('Command failed');
    expect(formatSessionOutcomeLine(board.done[0]!)).toContain('done');
  });
  it('does not reinterpret a failure as verified even when a verify child completed', () => {
    const board = buildSessionOutcomeBoard([
      card({ id: 'parent', status: 'failed', resultSummary: 'Commit failed' }),
      card({ id: 'verify', status: 'done', kind: 'verify', parentJobId: 'parent' }),
    ]);
    expect(board.blocked).toHaveLength(1);
    expect(board.done).toHaveLength(0);
  });
  it('keeps cancellation distinct from successful completion', () => {
    const board = buildSessionOutcomeBoard([
      card({ id: 'cancelled', status: 'cancelled' }),
      card({ id: 'parent', status: 'done' }),
      card({ id: 'child', status: 'cancelled', parentJobId: 'parent' }),
    ]);
    expect(board.done).toHaveLength(2);
    expect(board.done.every((row) => row.status === 'cancelled')).toBe(true);
    expect(board.done.every((row) => row.statusLabel === '취소' && row.token === 'textDim')).toBe(true);
  });
  it('shows recorded reasons without inventing host diagnoses or merging failures', () => {
    const failure = card({ id: 'a', status: 'failed', resultSummary: 'spawn EINVAL' });
    expect(summarizeBlockedReason(failure)).toBe('spawn EINVAL');
    expect(summarizeBlockedReason(card({ id: 'empty', status: 'blocked' }))).toBeUndefined();
    expect(buildSessionOutcomeBoard([failure, card({ ...failure, id: 'b' })]).blocked).toHaveLength(2);
  });
});
