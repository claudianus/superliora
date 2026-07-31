/**
 * Visual Quality / premium settings glance — live motion budget + renderer quality (SSOT §9.2).
 */

import { DEFAULT_APPEARANCE_PREFERENCES, type AppearancePreferences } from '#/tui/config';
import {
  appearanceAnimationFrameIntervalMs,
  motionEffectsAllowed,
  resolveAmbientEffectMode,
  resolveQualityAdjustedAmbientEffectMode,
  type AmbientEffectMode,
} from '#/tui/features/appearance/appearance-effects';
import type {
  NativeFrameStatsHealth,
  RendererDiagnosticsSnapshot,
  RendererQualityLevel,
} from '#/tui/renderer';

export interface PremiumVisualGlance {
  readonly premiumQualityMode: boolean;
  readonly appearance: AppearancePreferences;
  readonly renderQuality: RendererQualityLevel;
  readonly renderHealth: NativeFrameStatsHealth;
  readonly motionAllowed: boolean;
  readonly requestedEffectMode: AmbientEffectMode;
  readonly effectiveEffectMode: AmbientEffectMode;
  readonly ambientIntervalMs: number;
  readonly diagnostics?: RendererDiagnosticsSnapshot;
  /** Session RPC premium flag when wired; may differ briefly from appState. */
  readonly sessionPremiumQuality?: boolean;
}

export interface PremiumVisualGlanceSources {
  readonly premiumQualityMode?: boolean;
  readonly appearance?: AppearancePreferences;
  readonly renderQuality: RendererQualityLevel;
  readonly renderHealth: NativeFrameStatsHealth;
  readonly diagnostics?: RendererDiagnosticsSnapshot;
  readonly sessionPremiumQuality?: boolean;
}

/** Resolve live Visual Quality glance from appState + appearance module + renderer stats. */
export function loadPremiumVisualGlance(sources: PremiumVisualGlanceSources): PremiumVisualGlance {
  const appearance = sources.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
  const renderQuality = sources.renderQuality;
  const renderHealth = sources.renderHealth;
  const requestedEffectMode = resolveAmbientEffectMode(appearance);
  const effectiveEffectMode = resolveQualityAdjustedAmbientEffectMode(
    appearance,
    renderQuality,
    renderHealth,
  );
  const ambientIntervalMs = appearanceAnimationFrameIntervalMs(
    appearance,
    renderQuality,
    renderHealth,
  );

  return {
    premiumQualityMode: sources.premiumQualityMode === true,
    appearance,
    renderQuality,
    renderHealth,
    motionAllowed: motionEffectsAllowed(),
    requestedEffectMode,
    effectiveEffectMode,
    ambientIntervalMs,
    diagnostics: sources.diagnostics,
    sessionPremiumQuality: sources.sessionPremiumQuality,
  };
}

/** Harness Visual Quality toggle — appState with optional session confirmation. */
export function formatVisualQualityModeLine(glance: PremiumVisualGlance): string {
  const on = glance.premiumQualityMode;
  const sessionNote =
    glance.sessionPremiumQuality !== undefined && glance.sessionPremiumQuality !== on
      ? ` · session ${glance.sessionPremiumQuality ? 'ON' : 'OFF'} (syncing)`
      : '';
  return on
    ? `Visual Quality: ON · harness anti-slop + art direction${sessionNote}`
    : `Visual Quality: OFF · standard harness visuals${sessionNote}`;
}

/** Saved appearance motion prefs from tui.toml / Settings → Appearance. */
export function formatAppearanceMotionLine(glance: PremiumVisualGlance): string {
  const { appearance } = glance;
  return `Appearance: profile ${appearance.profile} · particles ${appearance.particles} · ${String(appearance.animationFps)}fps · transcript ${appearance.transcriptDetail}`;
}

/** Adaptive renderer quality + frame health wired from native renderer onFrame. */
export function formatLiveRenderQualityLine(glance: PremiumVisualGlance): string {
  const adaptive =
    glance.diagnostics?.quality.level !== undefined &&
    glance.diagnostics.quality.level !== glance.renderQuality
      ? ` · adaptive ${glance.diagnostics.quality.level}`
      : '';
  return `Render quality: ${glance.renderQuality}${adaptive} · frame health: ${glance.renderHealth}`;
}

function formatAmbientFps(intervalMs: number): string {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 'static';
  const fps = Math.round(1000 / intervalMs);
  return `~${String(fps)}fps`;
}

function formatFrameBudgetRatio(diagnostics: RendererDiagnosticsSnapshot | undefined): string {
  if (diagnostics === undefined || diagnostics.frames <= 0) {
    return 'awaiting first frame';
  }
  const ratio = diagnostics.avgFrameBudgetRatio;
  if (!Number.isFinite(ratio)) return 'n/a';
  const pct = Math.round(ratio * 100);
  return `${String(pct)}% avg`;
}

/** Live motion budget — effect mode, ambient tick, native frame budget when wired. */
export function formatMotionBudgetLine(glance: PremiumVisualGlance): string {
  if (!glance.motionAllowed) {
    return 'Motion budget: forced off (SSH · NO_COLOR · CI · TERM=dumb)';
  }
  if (glance.effectiveEffectMode === 'off') {
    return 'Motion budget: off · appearance profile/particles disable ambient';
  }

  const tick =
    Number.isFinite(glance.ambientIntervalMs) && glance.ambientIntervalMs > 0
      ? `${String(Math.round(glance.ambientIntervalMs))}ms (${formatAmbientFps(glance.ambientIntervalMs)})`
      : 'static';
  const degradeNote =
    glance.effectiveEffectMode !== glance.requestedEffectMode
      ? ` · softened from ${glance.requestedEffectMode}`
      : '';
  const budget = formatFrameBudgetRatio(glance.diagnostics);
  return `Motion budget: ${glance.effectiveEffectMode} ambient · tick ${tick}${degradeNote} · frame budget ${budget}`;
}

export function buildPremiumSettingsLines(glance: PremiumVisualGlance): readonly string[] {
  return [
    '── Visual Quality (read-only) ──────────────',
    'Harness art direction + TUI motion — Sovereign Reform §7 / PREMIUM.md.',
    '',
    '── Session (live) ───────────────────────────',
    formatVisualQualityModeLine(glance),
    formatAppearanceMotionLine(glance),
    formatLiveRenderQualityLine(glance),
    formatMotionBudgetLine(glance),
    '',
    '── Toggle ───────────────────────────────────',
    '  /premium on|off       harness Visual Quality (requires session)',
    '  Settings → Appearance   profile · particles · animation-fps',
    '  /appearance status      current appearance prefs',
    '',
    '── Renderer diagnostics ─────────────────────',
    '  /renderer diagnostics status   frame budget + quality HUD',
    '  SUPERLIORA_NATIVE_RENDERER_DIAGNOSTICS=1   overlay HUD',
    '',
    '── Motion rules (PREMIUM.md §7) ─────────────',
    '· Single animation clock — no raw setInterval in components',
    '· Quality auto-degrades under frame pressure (full→high→balanced→minimal)',
    '· Premium profile pins ambient effects unless appearance is off',
    '· Ops Theatre dopamine cues respect the same quality gate',
    '',
    'No persist slider here — use /premium and Settings → Appearance.',
  ];
}
