/**
 * Live progress lines for long-blocking tool calls (`onUpdate({kind:'status'})`).
 * URLs inside a line are wrapped in OSC 8 hyperlinks for Cmd-clickable terminals.
 */

import { Text, type Component } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';

const PROGRESS_URL_RE = /https?:\/\/\S+/g;

/** Render accumulated progress lines between call preview and result body. */
export function buildProgressBlockComponents(progressLines: readonly string[]): Component[] {
  if (progressLines.length === 0) return [];
  const items: Component[] = [];
  for (const raw of progressLines) {
    if (raw.length === 0) {
      items.push(new Text('', 2, 0));
      continue;
    }
    PROGRESS_URL_RE.lastIndex = 0;
    const styled = PROGRESS_URL_RE.test(raw)
      ? raw.replace(PROGRESS_URL_RE, (url) => {
        const visible = currentTheme.underlineFg('warning', url);
        return `\u001B]8;;${url}\u001B\\${visible}\u001B]8;;\u001B\\`;
      })
      : currentTheme.dim(raw);
    PROGRESS_URL_RE.lastIndex = 0;
    items.push(new Text(styled, 2, 0));
  }
  return items;
}
