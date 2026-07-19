import {
  DEFAULT_APPEARANCE_PREFERENCES,
  type AppearancePreferences,
} from '#/tui/config';
import {
  ansiTextToCells,
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
  stripAnsiControls,
  type NativeFrameStatsHealth,
  type RendererEffectLevel,
  type RendererQualityLevel,
  type RendererCell,
  type RendererCellStyle,
  type RendererRegionLine,
  type RendererStyledTextRun,
} from '#/tui/renderer';
import type { ColorToken } from '#/tui/theme';
import { currentTheme } from '#/tui/theme';

export type AmbientEffectMode = RendererEffectLevel;

/**
 * Monospace-safe ambient glyphs only.
 * Dingbats (✦✧✺) break on common Nerd Font + kitty symbol_map setups.
 */
const PREMIUM_PARTICLES = ['•', '∙', '·', '*', '◦'] as const;
/**
 * Brand duo motion tokens only — never success/warning/shellMode.
 * Keeps splash/meteors/particles/spectacular text inside each theme's two-tone.
 */
export const BRAND_MOTION_TOKENS: readonly ColorToken[] = [
  'gradientStart',
  'primary',
  'glow',
  'accent',
  'gradientEnd',
  'particle',
];
const PARTICLE_TOKENS: readonly ColorToken[] = [
  'particle',
  'accent',
  'primary',
  'gradientEnd',
];
const SHIMMER_FRAMES = ['•', '∙', '·', '◦'] as const;
const PREMIUM_DIVIDER_FRAMES = ['─', '─', '━'] as const;
/** Soft comet heads / trail dust — never flashy multi-star spam. */
const COMET_HEAD = '•';
const COMET_MID = '∙';
const COMET_TAIL = '·';
const STAR_DUST = ['·', '∙', '◦'] as const;
/** ~30fps cinematic floor — dense 1ms thrash burns CPU without better motion. */
const PREMIUM_AMBIENT_RENDER_TICK_MS = 33;
const SUBTLE_AMBIENT_RENDER_TICK_MS = 140;
const PULSE_GLYPH_INTERVAL_MS = 280;
/** Header/divider comet cadence — slow enough to read as drift, not scroll. */
const COMET_TICK_MS_PREMIUM = 48;
const COMET_TICK_MS_SUBTLE = 96;
const PULSE_TOKENS: readonly ColorToken[] = ['primary', 'glow', 'gradientEnd', 'particle'];
const SPECTACULAR_TOKENS: readonly ColorToken[] = BRAND_MOTION_TOKENS;

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
    // Premium spectacle pins the densify floor directly so animationFps max(30→33ms)
    // cannot slow zero-config particle rails past PREMIUM_AMBIENT_RENDER_TICK_MS.
    return PREMIUM_AMBIENT_RENDER_TICK_MS;
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

function paintCellIfEmpty(cells: string[], index: number, styled: string): void {
  if (index < 0 || index >= cells.length) return;
  const current = cells[index];
  // Overwrite empty sky or the soft base divider stroke only — never clobber other heads.
  if (current === ' ' || (current !== undefined && isBaseDividerCell(current))) {
    cells[index] = styled;
  }
}

