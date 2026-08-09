import { describe, expect, it, vi } from 'vitest';

import { maybeApplyStaleWorktrees } from '#/tui/features/control-tower/job-hygiene';
import { formatHygieneGcAppliedNotice } from '#/tui/utils/job/job-hygiene-notice';

describe('formatHygieneGcAppliedNotice', () => {
  it('is silent when nothing was removed', () => {
    expect(formatHygieneGcAppliedNotice(0)).toBeUndefined();
  });

  it('reports removed count', () => {
    const notice = formatHygieneGcAppliedNotice(2);
    expect(notice?.title).toContain('Removed 2');
    expect(notice?.detail).toContain('cleaned up');
  });
});

describe('maybeApplyStaleWorktrees', () => {
  it('applies GC with dryRun false and notices removals', async () => {
    const jobGcWorktrees = vi.fn(async () => ({ removed: 2, kept: 1 }));
    const showNotice = vi.fn();
    const showStatus = vi.fn();

    await maybeApplyStaleWorktrees({
      session: { jobGcWorktrees },
      showNotice,
      showStatus,
    });

    expect(jobGcWorktrees).toHaveBeenCalledWith({ dryRun: false });
    expect(showNotice).toHaveBeenCalledWith(
      expect.stringContaining('Removed 2'),
      expect.any(String),
      expect.objectContaining({ coalesceKey: 'job-hygiene-gc' }),
    );
    expect(showStatus).toHaveBeenCalled();
  });

  it('stays quiet when GC removes nothing', async () => {
    const showNotice = vi.fn();
    await maybeApplyStaleWorktrees({
      session: { jobGcWorktrees: async () => ({ removed: 0, kept: 3 }) },
      showNotice,
    });
    expect(showNotice).not.toHaveBeenCalled();
  });
});
