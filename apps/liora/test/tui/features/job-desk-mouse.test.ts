/**
 * Job Desk mouse hit-test — card clicks open the Job Deck via the native
 * input router. Pins the rect + panel hit map contract.
 */

import { describe, expect, it } from 'vitest';

import { JobDeskPanelComponent } from '#/tui/components/chrome/job-desk/job-desk-panel';
import { jobDeskCardIdAtMouse } from '#/tui/features/job-desk/job-desk-mouse';
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

describe('jobDeskCardIdAtMouse', () => {
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

    let hit: string | undefined;
    for (let x = 10; x < 130 && hit === undefined; x += 1) {
      hit = jobDeskCardIdAtMouse(state, mouse(x, 5 + row));
    }
    expect(hit).toBe('job_a1b2c3d4');
  });

  it('ignores clicks outside the jobs rect or with the wrong button', () => {
    const panel = new JobDeskPanelComponent();
    panel.setSnapshot(snapshotOf([card('job_a1b2c3d4', 'migrate billing')]));
    panel.render(120);
    const state = warmJobsState(panel, { x: 10, y: 5, width: 120, height: 20 });

    expect(jobDeskCardIdAtMouse(state, mouse(0, 0))).toBeUndefined();
    expect(
      jobDeskCardIdAtMouse(state, {
        ...mouse(15, 8),
        button: 'right',
      }),
    ).toBeUndefined();
  });

  it('returns undefined when the panel is hidden/empty', () => {
    const panel = new JobDeskPanelComponent();
    const state = warmJobsState(panel, { x: 0, y: 0, width: 80, height: 10 });
    expect(jobDeskCardIdAtMouse(state, mouse(2, 2))).toBeUndefined();
  });
});

function warmJobsState(
  panel: JobDeskPanelComponent,
  rect: { x: number; y: number; width: number; height: number },
): TUIState {
  return {
    jobDeskPanel: panel,
    cachedJobsRect: rect,
    cachedTranscriptColumns: 120,
    cachedTranscriptRows: 40,
    terminal: { columns: 120, rows: 40 },
  } as unknown as TUIState;
}