function isBaseDividerCell(cell: string): boolean {
  // Base strokes are single-style box glyphs; comet paint may replace them.
  const plain = cell.replaceAll(/\u001B\[[0-9;]*m/g, '');
  return plain === '─' || plain === '━' || plain === '═';
}

/** Soft decaying trail behind a moving head (fractional phase → smoother than integer steps). */
function paintCometTrail(
  cells: string[],
  headX: number,
  direction: 1 | -1,
  trailLen: number,
  headToken: ColorToken,
  premium: boolean,
): void {
  const safeWidth = cells.length;
  if (safeWidth === 0) return;
  const head = rendererPositiveModulo(Math.round(headX), safeWidth);
  paintCellIfEmpty(cells, head, currentTheme.fg(headToken, COMET_HEAD));

  for (let step = 1; step <= trailLen; step++) {
    const t = step / Math.max(1, trailLen);
    const x = rendererPositiveModulo(head - direction * step, safeWidth);
    // Near head: mid dust; far: mute pinpricks. Dim tokens fake optical falloff.
    if (t < 0.34) {
      paintCellIfEmpty(
        cells,
        x,
        premium ? currentTheme.fg('particle', COMET_MID) : currentTheme.dimFg('particle', COMET_MID),
      );
    } else if (t < 0.7) {
      paintCellIfEmpty(cells, x, currentTheme.dimFg('particle', COMET_TAIL));
    } else {
      paintCellIfEmpty(cells, x, currentTheme.dimFg('textMuted', COMET_TAIL));
    }
  }
}

/**
 * Sparse ambient rail — a few drifting pinpricks + rare long comets.
 * Intentionally low density so motion reads as atmosphere, not marquee.
 */
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
  const tickMs = premium ? COMET_TICK_MS_PREMIUM : COMET_TICK_MS_SUBTLE;
  const now = appearanceAnimationNow();
  // Sub-cell phase keeps trails from "jumping" a full column each tick.
  const phase = now / tickMs;
  const cells = Array.from({ length: safeWidth }, () => ' ');
  const base = hashRendererEffectSeed(seed);

  // Comets first so dust never steals the soft trail cells.
  const cometCount = premium
    ? safeWidth >= 48
      ? 2
      : 1
    : safeWidth >= 40
      ? 1
      : 0;
  for (let i = 0; i < cometCount; i++) {
    const origin = base * (i + 3) + i * 91;
    const direction: 1 | -1 = 1; // unified drift — opposing traffic looks jittery
    const speed = premium ? 0.55 + (i % 2) * 0.2 : 0.35;
    const headX = rendererPositiveModulo(origin + direction * phase * speed, safeWidth);
    const trailLen = premium
      ? Math.min(10, Math.max(5, Math.floor(safeWidth / 10)))
      : Math.min(6, Math.max(3, Math.floor(safeWidth / 16)));
    const token = PARTICLE_TOKENS[rendererPositiveModulo(origin + i * 2, PARTICLE_TOKENS.length)]!;
    paintCometTrail(cells, headX, direction, trailLen, token, premium);
  }

  // Still dust — slow twinkle into empty sky only.
  const dustCount = premium
    ? Math.max(2, Math.min(7, Math.floor(safeWidth / 18)))
    : Math.max(1, Math.min(4, Math.floor(safeWidth / 28)));
  for (let i = 0; i < dustCount; i++) {
    const origin = base + i * 47;
    // Drift ~1 cell every ~12–20 ticks — glacial, not busy.
    const drift = Math.floor(phase / (12 + (i % 5)));
    const x = rendererPositiveModulo(origin + drift, safeWidth);
    if (cells[x] !== ' ') continue;
    const twinkle = rendererPositiveModulo(Math.floor(phase / 3) + origin, 5);
    if (twinkle === 0) continue; // intentional gaps = breathing sky
    const char = STAR_DUST[rendererPositiveModulo(origin + twinkle, STAR_DUST.length)]!;
    const token = PARTICLE_TOKENS[rendererPositiveModulo(origin + i, PARTICLE_TOKENS.length)]!;
    cells[x] =
      twinkle >= 3 ? currentTheme.dimFg(token, char) : currentTheme.dimFg('textMuted', char);
  }

  return cells.join('');
}

