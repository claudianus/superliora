import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TUIToastState, TUI_TOAST_DURATION_MS } from '#/tui/utils/toast';

describe('TUIToastState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a message and auto-hides after the default duration', () => {
    const toast = new TUIToastState();
    const onChanged = vi.fn();
    toast.onChanged = onChanged;

    expect(toast.visible).toBeNull();

    toast.show('Copied to clipboard');
    expect(toast.visible?.message).toBe('Copied to clipboard');
    expect(onChanged).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(TUI_TOAST_DURATION_MS - 1);
    expect(toast.visible).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(toast.visible).toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('reschedules expiry when shown again while visible', () => {
    const toast = new TUIToastState();

    toast.show('first');
    vi.advanceTimersByTime(TUI_TOAST_DURATION_MS - 400);
    toast.show('second');

    // The first timer would have fired here, but the second show rescheduled.
    vi.advanceTimersByTime(400);
    expect(toast.visible?.message).toBe('second');

    vi.advanceTimersByTime(TUI_TOAST_DURATION_MS - 400);
    expect(toast.visible).toBeNull();
  });

  it('hide() clears immediately and dispose() detaches notifications', () => {
    const toast = new TUIToastState();
    const onChanged = vi.fn();
    toast.onChanged = onChanged;

    toast.show('Copied to clipboard');
    toast.hide();
    expect(toast.visible).toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(2);

    // hide() on an already-hidden toast is a no-op.
    toast.hide();
    expect(onChanged).toHaveBeenCalledTimes(2);

    toast.dispose();
    toast.show('again');
    expect(onChanged).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(TUI_TOAST_DURATION_MS);
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(toast.visible).toBeNull();
  });
});
