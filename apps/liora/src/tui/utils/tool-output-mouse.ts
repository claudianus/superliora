import type { NativeInputMouseEvent } from '#/tui/renderer';
import type { TUIState } from '#/tui/tui-state';
import { ToolCallComponent } from '#/tui/components/messages/tool-call';
import { requestTUIContentRender } from '#/tui/utils/frame-render';
import { resolveTranscriptLayoutContext } from '#/tui/utils/transcript-hit-test';
import { toolOutputViewportMaxHeight } from '#/tui/utils/tool-output-viewport';

interface ToolOutputMouseHit {
  readonly component: ToolCallComponent;
  readonly onRail: boolean;
  readonly onGrip: boolean;
}

interface ActiveToolOutputResize {
  readonly component: ToolCallComponent;
  readonly startY: number;
  readonly startHeight: number;
  readonly maxHeight: number;
}

let activeResize: ActiveToolOutputResize | undefined;
let hoveredComponent: ToolCallComponent | undefined;

function setHovered(component: ToolCallComponent | undefined): boolean {
  if (component === hoveredComponent) return false;
  hoveredComponent?.setToolOutputHovered(false);
  hoveredComponent = component;
  hoveredComponent?.setToolOutputHovered(true);
  return true;
}

function clearActiveResize(): boolean {
  if (activeResize === undefined) return false;
  activeResize.component.setToolOutputDragging(false);
  activeResize = undefined;
  return true;
}

/** Reset module-level pointer state on release, focus loss, teardown, and between tests. */
export function resetToolOutputMouseState(): boolean {
  const dragChanged = clearActiveResize();
  const hoverChanged = setHovered(undefined);
  return dragChanged || hoverChanged;
}

export function handleToolOutputMouse(
  state: TUIState,
  event: NativeInputMouseEvent,
): boolean {
  if (event.action === 'release') {
    const changed = resetToolOutputMouseState();
    if (changed) requestTUIContentRender(state);
    return changed;
  }

  if (activeResize !== undefined) {
    if (event.action === 'drag' || event.action === 'move') {
      const requestedHeight = activeResize.startHeight + event.y - activeResize.startY;
      activeResize.component.resizeToolOutput(requestedHeight, activeResize.maxHeight);
      requestTUIContentRender(state);
      return true;
    }
    return true;
  }

  const hit = resolveToolOutputMouseHit(state, event);
  const hoverChanged = setHovered(hit?.onRail ? hit.component : undefined);
  const wheelDelta = event.button === 'wheel-up' ? -1 : event.button === 'wheel-down' ? 1 : 0;
  if (wheelDelta !== 0) {
    if (hit === undefined) {
      if (hoverChanged) requestTUIContentRender(state);
      return false;
    }
    hit.component.scrollToolOutput(wheelDelta);
    requestTUIContentRender(state);
    // A wheel over a tool viewport is always consumed, including top/bottom
    // no-ops, so it can never reach selection, editor, or interrupt handlers.
    return true;
  }

  if (event.action === 'press' && event.button === 'left' && hit?.onGrip === true) {
    const context = resolveTranscriptLayoutContext(state);
    activeResize = {
      component: hit.component,
      startY: event.y,
      startHeight: state.toolOutputViewports.get(hit.component.toolCallId)?.height ?? 3,
      maxHeight: toolOutputViewportMaxHeight(context?.visibleRows ?? state.terminal.rows),
    };
    hit.component.setToolOutputDragging(true);
    requestTUIContentRender(state);
    return true;
  }

  if (hoverChanged) requestTUIContentRender(state);
  return hit?.onRail ?? false;
}

function resolveToolOutputMouseHit(
  state: TUIState,
  event: NativeInputMouseEvent,
): ToolOutputMouseHit | undefined {
  const context = resolveTranscriptLayoutContext(state);
  if (context === undefined) return undefined;
  const { rect } = context;
  if (
    event.x < rect.x ||
    event.x >= rect.x + rect.width ||
    event.y < rect.y ||
    event.y >= rect.y + rect.height
  ) {
    return undefined;
  }

  const viewportRow = event.y - rect.y;
  if (viewportRow < 0 || viewportRow >= context.visibleRows) return undefined;
  const logicalRow = context.viewportStart + viewportRow;
  const range = state.transcriptContainer.childRowRangeAt(context.stageWidth, logicalRow);
  if (range === undefined || !(range.child instanceof ToolCallComponent)) return undefined;

  const localColumn = event.x - rect.x - context.leftPad;
  if (localColumn < 0 || localColumn >= range.renderWidth) return undefined;
  const outputHit = range.child.toolOutputHitAt(range.localRow, localColumn, range.renderWidth);
  if (outputHit === undefined) return undefined;
  return {
    component: range.child,
    onRail: outputHit.onRail,
    onGrip: outputHit.onGrip,
  };
}
