/**
 * H11 — stacked question dialogs go deaf (Enter does nothing).
 *
 * User report: after leaving the session unattended, several questions queue
 * up. The dialog left on screen ignores input — specifically Enter cannot
 * confirm a choice, so the run stalls.
 *
 * This test drives the real wiring — `QuestionController` (queue) +
 * `ReverseRpcPanelsController` (mount/defer) + `mountEditorReplacement` /
 * `restoreEditor` (editor takeover) — and checks the mechanically observable
 * contract: the dialog the user can see is bound to the live waiter, and
 * Enter advances question 1 → 2 → 3.
 *
 * Root cause under test: `mountEditorReplacement` marks the takeover as
 * `activeDialog = 'command'` (modal-shell.ts:35). The next
 * `showQuestionDialog` reads that self-inflicted marker as "an unrelated
 * modal owns the editor" and defers itself (reverse-rpc-panels.ts:150-162).
 * Because `advanceOrHide` (base-controller.ts:124-132) only hides the panel
 * when the queue is empty, nothing calls `hideQuestionDialog()` in between —
 * so the stale dialog stays on screen and Q2/Q3 never mount.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  mountEditorReplacement,
  restoreEditor,
  type ModalShellDelegate,
} from '#/tui/controllers/dialogs/modal-shell';
import { ReverseRpcPanelsController } from '#/tui/controllers/panes/reverse-rpc-panels';
import { ApprovalController } from '#/tui/reverse-rpc/approval/controller';
import { QuestionController } from '#/tui/reverse-rpc/question/controller';
import type { ApprovalPanelData, QuestionPanelData } from '#/tui/reverse-rpc/types';
import type { TUIState } from '#/tui/tui-state';

// ── Test host: real containers, one stack ────────────────────────────

class FakeContainer {
  children: unknown[] = [];
  addChild(child: unknown): void {
    this.children.push(child);
  }
  clear(): void {
    this.children = [];
  }
}

function questionPayload(id: string): QuestionPanelData {
  return {
    id,
    tool_call_id: id,
    questions: [
      {
        question: `Q-${id}?`,
        multi_select: false,
        options: [{ label: 'Yes' }, { label: 'No' }],
      },
    ],
  };
}

function approvalPayload(id: string): ApprovalPanelData {
  return {
    id,
    tool_call_id: id,
    tool_name: 'Bash',
    action: 'run',
    description: `A-${id}`,
    display: [],
    choices: [
      { label: 'Approve once', response: 'approved' },
      { label: 'Reject', response: 'rejected' },
    ],
  };
}

function makeStack() {
  const livePane = {
    pendingApproval: null as null | { data: unknown },
    pendingQuestion: null as null | { data: QuestionPanelData },
  };
  const editorContainer = new FakeContainer();
  const editor = { focused: false };
  const state = {
    activeDialog: null as string | null,
    centerModalStack: [] as unknown[],
    livePane,
    editorContainer,
    editor,
    terminal: { columns: 100, rows: 40 },
    terminalState: { notificationKeys: new Set<string>() },
    transcriptContainer: {
      hasIdleStageMounted: false,
      isBatchMounting: false,
      invalidateIdleGeometry: vi.fn(),
      pinEmptyChromeToTop: vi.fn(),
    },
    appState: { notifications: { enabled: false, condition: 'always' } },
    ui: { setFocus: vi.fn() },
    renderer: { invalidateFrame: vi.fn() },
  } as unknown as TUIState;

  const controller = new QuestionController();
  const approvalController = new ApprovalController();
  const delegate = { closeAllCenterModals: vi.fn() } as unknown as ModalShellDelegate;

  const host: Record<string, unknown> = {
    state,
    deferredApproval: undefined,
    deferredQuestion: undefined,
    approvalController,
    questionController: controller,
    reverseRpcDisposers: [],
    nativeInputRouter: undefined,
    nativeInputModalDispose: undefined,
    nativeInputModalSequence: 0,
    centerModalSequence: 0,
    sessionLoadingOverlay: undefined,
    patchLivePane: (patch: Partial<typeof livePane>) => {
      Object.assign(livePane, patch);
    },
    setAppState: vi.fn(),
    showStatus: vi.fn(),
    toggleToolOutputExpansion: vi.fn(),
    appendPlanReviewTranscript: vi.fn(() => false),
    mountEditorReplacement: (panel: never) => {
      mountEditorReplacement(host as never, delegate, panel);
    },
    restoreEditor: () => {
      restoreEditor(host as never);
    },
  };

  const panels = new ReverseRpcPanelsController(host as never);
  controller.setUIHooks({
    showPanel: (payload) => {
      panels.showQuestionDialog(payload);
    },
    hidePanel: () => {
      panels.hideQuestionDialog();
    },
  });
  approvalController.setUIHooks({
    showPanel: (payload) => {
      panels.showApprovalPanel(payload);
    },
    hidePanel: () => {
      panels.hideApprovalPanel();
    },
  });

  /** The dialog the user actually sees: whatever the editor container holds. */
  const visibleDialog = () => {
    const child = editorContainer.children.at(-1) as
      | { handleInput?: (data: string) => void }
      | undefined;
    return child?.handleInput === undefined ? undefined : (child as { handleInput: (d: string) => void });
  };

  /** Confirm the current visible dialog: Enter selects, Enter submits. */
  const answer = () => {
    const dialog = visibleDialog();
    expect(dialog).toBeDefined();
    dialog!.handleInput('\r');
    dialog!.handleInput('\r');
  };

  /**
   * Approvals submit on a single Enter. A second '\r' to the same (already
   * answered) panel would respond to the controller again and swallow the next
   * queued approval — that is harness cross-talk, not product behaviour.
   */
  const answerApproval = () => {
    const dialog = visibleDialog();
    expect(dialog).toBeDefined();
    dialog!.handleInput('\r');
  };

  return {
    host,
    panels,
    livePane,
    editorContainer,
    editor,
    controller,
    approvalController,
    visibleDialog,
    answer,
    answerApproval,
  };
}

