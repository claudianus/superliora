import type { Session } from '@superliora/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionLifecycleController, type SessionLifecycleHost } from '#/tui/controllers/session/session-lifecycle';

const { flush, restore, writeState, restoreState, prune } = vi.hoisted(() => ({
  flush: vi.fn(), restore: vi.fn(async (_host: { session: Session }) => undefined),
  writeState: vi.fn(async (_host: { session: Session }) => undefined),
  restoreState: vi.fn(async () => undefined), prune: vi.fn(),
}));
vi.mock('#/tui/utils/prompt-input-state', () => ({ flushPromptInputState: flush, restorePromptInputState: restore }));
vi.mock('#/tui/utils/tui-session-state', () => ({
  writeTuiSessionState: writeState, restoreTuiSessionState: restoreState, pruneTuiSessionToolOutputViewports: prune,
}));
vi.mock('#/tui/features/control-tower/interrupted-banner', () => ({ maybeAnnounceInterruptedJobs: vi.fn() }));

beforeEach(() => { vi.clearAllMocks(); });

describe('session lifecycle', () => {
  it('clears outgoing Timeline mode without writing over its persisted session state', () => {
    const appState = { sessionId: 'old', transcriptRegionMode: 'timeline' };
    const setAppState = vi.fn((patch) => { Object.assign(appState, patch); });
    const host = {
      state: { appState, queuedMessages: [], footer: { setBackgroundCounts: vi.fn() } },
      promptStash: { clear: vi.fn() },
      streamingUI: {
        discardPending: vi.fn(), resetToolCallState: vi.fn(), resetToolUi: vi.fn(),
        setTodoList: vi.fn(), setTurnId: vi.fn(), setStep: vi.fn(), resetLiveText: vi.fn(),
      },
      sessionEventHandler: { resetRuntimeState: vi.fn() },
      tasksBrowserController: { close: vi.fn() }, btwPanelController: { clear: vi.fn() },
      updateQueueDisplay: vi.fn(), setAppState,
    } as unknown as SessionLifecycleHost;

    new SessionLifecycleController(host).resetSessionRuntime();

    expect(appState.transcriptRegionMode).toBe('chat');
    expect(setAppState).toHaveBeenCalledWith(expect.objectContaining({ transcriptRegionMode: 'chat' }));
    expect(flush).not.toHaveBeenCalled();
    expect(writeState).not.toHaveBeenCalled();
  });

  it('projects active model, permissions and workspace roots from ordinary session status', async () => {
    const appState = { additionalDirs: [] };
    const setAppState = vi.fn((patch) => { Object.assign(appState, patch); });
    const session = {
      id: 'session-new', summary: { title: 'Next task', additionalDirs: ['/shared'] },
      getStatus: vi.fn(async () => ({
        model: 'model-a', thinkingLevel: 'off', permission: 'auto',
        contextTokens: 20, maxContextTokens: 200, contextUsage: 0.1,
      })),
    } as unknown as Session;
    const controller = new SessionLifecycleController({
      state: { appState }, setAppState,
    } as unknown as SessionLifecycleHost);
    await controller.syncRuntimeState(session);
    expect(session.getStatus).toHaveBeenCalledOnce();
    expect(appState).toMatchObject({
      sessionId: 'session-new', model: 'model-a', permissionMode: 'auto', thinking: false,
      contextTokens: 20, maxContextTokens: 200, contextUsage: 0.1,
      sessionTitle: 'Next task', additionalDirs: ['/shared'],
    });
  });

  it.each([false, true])('persists outgoing drafts and restores incoming input even when replay fails (%s)', async (replayFails) => {
    const order: string[] = [];
    const previous = { id: 'old' } as Session;
    const incoming = { id: 'new', getResumeState: () => null } as unknown as Session;
    const host = {
      session: previous,
      state: { appState: { sessionId: 'old' }, toolOutputViewports: { clear: vi.fn() } },
      updateTerminalTitle: vi.fn(), clearTranscriptAndRedraw: vi.fn(),
      sessionReplay: { hydrateFromReplay: vi.fn(async () => { if (replayFails) throw new Error('Unreadable history'); }) },
      sessionEventHandler: { startSubscription: vi.fn() },
      showError: vi.fn(), showStatus: vi.fn(), showSessionWarnings: vi.fn(async () => undefined),
    } as unknown as SessionLifecycleHost;
    flush.mockImplementation((target) => { order.push(`flush:${target.session.id}`); });
    writeState.mockImplementation(async (target) => { order.push(`persist:${target.session.id}`); });
    restore.mockImplementation(async (target) => { order.push(`restore:${target.session.id}`); });
    const controller = new SessionLifecycleController(host);
    vi.spyOn(controller, 'resetSessionRuntime').mockImplementation(() => { order.push('reset'); });
    vi.spyOn(controller, 'setSession').mockImplementation(async (session) => { host.session = session; });
    vi.spyOn(controller, 'syncRuntimeState').mockResolvedValue(undefined);
    await controller.switchToSession(incoming, 'Switched');

    expect(order).toEqual(['flush:old', 'persist:old', 'reset', 'restore:new', 'persist:new']);
    expect(restoreState).toHaveBeenCalledWith(host);
    expect(prune).toHaveBeenCalledWith(host);
    expect(host.sessionEventHandler.startSubscription).toHaveBeenCalledOnce();
    expect(host.showStatus).toHaveBeenCalledWith('Switched');
    expect(host.showError).toHaveBeenCalledTimes(replayFails ? 1 : 0);
  });
});
