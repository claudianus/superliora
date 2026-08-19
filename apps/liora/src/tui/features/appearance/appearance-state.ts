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

/**
 * The one time base every motion timestamp shares.
 *
 * The renderer's frame loop stamps `frame.timestamp` from `performance.now()`,
 * so the shared animation clock counts milliseconds since process start — not
 * Unix epoch. Any stamp taken with `Date.now()` and compared against
 * `appearanceAnimationNow()` is off by ~1.8e12 ms, which silently pins every
 * elapsed-based effect at 0 (see PREMIUM.md §7.1). Producers of motion
 * timestamps must read this, never `Date.now()`.
 */
export function monotonicMotionNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

let activeAppearance: AppearancePreferences = DEFAULT_APPEARANCE_PREFERENCES;
let animationClockMs = monotonicMotionNowMs();
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

export function advanceAppearanceAnimationClock(
  nowMs: number = monotonicMotionNowMs(),
): void {
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

/** Alias of {@link shouldRenderAmbientEffects} for frame-policy call sites. */
export function ambientAnimationActive(
  appearance: AppearancePreferences = activeAppearance,
): boolean {
  return shouldRenderAmbientEffects(appearance);
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

/**
 * Decorative motion gate: ambient particles, gradients, pulses, glows, settle
 * flashes, entrance washes. Everything that is pure polish and must vanish when
 * the user, the frame budget, or the transport says no.
 */
export function shouldRenderAmbientEffects(appearance: AppearancePreferences): boolean {
  return motionEffectsAllowed() && resolveQualityAdjustedAmbientEffectMode(appearance) !== 'off';
}

/**
 * Functional motion gate: spinner frames, progress heads, and the other glyphs
 * whose whole job is to prove the process is still alive. A frozen spinner
 * reads as a hung agent, so these ignore the appearance profile, the quality
 * budget, and the transport — everything {@link shouldRenderAmbientEffects}
 * answers to.
 *
 * They also ignore the CI and SSH clauses of {@link motionEffectsAllowed}: a
 * remote session is exactly where a live spinner earns its keep. Only output
 * that cannot repaint a cell in place stops them, which leaves the plain-text
 * sinks — `TERM=dumb` and `NO_COLOR` — where a rotating glyph would just append
 * a new line per tick.
 */
export function progressMotionActive(): boolean {
  if (process.env['TERM'] === 'dumb') return false;
  const noColor = process.env['NO_COLOR'];
  return noColor === undefined || noColor === '';
}

/**
 * Frame index for a functional spinner on the shared clock. Returns 0 (the
 * resting frame) when functional motion is off, so callers can index a frame
 * table unconditionally.
 */
export function progressMotionFrame(intervalMs: number, frameCount: number): number {
  if (frameCount <= 0) return 0;
  if (!progressMotionActive()) return 0;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 0;
  return Math.floor(appearanceAnimationNow() / intervalMs) % frameCount;
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
