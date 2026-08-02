import { describe, expect, it, vi } from 'vitest';

import { SessionEventCompaction } from '../../../src/tui/controllers/session-event/compaction';
import type { CompactionEventHost } from '../../../src/tui/controllers/session-event/compaction';
import type { AppState } from '../../../src/tui/types';
import type { TUIState } from '../../../src/tui/tui-state';

function makeHost(
  appPatch: Partial<AppState>,
  showNotice?: CompactionEventHost['showNotice'],
  showStatus?: CompactionEventHost['showStatus'],
): CompactionEventHost & {
  notices: Array<{ title: string; detail?: string; coalesceKey?: string }>;
  statuses: Array<{ msg: string; color?: string }>;
} {
  const notices: Array<{ title: string; detail?: string; coalesceKey?: string }> = [];
  const statuses: Array<{ msg: string; color?: string }> = [];
  const appState = {
    isBackgroundCompacting: false,
    isCompacting: false,
    model: '',
    availableModels: [],
    ...appPatch,
  } as AppState;
  const host: CompactionEventHost & {
    notices: typeof notices;
    statuses: typeof statuses;
  } = {
    notices,
    statuses,
    state: { appState } as TUIState,
    streamingUI: {
      finalizeLiveTextBuffers: vi.fn(),
      promoteCompactionToBlocking: vi.fn(),
      beginCompaction: vi.fn(),
      endCompaction: vi.fn(),
      cancelCompaction: vi.fn(),
      updateCompactionProgress: vi.fn(),
      hasActiveTurn: () => false,
    } as unknown as CompactionEventHost['streamingUI'],
    setAppState(patch) {
      Object.assign(appState, patch);
    },
    resetLivePane: vi.fn(),
    shiftQueuedMessage: () => undefined,
    showNotice: showNotice ?? ((title, detail, options) => {
      notices.push({ title, detail, coalesceKey: options?.coalesceKey });
    }),
    showStatus: showStatus ?? ((msg, color) => {
      statuses.push({ msg, color });
    }),
  };
  return host;
}

describe('SessionEventCompaction.handleBlocked (Loop30a)', () => {
  it('promotes background compact and emits a named notice', () => {
    const host = makeHost({ isBackgroundCompacting: true });
    const handler = new SessionEventCompaction(host);

    handler.handleBlocked({ type: 'compaction.blocked', turnId: 3 });

    expect(host.state.appState.isCompacting).toBe(true);
    expect(host.state.appState.isBackgroundCompacting).toBe(false);
    expect(host.streamingUI.promoteCompactionToBlocking).toHaveBeenCalledOnce();
    expect(host.notices).toHaveLength(1);
    expect(host.notices[0]?.title).toBe('Compaction blocking turn');
    expect(host.notices[0]?.detail).toContain('Background context compaction');
    expect(host.notices[0]?.detail).toContain('turn 3');
    expect(host.notices[0]?.coalesceKey).toBe('compaction-blocked');
    expect(host.statuses[0]?.msg).toMatch(/background compaction/);
    expect(host.statuses[0]?.color).toBe('warning');
  });

  it('notices when already blocking compact is awaited', () => {
    const host = makeHost({ isCompacting: true });
    const handler = new SessionEventCompaction(host);

    handler.handleBlocked({ type: 'compaction.blocked' });

    expect(host.notices).toHaveLength(1);
    expect(host.notices[0]?.detail).toContain('waiting on in-flight context compaction');
    expect(host.notices[0]?.coalesceKey).toBe('compaction-blocked');
  });

  it('no-ops when no compact is active', () => {
    const host = makeHost({});
    const handler = new SessionEventCompaction(host);

    handler.handleBlocked({ type: 'compaction.blocked', turnId: 1 });

    expect(host.notices).toHaveLength(0);
    expect(host.streamingUI.promoteCompactionToBlocking).not.toHaveBeenCalled();
  });
});
