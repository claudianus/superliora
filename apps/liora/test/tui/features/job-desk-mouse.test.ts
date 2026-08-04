/**
 * Job Desk mouse hit-test — card/panel clicks open the Job Deck via the
 * native input router. Pins the rect + panel hit map contract, including
 * chrome-signature cache busting when the Job Desk mounts mid-session.
 */

import { describe, expect, it } from 'vitest';

import { JobDeskPanelComponent } from '#/tui/components/chrome/job-desk/job-desk-panel';
import {
  jobDeskCardIdAtMouse,
  jobDeskHitAtMouse,
} from '#/tui/features/job-desk/job-desk-mouse';
import {
  hitTestChromeSignature,
  invalidateTranscriptHitTestCache,
} from '#/tui/features/transcript/transcript-hit-test';
import type { NativeInputMouseEvent } from '#/tui/renderer';
import type { TUIState } from '#/tui/tui-state';
import type { ConductorJobCard, ConductorJobsSnapshot } from '#/tui/utils/job/job-strip';

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function card(id: string, title: string): ConductorJobCard {
  return { id, title, status: 'running', kind: 'task', priority: 1, updatedAtMs: 0 };
}

function snapshotOf(cards: readonly ConductorJobCard[]): ConductorJobsSnapshot {
  return {
    total: cards.length,
    queued: 0,
    running: cards.length,
    blocked: 0,
    needsUser: 0,
    interrupted: 0,
    failed: 0,
    unreadInbox: 0,
    jobs: cards,
    inbox: [],
  };
}

function mouse(x: number, y: number): NativeInputMouseEvent {
  return {
    type: 'mouse',
    action: 'press',
    button: 'left',
    x,
    y,
    raw: '',
    ctrl: false,
    alt: false,
    shift: false,
  };
}

describe('jobDeskHitAtMouse', () => {
  it('resolves a left-click on a rendered Job Desk card', () => {
    const panel = new JobDeskPanelComponent();
    panel.setSnapshot(snapshotOf([card('job_a1b2c3d4', 'migrate billing')]));
    const lines = panel.render(120).map(stripAnsi);
    const row = lines.findIndex((line) => line.includes('migrate billing'));
    expect(row).toBeGreaterThanOrEqual(0);

    const state = warmJobsState(panel, {
      x: 10,
      y: 5,
      width: 120,
      height: lines.length,
    });

    let hit: ReturnType<typeof jobDeskHitAtMouse>;
    let hitX = -1;
    for (let x = 10; x < 130; x += 1) {
      hit = jobDeskHitAtMouse(state, mouse(x, 5 + row));
      if (hit?.kind === 'card') {
        hitX = x;
        break;
      }
    }
    expect(hit).toEqual({ kind: 'card', jobId: 'job_a1b2c3d4' });
    expect(jobDeskCardIdAtMouse(state, mouse(hitX, 5 + row))).toBe('job_a1b2c3d4');
  });

  it('treats a click inside the jobs rect (missed card) as a panel hit', () => {
    const panel = new JobDeskPanelComponent();
    panel.setSnapshot(snapshotOf([card('job_a1b2c3d4', 'migrate billing')]));
    panel.render(120);
    const state = warmJobsState(panel, { x: 10, y: 5, width: 120, height: 20 });
    // Top-left of the region is typically chrome/title, not a card cell.
    expect(jobDeskHitAtMouse(state, mouse(10, 5))).toEqual({ kind: 'panel' });
  });

  it('ignores clicks outside the jobs rect or with the wrong button', () => {
    const panel = new JobDeskPanelComponent();
    panel.setSnapshot(snapshotOf([card('job_a1b2c3d4', 'migrate billing')]));
    panel.render(120);
    const state = warmJobsState(panel, { x: 10, y: 5, width: 120, height: 20 });

    expect(jobDeskHitAtMouse(state, mouse(0, 0))).toBeUndefined();
    expect(
      jobDeskHitAtMouse(state, {
        ...mouse(15, 8),
        button: 'right',
      }),
    ).toBeUndefined();
  });

  it('returns undefined when the panel is hidden/empty', () => {
    const panel = new JobDeskPanelComponent();
    const state = warmJobsState(panel, { x: 0, y: 0, width: 80, height: 10 });
    expect(jobDeskHitAtMouse(state, mouse(2, 2))).toBeUndefined();
  });
});

describe('hit-test chrome signature', () => {
  it('changes when the Job Desk mounts so the layout cache busts', () => {
    const panel = new JobDeskPanelComponent();
    const state = {
      jobDeskPanel: panel,
      todoPanel: { isEmpty: () => true },
      appState: { conductorJobs: null },
    } as unknown as TUIState;
    const emptySig = hitTestChromeSignature(state);
    panel.setSnapshot(snapshotOf([card('job_a1b2c3d4', 'work')]));
    (state as { appState: { conductorJobs: ConductorJobsSnapshot } }).appState.conductorJobs =
      snapshotOf([card('job_a1b2c3d4', 'work')]);
    expect(hitTestChromeSignature(state)).not.toBe(emptySig);
    invalidateTranscriptHitTestCache(state);
    expect(state.cachedJobsRect).toBeUndefined();
    expect(state.cachedHitTestChromeSig).toBeUndefined();
  });
});

function warmJobsState(
  panel: JobDeskPanelComponent,
  rect: { x: number; y: number; width: number; height: number },
): TUIState {
  const jobs = panel.isEmpty()
    ? null
    : snapshotOf([card('job_a1b2c3d4', 'migrate billing')]);
  const state = {
    jobDeskPanel: panel,
    todoPanel: { isEmpty: () => true },
    appState: { conductorJobs: jobs },
    // Fully warm the hit-test layout cache so getTUIStateNativeJobsRect
    // takes the fast path (no planTUINativeStage / real chrome containers).
    cachedTranscriptRect: { x: 0, y: 0, width: 120, height: 20 },
    cachedTranscriptVisibleRows: 20,
    cachedTranscriptStageWidth: 120,
    cachedTranscriptColumns: 120,
    cachedTranscriptRows: 40,
    cachedTranscriptLineCount: 1,
    cachedJobsRect: rect,
    cachedTodoRect: undefined,
    terminal: { columns: 120, rows: 40 },
    editor: { getNativeLayoutRowCount: () => 1 },
    editorContainer: { render: () => [] },
    transcriptContainer: {
      renderWithVisibleRegionLines: () => [],
    },
    transcriptViewport: { start: () => 0 },
  } as unknown as TUIState;
  state.cachedHitTestChromeSig = hitTestChromeSignature(state);
  return state;
}
