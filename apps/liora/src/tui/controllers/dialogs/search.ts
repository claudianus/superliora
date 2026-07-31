import { getInputHistoryFile } from '#/utils/paths';
import { loadInputHistory } from '#/utils/history/input-history';

import { HistorySearchDialogComponent } from '../../components/dialogs/search/history-search-dialog';
import { TranscriptSearchDialogComponent } from '../../components/dialogs/search/transcript-search';
import { requestTUIContentRender } from '../../utils/render/frame-render';
import { resolveTranscriptEntryLineOffset } from '../../features/transcript/transcript-entry-layout';
import { resolveTranscriptHitTestContext } from '../../features/transcript/transcript-hit-test';
import { jumpTranscriptViewportToLine } from '../../features/transcript/transcript-viewport';
import type { ModalShellDelegate } from './modal-shell';
import { mountEditorReplacement, restoreEditor } from './modal-shell';
import type { DialogsHost } from './types';

export function showHistorySearch(host: DialogsHost, shell: ModalShellDelegate): void {
  if (host.state.activeDialog !== null && host.state.activeDialog !== 'center-modal') return;
  void openHistorySearch(host, shell);
}

export async function openHistorySearch(host: DialogsHost, shell: ModalShellDelegate): Promise<void> {
  let entries: { content: string }[] = [];
  try {
    entries = await loadInputHistory(getInputHistoryFile(host.state.appState.workDir));
  } catch {
    entries = [];
  }
  // Most-recent-first ordering for search UX.
  const items = [...new Set(entries.map((e) => e.content))].toReversed();
  const dialog = new HistorySearchDialogComponent({
    items,
    onSelect: (text) => {
      restoreEditor(host);
      host.state.editor.setText(text);
      host.updateEditorBorderHighlight(text);
      requestTUIContentRender(host.state);
    },
    onCancel: () => {
      restoreEditor(host);
    },
  });
  mountEditorReplacement(host, shell, dialog);
}

export function showTranscriptSearch(host: DialogsHost, shell: ModalShellDelegate): void {
  if (host.state.activeDialog !== null) return;
  const entries = host.state.transcriptEntries
    .map((entry, index) => {
      // Strip ANSI/control noise from searchable text.
      const text = entry.content.replaceAll(/\u001B\[[0-9;]*m/g, '').trim();
      return { index, text };
    })
    .filter((entry) => entry.text.length > 0);
  const dialog = new TranscriptSearchDialogComponent({
    entries,
    onSelect: (index) => {
      // Keep the dialog open so the user can jump to more matches; just
      // scroll the matching entry into view.
      scrollToTranscriptIndex(host, index);
    },
    onCancel: () => {
      restoreEditor(host);
    },
  });
  mountEditorReplacement(host, shell, dialog);
}

/** Also used by the Error Navigator (`showErrors`, kept on `LioraTUI`). */
export function scrollToTranscriptIndex(host: DialogsHost, index: number): void {
  const entry = host.state.transcriptEntries[index];
  if (entry === undefined) return;
  // Exact jump: resolve the entry's first line in the current transcript
  // layout and move the viewport start there. Resolving the hit-test
  // context also warms the cached transcript layout.
  const context = resolveTranscriptHitTestContext(host.state);
  if (context !== undefined) {
    const line = resolveTranscriptEntryLineOffset(host.state, entry.id, context.stageWidth);
    if (line !== undefined) {
      jumpTranscriptViewportToLine(host.state.transcriptViewport, line);
      requestTUIContentRender(host.state);
      return;
    }
  }
  // Roughly map a transcript entry index to a scroll position. The viewport
  // is line-based; we approximate by scrolling to the entry proportionally.
  const total = host.state.transcriptEntries.length;
  if (total === 0) return;
  // Jump to bottom first, then up by the offset of entries after the target.
  host.state.transcriptViewport.scroll('bottom');
  const entriesAfter = total - 1 - index;
  // Each entry is at least one rendered line; scroll up by a few lines per
  // entry as a heuristic. The viewport clamps automatically.
  for (let i = 0; i < entriesAfter * 3; i++) {
    host.state.transcriptViewport.scroll('line-up');
  }
  requestTUIContentRender(host.state);
}
