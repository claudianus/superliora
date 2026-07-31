import { describe, expect, it } from 'vitest';

import { renderCliUpgradeProgressLines } from '#/cli/update/cli-progress';

const ANSI = /\u001B\[[0-9;]*m/g;

function strip(text: string): string {
  return text.replaceAll(ANSI, '');
}

describe('renderCliUpgradeProgressLines', () => {
  it('renders target, source, checklist, and bar for building stage', () => {
    const lines = renderCliUpgradeProgressLines({
      source: 'github-checkout',
      stage: 'building',
      targetVersion: 'origin/main@abcdef',
      startedAtMs: 1_000,
      nowMs: 2_500,
    }).map(strip);

    const joined = lines.join('\n');
    expect(joined).toContain('origin/main@abcdef');
    expect(joined).toContain('github-checkout');
    expect(joined).toContain('Building');
    expect(joined).toContain('Fetching');
    expect(joined).toContain('[');
    expect(joined).toMatch(/[█░]/);
    expect(joined).toContain('elapsed 1.5s');
  });

  it('includes detail when provided', () => {
    const lines = renderCliUpgradeProgressLines({
      source: 'npm-global',
      stage: 'installing',
      targetVersion: '0.5.0',
      detail: 'npm install -g …',
      startedAtMs: 0,
      nowMs: 100,
    }).map(strip);
    expect(lines.join('\n')).toContain('npm install');
  });
});
