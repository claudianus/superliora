import {
  DEFAULT_APPEARANCE_PREFERENCES,
  type AppearancePreferences,
} from '#/tui/config';
import {
  rendererAnimationFrameIntervalMs,
  rendererEffectFrameIntervalMs,
  hashRendererEffectSeed,
  mixHexColor,
  rendererPositiveModulo,
  renderRendererDividerRow,
  renderRendererStyledTextRunsAnsi,
  resolveRendererSeededIndex,
  resolveRendererEffectLevel,
  splitDisplayClusters,
  type NativeFrameStatsHealth,
  type RendererEffectLevel,
  type RendererQualityLevel,
  type RendererCellStyle,
  type RendererStyledTextRun,
} from '#/tui/renderer';
import type { ColorToken } from '#/tui/theme';
import { currentTheme } from '#/tui/theme';

export type AmbientEffectMode = RendererEffectLevel;

const SUBTLE_PARTICLES = ['·', '∙', '✧'] as const;
const PREMIUM_PARTICLES = ['✦', '✧', '✺', '∙', '•'] as const;
const PARTICLE_TOKENS: readonly ColorToken[] = [
  'particle',
  'accent',
  'primary',
  'gradientEnd',
];
const SHIMMER_FRAMES = ['✦', '✧', '∙', '·'] as const;
const PREMIUM_DIVIDER_FRAMES = ['─', '━', '═'] as const;
/** How often ambient animation frames repaint (~20fps). */
const PREMIUM_AMBIENT_RENDER_TICK_MS = 42;
const SUBTLE_AMBIENT_RENDER_TICK_MS = 140;
const PULSE_GLYPH_INTERVAL_MS = 280;
const PULSE_TOKENS: readonly ColorToken[] = ['primary', 'glow', 'gradientEnd', 'particle'];
const SPECTACULAR_TOKENS: readonly ColorToken[] = [
  'gradientStart',
  'primary',
  'glow',
  'accent',
  'gradientEnd',
  'particle',
  'shellMode',
  'success',
];

export interface SpectacularTextOptions {
  readonly rowIndex?: number;
  /** Faster color cycling and space sparkles. */
  readonly intense?: boolean;
  /** Slower wave for secondary copy. */
  readonly pace?: 'fast' | 'slow';
}

let activeAppearance: AppearancePreferences = DEFAULT_APPEARANCE_PREFERENCES;
let animationClockMs = Date.now();
let appearanceRenderQuality: RendererQualityLevel = 'full';
let appearanceRenderHealth: NativeFrameStatsHealth = 'healthy';

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

