import {
  rendererAmbientIntervalMs,
  type NativeFrameStatsHealth,
  type RendererAmbientScheduleOptions,
  type RendererQualityLevel,
  type RendererTerminalHost,
  type RendererTransportStability,
  UNSTABLE_TRANSPORT_FRAME_INTERVAL_MS,
} from '#/tui/renderer';

import type { AppearancePreferences } from '#/tui/config';
import { ESC, ST } from '#/tui/constant/terminal';
import { currentTheme } from '#/tui/theme';
import type { ColorPalette } from '#/tui/theme/colors';
import { setActiveSyntaxThemeId } from '#/tui/theme/syntax-theme';
import { clearHighlightCache } from '#/tui/components/media/code-highlight';
import { refreshShikiSyntaxTheme } from '#/tui/components/media/shiki-ansi';
import { clearTranscriptFormatCache } from '#/tui/utils/transcript/transcript-output-format';
import {
  motionEffectsAllowed,
  premiumAmbientIntervalMs,
  resolveAmbientEffectMode,
  setActiveAppearancePreferences,
} from '#/tui/features/appearance/appearance-effects';
import { capAmbientIntervalForCalmTransport } from '#/tui/features/appearance/ambient-calm';

export interface AppearanceControllerOptions {
  readonly terminal: RendererTerminalHost;
  readonly requestRender: () => void;
  readonly setAmbientSchedule: (
    options: RendererAmbientScheduleOptions | undefined,
  ) => void;
  readonly getAmbientScheduleContext?: () => {
    readonly quality: RendererQualityLevel;
    readonly health: NativeFrameStatsHealth;
    readonly backpressure: boolean;
  };
  readonly onAppearanceApplied?: () => void;
  readonly getAppearance: () => AppearancePreferences;
  readonly shouldRenderAnimation?: () => boolean;
  /** When true, force schedule enabled (splash) even if shouldRenderAnimation is false. */
  readonly forceAmbientSchedule?: () => boolean;
  /** Transport stability from the renderer; unstable + idle caps tick cadence. */
  readonly getTransportStability?: () => RendererTransportStability | undefined;
  /** True when no activity needs full-rate motion (see ambient-calm). */
  readonly isAmbientIdle?: () => boolean;
}

export class AppearanceController {
  private readonly terminal: RendererTerminalHost;
  private readonly getAppearance: () => AppearancePreferences;
  private readonly setAmbientSchedule: (
    options: RendererAmbientScheduleOptions | undefined,
  ) => void;
  private readonly shouldRenderAnimation: (() => boolean) | undefined;
  private readonly forceAmbientSchedule: (() => boolean) | undefined;
  private readonly getTransportStability:
    | (() => RendererTransportStability | undefined)
    | undefined;
  private readonly isAmbientIdle: (() => boolean) | undefined;
  private readonly onAppearanceApplied: (() => void) | undefined;
  private terminalMutated = false;
  private lastPalettePayload: string | undefined;

  constructor(options: AppearanceControllerOptions) {
    this.terminal = options.terminal;
    this.getAppearance = options.getAppearance;
    this.setAmbientSchedule = options.setAmbientSchedule;
    this.shouldRenderAnimation = options.shouldRenderAnimation;
    this.forceAmbientSchedule = options.forceAmbientSchedule;
    this.getTransportStability = options.getTransportStability;
    this.isAmbientIdle = options.isAmbientIdle;
    this.onAppearanceApplied = options.onAppearanceApplied;
    this.apply(options.getAppearance());
  }

  apply(appearance: AppearancePreferences = this.getAppearance()): void {
    setActiveAppearancePreferences(appearance);
    currentTheme.setCanvasBackgroundEnabled(appearance.canvasBackground);
    // Coding syntax theme is independent of UI chrome; rebind Shiki + bust caches.
    const syntaxId = appearance.syntaxTheme ?? 'auto';
    setActiveSyntaxThemeId(syntaxId);
    refreshShikiSyntaxTheme(syntaxId);
    clearHighlightCache();
    clearTranscriptFormatCache();
    this.syncAmbientSchedule();
    // Theme/appearance switch: the payload changed (or the terminal state is
    // stale either way) — bypass the dedupe cache.
    this.reapplyTerminalPalette({ appearance, force: true });
    this.onAppearanceApplied?.();
  }

