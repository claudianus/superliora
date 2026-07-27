import { describe, expect, it } from 'vitest';

import { NativeFrameRenderer } from '../src';

const CSI_Q = /\u001B\[\d+ q/;

function createRenderer(): { renderer: NativeFrameRenderer; writes: string[] } {
  const writes: string[] = [];
  const renderer = new NativeFrameRenderer({
    width: 20,
    height: 5,
    cursorMotion: 'absolute',
    output: {
      write: (chunk: string) => {
        writes.push(chunk);
      },
    },
  });
  return { renderer, writes };
}

describe('NativeFrameRenderer', () => {
  it('emits DECSCUSR once per shape change, not every frame', () => {
    const { renderer, writes } = createRenderer();

    renderer.beginFrame();
    renderer.writeText(0, 0, 'one');
    renderer.setCursor({ x: 0, y: 0, visible: true, shape: 'block', blinking: true });
    renderer.present();
    expect(writes.join('')).toContain('\u001B[1 q');

    // Same shape, new position: position + show emit, the shape does not.
    writes.length = 0;
    renderer.beginFrame();
    renderer.writeText(0, 1, 'two');
    renderer.setCursor({ x: 3, y: 1, visible: true, shape: 'block', blinking: true });
    renderer.present();
    const second = writes.join('');
    expect(second).not.toMatch(CSI_Q);
    expect(second).toContain('\u001B[2;4H');
    expect(second).toContain('\u001B[?25h');

    // A real shape change re-emits DECSCUSR.
    writes.length = 0;
    renderer.beginFrame();
    renderer.writeText(0, 2, 'three');
    renderer.setCursor({ x: 0, y: 2, visible: true, shape: 'underline', blinking: false });
    renderer.present();
    expect(writes.join('')).toContain('\u001B[4 q');
  });

  it('re-emits the cursor shape after a resize', () => {
    const { renderer, writes } = createRenderer();

    renderer.beginFrame();
    renderer.writeText(0, 0, 'one');
    renderer.setCursor({ x: 0, y: 0, visible: true, shape: 'block', blinking: true });
    renderer.present();
    expect(writes.join('')).toContain('\u001B[1 q');

    writes.length = 0;
    renderer.resize(30, 5);
    renderer.beginFrame();
    renderer.writeText(0, 0, 'two');
    renderer.setCursor({ x: 1, y: 0, visible: true, shape: 'block', blinking: true });
    renderer.present();
    expect(writes.join('')).toContain('\u001B[1 q');
  });

  it('treats resize as a no-op when the size is unchanged', () => {
    const { renderer } = createRenderer();
    const frameBefore = renderer.frame;

    renderer.resize(20, 5);
    expect(renderer.frame).toBe(frameBefore);

    renderer.resize(30, 5);
    expect(renderer.frame).not.toBe(frameBefore);
  });
});
