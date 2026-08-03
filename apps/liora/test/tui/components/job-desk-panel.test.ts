/**
 * Job Desk panel — the Conductor job desk rendered as a kanban board inside
 * the transcript screen (chrome slot below the Todo board). Pins the mount
 * contract: the slot collapses while the ledger is empty or operator-hidden,
 * and renders lane headers + cards once jobs exist.
 */

import { describe, expect, it } from 'vitest';

import {
  JOB_DESK_BOARD_MIN_WIDTH,
  JobDeskPanelComponent,
  syncJobDeskPanelContainer,
} from '#/tui/components/chrome/job-desk/job-desk-panel';
import type { Component } from '#/tui/renderer';
import type {
  ConductorJobCard,
  ConductorJobsSnapshot,
} from '#/tui/utils/job/job-strip';

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function card(
  id: string,
  title: string,
  status: ConductorJobCard['status'],
  priority = 1,
): ConductorJobCard {
  return { id, title, status, kind: 'task', priority, updatedAtMs: 0 };
}

function snapshotOf(cards: readonly ConductorJobCard[]): ConductorJobsSnapshot {
  const count = (status: ConductorJobCard['status']) =>
    cards.filter((entry) => entry.status === status).length;
  return {
    total: cards.length,
    queued: count('queued'),
    running: count('running'),
    blocked: count('blocked'),
    needsUser: count('needs_user'),
    interrupted: count('interrupted'),
    failed: count('failed'),
    unreadInbox: 0,
    jobs: cards,
    inbox: [],
  };
}

function fakeContainer() {
  const children: Component[] = [];
  return {
    children,
    clear: () => {
      children.length = 0;
    },
    addChild: (child: Component) => {
      children.push(child);
    },
  };
}

describe('JobDeskPanelComponent', () => {
  it('collapses to zero rows while the ledger is empty', () => {
    const panel = new JobDeskPanelComponent();
    expect(panel.isEmpty()).toBe(true);
    expect(panel.shouldMount()).toBe(false);
    expect(panel.render(120)).toEqual([]);
  });

  it('renders the kanban frame with lane headers and cards once jobs exist', () => {
    const panel = new JobDeskPanelComponent();
    panel.setSnapshot(
      snapshotOf([
        card('job_a1b2c3d4', 'migrate the billing service', 'running', 3),
        card('job_b2c3d4e5', 'answer needed for rollout', 'needs_user', 2),
        card('job_c3d4e5f6', 'refresh seed ladder', 'queued', 1),
      ]),
    );

    expect(panel.shouldMount()).toBe(true);
    const lines = panel.render(120).map(stripAnsi);
    expect(lines.length).toBeGreaterThan(3);
    const joined = lines.join('\n');
    expect(joined).toContain('Conductor Job Desk');
    expect(joined).toContain('Needs you (1)');
    expect(joined).toContain('Running (1)');
    expect(joined).toContain('Queue (1)');
    // Card titles truncate to the column width; assert on stable prefixes.
    expect(joined).toContain('migrate the billing');
    expect(joined).toContain('answer needed for roll');
  });

  it('lays lanes out side by side at board width', () => {
    const panel = new JobDeskPanelComponent();
    panel.setSnapshot(
      snapshotOf([
        card('job_a1b2c3d4', 'running work', 'running'),
        card('job_b2c3d4e5', 'queued work', 'queued'),
      ]),
    );

    const lines = panel.render(JOB_DESK_BOARD_MIN_WIDTH + 20).map(stripAnsi);
    // Grid mode puts both lane headers on a single row.
    const headerRow = lines.find((line) => line.includes('Running (1)'));
    expect(headerRow).toContain('Queue (1)');
  });

  it('stacks lanes when the stage is narrower than the board minimum', () => {
    const panel = new JobDeskPanelComponent();
    panel.setSnapshot(
      snapshotOf([
        card('job_a1b2c3d4', 'running work', 'running'),
        card('job_b2c3d4e5', 'queued work', 'queued'),
      ]),
    );

    const lines = panel.render(60).map(stripAnsi);
    const runningRow = lines.findIndex((line) => line.includes('Running (1)'));
    const queueRow = lines.findIndex((line) => line.includes('Queue (1)'));
    expect(runningRow).toBeGreaterThanOrEqual(0);
    expect(queueRow).toBeGreaterThan(runningRow);
  });

  it('stays hidden after the operator toggles it off', () => {
    const panel = new JobDeskPanelComponent();
    panel.setSnapshot(snapshotOf([card('job_a1b2c3d4', 'work', 'running')]));
    panel.setHidden(true);
    expect(panel.isHidden()).toBe(true);
    expect(panel.shouldMount()).toBe(false);
    expect(panel.render(120)).toEqual([]);
  });

  it('clear() drops the ledger and re-arms auto-mount', () => {
    const panel = new JobDeskPanelComponent();
    panel.setSnapshot(snapshotOf([card('job_a1b2c3d4', 'work', 'running')]));
    panel.setHidden(true);
    panel.clear();
    expect(panel.isEmpty()).toBe(true);
    expect(panel.isHidden()).toBe(false);
  });
});

describe('syncJobDeskPanelContainer', () => {
  it('mounts the panel only while it should mount', () => {
    const panel = new JobDeskPanelComponent();
    const container = fakeContainer();
    const state = { jobDeskPanel: panel, jobDeskPanelContainer: container };

    syncJobDeskPanelContainer(state);
    expect(container.children).toHaveLength(0);

    panel.setSnapshot(snapshotOf([card('job_a1b2c3d4', 'work', 'running')]));
    syncJobDeskPanelContainer(state);
    expect(container.children).toEqual([panel]);

    panel.setHidden(true);
    syncJobDeskPanelContainer(state);
    expect(container.children).toHaveLength(0);
  });
});
