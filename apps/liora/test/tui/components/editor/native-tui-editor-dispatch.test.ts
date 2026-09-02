import { describe, expect, it, vi } from 'vitest';

import {
  dispatchNativeTUIEditorDecodedEvents,
  type NativeTUIEditorDispatchHost,
} from '#/tui/components/editor/native-tui-editor-dispatch';
import type { NativeInputKeyEvent } from '#/tui/renderer';

function makeHost() {
  const submit = vi.fn();
  const insertNewline = vi.fn();
  const host = {
    getAutocompleteController: () => ({
      isOpen: () => false,
      handleNativeInput: () => ({ handled: false }),
    }),
    getTextInput: () => ({ handleInput: vi.fn() }),
    getPasteBurst: () => ({
      shouldInsertNewlineInsteadOfSubmit: () => false,
      extendWindow: () => {},
      onPlainChar: () => {},
    }),
    getDisablePasteBurst: () => true,
    getGhostText: () => undefined,
    getText: () => '',
    getLines: () => [''],
    getCursor: () => ({ line: 0, col: 0 }),
    isBrowsingHistory: () => false,
    inputMode: 'prompt',
    setInputMode: vi.fn(),
    navigateHistory: vi.fn(),
    closeAutocomplete: () => false,
    clearGhost: () => {},
    acceptGhost: () => {},
    shouldQueryAutocomplete: () => false,
    requestAutocomplete: vi.fn(async () => {}),
    applyPromptAwareMutation: vi.fn(() => true),
    resetPasteBurst: vi.fn(),
    onEscape: vi.fn(),
    onInsertNewline: insertNewline,
    submit,
    applyAutocompleteCompletion: vi.fn(),
  } as unknown as NativeTUIEditorDispatchHost;
  return { host, submit, insertNewline };
}

function enterEvent(raw: string, overrides: Partial<NativeInputKeyEvent> = {}): NativeInputKeyEvent {
  return {
    type: 'key',
    key: 'enter',
    raw,
    eventType: 'press',
    ctrl: false,
    alt: false,
    shift: false,
    ...overrides,
  };
}

describe('native editor enter submission', () => {
  it('submits a CR enter event', () => {
    const { host, submit } = makeHost();
    dispatchNativeTUIEditorDecodedEvents(host, [enterEvent('\r')]);
    expect(submit).toHaveBeenCalledOnce();
  });

  it('submits a CSI-u enter event (kitty-protocol terminals)', () => {
    const { host, submit } = makeHost();
    dispatchNativeTUIEditorDecodedEvents(host, [enterEvent('\u001B[13u')]);
    expect(submit).toHaveBeenCalledOnce();
  });

  it('submits an LF enter event (legacy terminals)', () => {
    const { host, submit } = makeHost();
    dispatchNativeTUIEditorDecodedEvents(host, [enterEvent('\n')]);
    expect(submit).toHaveBeenCalledOnce();
  });

  it('inserts a newline for shift+enter instead of submitting', () => {
    const { host, submit, insertNewline } = makeHost();
    dispatchNativeTUIEditorDecodedEvents(host, [
      enterEvent('\u001B[13;2u', { shift: true }),
    ]);
    expect(submit).not.toHaveBeenCalled();
    expect(insertNewline).toHaveBeenCalledOnce();
  });

  it('does not submit ctrl+enter', () => {
    const { host, submit } = makeHost();
    dispatchNativeTUIEditorDecodedEvents(host, [enterEvent('\r', { ctrl: true })]);
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not submit alt+enter', () => {
    const { host, submit } = makeHost();
    dispatchNativeTUIEditorDecodedEvents(host, [enterEvent('\r', { alt: true })]);
    expect(submit).not.toHaveBeenCalled();
  });
});
