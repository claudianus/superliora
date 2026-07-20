/**
 * `/search` — search project file contents (ripgrep when available,
 * built-in scanner otherwise) and open the grouped results dialog.
 * Enter on a match opens the file in the code viewer at that line.
 */

import { searchProject } from '#/utils/fs/project-search';
import type { SlashCommandHost } from './dispatch';

export function showSearch(host: SlashCommandHost, args?: string): void {
  const pattern = (args ?? '').trim();
  if (pattern.length === 0) {
    host.showError('Usage: /search <pattern>');
    return;
  }
  const results = searchProject(host.state.appState.workDir, pattern);
  host.showSearchResults(results);
}
