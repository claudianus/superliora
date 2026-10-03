/**
 * Conductor Timeline projection + panel smoke.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { ConductorTimelinePanelComponent } from '#/tui/components/panes/conductor-timeline/timeline-panel';
import { setActiveAppearancePreferences } from '#/tui/features/appearance/appearance-effects';
import {
  buildConductorTimeline,
  countConductorTimelineEntries,
  TIMELINE_ENTRY_WINDOW,
  stageForJob,
} from '#/tui/features/control-tower/timeline';
import {
  emptyConductorJobsSnapshot,
  type ConductorJobCard,
  type ConductorJobsSnapshot,
} from '#/tui/utils/job/job-strip';

function card(
  partial: Pick<ConductorJobCard, 'id' | 'title' | 'status'> &
    Partial<ConductorJobCard>,
): ConductorJobCard {
  return {
    kind: 'task',
    priority: 0,
    updatedAtMs: Date.now(),
    ...partial,
  };
}

describe('conductor timeline', () => {
  afterEach(() => {
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('maps recorded Job statuses and orders queued→done→failed', () => {
    expect(stageForJob(card({ id: 'a', title: 'q', status: 'queued' }))).toBe('queued');
    expect(stageForJob(card({ id: 'b', title: 'r', status: 'running' }))).toBe('running');
    expect(stageForJob(card({ id: 'c', title: 'n', status: 'needs_user' }))).toBe(
      'needs_user',
    );
    expect(stageForJob(card({ id: 'd', title: 'd', status: 'done' }))).toBe('done');
    expect(stageForJob(card({ id: 'e', title: 'f', status: 'failed' }))).toBe('failed');
    expect(stageForJob(card({ id: 'f', title: 'x', status: 'cancelled' }))).toBe('cancelled');
    expect(stageForJob(card({ id: 'paused', title: 'Resume manually', status: 'interrupted' }))).toBe('interrupted');
    expect(stageForJob(card({ id: 'blocked', title: 'Blocked', status: 'blocked' }))).toBe('blocked');

    const snap: ConductorJobsSnapshot = {
      ...emptyConductorJobsSnapshot(),
      jobs: [
        card({ id: 'job_done', title: 'Landed', status: 'done', updatedAtMs: 3 }),
        card({ id: 'job_run', title: 'Working', status: 'running', updatedAtMs: 2 }),
        card({ id: 'job_q', title: 'Waiting', status: 'queued', updatedAtMs: 1 }),
        card({ id: 'job_fail', title: 'Boom', status: 'failed', updatedAtMs: 4 }),
      ],
    };
    const entries = buildConductorTimeline(snap);
    expect(entries.map((e) => e.stage)).toEqual(['queued', 'running', 'done', 'failed']);
  });

  it('renders timeline panel with stage headers (profile off)', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const snap: ConductorJobsSnapshot = {
      ...emptyConductorJobsSnapshot(),
      jobs: [card({ id: 'job_1', title: 'Build UI', status: 'running' })],
    };
    const panel = new ConductorTimelinePanelComponent({
      getSnapshot: () => snap,
    });
    const text = panel.render(80).join('\n');
    expect(text).toContain('Job Timeline');
    expect(text).toContain('Running');
    expect(text).toContain('Build UI');
    expect(text).toContain('↑↓ navigate');
    expect(text).toContain('Esc cancel');
    expect(text).toContain('❯');
  });

  it('windows long timelines and reports full count', () => {
    const jobs = Array.from({ length: TIMELINE_ENTRY_WINDOW + 5 }, (_, i) =>
      card({
        id: `job_${String(i).padStart(4, '0')}`,
        title: `Task ${String(i)}`,
        status: 'running',
        updatedAtMs: 1000 - i,
      }),
    );
    const snap: ConductorJobsSnapshot = {
      ...emptyConductorJobsSnapshot(),
      jobs,
    };
    expect(countConductorTimelineEntries(snap)).toBe(TIMELINE_ENTRY_WINDOW + 5);
    const windowed = buildConductorTimeline(snap, {
      scrollOffset: 0,
      windowSize: TIMELINE_ENTRY_WINDOW,
    });
    expect(windowed).toHaveLength(TIMELINE_ENTRY_WINDOW);
    const scrolled = buildConductorTimeline(snap, {
      scrollOffset: 5,
      windowSize: TIMELINE_ENTRY_WINDOW,
    });
    expect(scrolled).toHaveLength(TIMELINE_ENTRY_WINDOW);
    expect(scrolled[0]?.jobId).not.toBe(windowed[0]?.jobId);
  });

});
