import type { NativeInputMouseEvent } from '#/tui/renderer';
import type { TUIState } from '#/tui/tui-state';
import { ToolCallComponent } from '#/tui/components/messages/tool-call/index';
import { ToolChainSummaryComponent } from '#/tui/components/messages/tool-chain-summary';
import { requestTUIContentRender } from '#/tui/utils/render/frame-render';
import { resolveTranscriptLayoutContext } from '#/tui/features/transcript/transcript-hit-test';
import { isOneLineToolLevel } from '#/tui/features/transcript/transcript-density';
import { toggleChainToolsAfter } from '#/tui/features/transcript/toggle-chain-tools';

/**
 * Click-to-expand for one-line transcript densities (PREMIUM.md §7.9).
 *
 * - Tool card: toggle local expand/collapse (header-only levels).
 * - Chain summary bar (minimal): toggle every tool card in the same turn.
 *
 * Only press events are consumed — wheel, drag, and release fall through.
 */
export function handleTranscriptDensityMouse(
  state: TUIState,
  event: NativeInputMouseEvent,
): boolean {
  if (event.action !== 'press' || event.button !== 'left') return false;
  const context = resolveTranscriptLayoutContext(state);
  if (context === undefined) return false;
  const { rect } = context;
  if (
    event.x < rect.x ||
    event.x >= rect.x + rect.width ||
    event.y < rect.y ||
    event.y >= rect.y + rect.height
  ) {
    return false;
  }

  const viewportRow = event.y - rect.y;
  if (viewportRow < 0 || viewportRow >= context.visibleRows) return false;
  const logicalRow = context.viewportStart + viewportRow;
  const range = state.transcriptContainer.childRowRangeAt(context.stageWidth, logicalRow);
  if (range === undefined) return false;

  if (range.child instanceof ToolChainSummaryComponent) {
    const chainIndex = state.transcriptContainer.children.indexOf(range.child);
    const toggled = toggleChainToolsAfter(state.transcriptContainer.children, chainIndex);
    if (toggled === 0) return false;
    requestTUIContentRender(state);
    return true;
  }

  if (!(range.child instanceof ToolCallComponent)) return false;
  if (!isOneLineToolLevel(range.child.getDetail())) return false;

  // Collapsed: the whole one-liner is the toggle target. Locally expanded
  // (clicked open): only the header row (localRow 0 — no leading spacer) closes it.
  if (!range.child.isOneLineCollapsed && range.localRow !== 0) return false;

  range.child.toggleDetailOverride();
  requestTUIContentRender(state);
  return true;
}
