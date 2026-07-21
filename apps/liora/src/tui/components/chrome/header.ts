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

    const densityText = this.buildDensityText(safeWidth);
    const brandWidth = visibleWidth(BRAND_MARK);
    const clockWidth = visibleWidth(clockLabel);
    const gap = visibleWidth(CLOCK_GAP);

    // Build the right cluster (model · density · clock). The density segment is
    // dropped first when the terminal is too narrow to keep brand + clock.
    const rightSegments: { text: string; width: number }[] = [];
    if (modelLabel.length > 0) {
      rightSegments.push({ text: modelText, width: visibleWidth(modelLabel) });
    }
    if (densityText) {
      rightSegments.push({ text: densityText, width: visibleWidth(densityText) });
    }
    rightSegments.push({ text: clockText, width: clockWidth });

    const minDivider = 2;
    const clusterWidth = (segs: { width: number }[]): number =>
      segs.reduce((sum, s) => sum + s.width, 0) + gap * (segs.length - 1);
    let segments = rightSegments;
    let available = safeWidth - brandWidth - clusterWidth(segments) - minDivider;

    // Overflow: drop the density segment (middle) before dropping the model.
    const modelSeg = segments[0];
    const clockSeg = segments[2];
    if (available < 0 && densityText && segments.length === 3 && modelSeg && clockSeg) {
      segments = [modelSeg, clockSeg];
      available = safeWidth - brandWidth - clusterWidth(segments) - minDivider;
    }

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
    const right = segments.map((s) => s.text).join(CLOCK_GAP);
    return [`${brand}${divider}${right}`];
  }

  /**
   * Live density segment for the header: context usage and session cost, e.g.
   * `CTX 84.0k/200.0k · COST $0.42`. Theme-aware. Returns null when there is
   * nothing to show or the terminal is too narrow to spare the room.
   */
  private buildDensityText(safeWidth: number): string | null {
    if (safeWidth < 100) return null;
    const usage = this.state.contextUsage;
    const tokens = this.state.contextTokens;
    const max = this.state.maxContextTokens;
    const cost = this.state.sessionCostUsd;
    const hasContext = typeof usage === 'number' && usage > 0;
    const hasCost = typeof cost === 'number' && cost > 0;
    if (!hasContext && !hasCost) return null;

    const parts: string[] = [];
    if (hasContext) {
      const pct = Math.round((usage as number) * 100);
      const token = pct > 80 ? 'error' : pct > 50 ? 'warning' : 'success';
      const detail =
        typeof tokens === 'number' && typeof max === 'number'
          ? `${formatHeaderTokens(tokens)}/${formatHeaderTokens(max)}`
          : `${pct}%`;
      parts.push(`${currentTheme.dimFg('textMuted', 'CTX')} ${currentTheme.fg(token, detail)}`);
    }
    if (hasCost) {
      parts.push(
        `${currentTheme.dimFg('textMuted', 'COST')} ${currentTheme.fg('textDim', formatHeaderCost(cost as number))}`,
      );
    }
    return parts.join(currentTheme.dimFg('textMuted', ' · '));
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

/** Compact token count for the header density segment (e.g. 12.3k, 1.2M). */
function formatHeaderTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Compact USD cost for the header density segment (e.g. $0.0042, $1.23). */
function formatHeaderCost(usd: number): string {
  if (usd <= 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
