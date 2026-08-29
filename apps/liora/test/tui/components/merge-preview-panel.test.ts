/**
 * Merge Preview Stage — approve/reject callbacks.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { MergePreviewPanelComponent } from '#/tui/components/dialogs/merge-preview/merge-preview-panel';
import { setActiveAppearancePreferences } from '#/tui/features/appearance/appearance-effects';
import type { ConductorJobCard } from '#/tui/utils/job/job-strip';
import type { GitDiffReport } from '#/utils/git/git-diff';

const ENTER = '\r';
const ESC = '\x1B';

const BRANCH_DIFF: GitDiffReport = {
  branch: 'liora/feature',
  files: [
    {
      path: 'src/a.ts',
      status: 'modified',
      added: 2,
      deleted: 1,
      lines: [
        { kind: 'context', lineNum: 1, code: 'const a = 1;' },
        { kind: 'delete', lineNum: 1, code: 'const b = 2;' },
        { kind: 'add', lineNum: 2, code: 'const b = 3;' },
        { kind: 'add', lineNum: 3, code: 'const c = 4;' },
      ],
    },
  ],
  totalAdded: 2,
  totalDeleted: 1,
  truncated: false,
};

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
    expect(lines).toMatch(/Push Preview/i);
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

  it('toggles the branch diff view with D and returns with Esc', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const onApprove = vi.fn();
    const panel = new MergePreviewPanelComponent({
      job: sampleJob(),
      diffReport: BRANCH_DIFF,
      onApprove,
      onReject: vi.fn(),
      onCancel: vi.fn(),
    });

    const decision = panel.render(80).join('\n');
    expect(decision).toMatch(/D diff/);
    expect(decision).not.toContain('src/a.ts');

    panel.handleInput('d');
    const diffView = panel.render(80).join('\n');
    expect(diffView).toContain('src/a.ts');
    expect(diffView).not.toContain('Ship hotfix');

    panel.handleInput(ESC);
    const back = panel.render(80).join('\n');
    expect(back).toContain('Ship hotfix');

    // The decision flow still works after visiting the diff.
    panel.handleInput('y');
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it('renders empty-branch and unavailable diff states inline without a diff view', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const empty = new MergePreviewPanelComponent({
      job: sampleJob(),
      diffReport: { ...BRANCH_DIFF, files: [], totalAdded: 0, totalDeleted: 0 },
      onApprove: vi.fn(),
      onReject: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(empty.render(80).join('\n')).toContain('No changes on this branch');

    const unavailable = new MergePreviewPanelComponent({
      job: sampleJob(),
      diffReport: null,
      onApprove: vi.fn(),
      onReject: vi.fn(),
      onCancel: vi.fn(),
    });
    const lines = unavailable.render(80).join('\n');
    expect(lines).toContain('Diff unavailable');

    // No diff view mounts in either state, so D cannot open one.
    empty.handleInput('d');
    expect(empty.render(80).join('\n')).not.toContain('src/a.ts');
    unavailable.handleInput('d');
    expect(unavailable.render(80).join('\n')).not.toContain('src/a.ts');
  });
});
