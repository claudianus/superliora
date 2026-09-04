/**
 * UX-sweep regression coverage for the desktop notification preference gate:
 * turn-complete bells and error toasts previously fired unconditionally,
 * ignoring the `[notifications]` setting and the `unfocused` condition.
 */

import { describe, expect, it, vi } from 'vitest';

import { notificationAllowed } from '#/tui/utils/notification/desktop-notification';
import type { TUIState } from '#/tui/tui-state';

function fakeState(options: {
  readonly enabled: boolean;
  readonly condition?: 'always' | 'unfocused';
  readonly focused?: boolean;
}): TUIState {
  return {
    appState: {
      notifications: {
        enabled: options.enabled,
        condition: options.condition ?? 'always',
      },
    },
    terminalState: {
      notificationKeys: new Set<string>(),
      focused: options.focused ?? true,
    },
  } as unknown as TUIState;
}

describe('notificationAllowed preference gate', () => {
  it('blocks notifications when the user disabled them', () => {
    expect(notificationAllowed(fakeState({ enabled: false }), 'k')).toBe(false);
  });

  it('allows once per key when enabled with condition=always', () => {
    const state = fakeState({ enabled: true, condition: 'always' });
    expect(notificationAllowed(state, 'turn-complete:1')).toBe(true);
    expect(notificationAllowed(state, 'turn-complete:1')).toBe(false);
    expect(notificationAllowed(state, 'turn-complete:2')).toBe(true);
  });

  it('blocks unfocused-condition notifications while the terminal is focused', () => {
    const state = fakeState({ enabled: true, condition: 'unfocused', focused: true });
    expect(notificationAllowed(state, 'error:x')).toBe(false);
  });

  it('allows unfocused-condition notifications when the terminal lost focus', () => {
    const state = fakeState({ enabled: true, condition: 'unfocused', focused: false });
    expect(notificationAllowed(state, 'error:x')).toBe(true);
  });

  it('treats a missing state as allowed (headless callers)', () => {
    expect(notificationAllowed(undefined, 'k')).toBe(true);
  });
});
