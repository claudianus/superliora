import { describe, expect, it } from 'vitest';

import type { ConductorJobCard } from '../../../../src/tui/utils/job/job-strip';
import {
  buildSessionOutcomeBoard,
  flattenSessionOutcomes,
  formatSessionOutcomeLine,
  isAutoOutcomeChild,
  shouldOpenSessionOutcomeBoard,
  summarizeBlockedReason,
} from '../../../../src/tui/utils/job/session-outcome-board';

function card(partial: Partial<ConductorJobCard> & Pick<ConductorJobCard, 'id' | 'title' | 'status'>): ConductorJobCard {
  return {
    kind: 'implement',
    priority: 0,
    updatedAtMs: 1_000,
    ...partial,
  };
}

describe('session-outcome-board', () => {
  it('does not open for empty or single-job sessions', () => {
    expect(shouldOpenSessionOutcomeBoard(0)).toBe(false);
    expect(shouldOpenSessionOutcomeBoard(1)).toBe(false);
    expect(shouldOpenSessionOutcomeBoard(2)).toBe(true);
  });

  it('collapses verify/debug children under the parent outcome', () => {
    const board = buildSessionOutcomeBoard([
      card({
        id: 'job_parent',
        title: 'TUI 세션 결과 현황판',
        status: 'done',
        kind: 'implement',
        priority: 2,
      }),
      card({
        id: 'job_verify',
        title: 'Verify: TUI 세션 결과 현황판',
        status: 'running',
        kind: 'verify',
        parentJobId: 'job_parent',
        priority: 1,
        updatedAtMs: 2_000,
      }),
      card({
        id: 'job_debug',
        title: 'Debug: TUI 세션 결과 현황판',
        status: 'queued',
        kind: 'implement',
        parentJobId: 'job_parent',
        debugFixer: true,
        priority: 1,
      }),
    ]);

    expect(board.totalJobs).toBe(3);
    expect(board.totalOutcomes).toBe(1);
    expect(board.remaining).toHaveLength(1);
    expect(board.remaining[0]!.title).toBe('TUI 세션 결과 현황판');
    expect(board.remaining[0]!.status).toBe('verify_only');
    expect(board.remaining[0]!.collapsedChildCount).toBe(2);
    expect(isAutoOutcomeChild(card({
      id: 'job_verify',
      title: 'v',
      status: 'running',
      kind: 'verify',
      parentJobId: 'job_parent',
    }))).toBe(true);
  });

  it('orders blocked and remaining above done', () => {
    const board = buildSessionOutcomeBoard([
      card({ id: 'job_done', title: 'harness shipped', status: 'done', kind: 'implement' }),
      card({
        id: 'job_blocked',
        title: 'game not on main',
        status: 'blocked',
        kind: 'implement',
        resultSummary: 'no origin remote configured',
        priority: 3,
      }),
      card({
        id: 'job_run',
        title: 'still coding',
        status: 'running',
        kind: 'implement',
        priority: 1,
      }),
    ]);

    const flat = flattenSessionOutcomes(board);
    expect(flat.map((r) => r.bucket)).toEqual(['blocked', 'remaining', 'done']);
    expect(flat[0]!.statusLabel).toBe('막힘');
    expect(flat[0]!.reason).toBe('원격(origin) 없음');
    expect(flat[1]!.statusLabel).toBe('진행');
    expect(flat[2]!.statusLabel).toBe('끝남');
  });

  it('labels ledger failed + verifyVerdict pass as code pass / ledger fail', () => {
    const board = buildSessionOutcomeBoard([
      card({
        id: 'job_impl',
        title: 'clipboard paste',
        status: 'failed',
        kind: 'implement',
        resultSummary: 'ledger write failed after worker done',
      }),
      card({
        id: 'job_v',
        title: 'Verify: clipboard paste',
        status: 'done',
        kind: 'verify',
        parentJobId: 'job_impl',
        verifyVerdict: 'passed',
      }),
    ]);

    expect(board.totalOutcomes).toBe(1);
    expect(board.done).toHaveLength(1);
    expect(board.done[0]!.status).toBe('code_pass_ledger_fail');
    expect(board.done[0]!.statusLabel).toBe('코드 통과·장부 실패');
    expect(board.done[0]!.reason).toBe('코드 통과, 장부 실패(환경)');
    expect(formatSessionOutcomeLine(board.done[0]!)).toContain('코드 통과·장부 실패');
  });

  it('summarizes known block reasons', () => {
    expect(
      summarizeBlockedReason(
        card({
          id: 'a',
          title: 'x',
          status: 'blocked',
          resultSummary: 'BrowserStatus EINVAL on host',
        }),
      ),
    ).toBe('호스트 브라우저(EINVAL)');
    expect(
      summarizeBlockedReason(
        card({
          id: 'b',
          title: 'x',
          status: 'blocked',
          resultSummary: 'wrong repo land — metalslug isolation',
        }),
      ),
    ).toBe('잘못된 레포 착지');
  });
});