/**
 * Header/queue divider: quiet base stroke + optional soft highlight band + rare comet.
 * Replaces the old "dense particles marching right" look.
 */
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

  const premium = mode === 'premium';
  const now = appearanceAnimationNow();
  const base = hashRendererEffectSeed(seed);
  // Very slow weight cycle — almost static, avoids ─/━/═ strobing.
  const baseChar =
    premium && rendererPositiveModulo(Math.floor(now / 900) + base, 5) === 0
      ? PREMIUM_DIVIDER_FRAMES[2]!
      : PREMIUM_DIVIDER_FRAMES[0]!;
  const baseToken: ColorToken = premium ? 'border' : 'primary';
  const cells = Array.from({ length: safeWidth }, () => currentTheme.dimFg(baseToken, baseChar));
  if (safeWidth < 8) return cells.join('');

  const tickMs = premium ? COMET_TICK_MS_PREMIUM : COMET_TICK_MS_SUBTLE;
  const phase = now / tickMs;

  // Soft traveling highlight band (wide, dim) — reads as light, not dots.
  if (premium && safeWidth >= 16) {
    const bandWidth = Math.min(14, Math.max(6, Math.floor(safeWidth / 7)));
    const bandSpeed = 0.22;
    const bandHead = rendererPositiveModulo(base + phase * bandSpeed, safeWidth);
    for (let step = 0; step < bandWidth; step++) {
      const x = rendererPositiveModulo(Math.round(bandHead) - step, safeWidth);
      const edge = step / Math.max(1, bandWidth - 1);
      // Center of band slightly brighter.
      const styled =
        edge < 0.35
          ? currentTheme.fg('glow', '─')
          : edge < 0.7
            ? currentTheme.dimFg('particle', '─')
            : currentTheme.dimFg('border', '─');
      cells[x] = styled;
    }
  }

  // Sparse twinkles on the stroke — no lateral marquee of stars.
  // Always keep ≥1 pinprick so short dividers still read as "alive".
  const twinkleCount = premium
    ? Math.max(1, Math.min(4, Math.floor(safeWidth / 22)))
    : Math.max(1, Math.min(2, Math.floor(safeWidth / 30)));
  let paintedTwinkles = 0;
  for (let i = 0; i < twinkleCount; i++) {
    const origin = base + i * 53;
    const x = rendererPositiveModulo(origin + Math.floor(phase / 18), safeWidth);
    // First twinkle is sticky; later ones may blink off for breathing room.
    const on = i === 0 || rendererPositiveModulo(Math.floor(phase / 4) + origin, 4) !== 0;
    if (!on) continue;
    const char = STAR_DUST[rendererPositiveModulo(origin, STAR_DUST.length)]!;
    cells[x] = currentTheme.dimFg(
      PARTICLE_TOKENS[rendererPositiveModulo(origin, PARTICLE_TOKENS.length)]!,
      char,
    );
    paintedTwinkles += 1;
  }
  if (paintedTwinkles === 0) {
    const x = rendererPositiveModulo(base, safeWidth);
    cells[x] = currentTheme.dimFg('particle', COMET_TAIL);
  }

  // At most one comet on the divider — the "why is this moving" should be one answer.
  if (safeWidth >= 20) {
    const direction: 1 | -1 = 1;
    const speed = premium ? 0.48 : 0.3;
    const headX = rendererPositiveModulo(base * 3 + direction * phase * speed, safeWidth);
    const trailLen = premium
      ? Math.min(12, Math.max(6, Math.floor(safeWidth / 8)))
      : Math.min(7, Math.max(4, Math.floor(safeWidth / 14)));
    paintCometTrail(cells, headX, direction, trailLen, 'particle', premium);
  }

  return cells.join('');
}

/**
 * Welcome/idle meteor field — sparse diagonal streaks over empty rows.
 * Not a full-screen backdrop; only paints the rows you ask for.
 */
