/**
 * Header bar — a single-line chrome region pinned above the transcript.
 *
 * Shows a compact brand mark on the left and the active model name on the right,
 * separated by a divider that fills the remaining width. The header is purely
 * presentational: it reads `AppState` and renders, it never touches the session
 * or SDK. It degrades to an empty render on tiny/compact layouts so it does not
 * eat vertical space on small terminals.
 */

import type { Component } from '#/tui/renderer';
import { truncateToWidth, visibleWidth } from '#/tui/renderer';

import { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import { currentTheme } from '#/tui/theme';
import type { AppState } from '#/tui/types';

const BRAND_MARK = '◆ SuperLiora';

export class HeaderComponent implements Component {
  private state: AppState;

  constructor(state: AppState) {
    this.state = state;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, Math.floor(width));
    // The header only renders on standard+ widths; narrower terminals skip it
    // (the caller passes header height 0 in that case, so render() is not even
    // reached, but guard anyway).
    if (safeWidth < 60 || resolveResponsiveLayout({ width: safeWidth }) === 'tiny') return [];

    const brand = currentTheme.boldFg('primary', BRAND_MARK);
    const activeModel = this.state.availableModels[this.state.model];
    const modelLabel = activeModel?.displayName ?? activeModel?.model ?? this.state.model ?? '';
    const modelText = modelLabel.length > 0 ? currentTheme.dimFg('textMuted', modelLabel) : '';

    const brandWidth = visibleWidth(BRAND_MARK);
    const modelWidth = visibleWidth(modelLabel);
    const minDivider = 2;
    const available = safeWidth - brandWidth - modelWidth - minDivider;

    if (available < 0) {
      // Not enough room for brand + model + divider: show brand only, truncated.
      return [truncateToWidth(brand, safeWidth, '…')];
    }

    const divider = currentTheme.fg('border', '─'.repeat(available + minDivider));
    return [`${brand}${divider}${modelText}`];
  }
}
