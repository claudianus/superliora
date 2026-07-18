import { describe, expect, it, vi } from 'vitest';

import { Input } from '#/tui/components/dialogs/input';

describe('dialog Input', () => {
  it('inserts bracketed paste without escape markers', () => {
    const input = new Input();
    input.handleInput('\u001B[200~sk-test-key\u001B[201~');
    expect(input.getValue()).toBe('sk-test-key');
  });

  it('assembles bracketed paste across chunks', () => {
    const input = new Input();
    input.handleInput('\u001B[200~sk-par');
    expect(input.getValue()).toBe('');
    input.handleInput('tial\u001B[201~');
    expect(input.getValue()).toBe('sk-partial');
  });

  it('strips ANSI leftovers from pasted text', () => {
    const input = new Input();
    input.handleInput('\u001B[200~\u001B[31msk-red\u001B[0m\u001B[201~');
    expect(input.getValue()).toBe('sk-red');
  });

  it('does not insert raw bracketed-paste markers as typed characters', () => {
    const input = new Input();
    // Legacy re-encode path: a full paste sequence arrives as one handleInput chunk.
    input.handleInput('\u001B[200~ctx7sk_test\u001B[201~');
    expect(input.getValue()).not.toContain('200');
    expect(input.getValue()).not.toContain('201');
    expect(input.getValue()).toBe('ctx7sk_test');
  });

  it('still submits on enter after a clean paste', () => {
    const onSubmit = vi.fn();
    const input = new Input();
    input.onSubmit = onSubmit;
    input.handleInput('\u001B[200~sk-ok\u001B[201~');
    input.handleInput('\r');
    expect(onSubmit).toHaveBeenCalledWith('sk-ok');
  });
});