describe('H11 stacked question dialogs stay answerable', () => {
  it('three queued questions: the visible dialog is answerable and advances 1 → 2 → 3', async () => {
    const s = makeStack();

    const p1 = s.controller.show(questionPayload('q1'));
    const p2 = s.controller.show(questionPayload('q2'));
    const p3 = s.controller.show(questionPayload('q3'));

    // Only Q1 may take the editor; the rest wait their turn.
    expect(s.livePane.pendingQuestion?.data.id).toBe('q1');
    expect(s.host['deferredQuestion']).toBeUndefined();

    // Enter on the visible dialog resolves Q1 …
    s.answer();
    await p1;
    expect(await p1).toEqual({ answers: ['Yes'], method: 'enter' });

    // … and the NEXT question must be the one on screen. This is the H11
    // assertion: a stale `activeDialog` marker used to defer Q2, so the
    // already-answered Q1 dialog stayed visible and ate the keystrokes.
    expect(s.livePane.pendingQuestion?.data.id).toBe('q2');
    expect(s.host['deferredQuestion']).toBeUndefined();

    s.answer();
    expect(await p2).toEqual({ answers: ['Yes'], method: 'enter' });
    expect(s.livePane.pendingQuestion?.data.id).toBe('q3');
    expect(s.host['deferredQuestion']).toBeUndefined();

    s.answer();
    expect(await p3).toEqual({ answers: ['Yes'], method: 'enter' });

    // Queue drained: the editor is back and nothing is left pending.
    expect(s.livePane.pendingQuestion).toBeNull();
    expect(s.editorContainer.children.at(-1)).toBe(s.editor);
  });

  it('regression: a single question resolves on Enter and restores the editor', async () => {
    const s = makeStack();
    const pending = s.controller.show(questionPayload('only'));

    expect(s.livePane.pendingQuestion?.data.id).toBe('only');
    s.answer();

    expect(await pending).toEqual({ answers: ['Yes'], method: 'enter' });
    expect(s.livePane.pendingQuestion).toBeNull();
    expect(s.editorContainer.children.at(-1)).toBe(s.editor);
  });

  it('regression: a foreign command modal still defers the question', () => {
    const s = makeStack();
    // A command dialog owns the editor before any question arrives.
    s.host['state'] = { ...(s.host['state'] as TUIState), activeDialog: 'command' };

    void s.controller.show(questionPayload('deferred'));

    expect(s.host['deferredQuestion']).toMatchObject({ id: 'deferred' });
    expect(s.editorContainer.children).toHaveLength(0);
  });

  it('regression: no pending question leaves the editor untouched', () => {
    const s = makeStack();
    expect(s.livePane.pendingQuestion).toBeNull();
    expect(s.editorContainer.children).toHaveLength(0);
  });
});

