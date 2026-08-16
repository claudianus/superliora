import { describe, expect, it, vi } from 'vitest';

import { ReverseRpcPanelsController } from '#/tui/controllers/panes/reverse-rpc-panels';
import type { QuestionPanelData } from '#/tui/reverse-rpc/types';
import type { TUIState } from '#/tui/tui-state';

function questionPayload(id = 'q-1'): QuestionPanelData {
  return {
    id,
    tool_call_id: id,
    questions: [
      {
        question: 'Ship now?',
        multi_select: false,
        options: [{ label: 'Yes' }, { label: 'No' }],
      },
    ],
  };
}

function makeHost() {
  const livePane = {
    pendingApproval: null as null | { data: unknown },
    pendingQuestion: null as null | { data: QuestionPanelData },
  };
  const state = {
    activeDialog: null as string | null,
    centerModalStack: [] as unknown[],
    livePane,
    terminal: {},
    terminalState: { notificationKeys: new Set<string>() },
    appState: {
      notifications: { enabled: false, condition: 'always' },
    },
  } as unknown as TUIState;

  const host = {
    state,
    deferredApproval: undefined as unknown,
    deferredQuestion: undefined as QuestionPanelData | undefined,
    approvalController: {
      cancelAll: vi.fn(),
      respond: vi.fn(),
    },
    questionController: {
      cancelAll: vi.fn(),
      respond: vi.fn(),
    },
    reverseRpcDisposers: [] as Array<() => void>,
    patchLivePane: vi.fn((patch: Partial<typeof livePane>) => {
      Object.assign(livePane, patch);
    }),
    setAppState: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    toggleToolOutputExpansion: vi.fn(),
    appendPlanReviewTranscript: vi.fn(() => false),
  };

  return { host, livePane };
}

describe('ReverseRpcPanelsController question freeze hole', () => {
  it('hideQuestionDialog is idempotent and always restores the editor', () => {
    const { host, livePane } = makeHost();
    const panels = new ReverseRpcPanelsController(host as never);

    panels.showQuestionDialog(questionPayload());
    expect(host.mountEditorReplacement).toHaveBeenCalledOnce();
    expect(livePane.pendingQuestion).not.toBeNull();

    panels.hideQuestionDialog();
    expect(host.restoreEditor).toHaveBeenCalledTimes(1);
    expect(livePane.pendingQuestion).toBeNull();
    expect(host.deferredQuestion).toBeUndefined();

    // Second hide (abort/restart race) must still free input — no throw, no remount.
    panels.hideQuestionDialog();
    expect(host.restoreEditor).toHaveBeenCalledTimes(2);
    expect(host.mountEditorReplacement).toHaveBeenCalledOnce();
  });

  it('cancelPendingReverseRpc drops deferred questions so restore cannot remount a dead dialog', () => {
    const { host } = makeHost();
    host.state.activeDialog = 'command';
    const panels = new ReverseRpcPanelsController(host as never);

    panels.showQuestionDialog(questionPayload('deferred-q'));
    expect(host.deferredQuestion?.id).toBe('deferred-q');
    expect(host.mountEditorReplacement).not.toHaveBeenCalled();

    panels.cancelPendingReverseRpc('session switch');
    expect(host.deferredQuestion).toBeUndefined();
    expect(host.questionController.cancelAll).toHaveBeenCalledWith('session switch');
    // cancelAll → hidePanel → hideQuestionDialog → restoreEditor
    expect(host.restoreEditor).toHaveBeenCalled();
  });

  it('dialog answer path still delivers through questionController.respond', () => {
    const { host } = makeHost();
    const panels = new ReverseRpcPanelsController(host as never);
    panels.showQuestionDialog(questionPayload());

    const dialog = host.mountEditorReplacement.mock.calls[0]![0] as {
      handleInput: (data: string) => void;
    };
    // Escape cancels with empty answers (dismissible — never traps keys).
    dialog.handleInput('\u001b');
    expect(host.questionController.respond).toHaveBeenCalledWith({ answers: [] });
  });
});
