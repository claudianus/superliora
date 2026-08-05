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

  it('hitTestCard resolves the job id on the rendered card row', () => {
    const panel = new JobDeskPanelComponent();
    panel.setSnapshot(snapshotOf([card('job_a1b2c3d4', 'migrate the billing service', 'running')]));
    const lines = panel.render(120).map(stripAnsi);
    const row = lines.findIndex((line) => line.includes('migrate the billing'));
    expect(row).toBeGreaterThanOrEqual(0);
    // Sweep across the card row; some cell must resolve to the card id.
    let hit: string | undefined;
    for (let x = 0; x < 120 && hit === undefined; x += 1) {
      hit = panel.hitTestCard(x, row);
    }
    expect(hit).toBe('job_a1b2c3d4');
    // Points outside the board never resolve.
    expect(panel.hitTestCard(0, 0)).toBeUndefined();
    expect(panel.hitTestCard(5, row + 500)).toBeUndefined();
  });

  it('exposes elapsed chips and the desk wall clock in the frame', () => {
    const panel = new JobDeskPanelComponent();
    const createdIso = new Date(Date.now() - 3 * 60_000 - 12_000).toISOString();
    const runningCard: ConductorJobCard = {
      ...card('job_a1b2c3d4', 'long haul work', 'running'),
      createdAtMs: Date.parse(createdIso),
      workerAgentId: 'agent_worker01',
    };
    panel.setSnapshot(snapshotOf([runningCard]));
    const joined = panel.render(120).map(stripAnsi).join('\n');
    expect(joined).toContain('⏱');
    expect(joined).toContain('3m 1');
    expect(joined).toContain('workers');
    expect(joined).toContain('/jobs deck');
    expect(joined).toContain('Alt+J');
  });

  it('renders remembered token chips on cards', () => {
    const panel = new JobDeskPanelComponent();
    panel.setSnapshot(
      snapshotOf([
        {
          ...card('job_a1b2c3d4', 'token work', 'running'),
          usage: { input: 12_000, output: 500, cacheRead: 0 },
        },
      ]),
    );
    const joined = panel.render(120).map(stripAnsi).join('\n');
    expect(joined).toContain('tok');
    expect(joined).toMatch(/12\.5k|12500/);
  });

  it('renders the live worker roster with the current tool and target', () => {
    const panel = new JobDeskPanelComponent();
    panel.setSnapshot(
      snapshotOf([
        {
          ...card('job_worker01', 'worker mission', 'running'),
          workerAgentId: 'agent_worker01',
          workerName: 'builder',
          liveTokens: 12_482,
          progress: {
            phase: 'src/parser.ts',
            recentTools: ['Read'],
          },
          liveActivity: {
            toolCallId: 'call_1',
            name: 'Read',
            target: 'src/parser.ts',
            status: 'running',
            atMs: Date.now(),
          },
        },
      ]),
    );

    const joined = panel.render(120).map(stripAnsi).join('\n');
    expect(joined).toContain('Live workers (1)');
    expect(joined).toContain('builder');
    expect(joined).toContain('Read src/parser.ts');
    expect(joined).toContain('12.5ktok');
  });

  it('invalidates rendered lines when a live snapshot arrives', () => {
    const panel = new JobDeskPanelComponent();
    panel.setSnapshot(snapshotOf([card('job_a1b2c3d4', 'first work', 'running')]));
    expect(panel.render(120).join('\n')).toContain('first work');

    panel.setSnapshot(snapshotOf([card('job_a1b2c3d4', 'new work', 'running')]));
    expect(panel.render(120).join('\n')).toContain('new work');
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
