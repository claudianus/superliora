import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { suggestSimilarCommand } from '#/cli/commands';

function commands(...names: string[]): Command[] {
  return names.map((name) => new Command(name));
}

describe('suggestSimilarCommand', () => {
  it('suggests the closest real command for near-miss typos', () => {
    const pool = commands('server', 'session', 'upgrade', 'doctor');
    expect(suggestSimilarCommand('servre', pool)).toBe('server');
    expect(suggestSimilarCommand('sessio', pool)).toBe('session');
    expect(suggestSimilarCommand('upgrad', pool)).toBe('upgrade');
  });

  it('returns undefined for unrelated words and tiny inputs', () => {
    const pool = commands('server', 'doctor');
    expect(suggestSimilarCommand('xyzzy', pool)).toBeUndefined();
    expect(suggestSimilarCommand('s', pool)).toBeUndefined();
  });

  it('ignores exact matches and hidden plumbing commands', () => {
    const visible = commands('server');
    const hidden = new Command('__plugin_run_node');
    (hidden as unknown as { _hidden: boolean })._hidden = true;
    expect(suggestSimilarCommand('server', [visible[0]!])).toBeUndefined();
    // Close to the hidden command only → do not leak plumbing into UX.
    expect(suggestSimilarCommand('__plugin_run_nod', [visible[0]!, hidden])).toBeUndefined();
  });

  it('matches aliases', () => {
    const withAlias = new Command('upgrade').alias('update');
    expect(suggestSimilarCommand('udpate', [withAlias])).toBe('update');
  });
});
