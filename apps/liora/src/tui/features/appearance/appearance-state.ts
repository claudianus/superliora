import {
  DEFAULT_APPEARANCE_PREFERENCES,
  type AppearancePreferences,
} from '#/tui/config';
import {
  rendererAmbientIntervalMs,
  resolveRendererEffectLevel,
  type NativeFrameStatsHealth,
  type RendererEffectLevel,
  type RendererQualityLevel,
  type RendererTransportStability,
} from '#/tui/renderer';

export type AmbientEffectMode = RendererEffectLevel;

/** Premium ambient ceiling (~60fps). Denser than this burns CPU without clearer motion. */
const PREMIUM_AMBIENT_MIN_MS = 16;
/** Soft-degrade / subtle ambient floor. */
const SUBTLE_AMBIENT_RENDER_TICK_MS = 100;

/** Resolve premium ambient interval from user `animationFps` (clamped to ≤60fps). */
export function premiumAmbientIntervalMs(animationFps: number): number {
  const fps = Number.isFinite(animationFps) ? Math.trunc(animationFps) : 60;
  if (fps <= 0) return Number.POSITIVE_INFINITY;
  // floor so 60fps → 16ms (round would yield 17).
  return Math.max(PREMIUM_AMBIENT_MIN_MS, Math.floor(1000 / Math.min(60, fps)));
}

let activeAppearance: AppearancePreferences = DEFAULT_APPEARANCE_PREFERENCES;
let animationClockMs = Date.now();
let appearanceRenderQuality: RendererQualityLevel = 'full';
let appearanceRenderHealth: NativeFrameStatsHealth = 'healthy';
// Set from the render callback each frame. Defaults optimistic so POSIX and
// pre-probe frames resolve normally; classic ConPTY flips it to 'unstable'.
let appearanceTransportStability: RendererTransportStability = 'synchronized';

export function setActiveAppearancePreferences(appearance: AppearancePreferences): void {
  activeAppearance = appearance;
}

export function getActiveAppearancePreferences(): AppearancePreferences {
  return activeAppearance;
}

export function advanceAppearanceAnimationClock(nowMs: number = Date.now()): void {
  animationClockMs = nowMs;
}

export function appearanceAnimationNow(): number {
  return animationClockMs;
}

export function setAppearanceRenderQuality(quality: RendererQualityLevel): void {
  appearanceRenderQuality = quality;
}

export function getAppearanceRenderQuality(): RendererQualityLevel {
  return appearanceRenderQuality;
}

export function setAppearanceRenderHealth(health: NativeFrameStatsHealth): void {
  appearanceRenderHealth = health;
}

export function getAppearanceRenderHealth(): NativeFrameStatsHealth {
  return appearanceRenderHealth;
}

export function setAppearanceTransportStability(stability: RendererTransportStability): void {
  appearanceTransportStability = stability;
}

export function getAppearanceTransportStability(): RendererTransportStability {
  return appearanceTransportStability;
}

export function resolveAmbientEffectMode(appearance: AppearancePreferences): AmbientEffectMode {
  if (appearance.profile === 'off' || appearance.particles === 'off') return 'off';
  if (appearance.profile === 'premium' || appearance.particles === 'premium') return 'premium';
  if (
    appearance.profile === 'subtle' ||
    appearance.particles === 'ambient' ||
    appearance.particles === 'events'
  ) {
    return 'subtle';
  }
  return 'subtle';
}

function pinsPremiumAppearanceEffects(appearance: AppearancePreferences): boolean {
  return resolveAmbientEffectMode(appearance) === 'premium';
}

