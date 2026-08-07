import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolCallComponent } from '#/tui/components/messages/tool-call/index';
import type { NativeInputMouseEvent } from '#/tui/renderer';
import { createTUIState, type TUIState } from '#/tui/tui-state';
import type { AppState } from '#/tui/types';
import { createTUIStateNativeInputRouter } from '#/tui/features/native-layout/native-input-router';
import {
  handleToolOutputMouse,
  resetToolOutputMouseState,
} from '#/tui/utils/tool/tool-output-mouse';
import { resolveTranscriptLayoutContext } from '#/tui/features/transcript/transcript-hit-test';

const FRAME_WIDTH = 80;
const FRAME_HEIGHT = 40;
const STAGE_WIDTH = 48;
const VISIBLE_ROWS = 30;

function fakeInitialAppState(): AppState {
  return {
    model: 'test-model',
    workDir: '/tmp/liora-test',
    additionalDirs: [],
    sessionId: 'sess-tool-output',
    permissionMode: 'manual',
    planMode: false,
    askMode: false,
    inputMode: 'prompt',
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

function createState(): TUIState {
  const state = createTUIState({
    initialAppState: fakeInitialAppState(),
    startup: { continueLast: false, yolo: false, auto: false, plan: false },
  });
  Object.defineProperty(state.terminal, 'columns', {
    configurable: true,
    get: () => FRAME_WIDTH,
  });
  Object.defineProperty(state.terminal, 'rows', {
    configurable: true,
    get: () => FRAME_HEIGHT,
  });
  state.renderer.requestRender = vi.fn();
  return state;
}

function tool(id: string, lines = 12): ToolCallComponent {
  return new ToolCallComponent(
    { id, name: 'SomethingUnknown', args: {} },
    {
      tool_call_id: id,
      output: Array.from({ length: lines }, (_, index) => `${id}-line-${index + 1}`).join('\n'),
      is_error: false,
    },
    undefined,
    undefined,
    currentState.toolOutputViewports,
  );
}

let currentState: TUIState;

function mountTools(...components: ToolCallComponent[]): void {
  for (const component of components) currentState.transcriptContainer.addChild(component);
  const totalRows = currentState.transcriptContainer.render(STAGE_WIDTH).length;
  currentState.transcriptViewport.sync(totalRows, VISIBLE_ROWS);
  const editorLineCount = currentState.editor.getNativeLayoutRowCount?.(FRAME_WIDTH) ?? -1;
  currentState.cachedTranscriptRect = {
    x: 4,
    y: 3,
    width: STAGE_WIDTH,
    height: VISIBLE_ROWS,
  };
  currentState.cachedTranscriptVisibleRows = VISIBLE_ROWS;
  currentState.cachedTranscriptStageWidth = STAGE_WIDTH;
  currentState.cachedTranscriptColumns = FRAME_WIDTH;
  currentState.cachedTranscriptRows = FRAME_HEIGHT;
  currentState.cachedTranscriptLineCount = editorLineCount;
}

function mouse(
  action: NativeInputMouseEvent['action'],
  x: number,
  y: number,
  button: NativeInputMouseEvent['button'] = 'left',
): NativeInputMouseEvent {
  return { type: 'mouse', raw: '', button, action, x, y, ctrl: false, alt: false, shift: false };
}

function pointInOutput(
  component: ToolCallComponent,
  target: 'body' | 'grip',
): { x: number; y: number } {
  const context = resolveTranscriptLayoutContext(currentState);
  if (context === undefined) throw new Error('missing transcript layout context');
  const totalRows = currentState.transcriptContainer.render(context.stageWidth).length;
  for (let logicalRow = 0; logicalRow < totalRows; logicalRow += 1) {
    const range = currentState.transcriptContainer.childRowRangeAt(context.stageWidth, logicalRow);
    if (range?.child !== component) continue;
    const localColumn = target === 'grip' ? range.renderWidth - 1 : 0;
    const hit = component.toolOutputHitAt(range.localRow, localColumn, range.renderWidth);
    if (hit === undefined || (target === 'grip' && !hit.onGrip)) continue;
    return {
      x: context.rect.x + context.leftPad + localColumn,
      y: context.rect.y + logicalRow - context.viewportStart,
    };
  }
  throw new Error(`missing ${target} point for ${component.toolCallId}`);
}

describe('tool output mouse routing', () => {
  beforeEach(() => {
    resetToolOutputMouseState();
    currentState = createState();
  });

  it('keeps tool A/B scroll and height independent and captures outside drag/release', () => {
    const toolA = tool('call-a');
    const toolB = tool('call-b');
    mountTools(toolA, toolB);
    const pointA = pointInOutput(toolA, 'body');
    const pointB = pointInOutput(toolB, 'body');

    expect(handleToolOutputMouse(currentState, mouse('wheel', pointA.x, pointA.y, 'wheel-down'))).toBe(true);
    expect(handleToolOutputMouse(currentState, mouse('wheel', pointA.x, pointA.y, 'wheel-down'))).toBe(true);
    expect(handleToolOutputMouse(currentState, mouse('wheel', pointB.x, pointB.y, 'wheel-down'))).toBe(true);
    expect(currentState.toolOutputViewports.get('call-a')?.offset).toBe(2);
    expect(currentState.toolOutputViewports.get('call-b')?.offset).toBe(1);

    const gripA = pointInOutput(toolA, 'grip');
    expect(handleToolOutputMouse(currentState, mouse('press', gripA.x, gripA.y))).toBe(true);
    expect(handleToolOutputMouse(currentState, mouse('drag', -20, gripA.y + 8))).toBe(true);
    expect(currentState.toolOutputViewports.get('call-a')?.height).toBeGreaterThan(5);
    expect(currentState.toolOutputViewports.get('call-b')?.height).toBe(5);
    expect(handleToolOutputMouse(currentState, mouse('release', -20, -20))).toBe(true);
    expect(handleToolOutputMouse(currentState, mouse('drag', -20, -10))).toBe(false);
  });

  it('falls back to global transcript scroll only when the pointer is outside tool output', () => {
    const component = tool('call-fallback');
    mountTools(component);
    const inside = pointInOutput(component, 'body');
    const scrollTranscriptViewport = vi.fn(() => true);
    const router = createTUIStateNativeInputRouter(currentState, { scrollTranscriptViewport });

    expect(router.dispatch(mouse('wheel', inside.x, inside.y, 'wheel-down')).handled).toBe(true);
    expect(scrollTranscriptViewport).not.toHaveBeenCalled();

    const context = resolveTranscriptLayoutContext(currentState);
    if (context === undefined) throw new Error('missing transcript layout context');
    expect(
      router.dispatch(mouse('wheel', context.rect.x, context.rect.y, 'wheel-down')).handled,
    ).toBe(true);
    expect(scrollTranscriptViewport).toHaveBeenCalledOnce();
    router.dispose();
  });

  it('restores offset and height when a tool component is recreated with the session registry', () => {
    const original = tool('call-replay');
    mountTools(original);
    original.scrollToolOutput(4);
    original.resizeToolOutput(6, 12);
    original.render(STAGE_WIDTH);
    const saved = currentState.toolOutputViewports.get('call-replay');
    expect(saved).toMatchObject({ offset: 4, height: 6 });

    const recreated = tool('call-replay');
    recreated.render(STAGE_WIDTH);
    expect(currentState.toolOutputViewports.get('call-replay')).toEqual(saved);
    expect(recreated.scrollToolOutput(1)).toBe(true);
    expect(currentState.toolOutputViewports.get('call-replay')?.offset).toBe(5);
  });

  it('consumes a 100-event wheel burst without legacy/editor or global-scroll leakage', () => {
    const component = tool('call-burst', 160);
    mountTools(component);
    const inside = pointInOutput(component, 'body');
    const legacyInputs: string[] = [];
    const scrollTranscriptViewport = vi.fn(() => true);
    const initialEditorText = currentState.editor.getText();
    const router = createTUIStateNativeInputRouter(currentState, {
      handleLegacyInput: (data) => legacyInputs.push(data),
      scrollTranscriptViewport,
    });

    for (let index = 0; index < 100; index += 1) {
      const button = index % 2 === 0 ? 'wheel-down' : 'wheel-up';
      const result = router.dispatch(mouse('wheel', inside.x, inside.y, button));
      expect(result.handled).toBe(true);
      expect(result.targetId).toBe('tool-output');
    }

    expect(legacyInputs).toEqual([]);
    expect(currentState.editor.getText()).toBe(initialEditorText);
    expect(scrollTranscriptViewport).not.toHaveBeenCalled();
    router.dispose();
  });
});
