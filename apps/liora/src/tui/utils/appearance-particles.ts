import {
  hashRendererEffectSeed,
  rendererPositiveModulo,
  renderRendererDividerRow,
} from '#/tui/renderer';
import type { AppearancePreferences } from '#/tui/config';
import type { ColorToken } from '#/tui/theme';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  motionEffectsAllowed,
  resolveQualityAdjustedAmbientEffectMode,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-state';

/**
 * Monospace-safe ambient glyphs only.
 * Dingbats (✦✧✺) break on common Nerd Font + kitty symbol_map setups.
 */
export const PREMIUM_PARTICLES = ['•', '∙', '·', '*', '◦'] as const;
/**
 * Brand + role motion tokens — never success/warning/error.
 * Particles / Ultrawork may use the full set (including roleUser / shellMode).
 * Spectacular / banner text uses `SPECTACULAR_TOKENS` only so row waves
 * stay on a gentle brand gradient instead of jumping gold↔pink↔violet.
 */
export const BRAND_MOTION_TOKENS: readonly ColorToken[] = [
  'gradientStart',
  'primary',
  'glow',
  'accent',
  'gradientEnd',
  'particle',
  'roleUser',
  'shellMode',
];
export const PARTICLE_TOKENS: readonly ColorToken[] = [
  'particle',
  'accent',
  'primary',
  'gradientEnd',
  'roleUser',
  'shellMode',
];
const PREMIUM_DIVIDER_FRAMES = ['─', '─', '━'] as const;
/** Soft comet heads / trail dust — never flashy multi-star spam. */
const COMET_HEAD = '•';
const COMET_MID = '∙';
const COMET_TAIL = '·';
const STAR_DUST = ['·', '∙', '◦'] as const;
/** Header/divider comet cadence — slow enough to read as drift, not scroll. */
const COMET_TICK_MS_PREMIUM = 48;
const COMET_TICK_MS_SUBTLE = 96;

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
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
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
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
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

export function renderAmbientDrift(
  width: number,
  seed: string,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string {
  // Quieter than meteor field: reuse particle rail with a distinct seed namespace.
  const w = Math.max(8, width);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') {
    return currentTheme.dimFg('border', '─'.repeat(w));
  }
  return renderParticleRail(w, appearance, `drift:${seed}`);
}
