/**
 * Merge Preview Stage — approve/reject callbacks.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { MergePreviewPanelComponent } from '#/tui/components/dialogs/merge-preview/merge-preview-panel';
import { setActiveAppearancePreferences } from '#/tui/features/appearance/appearance-effects';
import type { ConductorJobCard } from '#/tui/utils/job/job-strip';

const ENTER = '\r';

function sampleJob(overrides: Partial<ConductorJobCard> = {}): ConductorJobCard {
  return {
    id: 'job_abc123',
    title: 'Ship hotfix',
    status: 'done',
    kind: 'implement',
    priority: 0,
    updatedAtMs: Date.now(),
    resultSummary: 'Fixed the race',
    gateChecklist: {
      visual: 'na',
      review: 'pass',
      tests: 'pass',
      typecheck: 'pass',
    },
    ...overrides,
  };
}

describe('MergePreviewPanelComponent', () => {
  afterEach(() => {
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('renders gates, land≠push note, and approves with Y', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const panel = new MergePreviewPanelComponent({
      job: sampleJob(),
      trustReason: 'Checks not green',
      onApprove,
      onReject,
      onCancel: vi.fn(),
    });
    const lines = panel.render(80).join('\n');
    expect(lines).toContain('Ship hotfix');
    expect(lines).toContain('tests=pass');
    expect(lines).toContain('Land ≠ push');
    expect(lines).toContain('Checks are not green yet');

    panel.handleInput('y');
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('rejects with N', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const panel = new MergePreviewPanelComponent({
      job: sampleJob({ status: 'blocked' }),
      onApprove,
      onReject,
      onCancel: vi.fn(),
    });
    panel.handleInput('n');
    expect(onReject).toHaveBeenCalledOnce();
    expect(onApprove).not.toHaveBeenCalled();
    // Keep ENTER imported for smoke — approve path via Enter on default selection.
    const panel2 = new MergePreviewPanelComponent({
      job: sampleJob(),
      onApprove,
      onReject: vi.fn(),
      onCancel: vi.fn(),
    });
    panel2.handleInput(ENTER);
    expect(onApprove).toHaveBeenCalledOnce();
  });
});