  /**
   * Re-emit OSC palette / background colors after an authoritative native redraw.
   * Does not touch appearance preferences, animation scheduling, or palette
   * invalidation callbacks — callers already sit inside a forced frame.
   *
   * Identical payloads are skipped unless `force` is set: authoritative frames
   * fire on every splash/ambient `manual` tick, and re-blasting OSC 11 each
   * tick makes ConPTY repaint the whole screen — the startup flicker. `force`
   * is for terminal-resync moments where the terminal may have dropped OSC
   * state (splash disposal, resize).
   */
  reapplyTerminalPalette(
    options: { readonly appearance?: AppearancePreferences; readonly force?: boolean } = {},
  ): void {
    this.applyTerminalColors(options.appearance ?? this.getAppearance(), currentTheme.palette, {
      force: options.force === true,
    });
  }

  dispose(): void {
    this.setAmbientSchedule(undefined);
    this.resetTerminalColors();
  }

  /** Re-evaluate the shared ticker without rebinding the terminal palette. */
  refreshAmbientSchedule(): void {
    this.syncAmbientSchedule();
  }

  private syncAmbientSchedule(): void {
    const appearance = this.getAppearance();
    const forceAmbient = this.forceAmbientSchedule?.() === true;
    // When the agent is busy we always keep a low-rate ambient tick so live
    // thinking/waiting elapsed clocks and stall labels keep advancing even if
    // the user turned decorative animation off.
    if (!shouldAnimate(appearance) && !forceAmbient) {
      this.setAmbientSchedule(undefined);
      return;
    }
    this.setAmbientSchedule({
      enabled: true,
      shouldTick: () =>
        this.forceAmbientSchedule?.() === true || this.shouldRenderAnimation?.() !== false,
      resolveIntervalMs: (ctx) => {
        const appearance = this.getAppearance();
        const premiumMs = premiumAmbientIntervalMs(appearance.animationFps);
        // Splash forces the ambient schedule — keep premium cadence so the
        // cinematic does not soft-degrade to 24–100ms stutter. On an
        // unstable transport (classic ConPTY) that cadence is the startup
        // flicker; stay at the transport floor instead.
        if (this.forceAmbientSchedule?.() === true && shouldAnimate(appearance)) {
          const stability = ctx.transportStability ?? this.getTransportStability?.();
          return stability === 'unstable'
            ? Math.max(premiumMs, UNSTABLE_TRANSPORT_FRAME_INTERVAL_MS)
            : premiumMs;
        }
        // Busy-only force (streaming without decorative animation): keep the
        // moon/braille spinner cadence so waiting glyphs do not freeze at 1fps
        // while decorative particles stay off.
        if (this.forceAmbientSchedule?.() === true && !shouldAnimate(appearance)) {
          // Match MOON_SPINNER_INTERVAL_MS without importing chrome constants here.
          return 120;
        }
        const baseIntervalMs = rendererAmbientIntervalMs({
          requested: resolveAmbientEffectMode(appearance),
          quality: ctx.quality === 'minimal' ? 'balanced' : ctx.quality,
          // Pass real health: soft-degrade keys off degraded/minimal/backpressure.
          health: ctx.health,
          backpressure: ctx.backpressure,
          premiumMs,
          subtleMs: 100,
        });
        // Unstable + idle: cap to the write-atomicity floor (~12fps) so chrome
        // still moves without a 60fps ConPTY strobe.
        return capAmbientIntervalForCalmTransport(
          baseIntervalMs,
          ctx.transportStability ?? this.getTransportStability?.(),
          this.isAmbientIdle?.() === true,
        );
      },
    });
  }

