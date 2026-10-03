import { describe, expect, it, vi } from 'vitest';

import type { NativeInputEvent } from '#/tui/renderer';
import { ensureStartupNativeInputRouter } from '#/tui/controllers/startup-lifecycle/native-renderer';
import type { StartupLifecycleHost } from '#/tui/controllers/startup-lifecycle/types';
import { createTUIStateNativeInputRouter } from '#/tui/features/native-layout/native-input-router';

vi.mock('#/tui/features/native-layout/native-input-router', () => ({
  createTUIStateNativeInputRouter: vi.fn(() => ({ router: { registerGlobalHandler: vi.fn() }, dispose: vi.fn() })),
}));

function setup(focused = true) {
  vi.mocked(createTUIStateNativeInputRouter).mockClear();
  const panel = {
    focused, isEmpty: () => false, selectedWorker: 'worker-node',
    handleSelectionKey: vi.fn(() => ({ handled: true })),
  };
  const host = {
    nativeInputRouter: undefined,
    state: {
      appState: { appearance: { workerDock: 'auto' } },
      workerDockPanel: panel,
      transcriptContainer: { isBatchMounting: false },
      renderer: { invalidateFrame: vi.fn() },
      editor: { getText: () => '', tryHandleAppShortcut: vi.fn(() => false) },
    },
  };
  ensureStartupNativeInputRouter(host as unknown as StartupLifecycleHost, { scrollTranscriptViewport: () => false });
  const route = vi.mocked(createTUIStateNativeInputRouter).mock.calls[0]?.[1]?.handlePreEditorInput;
  if (route === undefined) throw new Error('Expected product pre-editor input route');
  return { panel, route };
}
function key(direction: 'left' | 'right', overrides: Partial<NativeInputEvent> = {}): NativeInputEvent {
  return { type: 'key', key: direction, eventType: 'press', raw: '', ctrl: false, alt: false, shift: false, ...overrides } as NativeInputEvent;
}

describe('Worker Dock tree disclosure key routing', () => {
  it.each(['left', 'right'] as const)('routes bare %s to a focused dock without changing selection or stealing editor input elsewhere', (direction) => {
    const focused = setup();
    expect(focused.route(key(direction))).toBe(true);
    expect(focused.panel.handleSelectionKey).toHaveBeenCalledExactlyOnceWith(direction);
    expect(focused.panel.selectedWorker).toBe('worker-node');
    const editor = setup(false);
    expect(editor.route(key(direction))).toBe(false);
    expect(editor.panel.handleSelectionKey).not.toHaveBeenCalled();
  });

  it.each([{ ctrl: true }, { alt: true }, { shift: true }, { super: true }, { eventType: 'release' }])('does not consume modified/released disclosure keys (%j)', (overrides) => {
    const { route, panel } = setup();
    expect(route(key('left', overrides as Partial<NativeInputEvent>))).toBe(false);
    expect(panel.handleSelectionKey).not.toHaveBeenCalled();
  });
});
