/**
 * V5-2 — control tower interaction evidence: keyboard and scroll input
 * produce screen updates.
 *
 * Covers the event → screen-update chain at two levels:
 * - component: raw terminal key sequences into `handleInput` repaint the
 *   board (selection pointer, detail pane, scrolled list viewport);
 * - controller: the navigation event updates the stored selection and
 *   requests a repaint; Esc restores the transcript screen.
 */

import { describe, expect, it, vi } from 'vitest';

import { JobBoardApp, type JobBoardProps } from '#/tui/components/job-board/job-board';
import { JobBoardController, type JobBoardHost } from '#/tui/controllers/panes/job-board';
import type {
  ConductorJobCard,
  ConductorJobsSnapshot,
} from '#/tui/utils/job/job-strip';

/** Raw terminal sequences emitted by an xterm-256color terminal. */
const KEY_UP = '\u001b[A';
const KEY_DOWN = '\u001b[B';
const KEY_HOME = '\u001b[H';
const KEY_END = '\u001b[F';
const KEY_ESCAPE = '\u001b';

const ROWS = 24;
const COLS = 100;

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function card(id: string, status: ConductorJobCard['status'], index: number): ConductorJobCard {
  return {
    id,
    title: `work on ${id}`,
    status,
    kind: 'task',
    priority: (index % 3) + 1,
    updatedAtMs: 1_700_000_000_000 - index * 7_000,
  };
}

/** 64 jobs across all 8 status groups — enough rows to overflow the list viewport. */
function fullBoardSnapshot(): ConductorJobsSnapshot {
  const statuses: ConductorJobCard['status'][] = [
    'running',
    'needs_user',
    'blocked',
    'queued',
    'interrupted',
    'failed',
    'done',
    'cancelled',
  ];
  const jobs: ConductorJobCard[] = [];
  for (let i = 0; i < 64; i++) {
    jobs.push(card(`job_${String(i).padStart(4, '0')}`, statuses[i % statuses.length]!, i));
  }
  return {
    total: 64,
    queued: 8,
    running: 8,
    blocked: 8,
    needsUser: 8,
    interrupted: 8,
    failed: 8,
    unreadInbox: 0,
    maxConcurrent: 8,
    jobs,
    inbox: [],
  };
}

function makeApp(options: { readonly onSelect?: (jobId: string) => void } = {}) {
  const onSelect = options.onSelect ?? vi.fn();
  const props: JobBoardProps = {
    snapshot: fullBoardSnapshot(),
    selectedJobId: 'job_0000',
    flashMessage: undefined,
    onSelect,
    onCancel: vi.fn(),
    onInspect: vi.fn(),
  };
  const app = new JobBoardApp(props, { rows: ROWS, columns: COLS, write: () => {} });
  return { app, props };
}

function renderText(app: JobBoardApp): string {
  return stripAnsi(app.render(COLS).join('\n'));
}