  private applyTerminalColors(
    appearance: AppearancePreferences,
    colors: ColorPalette,
    options: { readonly force?: boolean } = {},
  ): void {
    const allowed = terminalMutationAllowed(appearance);
    if (!allowed) {
      this.resetTerminalColors();
      return;
    }

    const chunks: string[] = [];
    if (appearance.terminalBackground === 'session') {
      chunks.push(oscSetDynamicColor(11, colors.background));
    }
    if (appearance.terminalPalette) {
      chunks.push(
        oscSetDynamicColor(10, colors.text),
        oscSetDynamicColor(11, colors.background),
        oscSetDynamicColor(12, colors.cursor),
      );
      for (const [index, color] of ansiPalette(colors).entries()) {
        chunks.push(oscSetPaletteColor(index, color));
      }
    }
    if (chunks.length === 0) {
      this.resetTerminalColors();
      return;
    }
    const payload = chunks.join('');
    // OSC 11 makes ConPTY repaint the entire screen; re-sending an identical
    // palette every authoritative frame is pure flicker.
    if (options.force !== true && this.terminalMutated && payload === this.lastPalettePayload) {
      return;
    }
    this.terminal.write(payload);
    this.terminalMutated = true;
    this.lastPalettePayload = payload;
  }

  private resetTerminalColors(): void {
    this.lastPalettePayload = undefined;
    if (!this.terminalMutated) return;
    this.terminal.write(`${ESC}]110${ST}${ESC}]111${ST}${ESC}]112${ST}${ESC}]104${ST}`);
    this.terminalMutated = false;
  }
}

export function shouldAnimate(appearance: AppearancePreferences): boolean {
  if (appearance.profile === 'off') return false;
  if (appearance.particles === 'off') return false;
  if (appearance.animationFps <= 0) return false;
  if (!motionEffectsAllowed()) return false;
  return resolveAmbientEffectMode(appearance) !== 'off';
}

export function shouldRenderAmbientAnimationFrame(
  terminalRows: number,
  transcriptSelectionActive = false,
  _options: { readonly nowMs?: number } = {},
): boolean {
  if (transcriptSelectionActive) return false;
  if (!Number.isFinite(terminalRows) || terminalRows <= 0) return false;
  // Ambient animation keeps running while the transcript is scrolled back;
  // only an active selection/drag suppresses it. Input frames have priority
  // (delay 0) and preempt animation frames in the render loop, so ambient
  // ticks no longer fight the editor for latency.
  return true;
}

export function terminalMutationAllowed(appearance: AppearancePreferences): boolean {
  if (appearance.terminalBackground === 'off' && !appearance.terminalPalette) return false;
  if (process.env['TERM'] === 'dumb') return false;
  if (process.env['NO_COLOR'] !== undefined && process.env['NO_COLOR'] !== '') return false;
  if (process.env['CI'] !== undefined && process.env['CI'] !== '' && process.env['CI'] !== '0') {
    return false;
  }
  if (isRemoteSession()) return false;
  if (process.env['TMUX'] !== undefined && process.env['TMUX'] !== '') return false;
  return process.stdout.isTTY;
}

function isRemoteSession(): boolean {
  return (
    (process.env['SSH_TTY'] ?? '').length > 0 ||
    (process.env['SSH_CONNECTION'] ?? '').length > 0 ||
    (process.env['SSH_CLIENT'] ?? '').length > 0
  );
}

function oscSetDynamicColor(index: 10 | 11 | 12, color: string): string {
  return `${ESC}]${String(index)};${color}${ST}`;
}

function oscSetPaletteColor(index: number, color: string): string {
  return `${ESC}]4;${String(index)};${color}${ST}`;
}

function ansiPalette(colors: ColorPalette): string[] {
  return [
    colors.surfaceSunken,
    colors.error,
    colors.success,
    colors.warning,
    colors.primary,
    colors.shellMode,
    colors.accent,
    colors.text,
    colors.textMuted,
    colors.diffRemovedStrong,
    colors.diffAddedStrong,
    colors.warning,
    colors.gradientStart,
    colors.particle,
    colors.gradientEnd,
    colors.textStrong,
  ];
}
