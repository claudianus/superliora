import { readFileSync } from 'node:fs';
import { join } from 'pathe';

import { describe, expect, it } from 'vitest';

/**
 * Drift guard for the prompt cache layers.
 *
 * `system.md` is the single source of the main system prompt. The
 * `layer{1,2,3}-*.md` files mirror it, split so providers can cache the
 * static prefix. Editing one without the others silently desyncs what the
 * model sees in combined vs layered mode.
 *
 * Invariants:
 *   1. Each layer's content lines appear in system.md in the same order.
 *   2. Every system.md content line appears in at least one layer.
 *
 * Template control lines ({% %}) and blank lines are ignored; `{{ }}`
 * placeholder lines must match literally. When this fails, mirror the edit
 * into the other file(s) — or update this test if divergence is intended.
 */

const PROMPT_DIR = join(import.meta.dirname, '..', '..', 'src', 'profile', 'default');

const SYSTEM = 'system.md';
const LAYERS = ['layer1-static.md', 'layer2-session.md', 'layer3-dynamic.md'] as const;

function contentLines(file: string): string[] {
  return readFileSync(join(PROMPT_DIR, file), 'utf-8')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('{%'));
}

describe('system.md ↔ cache layer sync', () => {
  const system = contentLines(SYSTEM);

  for (const layer of LAYERS) {
    it(`${layer} lines appear in system.md in order`, () => {
      let cursor = 0;
      for (const line of contentLines(layer)) {
        const found = system.indexOf(line, cursor);
        expect(
          found,
          `${layer} line missing from system.md (after line ${cursor}); mirror the edit into system.md:\n${line}`,
        ).toBeGreaterThanOrEqual(0);
        cursor = found + 1;
      }
    });
  }

  it('every system.md content line is mirrored in a layer', () => {
    const layerSets = LAYERS.map((layer) => new Set(contentLines(layer)));
    for (const line of system) {
      expect(
        layerSets.some((set) => set.has(line)),
        `system.md line missing from every layer file; mirror the edit into the owning layer:\n${line}`,
      ).toBe(true);
    }
  });
});
