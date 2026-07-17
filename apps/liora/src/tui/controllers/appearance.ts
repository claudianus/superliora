import type { RendererTerminalHost } from '#/tui/renderer';

import type { AppearancePreferences } from '#/tui/config';
import { ESC, ST } from '#/tui/constant/terminal';
import { currentTheme } from '#/tui/theme';
import type { ColorPalette } from '#/tui/theme/colors';
import {
  appearanceAnimationFrameIntervalMs,
  motionEffectsAllowed,
  resolveAmbientEffectMode,
  setActiveAppearancePreferences,
} from '#/tui/utils/appearance-effects';
import { isTUIInputInteractionActive } from '#/tui/utils/input-interaction';

import { AnimationScheduler } from './animation-scheduler';

export interface AppearanceControllerOptions {
  readonly terminal: RendererTerminalHost;
  readonly requestRender: () => void;
  readonly onAppearanceApplied?: () => void;
  readonly getAppearance: () => AppearancePreferences;
  readonly shouldRenderAnimation?: () => boolean;
}

export class AppearanceController {
  private readonly terminal: RendererTerminalHost;
  private readonly getAppearance: () => AppearancePreferences;
  private readonly onAppearanceApplied: (() => void) | undefined;
  private readonly scheduler: AnimationScheduler;
  private terminalMutated = false;

  constructor(options: AppearanceControllerOptions) {
    this.terminal = options.terminal;
    this.getAppearance = options.getAppearance;
    this.onAppearanceApplied = options.onAppearanceApplied;
    const appearance = options.getAppearance();
    this.scheduler = new AnimationScheduler({
      fps: appearance.animationFps,
      enabled: shouldAnimate(appearance),
      requestRender: options.requestRender,
      shouldRender: options.shouldRenderAnimation,
      beforeRender: undefined,
      resolveIntervalMs: () => appearanceAnimationFrameIntervalMs(this.getAppearance()),
    });
    this.apply(appearance);
  }

  apply(appearance: AppearancePreferences = this.getAppearance()): void {
    setActiveAppearancePreferences(appearance);
    currentTheme.setCanvasBackgroundEnabled(appearance.canvasBackground);
    this.scheduler.update({
      fps: appearance.animationFps,
      enabled: shouldAnimate(appearance),
    });
    this.reapplyTerminalPalette(appearance);
    this.onAppearanceApplied?.();
  }

  /**
   * Re-emit OSC palette / background colors after an authoritative native redraw.
   * Does not touch appearance preferences, animation scheduling, or palette
   * invalidation callbacks — callers already sit inside a forced frame.
   */
  reapplyTerminalPalette(appearance: AppearancePreferences = this.getAppearance()): void {
    this.applyTerminalColors(appearance, currentTheme.palette);
  }

  dispose(): void {
    this.scheduler.dispose();
    this.resetTerminalColors();
  }

  private applyTerminalColors(
    appearance: AppearancePreferences,
    colors: ColorPalette,
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
    this.terminal.write(chunks.join(''));
    this.terminalMutated = true;
  }

  private resetTerminalColors(): void {
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
  followOutput: boolean,
  terminalRows: number,
  transcriptSelectionActive = false,
  options: { readonly nowMs?: number } = {},
): boolean {
  if (transcriptSelectionActive) return false;
  if (!followOutput) return false;
  if (!Number.isFinite(terminalRows) || terminalRows <= 0) return false;
  // Typing and ambient ticks share the same render loop. Hold decorative
  // frames for a short window after input so prompt keystrokes stay snappy.
  if (isTUIInputInteractionActive(options.nowMs)) return false;
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
