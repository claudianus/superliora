import { describe, expect, it } from 'vitest';

import { ANSI_CLEAR_SCREEN } from '../src';
import { handleNativeRendererTerminalResize } from '../src/native-renderer/resize';
import type { NativeFrameRenderer } from '../src/native/frame';

function createResizeHarness(size: { width: number; height: number } = { width: 80, height: 24 }) {
  const prefixes: string[] = [];
  const frameState = {
    width: size.width,
    height: size.height,
  };
  const frameRenderer = {
    get width() {
      return frameState.width;
    },
    get height() {
      return frameState.height;
    },
    resize(width: number, height: number) {
      frameState.width = width;
      frameState.height = height;
    },
    queueTerminalPrefix(prefix: string) {
      prefixes.push(prefix);
    },
  } as NativeFrameRenderer;

  return { prefixes, frameRenderer };
}

describe('handleNativeRendererTerminalResize', () => {
  it('does not queue CSI 2J on alternate-screen grow or shrink', () => {
    const { prefixes, frameRenderer } = createResizeHarness();

    handleNativeRendererTerminalResize(
      {
        screenMode: 'alternate',
        originX: 0,
        originY: 0,
        frameRenderer,
        compositionCache: undefined,
      },
      { columns: 120, rows: 40 },
      {
        now: () => 0,
        recordResize: () => {},
        requestRender: () => {},
      },
    );

    expect(prefixes.join('')).not.toContain(ANSI_CLEAR_SCREEN);
    expect(prefixes.some((prefix) => prefix.includes('\u001B[2J'))).toBe(false);

    handleNativeRendererTerminalResize(
      {
        screenMode: 'alternate',
        originX: 0,
        originY: 0,
        frameRenderer,
        compositionCache: undefined,
      },
      { columns: 80, rows: 20 },
      {
        now: () => 0,
        recordResize: () => {},
        requestRender: () => {},
      },
    );

    expect(prefixes.join('')).not.toContain(ANSI_CLEAR_SCREEN);
  });
});
