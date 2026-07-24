import { beforeEach, describe, expect, it } from 'vitest';

import { STAGE_MIN_WIDTH } from '#/tui/controllers/stage-layout';
import type { TUIState } from '#/tui/tui-state';
import { createTUIState } from '#/tui/tui-state';
import type { AppState } from '#/tui/types';
import type { NativeInputMouseEvent } from '#/tui/renderer';
import {
  handleStageResizeMouseInput,
  resetStageResizeDragForTests,
} from '#/tui/utils/stage-resize-mouse';

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
    expect(handleStageResizeMouseInput(state, mouse('move', GRAB_RIGHT, MID_Y))).toBe(false);
    expect(handleStageResizeMouseInput(state, mouse('wheel', GRAB_RIGHT, MID_Y))).toBe(false);
  });

  it('does not start a drag from the stage body interior', () => {
    const state = createState();
    expect(handleStageResizeMouseInput(state, mouse('press', MID_X, MID_Y))).toBe(false);
    expect(state.userStageSize).toBeUndefined();
  });

  it('grows the width by 2*dx when dragging the right edge (center stays fixed)', () => {
    const state = createState();
    expect(handleStageResizeMouseInput(state, mouse('press', GRAB_RIGHT, MID_Y))).toBe(true);
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
});