export function appearanceAnimationFrameIntervalMs(
  appearance: AppearancePreferences,
  quality: RendererQualityLevel = appearanceRenderQuality,
  health: NativeFrameStatsHealth = appearanceRenderHealth,
): number {
  if (pinsPremiumAppearanceEffects(appearance)) {
    return rendererAnimationFrameIntervalMs({
      fps: appearance.animationFps,
      requested: 'premium',
      quality: 'full',
      health: 'healthy',
      maxFps: 24,
      defaultFps: DEFAULT_APPEARANCE_PREFERENCES.animationFps,
      premiumMs: PREMIUM_AMBIENT_RENDER_TICK_MS,
      offMs: 1000,
    });
  }
  return rendererAnimationFrameIntervalMs({
    fps: appearance.animationFps,
    requested: resolveAmbientEffectMode(appearance),
    // Same quality/health floor as resolveQualityAdjustedAmbientEffectMode so
    // the animation cadence stays consistent even when the renderer throttles.
    quality: quality === 'minimal' ? 'balanced' : quality,
    health: health === 'degraded' ? 'watch' : health,
    maxFps: 24,
    defaultFps: DEFAULT_APPEARANCE_PREFERENCES.animationFps,
    premiumMs: PREMIUM_AMBIENT_RENDER_TICK_MS,
    subtleMs: SUBTLE_AMBIENT_RENDER_TICK_MS,
    offMs: 1000,
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

export function renderParticleRail(
  width: number,
  appearance: AppearancePreferences,
  seed: string,
): string {
  const safeWidth = Math.max(0, Math.trunc(width));
  if (safeWidth === 0) return '';
  if (!shouldRenderAmbientEffects(appearance)) return ' '.repeat(safeWidth);

  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  const premium = mode === 'premium';
  const tickMs = rendererEffectFrameIntervalMs(mode);
  const tick = Math.floor(appearanceAnimationNow() / tickMs);
  // Dense demo-grade rails on premium; subtle ambient on default.
  const density = premium
    ? Math.max(20, Math.min(72, Math.floor(safeWidth / 1.45)))
    : Math.max(6, Math.min(26, Math.floor(safeWidth / 5.2)));
  const chars = premium ? PREMIUM_PARTICLES : SUBTLE_PARTICLES;
  const cells = Array.from({ length: safeWidth }, () => ' ');
  const base = hashRendererEffectSeed(seed);

  for (let i = 0; i < density; i++) {
    const direction = i % 2 === 0 ? 1 : -1;
    const speed = 1 + (i % 3);
    const origin = base + i * 17 + (i % 5) * 11;
    const x = rendererPositiveModulo(origin + direction * tick * speed, safeWidth);
    const char = chars[rendererPositiveModulo(origin + tick + i, chars.length)]!;
    const token = PARTICLE_TOKENS[rendererPositiveModulo(origin + tick + i * 3, PARTICLE_TOKENS.length)]!;
    cells[x] = currentTheme.fg(token, char);

    if (premium && safeWidth > 14) {
      // 7-cell comet trail for denser continuous motion on demo terminals.
      for (let step = 1; step <= 7; step++) {
        const trail = rendererPositiveModulo(x - direction * step, safeWidth);
        if (cells[trail] !== ' ') continue;
        if (step === 1) cells[trail] = currentTheme.dimFg('particle', '•');
        else if (step === 2) cells[trail] = currentTheme.dimFg('particle', '·');
        else cells[trail] = currentTheme.dimFg('textMuted', '·');
      }
    }
  }

  return cells.join('');
}

export function renderParticleDivider(
  width: number,
  seed: string,
  appearance: AppearancePreferences = activeAppearance,
): string {
  const safeWidth = Math.max(0, Math.trunc(width));
  if (safeWidth === 0) return '';
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') {
    return renderRendererDividerRow({
      width: safeWidth,
      style: (text) => currentTheme.fg('primary', text),
    });
  }
  const baseChar =
    mode === 'premium'
      ? PREMIUM_DIVIDER_FRAMES[
          rendererPositiveModulo(
            Math.floor(appearanceAnimationNow() / 260) + hashRendererEffectSeed(seed),
            PREMIUM_DIVIDER_FRAMES.length,
          )
        ]!
      : '─';
  const baseToken: ColorToken = mode === 'premium' ? 'glow' : 'primary';
  const cells = Array.from({ length: safeWidth }, () => currentTheme.fg(baseToken, baseChar));
  if (safeWidth < 8) return cells.join('');

  const premium = mode === 'premium';
  const tick = Math.floor(appearanceAnimationNow() / rendererEffectFrameIntervalMs(mode));
  const density = premium
    ? Math.max(14, Math.min(48, Math.floor(safeWidth / 2.3)))
    : Math.max(5, Math.min(18, Math.floor(safeWidth / 7.5)));
  const chars = premium ? PREMIUM_PARTICLES : SUBTLE_PARTICLES;
  const base = hashRendererEffectSeed(seed);
  for (let i = 0; i < density; i++) {
    const origin = base + i * 29;
    const x = rendererPositiveModulo(origin + tick * (1 + (i % 2)), safeWidth);
    const char = chars[rendererPositiveModulo(origin + tick + i, chars.length)]!;
    const token = PARTICLE_TOKENS[rendererPositiveModulo(origin + i * 3 + tick, PARTICLE_TOKENS.length)]!;
    cells[x] = currentTheme.fg(token, char);
  }

  return cells.join('');
}

export function renderAnimatedGradientText(
  text: string,
  seed: string,
  appearance: AppearancePreferences = activeAppearance,
): string {
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') return currentTheme.boldFg('primary', text);
  return renderSpectacularText(text, seed, appearance, {
    intense: mode === 'premium',
    pace: mode === 'premium' ? 'fast' : 'slow',
  });
}

export function renderPulseText(
  text: string,
  seed: string,
  fallbackToken: ColorToken = 'primary',
  appearance: AppearancePreferences = activeAppearance,
): string {
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') {
    return currentTheme.boldFg(fallbackToken, text);
  }
  return renderSpectacularText(text, seed, appearance, {
    intense: mode === 'premium',
    pace: 'fast',
  });
}

export function renderPulseGlyph(
  glyphs: readonly string[],
  seed: string,
  fallback: string,
  fallbackToken: ColorToken,
  appearance: AppearancePreferences = activeAppearance,
): string {
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode !== 'premium' || glyphs.length === 0) {
    return currentTheme.fg(fallbackToken, fallback);
  }
  const index = resolveRendererSeededIndex({
    seed,
    nowMs: appearanceAnimationNow(),
    intervalMs: PULSE_GLYPH_INTERVAL_MS,
    length: glyphs.length,
  }) ?? 0;
  return currentTheme.boldFg(PULSE_TOKENS[index % PULSE_TOKENS.length]!, glyphs[index]!);
}

