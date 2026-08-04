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

/** Motion profile / ambient tick tip — Settings → Visual Quality picker. */
export const PREMIUM_MOTION_TIP =
  'Motion: profile auto|off|subtle|premium · particles auto|off|ambient|events|premium · animation-fps 1–60 · single shared animation clock (PREMIUM.md §7) · /appearance profile|particles|animation-fps · Settings → Appearance · forced off under SSH · NO_COLOR · CI · TERM=dumb.';

/** Transcript + layout density tip — appearance prefs + live transcript projection. */
export const PREMIUM_DENSITY_TIP =
  'Density: appearance density auto|compact|comfortable|spacious · transcript-detail minimal|compact|standard|full · /transcript <level> · /appearance density|transcript-detail · tui.toml [appearance] · Visual Quality ON may route premium injection density visual vs code.';

/** Harness Visual Quality (PQ) toggle tip — session RPC, not config.toml. */
export const PREMIUM_PQ_TIP =
  'Visual Quality (PQ): harness art direction + anti-slop visuals — not task/model quality · /premium on|off|status (requires session) · Ultrawork may auto-enable · Settings → Appearance for motion prefs.';

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
  const qualityLevel = glance.diagnostics?.quality?.level;
  const adaptive =
    qualityLevel !== undefined && qualityLevel !== glance.renderQuality
      ? ` · adaptive ${qualityLevel}`
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
    '── Visual Quality ───────────────────────────',
    'Harness art direction + TUI motion — Sovereign Reform §7 / PREMIUM.md.',
    '',
    '── Session (live) ───────────────────────────',
    formatVisualQualityModeLine(glance),
    formatAppearanceMotionLine(glance),
    formatLiveRenderQualityLine(glance),
    formatMotionBudgetLine(glance),
    '',
    '── Toggle ───────────────────────────────────',
    '  Settings → Visual Quality   ON/OFF · transcript density',
    '  /premium on|off             harness Visual Quality (requires session)',
    '  Settings → Appearance       profile · particles · animation-fps',
    '  /transcript                 density picker',
    '',
    '── Renderer diagnostics ─────────────────────',
    '  /renderer diagnostics status   frame budget + quality HUD',
    '  SUPERLIORA_NATIVE_RENDERER_DIAGNOSTICS=1   overlay HUD',
    '',
    '── Motion rules (PREMIUM.md §7) ─────────────',
    '· Single animation clock — no raw setInterval in components',
    '· Quality auto-degrades under frame pressure (full→high→balanced→minimal)',
    '· Premium profile pins ambient effects unless appearance is off',
  ];
}