export function renderMeteorField(
  width: number,
  height: number,
  seed: string,
  appearance: AppearancePreferences = activeAppearance,
): string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const safeHeight = Math.max(0, Math.trunc(height));
  if (safeWidth === 0 || safeHeight === 0) return [];
  if (!shouldRenderAmbientEffects(appearance)) {
    return Array.from({ length: safeHeight }, () => ' '.repeat(safeWidth));
  }

  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  const premium = mode === 'premium';
  const now = appearanceAnimationNow();
  const tickMs = premium ? COMET_TICK_MS_PREMIUM : COMET_TICK_MS_SUBTLE;
  const phase = now / tickMs;
  const base = hashRendererEffectSeed(seed);

  const rows: string[][] = Array.from({ length: safeHeight }, () =>
    Array.from({ length: safeWidth }, () => ' '),
  );

  // Background star dust — mostly static with rare blinks.
  const dust = premium
    ? Math.max(3, Math.min(14, Math.floor((safeWidth * safeHeight) / 48)))
    : Math.max(2, Math.min(8, Math.floor((safeWidth * safeHeight) / 70)));
  for (let i = 0; i < dust; i++) {
    const h = base + i * 59;
    const x = rendererPositiveModulo(h, safeWidth);
    const y = rendererPositiveModulo(h * 3 + i * 7, safeHeight);
    const blink = rendererPositiveModulo(Math.floor(phase / 5) + h, 6);
    if (blink === 0) continue;
    const char = STAR_DUST[rendererPositiveModulo(h, STAR_DUST.length)]!;
    rows[y]![x] =
      blink >= 4
        ? currentTheme.dimFg('particle', char)
        : currentTheme.dimFg('textMuted', char);
  }

  // Diagonal meteors (down-right). Lifecycle: enter → streak → fade out of field.
  const meteorCount = premium
    ? safeHeight >= 3
      ? 3
      : 2
    : safeHeight >= 2
      ? 1
      : 0;
  for (let m = 0; m < meteorCount; m++) {
    const h = base * (m + 2) + m * 131;
    // Period in phase units — staggered so they don't sync.
    const period = premium ? 42 + (m % 3) * 11 : 56 + (m % 2) * 14;
    const local = rendererPositiveModulo(phase + (h % period), period);
    // Only visible for part of the cycle (quiet sky between showers).
    const activeFor = premium ? 16 : 12;
    if (local > activeFor) continue;

    const startX = rendererPositiveModulo(h, Math.max(1, safeWidth));
    const startY = -Math.floor((h % 5) + 1); // spawn slightly above field
    const speed = premium ? 0.7 + (m % 3) * 0.12 : 0.5;
    // Diagonal: x increases slower than y for a natural fall angle.
    const headX = startX + local * speed * 1.15;
    const headY = startY + local * speed;
    const trailLen = premium ? 5 : 3;
    const token = PARTICLE_TOKENS[rendererPositiveModulo(h, PARTICLE_TOKENS.length)]!;

    for (let step = 0; step <= trailLen; step++) {
      const x = Math.round(headX - step * 1.1);
      const y = Math.round(headY - step * 0.85);
      if (y < 0 || y >= safeHeight || x < 0 || x >= safeWidth) continue;
      const t = step / Math.max(1, trailLen);
      if (step === 0) {
        rows[y]![x] = currentTheme.fg(token, COMET_HEAD);
      } else if (t < 0.4) {
        rows[y]![x] = currentTheme.fg('particle', COMET_MID);
      } else if (t < 0.75) {
        rows[y]![x] = currentTheme.dimFg('particle', COMET_TAIL);
      } else {
        rows[y]![x] = currentTheme.dimFg('textMuted', COMET_TAIL);
      }
    }
  }

  return rows.map((cells) => cells.join(''));
}

export function renderAnimatedGradientText(
  text: string,
  seed: string,
  appearance: AppearancePreferences = activeAppearance,
): string {
  const plainText = stripAnsiControls(text);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') return currentTheme.boldFg('primary', plainText);
  return renderSpectacularText(plainText, seed, appearance, {
    intense: mode === 'premium',
    pace: mode === 'premium' ? 'fast' : 'slow',
  });
}

