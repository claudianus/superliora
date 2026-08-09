/**
 * `/search` — search project file contents (ripgrep when available,
 * built-in scanner otherwise) and open the grouped results dialog.
 * Enter on a match opens the file in the code viewer at that line.
 */

import { searchProject } from '#/utils/fs/project-search';
import { ttui } from '#/tui/utils/tui-i18n';
import type { SlashCommandHost } from './hub/dispatch';

export function showSearch(host: SlashCommandHost, args?: string): void {
  const pattern = (args ?? '').trim();
  if (pattern.length === 0) {
    host.showError(ttui('tui.search.usage'));
    return;
  }
  if (host.isSessionLoadingOverlayActive()) {
    host.showError(ttui('tui.sessionLoading.busy'));
    return;
  }
  void host.runWithBusyOverlay(
    {
      title: ttui('tui.sessionLoading.searching'),
      detail: ttui('tui.sessionLoading.searching'),
      phase: 'working',
    },
    async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const results = searchProject(host.state.appState.workDir, pattern);
      host.showSearchResults(results);
    },
  );
}