describe('control tower keyboard interaction (V5-2)', () => {
  it('down arrow moves the selection and repaints list pointer + detail pane', () => {
    const onSelect = vi.fn();
    const { app } = makeApp({ onSelect });
    const before = renderText(app);
    expect(before).toContain('Job:      job_0000');

    app.handleInput(KEY_DOWN);
    const after = renderText(app);

    expect(after).not.toEqual(before);
    expect(onSelect).toHaveBeenCalledTimes(1);
    // Running group is sorted priority-desc: the row after job_0000 is job_0024.
    expect(onSelect).toHaveBeenCalledWith('job_0024');
    expect(after).toContain('Job:      job_0024');
    expect(after).toContain('❯ ▸ 0024');
    expect(before).toContain('❯ ▸ 0000');
  });

  it('j/k vim keys mirror arrow navigation', () => {
    const { app } = makeApp();
    app.handleInput('j');
    expect(renderText(app)).toContain('Job:      job_0024');
    app.handleInput('k');
    expect(renderText(app)).toContain('Job:      job_0000');
  });

  it('up arrow at the top job row keeps the screen unchanged', () => {
    const onSelect = vi.fn();
    const { app } = makeApp({ onSelect });
    // The top job row is the sorted running group's first card (job_0008).
    app.handleInput(KEY_HOME);
    onSelect.mockClear();
    const before = renderText(app);
    expect(before).toContain('❯ ▸ 0008');
    app.handleInput(KEY_UP);
    expect(renderText(app)).toEqual(before);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('End scrolls the list viewport to the last job (scroll evidence)', () => {
    const { app } = makeApp();
    const before = renderText(app);
    // The top of the board shows the running group before scrolling.
    expect(before).toContain('running (8)');

    app.handleInput(KEY_END);
    const after = renderText(app);

    expect(after).not.toEqual(before);
    // Viewport scrolled: running group no longer visible, last job selected.
    expect(after).not.toContain('running (8)');
    expect(after).toContain('Job:      job_0063');
    expect(after).toContain('❯ ⊘ 0063');
  });

  it('Home jumps back to the first job row', () => {
    const { app } = makeApp();
    app.handleInput(KEY_END);
    app.handleInput(KEY_HOME);
    const text = renderText(app);
    expect(text).toContain('running (8)');
    expect(text).toContain('❯ ▸ 0008');
    expect(text).toContain('Job:      job_0008');
  });

  it('Esc and q fire the cancel (close) callback', () => {
    const { app, props } = makeApp();
    app.handleInput(KEY_ESCAPE);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    app.handleInput('q');
    expect(props.onCancel).toHaveBeenCalledTimes(2);
  });

  it('Enter inspects the selected job', () => {
    const { app, props } = makeApp();
    app.handleInput('\r');
    expect(props.onInspect).toHaveBeenCalledWith('job_0000');
  });
});

describe('control tower controller event chain (V5-2)', () => {
  function fakeBoardHost(snap: ConductorJobsSnapshot) {
    const children: unknown[] = ['transcript', 'activity', 'editor'];
    const ui = {
      children,
      clear: vi.fn(() => {
        children.length = 0;
      }),
      addChild: vi.fn((child: unknown) => {
        children.push(child);
      }),
      setFocus: vi.fn(),
      requestRender: vi.fn(),
    };
    const state = {
      jobBoard: undefined as unknown,
      terminal: { rows: ROWS, columns: COLS, write: () => {} },
      ui,
      editor: { name: 'editor' },
      appState: { conductorJobs: snap },
    };
    const host = {
      state,
      setJobBoard: vi.fn((value: unknown) => {
        state.jobBoard = value;
      }),
      sendNormalUserInput: vi.fn(),
      showStatus: vi.fn(),
    };
    return { host: host as unknown as JobBoardHost, ui, state };
  }

  it('navigation event updates the stored selection and requests a repaint', () => {
    const { host, ui, state } = fakeBoardHost(fullBoardSnapshot());
    const controller = new JobBoardController(host);
    controller.show();
    expect(ui.requestRender).toHaveBeenCalledTimes(1);
    const board = state.jobBoard as {
      component: JobBoardApp;
      selectedJobId: string | undefined;
    };
    expect(board.selectedJobId).toBe('job_0000');

    // Keyboard event on the mounted board flows back through the controller:
    // selection stored, snapshot re-pushed, render requested.
    board.component.handleInput(KEY_DOWN);

    expect(board.selectedJobId).toBe('job_0024');
    expect(ui.requestRender).toHaveBeenCalledTimes(2);
    const text = stripAnsi(board.component.render(COLS).join('\n'));
    expect(text).toContain('Job:      job_0024');
  });

  it('Esc on the board restores the transcript screen', () => {
    const { host, ui, state } = fakeBoardHost(fullBoardSnapshot());
    const controller = new JobBoardController(host);
    controller.show();
    const board = state.jobBoard as { component: JobBoardApp };

    board.component.handleInput(KEY_ESCAPE);

    expect(state.jobBoard).toBeUndefined();
    expect(ui.children).toEqual(['transcript', 'activity', 'editor']);
    expect(ui.setFocus).toHaveBeenLastCalledWith(state.editor);
    expect(controller.isOpen()).toBe(false);
  });
});