export function renderPulseText(
  text: string,
  seed: string,
  fallbackToken: ColorToken = 'primary',
  appearance: AppearancePreferences = activeAppearance,
  pace: 'fast' | 'slow' = 'fast',
): string {
  const plainText = stripAnsiControls(text);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') {
    return currentTheme.boldFg(fallbackToken, plainText);
  }
  return renderSpectacularText(plainText, seed, appearance, {
    intense: mode === 'premium',
    pace,
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
  // Callers sometimes pass already-styled chalk/ANSI fragments (queue pointer,
  // thinking density, etc.). Strip controls first so per-cluster restyling
  // never re-escapes SGR bodies into visible `[0;1;38;2…` garbage.
  const plainText = stripAnsiControls(text);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') {
    return currentTheme.boldFg('primary', plainText);
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

  for (const cluster of splitDisplayClusters(plainText)) {
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
  const plainText = stripAnsiControls(text);
  if (!shouldRenderAmbientEffects(appearance)) {
    return currentTheme.boldFg('textStrong', plainText);
  }
  return `${renderShimmerPrefix(appearance)}${renderSpectacularText(plainText, seed, appearance, { intense: true })}`;
}

export function renderPremiumAccentLine(
  text: string,
  seed: string,
  appearance: AppearancePreferences = activeAppearance,
): string {
  const plainText = stripAnsiControls(text);
  if (!shouldRenderAmbientEffects(appearance)) {
    return currentTheme.fg('primary', plainText);
  }
  return renderSpectacularText(plainText, seed, appearance, { intense: true, pace: 'slow' });
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

export type MotionToolPhase = 'running' | 'streaming' | 'done' | 'error';

export const SETTLE_FLASH_MS = 420;
export const CROSSFADE_MS = 480;
export const ENTER_BEAT_MS = 720;
export const EXIT_BEAT_MS = 640;

/** Enter-beat TTL matching `renderEnterBeat` (subtle stretches ×1.2). */
export function enterBeatDurationMs(
  appearance: AppearancePreferences = activeAppearance,
): number {
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  return mode === 'subtle' ? ENTER_BEAT_MS * 1.2 : ENTER_BEAT_MS;
}

/** Exit-beat TTL matching `renderExitBeat` (subtle stretches ×1.2). */
export function exitBeatDurationMs(
  appearance: AppearancePreferences = activeAppearance,
): number {
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  return mode === 'subtle' ? EXIT_BEAT_MS * 1.2 : EXIT_BEAT_MS;
}

function motionProgress(startedAtMs: number, durationMs: number, nowMs = appearanceAnimationNow()): number {
  if (durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, (nowMs - startedAtMs) / durationMs));
}

export function renderSettleFlash(
  text: string,
  seed: string,
  startedAtMs: number,
  appearance: AppearancePreferences = activeAppearance,
): string {
  const plain = stripAnsiControls(text);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') {
    return currentTheme.boldFg('textStrong', plain);
  }
  const p = motionProgress(startedAtMs, mode === 'subtle' ? SETTLE_FLASH_MS * 1.4 : SETTLE_FLASH_MS);
  if (p >= 1) return currentTheme.fg('text', plain);
  // ≥4 visual steps via spectacular → pulse → text
  if (p < 0.35) return renderSpectacularText(plain, seed, appearance, { intense: true, pace: 'fast' });
  if (p < 0.7) return renderPulseText(plain, seed, 'primary', appearance);
  return currentTheme.boldFg('primary', plain);
}

export function renderPhaseChip(
  label: string,
  phase: MotionToolPhase,
  seed: string,
  appearance: AppearancePreferences = activeAppearance,
): string {
  const plain = stripAnsiControls(label);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  const mark =
    phase === 'running' ? '▸' : phase === 'streaming' ? '▹' : phase === 'done' ? '✓' : '!';
  // Use SELECT-safe marks that are NOT list pointers; these are chip glyphs only.
  const body = `${mark} ${plain}`;
  if (!motionEffectsAllowed() || mode === 'off') {
    const token =
      phase === 'error' ? 'error' : phase === 'done' ? 'glow' : 'textMuted';
    return currentTheme.fg(token, body);
  }
  if (phase === 'running' || phase === 'streaming') {
    return renderPulseText(body, `${seed}:${phase}`, phase === 'streaming' ? 'accent' : 'primary', appearance);
  }
  if (phase === 'error') return currentTheme.boldFg('error', body);
  // Done chip stays on brand glow — not the shared mint success token.
  return currentTheme.fg('glow', body);
}

export function renderCrossfadeLine(
  fromText: string,
  toText: string,
  seed: string,
  startedAtMs: number,
  appearance: AppearancePreferences = activeAppearance,
): string {
  const from = stripAnsiControls(fromText);
  const to = stripAnsiControls(toText);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off' || from === to) {
    return currentTheme.fg('textMuted', to);
  }
  const p = motionProgress(startedAtMs, mode === 'subtle' ? CROSSFADE_MS * 1.4 : CROSSFADE_MS);
  if (p < 0.45) return currentTheme.dimFg('textMuted', from);
  if (p < 0.7) return renderShimmerPrefix(appearance) + currentTheme.fg('textMuted', to);
  return currentTheme.fg('textMuted', to);
}

