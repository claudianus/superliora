import { afterEach, describe, expect, it } from 'vitest';

import {
  presentStableEditorLines,
  resetNativeEditorPresentCacheForTests,
} from '#/tui/features/native-layout/native-layout-frame-editor';
import type { RendererCell, RendererRegionLine } from '#/tui/renderer';

function cellLine(text: string, bg = '#0b0f14'): RendererRegionLine {
  return Array.from(text, (char) => ({ char, style: { bg } }) satisfies RendererCell);
}

describe('presentStableEditorLines', () => {
  afterEach(() => {
    resetNativeEditorPresentCacheForTests();
  });

  it('reuses prior line identities when content hashes match (ambient tick hole)', () => {
    // Ambient ticks rebuild editor surface with fresh arrays even when glyphs
    // are unchanged. Without hash-skip, composition/present rewrites the whole
    // prompt row and ConPTY can flash blank/black cells for a frame.
    const rect = { x: 4, y: 20, width: 40, height: 3 };
    const first = [cellLine('> hello'), cellLine('  world'), cellLine('   ')];
    const presented1 = presentStableEditorLines(first, rect);
    expect(presented1).toBe(first);

    // Fresh arrays, identical content.
    const second = [cellLine('> hello'), cellLine('  world'), cellLine('   ')];
    const presented2 = presentStableEditorLines(second, rect);
    expect(presented2).toBe(presented1);
    expect(presented2).not.toBe(second);
  });

  it('takes incoming lines when content changes', () => {
    const rect = { x: 0, y: 0, width: 20, height: 2 };
    const first = [cellLine('> a'), cellLine('  ')];
    presentStableEditorLines(first, rect);

    const next = [cellLine('> ab'), cellLine('  ')];
    const presented = presentStableEditorLines(next, rect);
    expect(presented).toBe(next);
  });

  it('takes incoming lines when geometry changes even if glyphs match', () => {
    const first = [cellLine('> same')];
    presentStableEditorLines(first, { x: 0, y: 0, width: 20, height: 1 });

    const second = [cellLine('> same')];
    const presented = presentStableEditorLines(second, {
      x: 0,
      y: 1,
      width: 20,
      height: 1,
    });
    expect(presented).toBe(second);
  });
});
