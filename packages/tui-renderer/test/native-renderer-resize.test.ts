import { describe, expect, it } from 'vitest';

import { ANSI_CLEAR_SCREEN, encodeTerminalClearBelowRow } from '../src';
import {
  clearStaleNativeRendererFrameRows,
  handleNativeRendererTerminalResize,
} from '../src/native-renderer/resize';
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

const THEME_BG_SGR = '\u001B[0;48;2;17;34;51m';

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

  it('theme-bg-fills newly exposed rows after a height increase without CSI 0J', () => {
    const { prefixes, frameRenderer } = createResizeHarness({ width: 80, height: 20 });
    const fill = { style: { bg: '#112233' } };

    clearStaleNativeRendererFrameRows(
      {
        screenMode: 'alternate',
        originX: 0,
        originY: 0,
        fill,
        frameRenderer,
        compositionCache: undefined,
      },
      24,
      20,
    );

    expect(prefixes).toEqual([encodeTerminalClearBelowRow(20, 0, 0, fill, 80, 4)]);
    expect(prefixes.join('')).toContain(THEME_BG_SGR);
    expect(prefixes.join('')).not.toContain('\u001B[0J');
    expect(prefixes.join('')).not.toContain('\u001B[J');
    expect(prefixes.join('')).not.toContain(ANSI_CLEAR_SCREEN);
    expect(prefixes.join('')).not.toContain('\u001B[K');
  });

  it('theme-bg-fills leftover rows after a height decrease without default-black erase', () => {
    const { prefixes, frameRenderer } = createResizeHarness({ width: 80, height: 24 });
    const fill = { style: { bg: '#112233' } };

    handleNativeRendererTerminalResize(
      {
        screenMode: 'main',
        originX: 0,
        originY: 0,
        fill,
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

    expect(prefixes).toEqual([encodeTerminalClearBelowRow(20, 0, 0, fill, 80, 4)]);
    expect(prefixes.join('')).toContain(THEME_BG_SGR);
    expect(prefixes.join('')).not.toContain('\u001B[0J');
    expect(prefixes.join('')).not.toContain('\u001B[J');
    expect(prefixes.join('')).not.toContain(ANSI_CLEAR_SCREEN);
    expect(prefixes.join('')).not.toContain('\u001B[K');
  });

  it('does not emit CSI 0J when no theme fill is available', () => {
    const { prefixes, frameRenderer } = createResizeHarness({ width: 80, height: 24 });

    clearStaleNativeRendererFrameRows(
      {
        screenMode: 'main',
        originX: 0,
        originY: 0,
        frameRenderer,
        compositionCache: undefined,
      },
      20,
      24,
    );

    expect(prefixes).toEqual([]);
    expect(encodeTerminalClearBelowRow(20)).toBe('');
  });
});
