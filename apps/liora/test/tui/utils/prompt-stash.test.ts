import { describe, expect, it } from 'vitest';

import { PromptStash } from '#/tui/utils/prompt-stash';

describe('PromptStash', () => {
  it('pops entries in LIFO order across pushes', () => {
    const stash = new PromptStash();
    stash.push({ text: 'first draft', mode: 'prompt' });
    stash.push({ text: '!ls -la', mode: 'bash' });
    stash.push({ text: 'third draft', mode: 'prompt' });

    expect(stash.pop()).toEqual({ text: 'third draft', mode: 'prompt' });
    expect(stash.pop()).toEqual({ text: '!ls -la', mode: 'bash' });
    expect(stash.pop()).toEqual({ text: 'first draft', mode: 'prompt' });
  });

  it('returns undefined when popping an empty stash', () => {
    const stash = new PromptStash();
    expect(stash.pop()).toBeUndefined();

    stash.push({ text: 'draft', mode: 'prompt' });
    stash.pop();
    expect(stash.pop()).toBeUndefined();
  });

  it('tracks size across pushes and pops', () => {
    const stash = new PromptStash();
    expect(stash.size).toBe(0);
    expect(stash.push({ text: 'a', mode: 'prompt' })).toBe(1);
    expect(stash.push({ text: 'b', mode: 'bash' })).toBe(2);
    expect(stash.size).toBe(2);

    stash.pop();
    expect(stash.size).toBe(1);
    stash.pop();
    expect(stash.size).toBe(0);
  });

  it('stashes whitespace-only drafts as-is', () => {
    const stash = new PromptStash();
    stash.push({ text: '   ', mode: 'prompt' });

    expect(stash.size).toBe(1);
    expect(stash.pop()).toEqual({ text: '   ', mode: 'prompt' });
  });
});
