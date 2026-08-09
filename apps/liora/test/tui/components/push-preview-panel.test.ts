/**
 * Push Preview Stage — approve/reject callbacks.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { PushPreviewPanelComponent } from '#/tui/components/dialogs/push-preview/push-preview-panel';
import { setActiveAppearancePreferences } from '#/tui/features/appearance/appearance-effects';
import type { ConductorJobCard } from '#/tui/utils/job/job-strip';

function sampleJob(overrides: Partial<ConductorJobCard> = {}): ConductorJobCard {
  return {
    id: 'job_abc123',
    title: 'Deploy Pages',
    status: 'done',
    kind: 'implement',
    priority: 0,
    updatedAtMs: Date.now(),
    resultSummary: 'Built dist/ for gh-pages',
    worktreePath: '/tmp/job-wt',
    ...overrides,
  };
}

describe('PushPreviewPanelComponent', () => {
  afterEach(() => {
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('renders refspec and approves with Y', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const panel = new PushPreviewPanelComponent({
      job: sampleJob(),
      remote: 'origin',
      localRef: 'gh-pages',
      remoteRef: 'gh-pages',
      onApprove,
      onReject,
      onCancel: vi.fn(),
    });
    const lines = panel.render(80).join('\n');
    expect(lines).toContain('Deploy Pages');
    expect(lines).toContain('gh-pages → origin/gh-pages');
    expect(lines).toContain('Push ≠ land');

    panel.handleInput('y');
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('rejects with N', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const panel = new PushPreviewPanelComponent({
      job: sampleJob({ status: 'blocked' }),
      onApprove,
      onReject,
      onCancel: vi.fn(),
    });
    panel.handleInput('n');
    expect(onReject).toHaveBeenCalledOnce();
    expect(onApprove).not.toHaveBeenCalled();
  });
});
