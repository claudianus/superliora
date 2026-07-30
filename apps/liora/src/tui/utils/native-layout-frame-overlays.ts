import {
  createRendererDiagnosticsOverlayRegion,
  createRendererRegionVfx,
  visibleWidth,
  type RendererCellStyle,
  type RendererDiagnosticsSnapshot,
  type RendererFrameRegion,
  type RendererOverlayPanelLineStyle,
  type RendererOverlayPlacement,
  type RendererRect,
  type RendererRegionVfxPreset,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getAppearanceRenderHealth,
  getAppearanceRenderQuality,
  getActiveAppearancePreferences,
  motionEffectsAllowed,
  resolveAmbientEffectMode,
} from '#/tui/utils/appearance-effects';

import type { TUIState } from '../tui-state';

export type TUIStateNativeDiagnosticsOverlayInput =
  | boolean
  | TUIStateNativeDiagnosticsOverlayOptions;
export type TUIStateNativeDiagnosticsOverlayResolver =
  () => TUIStateNativeDiagnosticsOverlayInput | undefined;
export type TUIStateNativeDiagnosticsOverlaySource =
  | TUIStateNativeDiagnosticsOverlayInput
  | TUIStateNativeDiagnosticsOverlayResolver;

export interface TUIStateNativeDiagnosticsOverlayOptions {
  readonly enabled?: boolean;
  readonly diagnostics?: RendererDiagnosticsSnapshot;
  readonly width?: number;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly placement?: RendererOverlayPlacement;
  readonly marginX?: number;
  readonly marginY?: number;
  readonly zIndex?: number;
  readonly title?: string;
  readonly border?: boolean;
  readonly maxIssues?: number;
  readonly includeIssues?: boolean;
}

export function createTUIStateDiagnosticsOverlayRegion(
  state: TUIState,
  input: TUIStateNativeDiagnosticsOverlaySource | undefined,
  fallbackDiagnostics: RendererDiagnosticsSnapshot | undefined,
  width: number,
  height: number,
): RendererFrameRegion | undefined {
  const options = normalizeDiagnosticsOverlayInput(input);
  if (options === undefined) return undefined;
  const diagnostics = options.diagnostics ?? fallbackDiagnostics;
  if (diagnostics === undefined) return undefined;
  const palette = currentTheme.palette;
  const panelBg = currentTheme.canvasBackgroundEnabled ? palette.surfaceRaised : undefined;
  const severityColor = diagnostics.severity === 'degraded'
    ? palette.error
    : diagnostics.severity === 'watch'
      ? palette.warning
      : palette.success;
  const region = createRendererDiagnosticsOverlayRegion(diagnostics, {
    id: 'kimi-native-renderer-diagnostics',
    viewport: { x: 0, y: 0, width, height },
    width: options.width,
    minWidth: options.minWidth,
    maxWidth: options.maxWidth ?? Math.min(72, Math.max(12, width - 2)),
    maxHeight: options.maxHeight ?? 8,
    placement: options.placement ?? 'top-right',
    marginX: options.marginX ?? 1,
    marginY: options.marginY ?? 1,
    zIndex: options.zIndex,
    title: options.title ?? 'Renderer',
    border: options.border,
    maxIssues: options.maxIssues ?? 2,
    includeIssues: options.includeIssues,
    style: {
      container: { fg: palette.text, bg: panelBg },
      border: { fg: severityColor, bg: panelBg },
      title: { fg: severityColor, bg: panelBg, bold: true },
      body: { fg: palette.textDim, bg: panelBg },
    },
    lineStyle: createTUIStateDiagnosticsOverlayLineStyle(panelBg),
    background: { char: ' ', style: { fg: palette.text, bg: panelBg } },
  });
  if (region === undefined || diagnostics.severity === 'ok') return region;
  return {
    ...region,
    vfx: createTUIStateNativeRegionVfx(state, 'focus-pulse', {
      color: severityColor,
      seed: `native-diagnostics:${diagnostics.severity}`,
    }),
  };
}