export function renderEnterBeat(
  title: string,
  width: number,
  seed: string,
  startedAtMs: number,
  appearance: AppearancePreferences = activeAppearance,
): string[] {
  const plain = stripAnsiControls(title);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  const w = Math.max(8, width);
  // Narrow terminals: keep a single title line (no rail / extra chrome height).
  const tiny = width < 40;
  if (!motionEffectsAllowed() || mode === 'off') {
    return [currentTheme.boldFg('textStrong', plain)];
  }
  const p = motionProgress(startedAtMs, enterBeatDurationMs(appearance));
  const head =
    p < 0.85
      ? renderPremiumHeadline(plain, `${seed}:title`, appearance)
      : currentTheme.boldFg('textStrong', plain);
  if (tiny) return [head];
  const rail = renderParticleRail(w, appearance, `${seed}:enter`);
  if (p < 0.25) return [currentTheme.dim(rail)];
  if (p < 0.5) return [currentTheme.dim(rail), head];
  if (p < 0.85) return [head, currentTheme.dim(rail)];
  return [head];
}

export function renderExitBeat(
  title: string,
  width: number,
  seed: string,
  startedAtMs: number,
  appearance: AppearancePreferences = activeAppearance,
): string[] {
  // Mirror enter with brand glow, then collapse to a single line
  const plain = stripAnsiControls(title);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  const w = Math.max(8, width);
  const tiny = width < 40;
  if (!motionEffectsAllowed() || mode === 'off') {
    return [currentTheme.fg('glow', plain)];
  }
  const p = motionProgress(startedAtMs, exitBeatDurationMs(appearance));
  const head = renderPulseText(plain, `${seed}:exit-title`, 'glow', appearance);
  if (tiny) {
    if (p < 0.65) return [head];
    return [currentTheme.fg('glow', plain)];
  }
  const rail = renderParticleRail(w, appearance, `${seed}:exit`);
  if (p < 0.3) return [head, currentTheme.dim(rail)];
  if (p < 0.65) return [head];
  return [currentTheme.fg('glow', plain)];
}

export function renderAmbientDrift(
  width: number,
  seed: string,
  appearance: AppearancePreferences = activeAppearance,
): string {
  // Quieter than meteor field: reuse particle rail with a distinct seed namespace.
  const w = Math.max(8, width);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') {
    return currentTheme.dimFg('border', '─'.repeat(w));
  }
  return renderParticleRail(w, appearance, `drift:${seed}`);
}

export function renderDangerBreathe(
  text: string,
  seed: string,
  appearance: AppearancePreferences = activeAppearance,
): string {
  const plain = stripAnsiControls(text);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') {
    return currentTheme.boldFg('error', plain);
  }
  // Alternate error / primary — stay on brand+danger, never warning yellow
  const interval = mode === 'premium' ? 220 : 400;
  const tick = Math.floor(appearanceAnimationNow() / interval) % 4;
  const token = tick % 2 === 0 ? 'error' : 'primary';
  return currentTheme.boldFg(token, plain);
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

/** Ultrawork editor border — multi-hue chase that stays monospace-safe. */
const ULTRAWORK_GLOW_TOKENS: readonly ColorToken[] = [
  'particle',
  'glow',
  'primary',
  'accent',
  'gradientEnd',
  'gradientStart',
];
const EDITOR_BORDER_CHARS = new Set(['╭', '╮', '╰', '╯', '│', '─', '├', '┤', '┬', '┴', '┼']);
/** ~24 border-cells/sec — readable chase without strobe. */
const ULTRAWORK_BORDER_CHASE_MS_PER_CELL = 42;
const ULTRAWORK_BORDER_HUE_CYCLE_MS = 880;

/**
 * Smooth multi-token hue for Ultrawork chrome (border + region VFX).
 * Blends adjacent palette tokens so the edge never snaps between solids.
 */
