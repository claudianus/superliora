import type { TUIState } from '../tui-state';
import { getTranscriptComponentEntry } from './transcript-component-metadata';

/**
 * Resolve the absolute line offset at which the component bound to `entryId`
 * starts within the transcript layout. Children that are not entry-bound
 * (streaming live text, idle stage) still occupy lines and count toward the
 * offset. Returns undefined when no mounted child matches the entry.
 */
export function resolveTranscriptEntryLineOffset(
  state: TUIState,
  entryId: string,
  stageWidth: number,
): number | undefined {
  const width = Math.max(1, stageWidth);
  let offset = 0;
  for (const child of state.transcriptContainer.children) {
    if (getTranscriptComponentEntry(child)?.id === entryId) return offset;
    offset += child.render(width).length;
  }
  return undefined;
}
