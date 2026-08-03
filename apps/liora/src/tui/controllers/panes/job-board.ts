/**
 * Conductor Job desk board controller — full-screen takeover, same
 * container-swap pattern as TasksBrowserController. Data is event-driven
 * (`job.updated` / `job.inbox` → appState.conductorJobs → repaint); no
 * polling.
 */

import type { Component, RendererRootUI, RendererTerminalHost } from '#/tui/renderer';

import { JobBoardApp } from '../../components/job-board/job-board';
import type { TUIEditor } from '../../components/editor/editor-contract';
import type { AppState } from '../../types';
import {
  emptyConductorJobsSnapshot,
  type ConductorJobsSnapshot,
} from '../../utils/job/job-strip';

export interface JobBoardHost {
  readonly state: {
    readonly jobBoard: JobBoardState | undefined;
    readonly terminal: RendererTerminalHost;
    readonly ui: RendererRootUI;
    readonly editor: TUIEditor;
    readonly appState: AppState;
  };
  setJobBoard(value: JobBoardState | undefined): void;
  sendNormalUserInput(text: string, options?: { displayText?: string }): void;
  showStatus(msg: string): void;
}

export type JobBoardState = {
  component: JobBoardApp;
  savedChildren: readonly Component[];
  selectedJobId: string | undefined;
};

export class JobBoardController {
  constructor(private readonly host: JobBoardHost) {}

  isOpen(): boolean {
    return this.host.state.jobBoard !== undefined;
  }

  toggle(): void {
    if (this.isOpen()) {
      this.close();
    } else {
      this.show();
    }
  }

  show(): void {
    const { state } = this.host;
    if (state.jobBoard !== undefined) return;

    const snapshot = this.snapshot();
    const selectedJobId = this.pickInitialSelection(snapshot);
    const component = new JobBoardApp(
      {
        snapshot,
        selectedJobId,
        flashMessage: undefined,
        ...this.buildCallbacks(),
      },
      state.terminal,
    );

    const savedChildren = [...state.ui.children];
    state.ui.clear();
    state.ui.addChild(component);
    state.ui.setFocus(component);
    state.ui.requestRender(true);

    this.host.setJobBoard({ component, savedChildren, selectedJobId });
  }

  close(): void {
    const { state } = this.host;
    const board = state.jobBoard;
    if (board === undefined) return;

    state.ui.clear();
    for (const child of board.savedChildren) {
      state.ui.addChild(child);
    }
    this.host.setJobBoard(undefined);
    state.ui.setFocus(state.editor);
    state.ui.requestRender(true);
  }

  /** Re-push the latest conductorJobs snapshot into the open board. */
  repaint(): void {
    const board = this.host.state.jobBoard;
    if (board === undefined) return;
    board.component.setProps({
      snapshot: this.snapshot(),
      selectedJobId: board.selectedJobId,
      flashMessage: undefined,
      ...this.buildCallbacks(),
    });
    this.host.state.ui.requestRender();
  }

  /** Close the board and run `/job inspect <id>` in the transcript. */
  inspect(jobId: string): void {
    this.close();
    this.host.sendNormalUserInput(
      `Use JobInspect with job_id=${jobId} and summarize status, paths, worktree, and result.`,
      { displayText: `/job inspect ${jobId}` },
    );
  }

  // ---------------------------------------------------------------------------

  private snapshot(): ConductorJobsSnapshot {
    return this.host.state.appState.conductorJobs ?? emptyConductorJobsSnapshot();
  }

  private pickInitialSelection(snapshot: ConductorJobsSnapshot): string | undefined {
    const cards = snapshot.jobs;
    if (cards === undefined || cards.length === 0) return undefined;
    const inFlightOrder = ['running', 'needs_user', 'blocked', 'queued', 'interrupted'];
    for (const status of inFlightOrder) {
      const match = cards.find((card) => card.status === status);
      if (match !== undefined) return match.id;
    }
    return cards[0]?.id;
  }

  private buildCallbacks(): {
    onSelect: (jobId: string) => void;
    onCancel: () => void;
    onInspect: (jobId: string) => void;
  } {
    return {
      onSelect: (jobId) => {
        const board = this.host.state.jobBoard;
        if (board === undefined || board.selectedJobId === jobId) return;
        board.selectedJobId = jobId;
        this.repaint();
      },
      onCancel: () => {
        this.close();
      },
      onInspect: (jobId) => {
        this.inspect(jobId);
      },
    };
  }
}
