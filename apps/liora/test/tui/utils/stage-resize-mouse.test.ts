import { beforeEach, describe, expect, it } from 'vitest';

import { STAGE_MIN_WIDTH } from '#/tui/controllers/layout/stage-layout';
import type { TUIState } from '#/tui/tui-state';
import { createTUIState } from '#/tui/tui-state';
import type { AppState } from '#/tui/types';
import type { NativeInputMouseEvent } from '#/tui/renderer';
import {
  getStageResizeHoverZone,
  handleStageResizeMouseInput,
  isStageResizeDragging,
  pointerShapeForZone,
  resetStageResizeDragForTests,
  resetStageResizePointerShape,
} from '#/tui/features/stage/stage-resize-mouse';
import { invalidateProfile } from '#/tui/utils/terminal/terminal-capability-profile';

function fakeInitialAppState(): AppState {
  return {
    model: 'test-model',
    workDir: '/tmp/liora-test',
    additionalDirs: [],
    sessionId: 'sess-1',
    permissionMode: 'manual',
    planMode: false,
    inputMode: 'prompt',
    swarmMode: false,
    thinking: false,
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    isCompacting: false,
    isBackgroundCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    theme: 'dark',
    version: '0.0.0-test',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    upgrade: { autoInstall: true },
    availableModels: {},
    availableProviders: {},
    sessionTitle: null,
    mcpServersSummary: null,
  };
}

const COLS = 200;
const ROWS = 80;
// A known stage band the renderer would have cached. Margins on all sides are
// >= STAGE_FRAME_MARGIN (3) so the frame counts as visible.
const BAND = { x: 50, y: 15, width: 100, height: 50 };

function createState(): TUIState {
  const state = createTUIState({
    initialAppState: fakeInitialAppState(),
    startup: { continueLast: false, yolo: false, auto: false, plan: false },
  });
  Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => ROWS });
  Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => COLS });
  // Swallow Kitty pointer-shape OSC so tests never leak control sequences.
  state.terminal.write = () => {};
  state.cachedStageBand = { ...BAND };
  return state;
}

function mouse(
  action: NativeInputMouseEvent['action'],
  x: number,
  y: number,
  button: NativeInputMouseEvent['button'] = 'left',
): NativeInputMouseEvent {
  return { type: 'mouse', raw: '', button, action, x, y, ctrl: false, alt: false, shift: false };
}

// The grab rect is the band expanded by one cell (the visible stroke ring).
const GRAB_LEFT = BAND.x - 1;
const GRAB_RIGHT = BAND.x + BAND.width; // grabRect.x + grabRect.width - 1
const GRAB_TOP = BAND.y - 1;
const GRAB_BOTTOM = BAND.y + BAND.height;
const MID_Y = BAND.y + Math.floor(BAND.height / 2);
const MID_X = BAND.x + Math.floor(BAND.width / 2);