export function resolveQualityAdjustedAmbientEffectMode(
  appearance: AppearancePreferences,
  quality: RendererQualityLevel = appearanceRenderQuality,
  health: NativeFrameStatsHealth = appearanceRenderHealth,
): AmbientEffectMode {
  const requested = resolveAmbientEffectMode(appearance);
  // Unstable transports (classic ConPTY) turn every write into a visible
  // repaint, so animated ambient effects read as constant flicker no matter
  // the quality budget. Clamp them off; this overrides even a premium pin.
  // Functional indicators are unaffected — spinner rotation and the stream
  // reveal ride the raw mode/clock — and the starfield backdrop survives as a
  // static frame via appearanceDecorativeFrozenByTransport.
  if (requested !== 'off' && appearanceTransportStability === 'unstable') return 'off';
  if (pinsPremiumAppearanceEffects(appearance)) return 'premium';
  return resolveRendererEffectLevel({
    requested,
    // When the renderer drops to minimal quality during bursts of input, keep
    // ambient effects alive at the balanced level so they do not appear to freeze
    // while the user is typing.
    quality: quality === 'minimal' ? 'balanced' : quality,
    health: health === 'degraded' ? 'watch' : health,
  });
}

/**
 * True when the user asked for ambient effects but the transport cannot animate
 * them without flicker. Large-area backdrops (the letterbox starfield) use this
 * to paint one static frame instead of disappearing entirely.
 */
export function appearanceDecorativeFrozenByTransport(
  appearance: AppearancePreferences,
): boolean {
  return (
    appearanceTransportStability === 'unstable' &&
    resolveAmbientEffectMode(appearance) !== 'off'
  );
}

/**
 * True when the transport cannot repaint cheaply, so the incremental
 * "type-on" stream reveal should snap to the full draft instead of animating
 * code point by code point. On unstable transports every reveal tick is its
 * own console repaint; snapping collapses the whole catch-up into the next
 * governed frame, which is the single largest streaming-flicker win.
 */
export function streamingRevealSnapByTransport(): boolean {
  return appearanceTransportStability === 'unstable';
}

export function appearanceAnimationFrameIntervalMs(
  appearance: AppearancePreferences,
  quality: RendererQualityLevel = appearanceRenderQuality,
  health: NativeFrameStatsHealth = appearanceRenderHealth,
): number {
  return rendererAmbientIntervalMs({
    requested: resolveAmbientEffectMode(appearance),
    quality: quality === 'minimal' ? 'balanced' : quality,
    // Pass real health through: soft-degrade keys off `degraded` / minimal /
    // backpressure only. Mapping degraded→watch here used to keep cadence soft
    // when watch itself soft-degraded; watch alone now stays at premium ms.
    health,
    // backpressure is injected by AmbientSchedule ctx at the renderer; this
    // helper remains quality/health oriented for unit tests / cache ticks.
    premiumMs: premiumAmbientIntervalMs(appearance.animationFps),
    subtleMs: SUBTLE_AMBIENT_RENDER_TICK_MS,
  });
}

export function ambientAnimationActive(
  appearance: AppearancePreferences = activeAppearance,
): boolean {
  return motionEffectsAllowed() && resolveQualityAdjustedAmbientEffectMode(appearance) !== 'off';
}

export function ambientAnimationRenderTick(
  appearance: AppearancePreferences = activeAppearance,
): number {
  if (!ambientAnimationActive(appearance)) return -1;
  const intervalMs = appearanceAnimationFrameIntervalMs(appearance);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return -1;
  return Math.floor(appearanceAnimationNow() / intervalMs);
}

export function motionEffectsAllowed(): boolean {
  if (process.env['TERM'] === 'dumb') return false;
  if (process.env['NO_COLOR'] !== undefined && process.env['NO_COLOR'] !== '') return false;
  if (process.env['CI'] !== undefined && process.env['CI'] !== '' && process.env['CI'] !== '0') {
    return false;
  }
  return !isRemoteSession();
}

export function shouldRenderAmbientEffects(appearance: AppearancePreferences): boolean {
  return motionEffectsAllowed() && resolveQualityAdjustedAmbientEffectMode(appearance) !== 'off';
}

function isRemoteSession(): boolean {
  return (
    (process.env['SSH_TTY'] ?? '').length > 0 ||
    (process.env['SSH_CONNECTION'] ?? '').length > 0 ||
    (process.env['SSH_CLIENT'] ?? '').length > 0
  );
}

/** Shared progress fraction (0-1) for a time-boxed motion effect. */
export function motionProgress(
  startedAtMs: number,
  durationMs: number,
  nowMs: number = appearanceAnimationNow(),
): number {
  if (durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, (nowMs - startedAtMs) / durationMs));
}