export function resolveUltraworkBorderGlowHex(nowMs: number = appearanceAnimationNow()): string {
  const count = ULTRAWORK_GLOW_TOKENS.length;
  const phase = (Math.max(0, nowMs) / ULTRAWORK_BORDER_HUE_CYCLE_MS) % count;
  const i0 = Math.floor(phase) % count;
  const i1 = (i0 + 1) % count;
  const t = phase - Math.floor(phase);
  // Smoothstep — eases the mid-blend so the hue feels liquid, not linear RGB crawl.
  const s = t * t * (3 - 2 * t);
  return mixHexColor(
    currentTheme.color(ULTRAWORK_GLOW_TOKENS[i0]!),
    currentTheme.color(ULTRAWORK_GLOW_TOKENS[i1]!),
    s,
  );
}

export function resolveUltraworkEditorBorderStyle(
  nowMs: number = appearanceAnimationNow(),
): RendererCellStyle {
  return {
    fg: resolveUltraworkBorderGlowHex(nowMs),
    bold: true,
  };
}

/**
 * Paint a traveling highlight along the editor frame perimeter.
 * Only touches box-drawing border glyphs — prompt/text stay untouched.
 */
export function paintUltraworkEditorBorderGlow(
  lines: readonly RendererRegionLine[],
  nowMs: number = appearanceAnimationNow(),
): RendererRegionLine[] {
  if (lines.length === 0) return [];

  // Editor-replacement dialogs (approval / permission prompts) still yield ANSI
  // strings. Never Array.from() those — ESC bodies become visible `[0;1;38;2…`.
  const rows: RendererCell[][] = lines.map((line) => {
    if (typeof line === 'string') {
      return ansiTextToCells(line).map((cell) => ({
        ...cell,
        style: cell.style === undefined ? undefined : { ...cell.style },
      }));
    }
    return line.map((cell) => ({ ...cell, style: cell.style === undefined ? undefined : { ...cell.style } }));
  });

  const height = rows.length;
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (width === 0) return lines.slice();

  for (const row of rows) {
    while (row.length < width) row.push({ char: ' ' });
  }

  const path: Array<{ readonly x: number; readonly y: number }> = [];
  if (height === 1) {
    for (let x = 0; x < width; x++) path.push({ x, y: 0 });
  } else {
    for (let x = 0; x < width; x++) path.push({ x, y: 0 });
    for (let y = 1; y < height - 1; y++) path.push({ x: width - 1, y });
    for (let x = width - 1; x >= 0; x--) path.push({ x, y: height - 1 });
    for (let y = height - 2; y >= 1; y--) path.push({ x: 0, y });
  }
  if (path.length === 0) return rows;

  const head = resolveUltraworkBorderGlowHex(nowMs);
  const mid = mixHexColor(head, currentTheme.color('primary'), 0.32);
  const soft = mixHexColor(head, currentTheme.color('border'), 0.58);
  const dim = mixHexColor(soft, currentTheme.color('border'), 0.4);
  const headIndex = rendererPositiveModulo(
    Math.floor(nowMs / ULTRAWORK_BORDER_CHASE_MS_PER_CELL),
    path.length,
  );
  const trailLen = Math.min(16, Math.max(7, Math.floor(path.length / 4)));

  // Base: whole border gently tinted so Ultrawork never looks "off".
  for (const { x, y } of path) {
    const cell = rows[y]![x]!;
    if (!EDITOR_BORDER_CHARS.has(cell.char)) continue;
    rows[y]![x] = {
      ...cell,
      style: { ...cell.style, fg: dim, bold: false },
    };
  }

  // Chase head + decaying trail (clockwise).
  for (let step = 0; step <= trailLen; step++) {
    const idx = rendererPositiveModulo(headIndex - step, path.length);
    const { x, y } = path[idx]!;
    const cell = rows[y]![x]!;
    if (!EDITOR_BORDER_CHARS.has(cell.char)) continue;
    const t = step / Math.max(1, trailLen);
    const fg = t < 0.12 ? head : t < 0.4 ? mid : t < 0.72 ? soft : dim;
    rows[y]![x] = {
      ...cell,
      style: {
        ...cell.style,
        fg,
        bold: t < 0.35,
      },
    };
  }

  return rows;
}
