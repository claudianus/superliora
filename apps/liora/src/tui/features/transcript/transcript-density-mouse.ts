import type { NativeInputMouseEvent } from '#/tui/renderer';
import type { TUIState } from '#/tui/tui-state';
import { ToolCallComponent } from '#/tui/components/messages/tool-call/index';
import { requestTUIContentRender } from '#/tui/utils/render/frame-render';
import { resolveTranscriptLayoutContext } from '#/tui/features/transcript/transcript-hit-test';
import { isOneLineToolLevel } from '#/tui/features/transcript/transcript-density';

/**
 * Click-to-expand for one-line transcript densities (PREMIUM.md §7.9).
 *
 * A left press on a collapsed tool card toggles its local standard view;
 * a press on the header row of a locally opened card closes it again so
 * the body text of an opened card stays selectable. Only press events are
 * consumed — wheel, drag, and release fall through to the tool-output and
 * selection handlers untouched.
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
  if (range === undefined || !(range.child instanceof ToolCallComponent)) return false;
  if (!isOneLineToolLevel(range.child.getDetail())) return false;

  // Collapsed: the whole one-liner is the toggle target. Locally expanded
  // (clicked open): only the header row closes it — row 1 sits under the
  // component's 1-row spacer.
  if (!range.child.isOneLineCollapsed && range.localRow !== 1) return false;

  range.child.toggleDetailOverride();
  requestTUIContentRender(state);
  return true;
}
