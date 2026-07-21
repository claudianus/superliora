/**
 * Activity ticker — a single-line bar at the top of the workspace showing
 * the agent's current action in real-time. Bloomberg Terminal ticker-tape style.
 */

import type { ActivityEntry } from '../workspace/panels/activity-transparency-panel';

const KIND_TICKER_ICONS: Record<string, string> = {
  'tool-start': '\u001B[36m⚡\u001B[0m',
  'tool-progress': '\u001B[36m…\u001B[0m',
  'tool-result': '\u001B[32m✓\u001B[0m',
  'tool-error': '\u001B[31m✗\u001B[0m',
  thinking: '\u001B[33m◌\u001B[0m',
  decision: '\u001B[33m◆\u001B[0m',
  'file-read': '\u001B[34m📖\u001B[0m',
  'file-write': '\u001B[35m✏\u001B[0m',
  command: '\u001B[36m▶\u001B[0m',
  'agent-spawn': '\u001B[35m⑂\u001B[0m',
  'agent-done': '\u001B[32m⑁\u001B[0m',
  info: '\u001B[2mℹ\u001B[0m',
};

/**
 * Render the activity ticker as a single line.
 * Shows the most recent activity entry with an elapsed-time indicator.
 */
export function renderActivityTicker(
  latestEntry: ActivityEntry | undefined,
  agentActive: boolean,
  columns: number,
): string {
  const parts: string[] = [];

  // Activity indicator (pulsing dot when active)
  if (agentActive) {
    parts.push('\u001B[32m●\u001B[0m');
  } else {
    parts.push('\u001B[2m○\u001B[0m');
  }

  if (latestEntry) {
    const icon = KIND_TICKER_ICONS[latestEntry.kind] ?? '\u001B[2m·\u001B[0m';
    const elapsed = formatElapsed(Date.now() - latestEntry.timestamp);
    const label = truncateText(latestEntry.label, Math.max(10, columns - 20));
    parts.push(`${icon} ${label} \u001B[2m${elapsed}\u001B[0m`);
  } else {
    parts.push('\u001B[2m 대기 중\u001B[0m');
  }

  const content = ` ${parts.join(' ')}`;

  // Pad to full width with dim background
  const visibleLen = content.replace(/\u001B\[[0-9;]*m/g, '').length;
  const padding = Math.max(0, columns - visibleLen);

  return `${content}${' '.repeat(padding)}`;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return '방금';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}초 전`;
  const mins = Math.floor(secs / 60);
  return `${mins}분 전`;
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}
