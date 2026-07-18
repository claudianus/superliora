/**
 * Header bar — a single-line chrome region pinned above the transcript.
 *
 * Shows a compact brand mark on the left, the active model name, and a live
 * local clock on the right, separated by a particle divider that fills the
 * remaining width. The header is purely presentational: it reads `AppState`
 * and renders, it never touches the session or SDK. It degrades to an empty
 * render on tiny/compact layouts so it does not eat vertical space on small
 * terminals.
 */

import type { Component } from '#/tui/renderer';
import { truncateToWidth, visibleWidth } from '#/tui/renderer';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import { currentTheme } from '#/tui/theme';
import type { AppState } from '#/tui/types';
import {
  renderParticleDivider,
  renderSpectacularText,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

const BRAND_MARK = '◆ SuperLiora';
const CLOCK_INTERVAL_MS = 1_000;
const CLOCK_GAP = '  ';

export class HeaderComponent implements Component {
  private state: AppState;
  private readonly onRefresh: () => void;
  private readonly nowMs: () => number;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private lastClockLabel = '';

  constructor(
    state: AppState,
    onRefresh: () => void = () => {},
    nowMs: () => number = () => Date.now(),
  ) {
    this.state = state;
    this.onRefresh = onRefresh;
    this.nowMs = nowMs;
    this.lastClockLabel = formatLocalClock(this.nowMs());
    this.startClock();
  }

  setState(state: AppState): void {
    this.state = state;
  }

  invalidate(): void {}

  dispose(): void {
    if (this.clockTimer !== null) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, Math.floor(width));
    // The header only renders on standard+ widths; narrower terminals skip it
    // (the caller passes header height 0 in that case, so render() is not even
    // reached, but guard anyway).
    if (safeWidth < 60 || resolveResponsiveLayout({ width: safeWidth }) === 'tiny') return [];

    const appearance = this.state.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
    const brand = shouldRenderAmbientEffects(appearance)
      ? renderSpectacularText(BRAND_MARK, 'header:brand', appearance, {
          intense: true,
          pace: 'slow',
        })
      : currentTheme.boldFg('primary', BRAND_MARK);
    const activeModel = this.state.availableModels[this.state.model];
    const modelLabel = activeModel?.displayName ?? activeModel?.model ?? this.state.model ?? '';
    const clockLabel = formatLocalClock(this.nowMs());
    this.lastClockLabel = clockLabel;

    const modelText =
      modelLabel.length > 0
        ? shouldRenderAmbientEffects(appearance)
          ? renderSpectacularText(modelLabel, `header:model:${modelLabel}`, appearance, {
              intense: false,
              pace: 'slow',
            })
          : currentTheme.dimFg('textMuted', modelLabel)
        : '';
    // Keep the clock seed stable across seconds. Seeding with the label made the
    // hue base jump every tick, which read as random color flicker.
    const clockText = shouldRenderAmbientEffects(appearance)
      ? renderSpectacularText(clockLabel, 'header:clock', appearance, {
          intense: false,
          pace: 'slow',
        })
      : currentTheme.dimFg('textMuted', clockLabel);

    const brandWidth = visibleWidth(BRAND_MARK);
    const modelWidth = visibleWidth(modelLabel);
    const clockWidth = visibleWidth(clockLabel);
    const gapWidth = modelLabel.length > 0 ? visibleWidth(CLOCK_GAP) : 0;
    const rightWidth = modelWidth + gapWidth + clockWidth;
    const minDivider = 2;
    const available = safeWidth - brandWidth - rightWidth - minDivider;

    if (available < 0) {
      // Prefer keeping brand + clock when the model label will not fit.
      const clockOnlyAvailable = safeWidth - brandWidth - clockWidth - minDivider;
      if (clockOnlyAvailable >= 0) {
        const dividerWidth = clockOnlyAvailable + minDivider;
        const divider = shouldRenderAmbientEffects(appearance)
          ? renderParticleDivider(dividerWidth, 'header:divider', appearance)
          : currentTheme.fg('border', '─'.repeat(dividerWidth));
        return [`${brand}${divider}${clockText}`];
      }
      // Not enough room for brand + clock + divider: show brand only, truncated.
      return [truncateToWidth(brand, safeWidth, '…')];
    }

    const dividerWidth = available + minDivider;
    const divider = shouldRenderAmbientEffects(appearance)
      ? renderParticleDivider(dividerWidth, 'header:divider', appearance)
      : currentTheme.fg('border', '─'.repeat(dividerWidth));
    const right =
      modelLabel.length > 0 ? `${modelText}${CLOCK_GAP}${clockText}` : clockText;
    return [`${brand}${divider}${right}`];
  }

  private startClock(): void {
    if (this.clockTimer !== null) return;
    this.clockTimer = setInterval(() => {
      const next = formatLocalClock(this.nowMs());
      if (next === this.lastClockLabel) return;
      this.lastClockLabel = next;
      this.onRefresh();
    }, CLOCK_INTERVAL_MS);
    // Unref so the clock never keeps the process alive on its own (Node/Bun).
    const timer = this.clockTimer as { unref?: () => void };
    timer.unref?.();
  }
}

/**
 * Local wall-clock label for the header, e.g. `01:47:02 PM`.
 * Zero-padded 12-hour form keeps the right-side width stable across hours.
 * Exported for tests.
 */
export function formatLocalClock(nowMs: number = Date.now()): string {
  const date = new Date(nowMs);
  const hours24 = date.getHours();
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const hours = hours12.toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds} ${period}`;
}