/**
 * Transient toast (e.g. "Copied to clipboard"). Drawn above all chrome
 * (zIndex 9) while `state.toast.visible` has not expired. Floats two rows
 * above the editor region when present, otherwise near the bottom edge.
 */
export function createTUIToastOverlayRegion(
  state: TUIState,
  width: number,
  height: number,
  editorTopY: number | undefined,
): RendererFrameRegion | undefined {
  const toast = state.toast.visible;
  if (toast === null || toast.expiresAtMs <= Date.now()) return undefined;
  const palette = currentTheme.palette;
  const accent = palette.success ?? palette.primary;
  const background = palette.surfaceRaised ?? palette.surface;
  const label = ` ✓ ${toast.message} `;
  const labelWidth = Math.min(visibleWidth(label), width);
  if (labelWidth <= 0 || height <= 0) return undefined;
  const x = Math.max(0, Math.min(Math.floor((width - labelWidth) / 2), width - labelWidth));
  const y = editorTopY === undefined ? Math.max(0, height - 3) : Math.max(0, editorTopY - 2);
  const content =
    `\u001B[1m\u001B[38;2;${hexToTruecolorSgr(accent)}m\u001B[48;2;${hexToTruecolorSgr(background)}m` +
    `${label}\u001B[0m`;
  return {
    id: 'toast',
    zIndex: 9,
    rect: { x, y, width: labelWidth, height: 1 },
    content: [content],
  };
}

function hexToTruecolorSgr(hex: string): string {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `${r};${g};${b}`;
}

export function createTUIStateNativeRegionVfx(
  state: TUIState,
  preset: RendererRegionVfxPreset,
  options: {
    readonly color: string;
    readonly seed: string;
    readonly rect?: RendererRect;
    readonly premiumIntervalMs?: number;
    readonly subtleIntervalMs?: number;
    readonly minIntensity?: number;
    readonly maxIntensity?: number;
    readonly width?: number;
  },
): ReturnType<typeof createRendererRegionVfx> {
  // Region VFX keeps running while the transcript is scrolled back; ambient
  // motion only pauses for an active transcript selection (frame hold).
  if (!motionEffectsAllowed()) return undefined;
  const appearance = state.appState.appearance ?? getActiveAppearancePreferences();
  // Ultrawork / premium spectacle pins full quality so the glow does not freeze under load.
  const premiumPinned =
    resolveAmbientEffectMode(appearance) === 'premium' || state.appState.ultraworkMode === true;
  return createRendererRegionVfx({
    preset,
    requested:
      state.appState.ultraworkMode === true
        ? 'premium'
        : resolveAmbientEffectMode(appearance),
    quality: premiumPinned ? 'full' : getAppearanceRenderQuality(),
    health: premiumPinned ? 'healthy' : getAppearanceRenderHealth(),
    nowMs: appearanceAnimationNow(),
    seed: options.seed,
    color: options.color,
    rect: options.rect,
    premiumIntervalMs: options.premiumIntervalMs,
    subtleIntervalMs: options.subtleIntervalMs,
    minIntensity: options.minIntensity,
    maxIntensity: options.maxIntensity,
    width: options.width,
  });
}

function normalizeDiagnosticsOverlayInput(
  input: TUIStateNativeDiagnosticsOverlaySource | undefined,
): TUIStateNativeDiagnosticsOverlayOptions | undefined {
  if (typeof input === 'function') return normalizeDiagnosticsOverlayInput(input());
  if (input === undefined || input === false) return undefined;
  if (input === true) return {};
  if (input.enabled === false) return undefined;
  return input;
}

function createTUIStateDiagnosticsOverlayLineStyle(
  background: string | undefined,
): RendererOverlayPanelLineStyle {
  return (line): RendererCellStyle | undefined => {
    const palette = currentTheme.palette;
    if (line.startsWith('degraded:')) return { fg: palette.error, bg: background, bold: true };
    if (line.startsWith('watch:')) return { fg: palette.warning, bg: background, bold: true };
    return undefined;
  };
}
