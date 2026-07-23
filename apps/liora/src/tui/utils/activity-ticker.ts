/**
 * Activity ticker — a single-line bar at the top of the workspace showing the
 * agent's current action in real-time. Bloomberg Terminal ticker-tape style.
 * Theme-aware (PREMIUM.md): colors flow through `currentTheme`; glyph/token
 * maps are resolved at render time so theme switches apply within a frame.
 */

import { currentTheme } from '#/tui/theme';
import {
  getActiveAppearancePreferences,
  renderPulseText,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

export interface ActivityEntry {
  readonly id: string | number;
  readonly kind: string;
  readonly label: string;
  readonly detail?: string;
  readonly error?: boolean;
  readonly timestamp: number;
}

type TickerToken = Parameters<typeof currentTheme.fg>[0];

/** Glyph + theme token per activity kind, resolved at render time. */
const KIND_TICKER_GLYPHS: Record<string, { glyph: string; token: TickerToken }> = {
  'tool-start': { glyph: '⚡', token: 'accent' },
  'tool-progress': { glyph: '…', token: 'accent' },
  'tool-result': { glyph: '✓', token: 'success' },
  'tool-error': { glyph: '✗', token: 'error' },
  thinking: { glyph: '◌', token: 'warning' },
  decision: { glyph: '◆', token: 'warning' },
  'file-read': { glyph: '📖', token: 'primary' },
  'file-write': { glyph: '✏', token: 'accent' },
  command: { glyph: '▶', token: 'accent' },
  'agent-spawn': { glyph: '⑂', token: 'accent' },
  'agent-done': { glyph: '⑁', token: 'success' },
  'agent-progress': { glyph: '⟳', token: 'particle' },
  info: { glyph: 'ℹ', token: 'textMuted' },
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
  const appearance = getActiveAppearancePreferences();
  const animate = shouldRenderAmbientEffects(appearance);

  // Activity indicator (pulsing dot when active)
  parts.push(agentActive
    ? (animate ? renderPulseText('●', 'ticker:active', 'success', appearance) : currentTheme.fg('success', '●'))
    : currentTheme.dimFg('textMuted', '○'));

  if (latestEntry) {
    const meta = KIND_TICKER_GLYPHS[latestEntry.kind];
    const icon = meta
      ? currentTheme.fg(meta.token, meta.glyph)
      : currentTheme.dimFg('textMuted', '·');
    const elapsed = formatElapsed(Date.now() - latestEntry.timestamp);
    const label = truncateText(latestEntry.label, Math.max(10, columns - 20));
    const styledLabel = animate && agentActive
      ? renderPulseText(label, `ticker:label:${latestEntry.id}`, meta?.token ?? 'text', appearance)
      : currentTheme.fg(meta?.token ?? 'text', label);
    parts.push(`${icon} ${styledLabel} ${currentTheme.dimFg('textMuted', elapsed)}`);
  } else {
    parts.push(currentTheme.dimFg('textMuted', ' 대기 중'));
  }

  const content = ` ${parts.join(' ')}`;

  // Pad to full width.
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
