import { describe, expect, it, vi } from 'vitest';

import { ApprovalController } from '#/tui/controllers/approval-controller';
import type { Quest } from '#/tui/controllers/quest-types';

function makeQuest(id: string, overrides: Partial<Quest> = {}): Quest {
  return {
    id,
    name: `Quest ${id}`,
    sessionRef: `session-${id}`,
    state: 'waiting-approval',
    createdAt: Date.now() - 60_000,
    lastActivityAt: Date.now(),
    changeCount: { added: 1, removed: 0 },
    planStep: 'Awaiting approval',
    worktreePath: `/tmp/wt/${id}`,
    pinned: false,
    approvalPending: true,
    ...overrides,
  };
}

function makeController() {
  const sendStdin = vi.fn();
  const cancelQuest = vi.fn();
  const rejectStep = vi.fn();
  const openRewindPicker = vi.fn().mockResolvedValue(null);
  const executeRewind = vi.fn();
  const presentRejectChoice = vi.fn().mockResolvedValue(null);
  const requestRender = vi.fn();

  const ctrl = new ApprovalController({
    sendStdin,
    cancelQuest,
    rejectStep,
    openRewindPicker,
    executeRewind,
    presentRejectChoice,
    requestRender,
  });

  return { ctrl, sendStdin, cancelQuest, rejectStep, openRewindPicker, executeRewind, presentRejectChoice, requestRender };
}

describe('approval actions a/x/r dispatch (AC-4)', () => {
  it('approve (a) sends "y\\n" to session stdin', async () => {
    const { ctrl, sendStdin, requestRender } = makeController();
    const quest = makeQuest('q1');

    await ctrl.handleAction(quest, 'approve');

    expect(sendStdin).toHaveBeenCalledWith('session-q1', 'y\n');
    expect(requestRender).toHaveBeenCalled();
  });

  it('reject (x) with cancel-all calls cancelQuest', async () => {
    const { ctrl, presentRejectChoice, cancelQuest, requestRender } = makeController();
    presentRejectChoice.mockResolvedValue('cancel-all');
    const quest = makeQuest('q1');

    await ctrl.handleAction(quest, 'reject');

    expect(presentRejectChoice).toHaveBeenCalledWith('q1');
    expect(cancelQuest).toHaveBeenCalledWith('q1');
    expect(requestRender).toHaveBeenCalled();
  });

  it('reject (x) with reject-step calls rejectStep', async () => {
    const { ctrl, presentRejectChoice, rejectStep, requestRender } = makeController();
    presentRejectChoice.mockResolvedValue('reject-step');
    const quest = makeQuest('q1');

    await ctrl.handleAction(quest, 'reject');

    expect(rejectStep).toHaveBeenCalledWith('session-q1');
    expect(requestRender).toHaveBeenCalled();
  });

  it('reject (x) cancelled by user does nothing', async () => {
    const { ctrl, presentRejectChoice, cancelQuest, rejectStep } = makeController();
    presentRejectChoice.mockResolvedValue(null);
    const quest = makeQuest('q1');

    await ctrl.handleAction(quest, 'reject');

    expect(cancelQuest).not.toHaveBeenCalled();
    expect(rejectStep).not.toHaveBeenCalled();
  });

  it('rewind (r) opens picker and executes selected level', async () => {
    const { ctrl, openRewindPicker, executeRewind, requestRender } = makeController();
    openRewindPicker.mockResolvedValue('commit');
    const quest = makeQuest('q1');

    await ctrl.handleAction(quest, 'rewind');

    expect(openRewindPicker).toHaveBeenCalledWith('q1');
    expect(executeRewind).toHaveBeenCalledWith('q1', 'commit');
    expect(requestRender).toHaveBeenCalled();
  });

  it('rewind (r) with turn level', async () => {
    const { ctrl, openRewindPicker, executeRewind } = makeController();
    openRewindPicker.mockResolvedValue('turn');
    const quest = makeQuest('q1');

    await ctrl.handleAction(quest, 'rewind');
    expect(executeRewind).toHaveBeenCalledWith('q1', 'turn');
  });

  it('rewind (r) with step level', async () => {
    const { ctrl, openRewindPicker, executeRewind } = makeController();
    openRewindPicker.mockResolvedValue('step');
    const quest = makeQuest('q1');

    await ctrl.handleAction(quest, 'rewind');
    expect(executeRewind).toHaveBeenCalledWith('q1', 'step');
  });

  it('rewind (r) cancelled by user does not execute', async () => {
    const { ctrl, openRewindPicker, executeRewind } = makeController();
    openRewindPicker.mockResolvedValue(null);
    const quest = makeQuest('q1');

    await ctrl.handleAction(quest, 'rewind');
    expect(executeRewind).not.toHaveBeenCalled();
  });
});
