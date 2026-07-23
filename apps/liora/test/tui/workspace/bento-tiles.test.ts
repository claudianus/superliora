import { describe, expect, it } from 'vitest';

import { NativeFrameRenderer } from '@harness-kit/tui-renderer';

import { paintBentoTile } from '#/tui/workspace/bento-tiles';

function rowText(frame: NativeFrameRenderer, y: number): string {
  const cells: string[] = [];
  for (let x = 0; x < frame.width; x++) {
    cells.push(frame.frame.getCell(x, y)?.char ?? ' ');
  }
  return cells.join('');
}

describe('paintBentoTile', () => {
  it('omits the bottom rule when a sibling abuts below', () => {
    const frame = new NativeFrameRenderer({
      width: 20,
      height: 6,
      output: { write: () => {} },
    });
    frame.beginFrame({ clear: true });
    paintBentoTile(frame, {
      x: 0,
      y: 0,
      width: 20,
      height: 3,
      title: 'Files',
      kind: 'panel',
      content: ['a'],
      omitBottom: true,
    });
    paintBentoTile(frame, {
      x: 0,
      y: 3,
      width: 20,
      height: 3,
      title: 'Git',
      kind: 'panel',
      content: ['b'],
    });

    expect(rowText(frame, 0)).toMatch(/^╭.*Files.*╮$/);
    expect(rowText(frame, 1)).toMatch(/^│a/);
    // No ╰ from the upper tile — Git's ╭ is the shared seam.
    expect(rowText(frame, 2)).not.toMatch(/╰/);
    expect(rowText(frame, 3)).toMatch(/^╭.*Git.*╮$/);
    expect(rowText(frame, 5)).toMatch(/^╰─+╯$/);
  });
});
