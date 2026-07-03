import { describe, expect, it, vi } from 'vitest';

import { KimiNativeRootUI } from '#/tui/renderer';

describe('KimiNativeRootUI input routing', () => {
  function createUI(): KimiNativeRootUI {
    const output = { write: vi.fn(), columns: 80, rows: 24 };
    return new KimiNativeRootUI({ output, input: undefined });
  }

  it('does not forward raw input to the focused component when an input router is set', () => {
    const ui = createUI();
    const focused = { handleInput: vi.fn() };
    ui.setFocus(focused as unknown as Parameters<KimiNativeRootUI['setFocus']>[0]);
    const router = { dispatch: vi.fn() };
    ui.setInputRouter(router);

    (ui as unknown as { handleRawInput(data: string): void }).handleRawInput('x');

    expect(focused.handleInput).not.toHaveBeenCalled();
    expect(router.dispatch).not.toHaveBeenCalled();
  });

  it('forwards raw input to the focused component when no input router is set', () => {
    const ui = createUI();
    const focused = { handleInput: vi.fn() };
    ui.setFocus(focused as unknown as Parameters<KimiNativeRootUI['setFocus']>[0]);

    (ui as unknown as { handleRawInput(data: string): void }).handleRawInput('x');

    expect(focused.handleInput).toHaveBeenCalledWith('x');
  });

  it('still runs raw input listeners before the router gate', () => {
    const ui = createUI();
    const focused = { handleInput: vi.fn() };
    const listener = vi.fn(() => ({ consume: true }));
    ui.addInputListener(listener);
    ui.setFocus(focused as unknown as Parameters<KimiNativeRootUI['setFocus']>[0]);
    const router = { dispatch: vi.fn() };
    ui.setInputRouter(router);

    (ui as unknown as { handleRawInput(data: string): void }).handleRawInput('x');

    expect(listener).toHaveBeenCalledWith('x');
    expect(focused.handleInput).not.toHaveBeenCalled();
    expect(router.dispatch).not.toHaveBeenCalled();
  });
});
