import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CombinedAutocompleteProvider } from '../src';

function signal(): AbortSignal {
  return new AbortController().signal;
}

describe('CombinedAutocompleteProvider', () => {
  it('completes slash command names and applies command insertion', async () => {
    const provider = new CombinedAutocompleteProvider(
      [{ name: 'goal', description: 'Manage goals', argumentHint: '[status]' }],
      process.cwd(),
      null,
    );

    const suggestions = await provider.getSuggestions(['/go'], 0, 3, { signal: signal() });

    expect(suggestions).toEqual({
      prefix: '/go',
      items: [{ value: 'goal', label: 'goal', description: '[status] — Manage goals' }],
    });
    expect(provider.applyCompletion(['/go'], 0, 3, suggestions!.items[0]!, '/go')).toEqual({
      lines: ['/goal '],
      cursorLine: 0,
      cursorCol: '/goal '.length,
    });
  });

  it('completes slash command arguments', async () => {
    const provider = new CombinedAutocompleteProvider(
      [
        {
          name: 'goal',
          getArgumentCompletions: async (prefix) =>
            prefix === 'st' ? [{ value: 'status', label: 'status' }] : null,
        },
      ],
      process.cwd(),
      null,
    );

    expect(await provider.getSuggestions(['/goal st'], 0, '/goal st'.length, { signal: signal() })).toEqual({
      prefix: 'st',
      items: [{ value: 'status', label: 'status' }],
    });
  });

  it('completes local file paths with quoting and directory cursor placement', async () => {
    const root = mkdtempSync(join(tmpdir(), 'renderer-autocomplete-'));
    mkdirSync(join(root, 'my dir'));
    writeFileSync(join(root, 'my file.txt'), 'x');

    const provider = new CombinedAutocompleteProvider([], root, null);
    const suggestions = await provider.getSuggestions(['my'], 0, 2, { signal: signal(), force: true });

    expect(suggestions?.prefix).toBe('my');
    expect(suggestions?.items).toEqual([
      { value: '"my dir/"', label: 'my dir/' },
      { value: '"my file.txt"', label: 'my file.txt' },
    ]);

    expect(provider.applyCompletion(['my'], 0, 2, suggestions!.items[0]!, 'my')).toEqual({
      lines: ['"my dir/"'],
      cursorLine: 0,
      cursorCol: '"my dir/'.length,
    });
  });

  it('suppresses bare slash command names for file completion triggers', () => {
    const provider = new CombinedAutocompleteProvider([], process.cwd(), null);

    expect(provider.shouldTriggerFileCompletion(['/go'], 0, 3)).toBe(false);
    expect(provider.shouldTriggerFileCompletion(['/goal st'], 0, 8)).toBe(true);
  });
});