export function renderSpectacularText(
  text: string,
  seed: string,
  appearance: AppearancePreferences = activeAppearance,
  options: SpectacularTextOptions = {},
): string {
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') {
    return currentTheme.boldFg('primary', text);
  }

  const rowIndex = options.rowIndex ?? 0;
  const intense = options.intense !== false && mode === 'premium';
  const pace = options.pace ?? (intense ? 'fast' : 'slow');
  const cycleMs = resolveSpectacularTextCycleMs(appearance, pace, intense);
  const nowMs = appearanceAnimationNow();
  const tickFloat = nowMs / cycleMs;
  const tick = Math.floor(tickFloat);
  const base = hashRendererEffectSeed(seed) + rowIndex * 37;
  const waveStride = resolveSpectacularWaveStride(intense, pace);
  const waveSpan = SPECTACULAR_TOKENS.length * 4;
  const runs: RendererStyledTextRun[] = [];
  let clusterIndex = 0;

  for (const cluster of splitDisplayClusters(text)) {
    const char = cluster.text;
    if (char === ' ') {
      if (
        intense &&
        rendererPositiveModulo(base + clusterIndex + tick * 3, 23) === 0
      ) {
        const glyph =
          PREMIUM_PARTICLES[
            rendererPositiveModulo(base + tick + clusterIndex, PREMIUM_PARTICLES.length)
          ]!;
        runs.push({
          text: glyph,
          style: withSpectacularCanvasBackground({
            fg: currentTheme.color(
              PARTICLE_TOKENS[
                rendererPositiveModulo(base + tick + clusterIndex, PARTICLE_TOKENS.length)
              ]!,
            ),
            bold: true,
          }),
        });
        clusterIndex += cluster.width;
        continue;
      }
      runs.push({ text: char, style: withSpectacularCanvasBackground(undefined) });
      clusterIndex += cluster.width;
      continue;
    }

    const waveFloat = clusterIndex + tickFloat * waveStride + base;
    const wave = ((waveFloat % waveSpan) + waveSpan) % waveSpan;
    const tokenIndex = Math.floor(wave);
    const tokenA = SPECTACULAR_TOKENS[tokenIndex % SPECTACULAR_TOKENS.length]!;
    const tokenB = SPECTACULAR_TOKENS[(tokenIndex + 1) % SPECTACULAR_TOKENS.length]!;
    const blend = wave - tokenIndex;
    runs.push({
      text: char,
      style: withSpectacularCanvasBackground({
        fg: mixHexColor(currentTheme.color(tokenA), currentTheme.color(tokenB), blend),
        bold: intense || char !== char.toLowerCase() || /[\\/|_\-=+#@*]/.test(char),
      }),
    });
    clusterIndex += cluster.width;
  }

  return renderRendererStyledTextRunsAnsi(runs, { resetStyle: true });
}

export function renderPremiumHeadline(
  text: string,
  seed: string,
  appearance: AppearancePreferences = activeAppearance,
): string {
  if (!shouldRenderAmbientEffects(appearance)) {
    return currentTheme.boldFg('textStrong', text);
  }
  return `${renderShimmerPrefix(appearance)}${renderSpectacularText(text, seed, appearance, { intense: true })}`;
}

export function renderPremiumAccentLine(
  text: string,
  seed: string,
  appearance: AppearancePreferences = activeAppearance,
): string {
  if (!shouldRenderAmbientEffects(appearance)) {
    return currentTheme.fg('primary', text);
  }
  return renderSpectacularText(text, seed, appearance, { intense: true, pace: 'slow' });
}

export function renderShimmerPrefix(appearance: AppearancePreferences = activeAppearance): string {
  if (!shouldRenderAmbientEffects(appearance)) return '';
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  const interval = rendererEffectFrameIntervalMs(mode, {
    premiumMs: 180,
    subtleMs: 520,
  });
  const index = resolveRendererSeededIndex({
    nowMs: appearanceAnimationNow(),
    intervalMs: interval,
    length: SHIMMER_FRAMES.length,
  }) ?? 0;
  return `${SHIMMER_FRAMES[index]!} `;
}

function resolveSpectacularTextCycleMs(
  appearance: AppearancePreferences,
  pace: 'fast' | 'slow',
  intense: boolean,
): number {
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (mode === 'subtle') return pace === 'fast' ? 380 : 480;
  if (pace === 'slow') return intense ? 320 : 400;
  return intense ? 220 : 280;
}

function resolveSpectacularWaveStride(intense: boolean, pace: 'fast' | 'slow'): number {
  if (!intense) return 0.45;
  return pace === 'fast' ? 1 : 0.65;
}

function isRemoteSession(): boolean {
  return (
    (process.env['SSH_TTY'] ?? '').length > 0 ||
    (process.env['SSH_CONNECTION'] ?? '').length > 0 ||
    (process.env['SSH_CLIENT'] ?? '').length > 0
  );
}

function withSpectacularCanvasBackground(
  style: RendererCellStyle | undefined,
): RendererCellStyle | undefined {
  if (!currentTheme.canvasBackgroundEnabled) return style;
  const bg = currentTheme.color('background');
  if (style === undefined) return { bg };
  if (style.bg !== undefined) return style;
  return { ...style, bg };
}
