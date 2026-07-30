/**
 * UsagePanelComponent — wraps pre-coloured `/usage` lines in a blue box
 * border with a left indent, mirroring the PlanBoxComponent layout so
 * the pattern stays consistent across command-triggered panels.
 */

import type { Component } from '#/tui/renderer';
import { truncateToWidth } from '#/tui/renderer';
import type { ColorToken } from '#/tui/theme';
import {
  appearanceAnimationNow,
  enterBeatDurationMs,
  getActiveAppearancePreferences,
  renderEnterBeat,
  renderPulseText,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import { renderRoundedPanel } from '#/tui/utils/panel-frame';

import { buildContextCompositionLines } from './context';
import { buildManagedUsageReportLines } from './managed';
import { buildUsageReportLines } from './report';
import type {
  ManagedAccountUsageReport,
  ManagedUsageReport,
  ManagedUsageReportLineOptions,
  ManagedUsageRow,
  UsagePanelComponentOptions,
  UsagePanelPhase,
  UsageReportOptions,
} from './types';

export type {
  ManagedAccountUsageReport,
  ManagedUsageReport,
  ManagedUsageReportLineOptions,
  ManagedUsageRow,
  UsagePanelComponentOptions,
  UsagePanelPhase,
  UsageReportOptions,
};

export { buildContextCompositionLines, buildManagedUsageReportLines, buildUsageReportLines };

const LEFT_MARGIN = 2;
const SIDE_PADDING = 1;
const BOX_OVERHEAD = LEFT_MARGIN + 2 + 2 * SIDE_PADDING;
/** Fill animation for plan bars after data arrives (clock-driven; no setInterval). */
const USAGE_FILL_MS = 400;
const USAGE_FRAME_INTERVAL_MS = 80;

/**
 * Bordered `/usage` panel. Supports optional loading → filled animation for
 * Plan usage bars via the shared appearance animation clock (no private timers).
 */
export class UsagePanelComponent implements Component {
  /** Cached coloured lines; rebuilt from `buildLines` on every invalidate. */
  private lines: readonly string[];
  private phase: UsagePanelPhase;
  private fillStartedAtMs: number | undefined;
  private lastFrameTickMs = 0;
  private readonly buildLines: (fillProgress: number) => readonly string[];
  private readonly borderToken: ColorToken;
  private readonly title: string;
  private readonly requestRender: (() => void) | undefined;
  private readonly enterBeatSeed: string;
  private readonly openedAtMs: number;

  constructor(
    buildLines: (() => readonly string[]) | UsagePanelComponentOptions,
    borderToken: ColorToken = 'primary',
    title: string = ' Usage ',
  ) {
    if (typeof buildLines === 'function') {
      this.buildLines = (_fillProgress: number) => buildLines();
      this.borderToken = borderToken;
      this.title = title;
      this.requestRender = undefined;
      this.phase = 'ready';
      this.fillStartedAtMs = undefined;
      this.enterBeatSeed = title.trim().toLowerCase() || 'panel';
      this.openedAtMs = appearanceAnimationNow();
    } else {
      this.buildLines = buildLines.buildLines;
      this.borderToken = buildLines.borderToken ?? 'primary';
      this.title = buildLines.title ?? ' Usage ';
      this.requestRender = buildLines.requestRender;
      this.phase = buildLines.phase ?? 'ready';
      this.fillStartedAtMs = buildLines.fillStartedAtMs;
      this.enterBeatSeed =
        buildLines.enterBeatSeed ?? (this.title.trim().toLowerCase() || 'panel');
      this.openedAtMs = buildLines.openedAtMs ?? appearanceAnimationNow();
    }
    this.lines = this.buildLines(this.resolveFillProgress());
  }

  setPhase(phase: UsagePanelPhase, options: { readonly fillStartedAtMs?: number } = {}): void {
    this.phase = phase;
    if (options.fillStartedAtMs !== undefined) {
      this.fillStartedAtMs = options.fillStartedAtMs;
    } else if (phase === 'ready' && this.fillStartedAtMs === undefined) {
      this.fillStartedAtMs = appearanceAnimationNow();
    } else if (phase === 'loading') {
      this.fillStartedAtMs = undefined;
    }
    this.lastFrameTickMs = 0;
    this.lines = this.buildLines(this.resolveFillProgress());
  }

  invalidate(): void {
    // Report bodies embed palette colours, so a theme switch must re-run the
    // builder to repaint the cached lines (the data itself is captured).
    this.lines = this.buildLines(this.resolveFillProgress());
  }

  render(width: number): string[] {
    this.tickClockDrivenAnimation();
    // Rebuild when ambient fill progress advances between frames.
    this.lines = this.buildLines(this.resolveFillProgress());

    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    const appearance = getActiveAppearancePreferences();
    const availableInterior = safeWidth - BOX_OVERHEAD;
    const titleText =
      this.phase === 'loading' && shouldRenderAmbientEffects(appearance)
        ? renderPulseText(this.title, 'usage-panel:title', this.borderToken)
        : this.title;
    if (availableInterior < 1) {
      // Too narrow for a box: flat title + lines without the left indent.
      return [
        truncateToWidth(this.title.trim(), safeWidth, '…'),
        ...this.lines.map((line) => truncateToWidth(line, safeWidth, '…')),
      ];
    }

    const body = renderRoundedPanel({
      title: titleText,
      content: this.lines,
      width: safeWidth,
      borderToken: this.borderToken,
      leftMargin: LEFT_MARGIN,
      sidePadding: SIDE_PADDING,
      // The flat fallback above owns the too-narrow case; disable the shared
      // default so narrow widths keep drawing a box exactly as before.
      minBoxWidth: 0,
    });
    if (!this.isEnterBeatActive(appearance)) return body;
    const beat = renderEnterBeat(
      this.title.trim() || 'Panel',
      safeWidth,
      this.enterBeatSeed,
      this.openedAtMs,
      appearance,
    ).map((line) => truncateToWidth(line, safeWidth, '…'));
    return [...beat, ...body];
  }

  private resolveFillProgress(): number {
    const appearance = getActiveAppearancePreferences();
    if (!shouldRenderAmbientEffects(appearance)) return 1;
    if (this.phase === 'loading') {
      const t = appearanceAnimationNow() / 500;
      return 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2));
    }
    if (this.fillStartedAtMs === undefined) return 1;
    const elapsed = appearanceAnimationNow() - this.fillStartedAtMs;
    if (elapsed >= USAGE_FILL_MS) return 1;
    return Math.max(0, Math.min(1, elapsed / USAGE_FILL_MS));
  }

  private isEnterBeatActive(
    appearance = getActiveAppearancePreferences(),
  ): boolean {
    if (!shouldRenderAmbientEffects(appearance)) return false;
    return appearanceAnimationNow() - this.openedAtMs < enterBeatDurationMs(appearance);
  }

  private needsAnimationFrame(): boolean {
    if (this.requestRender === undefined) return false;
    const appearance = getActiveAppearancePreferences();
    if (!shouldRenderAmbientEffects(appearance)) return false;
    if (this.isEnterBeatActive(appearance)) return true;
    if (this.phase === 'loading') return true;
    if (this.fillStartedAtMs === undefined) return false;
    return appearanceAnimationNow() - this.fillStartedAtMs < USAGE_FILL_MS;
  }

  private tickClockDrivenAnimation(): void {
    if (!this.needsAnimationFrame() || this.requestRender === undefined) return;
    const now = appearanceAnimationNow();
    if (this.lastFrameTickMs !== 0 && now - this.lastFrameTickMs < USAGE_FRAME_INTERVAL_MS) return;
    this.lastFrameTickMs = now;
    this.requestRender();
  }
}
