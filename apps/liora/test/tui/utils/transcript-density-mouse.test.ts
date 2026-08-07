import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolCallComponent } from '#/tui/components/messages/tool-call/index';
import { ToolChainSummaryComponent } from '#/tui/components/messages/tool-chain-summary';
import type { NativeInputMouseEvent } from '#/tui/renderer';
import { createTUIState, type TUIState } from '#/tui/tui-state';
import type { AppState } from '#/tui/types';
import { handleTranscriptDensityMouse } from '#/tui/features/transcript/transcript-density-mouse';
import { hitTestChromeSignature } from '#/tui/features/transcript/transcript-hit-test';

const FRAME_WIDTH = 80;
const FRAME_HEIGHT = 40;
const STAGE_WIDTH = 48;
const VISIBLE_ROWS = 30;
const RECT_X = 4;
const RECT_Y = 3;

function fakeInitialAppState(): AppState {
  return {
    model: 'test-model',
    workDir: '/tmp/liora-test',
    additionalDirs: [],
    sessionId: 'sess-transcript-density',
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

let currentState: TUIState;

function tool(id: string, detail: 'compact' | 'standard' = 'compact'): ToolCallComponent {
  const component = new ToolCallComponent(
    { id, name: 'Bash', args: { command: `echo ${id}` } },
    {
      tool_call_id: id,
      output: `${id}-output-line-1\n${id}-output-line-2`,
      is_error: false,
    },
    undefined,
    undefined,
    currentState.toolOutputViewports,
  );
  component.setDetail(detail);
  return component;
}

function mountTools(...components: ToolCallComponent[]): void {
  for (const component of components) currentState.transcriptContainer.addChild(component);
  const totalRows = currentState.transcriptContainer.render(STAGE_WIDTH).length;
  currentState.transcriptViewport.sync(totalRows, VISIBLE_ROWS);
  const editorLineCount = currentState.editor.getNativeLayoutRowCount?.(FRAME_WIDTH) ?? -1;
  currentState.cachedTranscriptRect = {
    x: RECT_X,
    y: RECT_Y,
    width: STAGE_WIDTH,
    height: VISIBLE_ROWS,
  };
  currentState.cachedTranscriptVisibleRows = VISIBLE_ROWS;
  currentState.cachedTranscriptStageWidth = STAGE_WIDTH;
  currentState.cachedTranscriptColumns = FRAME_WIDTH;
  currentState.cachedTranscriptRows = FRAME_HEIGHT;
  currentState.cachedTranscriptLineCount = editorLineCount;
  // Without the chrome signature the hit-test falls back to a real stage plan
  // and ignores the rect pinned above.
  currentState.cachedHitTestChromeSig = hitTestChromeSignature(currentState);
}

function mouse(
  action: NativeInputMouseEvent['action'],
  x: number,
  y: number,
  button: NativeInputMouseEvent['button'] = 'left',
): NativeInputMouseEvent {
  return { type: 'mouse', raw: '', button, action, x, y, ctrl: false, alt: false, shift: false };
}

/** Row 1 of the first mounted component = its header (row 0 is the spacer). */
function headerClick(): NativeInputMouseEvent {
  return mouse('press', RECT_X + 2, RECT_Y + 1);
}

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('handleTranscriptDensityMouse', () => {
  beforeEach(() => {
    currentState = createState();
  });

  it('expands a collapsed compact card on click', () => {
    const component = tool('call_click_open');
    mountTools(component);
    expect(component.isOneLineCollapsed).toBe(true);

    const handled = handleTranscriptDensityMouse(currentState, headerClick());
    expect(handled).toBe(true);
    expect(component.isOneLineCollapsed).toBe(false);
    expect(strip(currentState.transcriptContainer.render(STAGE_WIDTH).join('\n'))).toContain(
      'call_click_open-output-line-1',
    );
  });

  it('clicking the header of a locally opened card closes it again', () => {
    const component = tool('call_click_close');
    mountTools(component);
    handleTranscriptDensityMouse(currentState, headerClick());
    expect(component.isOneLineCollapsed).toBe(false);

    const handled = handleTranscriptDensityMouse(currentState, headerClick());
    expect(handled).toBe(true);
    expect(component.isOneLineCollapsed).toBe(true);
  });

  it('body clicks on a locally opened card fall through to selection', () => {
    const component = tool('call_body_fallthrough');
    mountTools(component);
    handleTranscriptDensityMouse(currentState, headerClick());
    expect(component.isOneLineCollapsed).toBe(false);

    // Row 3 lands inside the rendered body, not the header row.
    const bodyClick = mouse('press', RECT_X + 4, RECT_Y + 3);
    expect(handleTranscriptDensityMouse(currentState, bodyClick)).toBe(false);
    expect(component.isOneLineCollapsed).toBe(false);
  });

  it('standard-density cards are untouched', () => {
    const component = tool('call_standard', 'standard');
    mountTools(component);

    expect(handleTranscriptDensityMouse(currentState, headerClick())).toBe(false);
    expect(component.isOneLineCollapsed).toBe(false);
    expect(component.getDetail()).toBe('standard');
  });

  it('only left press events are consumed', () => {
    const component = tool('call_not_press');
    mountTools(component);

    expect(handleTranscriptDensityMouse(currentState, mouse('move', RECT_X + 2, RECT_Y + 1))).toBe(
      false,
    );
    expect(
      handleTranscriptDensityMouse(currentState, mouse('press', RECT_X + 2, RECT_Y + 1, 'right')),
    ).toBe(false);
    expect(component.isOneLineCollapsed).toBe(true);
  });

  it('clicks outside the transcript rect are ignored', () => {
    const component = tool('call_outside');
    mountTools(component);
    expect(handleTranscriptDensityMouse(currentState, mouse('press', 0, 0))).toBe(false);
    expect(component.isOneLineCollapsed).toBe(true);
  });

  it('clicking the chain phase bar expands every tool in the turn', () => {
    const chain = new ToolChainSummaryComponent();
    const t1 = tool('chain_a', 'compact');
    const t2 = tool('chain_b', 'compact');
    currentState.transcriptContainer.addChild(chain);
    mountTools(t1, t2);
    expect(t1.isOneLineCollapsed).toBe(true);
    expect(t2.isOneLineCollapsed).toBe(true);

    // Resolve a viewport row that lands on the chain summary (layout-aware).
    let chainLocalRow = -1;
    for (let row = 0; row < 20; row++) {
      const range = currentState.transcriptContainer.childRowRangeAt(STAGE_WIDTH, row);
      if (range?.child === chain) {
        chainLocalRow = row;
        break;
      }
    }
    expect(chainLocalRow).toBeGreaterThanOrEqual(0);
    const chainClick = mouse('press', RECT_X + 2, RECT_Y + chainLocalRow);
    expect(handleTranscriptDensityMouse(currentState, chainClick)).toBe(true);
    expect(t1.isOneLineCollapsed).toBe(false);
    expect(t2.isOneLineCollapsed).toBe(false);

    // Second click collapses the unit again.
    expect(handleTranscriptDensityMouse(currentState, chainClick)).toBe(true);
    expect(t1.isOneLineCollapsed).toBe(true);
    expect(t2.isOneLineCollapsed).toBe(true);
  });
});
