import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../..');

describe('Mission naming surface', () => {
  it('skill primary name is mission with ultrawork alias', () => {
    const skill = readFileSync(
      join(root, 'src/skill/builtin/ultrawork.md'),
      'utf8',
    );
    expect(skill).toMatch(/^name:\s*mission/m);
    expect(skill).toMatch(/aliases:\s*\n\s*-\s*ultrawork/m);
    expect(skill).toContain('Hard vs soft');
    expect(skill).toContain('Fleet decision');
    // Must not claim all phase checkpoints are advisory-only.
    expect(skill).not.toMatch(/phase checkpoints are advisory, not hard gates/);
  });

  it('activation prompt brand is Mission with single spine', () => {
    const contract = readFileSync(
      join(root, '../../apps/liora/src/tui/commands/ultrawork/ultrawork-contract.ts'),
      'utf8',
    );
    expect(contract).toContain("brand: Mission");
    expect(contract).toContain('Do not run a separate Ultrawork spine');
    expect(contract).toContain('load the `mission` builtin skill');
  });
});
