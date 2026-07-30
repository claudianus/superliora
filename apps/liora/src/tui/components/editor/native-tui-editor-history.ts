export interface NativeTUIEditorHistoryHost {
  getText(): string;
  restoreHistoryText(text: string): void;
  onRecall?: (entry: string) => string | undefined;
  onHistoryDraftSave?: () => unknown;
  onHistoryDraftRestore?: (state: unknown) => void;
  getHistory(): readonly string[];
  getHistoryIndex(): number | undefined;
  setHistoryIndex(index: number | undefined): void;
  getHistoryFilter(): ((entry: string) => boolean) | null;
  getHistoryDraftText(): string | undefined;
  setHistoryDraftText(text: string | undefined): void;
  getHostHistoryDraft(): unknown;
  setHostHistoryDraft(state: unknown): void;
}

export function navigateNativeTUIEditorHistory(
  host: NativeTUIEditorHistoryHost,
  direction: -1 | 1,
): void {
  const history = host.getHistory();
  if (history.length === 0) return;
  const entering = host.getHistoryIndex() === undefined && host.getText().length === 0;
  if (entering) {
    host.setHistoryDraftText(host.getText());
    host.setHostHistoryDraft(host.onHistoryDraftSave?.());
  }

  let index = host.getHistoryIndex() ?? history.length;
  while (true) {
    index += direction;
    if (index >= history.length) {
      host.setHistoryIndex(undefined);
      host.restoreHistoryText(host.getHistoryDraftText() ?? '');
      if (host.getHostHistoryDraft() !== undefined) {
        host.onHistoryDraftRestore?.(host.getHostHistoryDraft());
        host.setHostHistoryDraft(undefined);
      }
      host.setHistoryDraftText(undefined);
      return;
    }
    if (index < 0) return;
    const entry = history[index];
    if (entry === undefined) return;
    const filter = host.getHistoryFilter();
    if (filter !== null && !filter(entry)) continue;
    host.setHistoryIndex(index);
    const recalled = host.onRecall?.(entry) ?? entry;
    host.restoreHistoryText(recalled);
    return;
  }
}