describe('handleStageResizeMouseInput', () => {
  beforeEach(() => {
    resetStageResizeDragForTests();
  });

  it('ignores non-mouse events and non-resize actions', () => {
    const state = createState();
    expect(handleStageResizeMouseInput(state, { type: 'focus', raw: '', focused: true } as never)).toBe(false);
    expect(handleStageResizeMouseInput(state, mouse('wheel', GRAB_RIGHT, MID_Y))).toBe(false);
  });

  it('lights the resize grip and reports a pointer shape on hover move', () => {
    const prevTerm = process.env['TERM'];
    const prevCi = process.env['CI'];
    const prevTty = process.stdin.isTTY;
    process.env['TERM'] = 'kitty';
    delete process.env['CI'];
    process.stdin.isTTY = true;
    invalidateProfile();
    try {
      const state = createState();
      const writes: string[] = [];
      state.terminal.write = (chunk: string) => {
        writes.push(chunk);
      };

      // Move over the right edge grip (button=none for any-event tracking).
      expect(handleStageResizeMouseInput(state, mouse('move', GRAB_RIGHT, MID_Y, 'none'))).toBe(true);
      expect(getStageResizeHoverZone()).toBe('resize-right');
      expect(isStageResizeDragging()).toBe(false);
      // OSC 22 push — never the legacy CSI form that leaked "s-resize" text.
      expect(writes.some((w) => w.includes('\u001B]22;>ew-resize\u001B\\'))).toBe(true);
      expect(writes.some((w) => w.includes('\u001B[22;'))).toBe(false);

      // Leave the grip — hover clears and pointer pops via OSC 22.
      expect(handleStageResizeMouseInput(state, mouse('move', MID_X, MID_Y, 'none'))).toBe(true);
      expect(getStageResizeHoverZone()).toBeUndefined();
      expect(writes.some((w) => w.includes('\u001B]22;<\u001B\\'))).toBe(true);
    } finally {
      if (prevTerm === undefined) delete process.env['TERM'];
      else process.env['TERM'] = prevTerm;
      if (prevCi === undefined) delete process.env['CI'];
      else process.env['CI'] = prevCi;
      process.stdin.isTTY = prevTty;
      invalidateProfile();
    }
  });

  it('never writes pointer shape sequences for unsupported terminals', () => {
    // Default vitest env is non-interactive, so pointerShapes must be off.
    invalidateProfile();
    try {
      const state = createState();
      const writes: string[] = [];
      state.terminal.write = (chunk: string) => {
        writes.push(chunk);
      };
      expect(handleStageResizeMouseInput(state, mouse('move', GRAB_RIGHT, MID_Y, 'none'))).toBe(true);
      expect(handleStageResizeMouseInput(state, mouse('move', MID_X, MID_Y, 'none'))).toBe(true);
      expect(writes.filter((w) => w.includes('\u001B]22'))).toEqual([]);
      expect(writes.filter((w) => w.includes('resize'))).toEqual([]);
    } finally {
      invalidateProfile();
    }
  });

  it('maps resize zones to Kitty pointer shapes', () => {
    expect(pointerShapeForZone('resize-left')).toBe('ew-resize');
    expect(pointerShapeForZone('resize-right')).toBe('ew-resize');
    expect(pointerShapeForZone('resize-top')).toBe('ns-resize');
    expect(pointerShapeForZone('resize-bottom')).toBe('ns-resize');
    expect(pointerShapeForZone('resize-top-left')).toBe('nwse-resize');
    expect(pointerShapeForZone('resize-bottom-right')).toBe('nwse-resize');
    expect(pointerShapeForZone('resize-top-right')).toBe('nesw-resize');
    expect(pointerShapeForZone('resize-bottom-left')).toBe('nesw-resize');
  });

  it('treats the top edge as a resize grip (not a window title-bar)', () => {
    const state = createState();
    expect(handleStageResizeMouseInput(state, mouse('press', MID_X, GRAB_TOP))).toBe(true);
    expect(isStageResizeDragging()).toBe(true);
    expect(getStageResizeHoverZone()).toBe('resize-top');
  });

  it('does not start a drag from the stage body interior', () => {
    const state = createState();
    expect(handleStageResizeMouseInput(state, mouse('press', MID_X, MID_Y))).toBe(false);
    expect(state.userStageSize).toBeUndefined();
  });

  it('clears lingering hover when pressing outside a resize grip', () => {
    const state = createState();
    // Hover over the right edge to set the resize cursor.
    expect(handleStageResizeMouseInput(state, mouse('move', GRAB_RIGHT, MID_Y, 'none'))).toBe(true);
    expect(getStageResizeHoverZone()).toBe('resize-right');

    // Press inside the stage body (not a resize zone): hover must clear
    // so the resize cursor does not stay stuck.
    expect(handleStageResizeMouseInput(state, mouse('press', MID_X, MID_Y))).toBe(false);
    expect(getStageResizeHoverZone()).toBeUndefined();
  });

  it('recovers from a lost release when a hover move arrives during drag', () => {
    const state = createState();
    // Start a drag on the right edge.
    expect(handleStageResizeMouseInput(state, mouse('press', GRAB_RIGHT, MID_Y))).toBe(true);
    expect(isStageResizeDragging()).toBe(true);

    // The user released the mouse button outside the terminal so no release
    // event was received. A subsequent hover move (button=none) must clear
    // the stale drag state so the cursor resets.
    // Returns false because the mouse is now outside the resize zone.
    expect(handleStageResizeMouseInput(state, mouse('move', MID_X, MID_Y, 'none'))).toBe(false);
    expect(isStageResizeDragging()).toBe(false);
    expect(getStageResizeHoverZone()).toBeUndefined();
  });

  it('grows the width by 2*dx when dragging the right edge (center stays fixed)', () => {
    const state = createState();
    expect(handleStageResizeMouseInput(state, mouse('press', GRAB_RIGHT, MID_Y))).toBe(true);
    expect(isStageResizeDragging()).toBe(true);
    expect(getStageResizeHoverZone()).toBe('resize-right');
    expect(handleStageResizeMouseInput(state, mouse('drag', GRAB_RIGHT + 5, MID_Y))).toBe(true);
    expect(state.userStageSize).toEqual({ width: BAND.width + 10, height: BAND.height });
  });

  it('shrinks from the left edge by 2*dx', () => {
    const state = createState();
    expect(handleStageResizeMouseInput(state, mouse('press', GRAB_LEFT, MID_Y))).toBe(true);
    // Dragging the left edge to the right shrinks the stage.
    expect(handleStageResizeMouseInput(state, mouse('drag', GRAB_LEFT + 4, MID_Y))).toBe(true);
    expect(state.userStageSize).toEqual({ width: BAND.width - 8, height: BAND.height });
  });

  it('resizes both axes from a bottom-right corner drag', () => {
    const state = createState();
    expect(handleStageResizeMouseInput(state, mouse('press', GRAB_RIGHT, GRAB_BOTTOM))).toBe(true);
    expect(handleStageResizeMouseInput(state, mouse('drag', GRAB_RIGHT + 5, GRAB_BOTTOM + 3))).toBe(true);
    expect(state.userStageSize).toEqual({ width: BAND.width + 10, height: BAND.height + 6 });
  });

  it('clamps the width to the minimum stage size', () => {
    const state = createState();
    expect(handleStageResizeMouseInput(state, mouse('press', GRAB_LEFT, MID_Y))).toBe(true);
    // Drag the left edge far to the right so the raw width goes negative.
    expect(handleStageResizeMouseInput(state, mouse('drag', GRAB_LEFT + 200, MID_Y))).toBe(true);
    expect(state.userStageSize?.width).toBe(STAGE_MIN_WIDTH);
  });

  it('stops resizing after release', () => {
    const state = createState();
    expect(handleStageResizeMouseInput(state, mouse('press', GRAB_RIGHT, MID_Y))).toBe(true);
    expect(handleStageResizeMouseInput(state, mouse('release', GRAB_RIGHT + 5, MID_Y))).toBe(true);
    // A subsequent drag without a fresh press is a no-op, and no drag frame
    // ever wrote a user size.
    expect(handleStageResizeMouseInput(state, mouse('drag', GRAB_RIGHT + 20, MID_Y))).toBe(false);
    expect(state.userStageSize).toBeUndefined();
  });

  it('falls back to resolving the band before any frame is cached', () => {
    const state = createState();
    state.cachedStageBand = undefined;
    // No cached band: the handler resolves the layout itself. A press far from
    // the centered stage must not start a drag.
    expect(handleStageResizeMouseInput(state, mouse('press', 0, 0))).toBe(false);
  });

  it('pops the pointer shape when the pointer leaves the grip while hovering', () => {
    const prevTerm = process.env['TERM'];
    const prevCi = process.env['CI'];
    const prevTty = process.stdin.isTTY;
    process.env['TERM'] = 'kitty';
    delete process.env['CI'];
    process.stdin.isTTY = true;
    invalidateProfile();
    try {
      const state = createState();
      const writes: string[] = [];
      state.terminal.write = (chunk: string) => {
        writes.push(chunk);
      };

      expect(handleStageResizeMouseInput(state, mouse('move', GRAB_RIGHT, MID_Y, 'none'))).toBe(true);
      expect(getStageResizeHoverZone()).toBe('resize-right');
      writes.length = 0;

      // Leave the grip for the stage interior: hover clears and the pushed
      // shape is popped in the same move.
      expect(handleStageResizeMouseInput(state, mouse('move', MID_X, MID_Y, 'none'))).toBe(true);
      expect(getStageResizeHoverZone()).toBeUndefined();
      expect(writes.some((w) => w.includes('\u001B]22;<\u001B\\'))).toBe(true);
    } finally {
      if (prevTerm === undefined) delete process.env['TERM'];
      else process.env['TERM'] = prevTerm;
      if (prevCi === undefined) delete process.env['CI'];
      else process.env['CI'] = prevCi;
      process.stdin.isTTY = prevTty;
      invalidateProfile();
    }
  });

  it('clears drag and hover on release outside the stage frame', () => {
    const state = createState();
    expect(handleStageResizeMouseInput(state, mouse('press', GRAB_RIGHT, MID_Y))).toBe(true);
    expect(isStageResizeDragging()).toBe(true);
    expect(getStageResizeHoverZone()).toBe('resize-right');

    expect(handleStageResizeMouseInput(state, mouse('release', -20, -20))).toBe(true);
    expect(isStageResizeDragging()).toBe(false);
    expect(getStageResizeHoverZone()).toBeUndefined();
  });

  it('clears drag and hover when terminal focus is lost', () => {
    const state = createState();
    expect(handleStageResizeMouseInput(state, mouse('press', GRAB_RIGHT, MID_Y))).toBe(true);

    expect(
      handleStageResizeMouseInput(state, { type: 'focus', raw: '', focused: false }),
    ).toBe(true);
    expect(isStageResizeDragging()).toBe(false);
    expect(getStageResizeHoverZone()).toBeUndefined();
  });

  it('resetStageResizePointerShape pops a pushed shape and clears drag/hover state', () => {
    const prevTerm = process.env['TERM'];
    const prevCi = process.env['CI'];
    const prevTty = process.stdin.isTTY;
    process.env['TERM'] = 'kitty';
    delete process.env['CI'];
    process.stdin.isTTY = true;
    invalidateProfile();
    try {
      const state = createState();
      const writes: string[] = [];
      state.terminal.write = (chunk: string) => {
        writes.push(chunk);
      };

      // Press on the right grip: pushes a shape and starts a drag.
      expect(handleStageResizeMouseInput(state, mouse('press', GRAB_RIGHT, MID_Y))).toBe(true);
      expect(isStageResizeDragging()).toBe(true);
      expect(writes.some((w) => w.includes('\u001B]22;>ew-resize\u001B\\'))).toBe(true);
      writes.length = 0;

      // A terminal resize goes through this reset: the shape pops and the
      // in-flight drag/hover state is dropped.
      resetStageResizePointerShape(state.terminal);
      expect(writes.some((w) => w.includes('\u001B]22;<\u001B\\'))).toBe(true);
      expect(isStageResizeDragging()).toBe(false);
      expect(getStageResizeHoverZone()).toBeUndefined();

      // A second reset is a no-op (no duplicate pop).
      writes.length = 0;
      resetStageResizePointerShape(state.terminal);
      expect(writes).toEqual([]);
    } finally {
      if (prevTerm === undefined) delete process.env['TERM'];
      else process.env['TERM'] = prevTerm;
      if (prevCi === undefined) delete process.env['CI'];
      else process.env['CI'] = prevCi;
      process.stdin.isTTY = prevTty;
      invalidateProfile();
    }
  });
});