/**
 * H11b — the same self-marker misread on the APPROVAL panel.
 *
 * `showApprovalPanel` used the identical raw predicate:
 *   activeDialog === 'command' || 'center-modal' || centerModalStack.length > 0
 * The approval panel is itself mounted through `mountEditorReplacement`, which
 * sets `activeDialog = 'command'` (modal-shell.ts:35). So the second queued
 * approval read its own marker as a foreign modal and deferred forever:
 * `advanceOrHide` (base-controller.ts:124-132) only hides when the queue
 * drains, and `advanceOrHide` never calls `hideApprovalPanel` in between — the
 * answered panel stayed on screen, its waiter already resolved, and Enter went
 * nowhere. Same freeze as H11, different panel.
 */
describe('H11b stacked approval panels stay answerable', () => {
  it('three queued approvals: the visible panel is answerable and advances 1 → 2 → 3', async () => {
    const s = makeStack();

    const a1 = s.approvalController.show(approvalPayload('a1'));
    const a2 = s.approvalController.show(approvalPayload('a2'));
    const a3 = s.approvalController.show(approvalPayload('a3'));

    expect(s.livePane.pendingApproval?.data.id).toBe('a1');
    expect(s.host['deferredApproval']).toBeUndefined();

    s.answerApproval();
    expect(await a1).toMatchObject({ decision: 'approved' });

    // The next approval must be the one on screen — this is the H11b
    // assertion. A stale self-marker used to defer a2/a3 permanently.
    expect(s.livePane.pendingApproval?.data.id).toBe('a2');
    expect(s.host['deferredApproval']).toBeUndefined();

    s.answerApproval();
    expect(await a2).toMatchObject({ decision: 'approved' });
    expect(s.livePane.pendingApproval?.data.id).toBe('a3');
    expect(s.host['deferredApproval']).toBeUndefined();

    s.answerApproval();
    expect(await a3).toMatchObject({ decision: 'approved' });

    // Queue drained: the editor is back and nothing is left pending.
    expect(s.livePane.pendingApproval).toBeNull();
    expect(s.editorContainer.children.at(-1)).toBe(s.editor);
  });

  it('regression: a single approval resolves on Enter and restores the editor', async () => {
    const s = makeStack();
    const pending = s.approvalController.show(approvalPayload('only-approval'));

    expect(s.livePane.pendingApproval?.data.id).toBe('only-approval');
    s.answerApproval();

    expect(await pending).toMatchObject({ decision: 'approved' });
    expect(s.livePane.pendingApproval).toBeNull();
    expect(s.editorContainer.children.at(-1)).toBe(s.editor);
  });

  it('regression: a foreign command modal still defers the approval', () => {
    const s = makeStack();
    s.host['state'] = { ...(s.host['state'] as TUIState), activeDialog: 'command' };

    void s.approvalController.show(approvalPayload('deferred-approval'));

    expect(s.host['deferredApproval']).toMatchObject({ id: 'deferred-approval' });
    expect(s.editorContainer.children).toHaveLength(0);
  });

  it('regression: a center modal still defers the approval', () => {
    const s = makeStack();
    const state = s.host['state'] as TUIState;
    (state.centerModalStack as unknown[]).push({});

    void s.approvalController.show(approvalPayload('center-deferred'));

    expect(s.host['deferredApproval']).toMatchObject({ id: 'center-deferred' });
    expect(s.editorContainer.children).toHaveLength(0);
  });
});
