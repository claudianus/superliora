/**
 * Empty-transcript idle scene — "Paper Fox on the Night River".
 *
 * Deliberately separate from splash's Blood Moon language: no shared moon
 * glyphs, no meteor field, no splash starfield. This is a looping story beat
 * (fox breathes and wags, lantern flames flicker, rain and mist drift,
 * moonlight walks the river, fireflies keep time)
 * meant to stay watchable while the transcript is empty.
 */

import { truncateToWidth, visibleWidth } from '#/tui/renderer';

/** Sitting paper-fox (7 rows) — inhale pose (chest open). */
export const FOX_LARGE = [
  '   /\\   /\\     ',
  '  (  ·.·  )    ',
  '   )  ⌣  (     ',
  '  (  ~~~  )    ',
  ' /|   ▽   |\\   ',
  '(_|       |_)  ',
  '  "       "    ',
] as const;

/** Sitting paper-fox (7 rows) — exhale pose (chest soft). */
export const FOX_LARGE_EXHALE = [
  '   /\\   /\\     ',
  '  (  ·.·  )    ',
  '   )  -  (     ',
  '  (  ~~~  )    ',
  ' /|   ▽   |\\   ',
  '(_|  ···  |_)  ',
  '  "       "    ',
] as const;

/** Compact fox (5 rows) for short / narrow stages. */
export const FOX_COMPACT = [
  ' /\\_/\\  ',
  '( ·.· ) ',
  ' ) ⌣ (  ',
  '/|   |\\ ',
  '(_| |_) ',
] as const;

/** Compact fox exhale. */
export const FOX_COMPACT_EXHALE = [
  ' /\\_/\\  ',
  '( ·.· ) ',
  ' ) - (  ',
  '/|   |\\ ',
  '(_| |_) ',
] as const;

/** Tiny reed clump painted near the bank. */
export const REED_CLUMP = [
  ' │││ ',
  ' │╱│ ',
  ' │││ ',
] as const;

/** Paper lantern body (no solid █ — splash moon language). */
export const LANTERN_BODY = [
  ' ╷ ',
  '╒▓╕',
  ' ╵ ',
] as const;

/** Flame glyphs that cycle above the lantern (blink / flicker). */
export const LANTERN_FLAMES = ['·', '˚', '*', '✧', '°'] as const;

const FIREFLY_GLYPHS = ['.', '·', '˚', '✧', '*', '°'] as const;
const WAVE_CHARS = ['~', '≈', '⁓', '∼', '·', ' '] as const;
const MIST_CHARS = [' ', '·', '˙', '°', '˚', ' '] as const;

/** Breath period for the fox (ms). Slow enough to feel alive, not twitchy. */
export const FOX_BREATH_MS = 2_800;
/** Tail wag frame length (ms). Faster than breath — restless companion energy. */
export const FOX_TAIL_MS = 380;
/** Soft rain drop cycle (ms) for vertical fall stepping. */
export const RAIN_STEP_MS = 110;

/** Thin crescent (not splash Blood Moon blocks) — watches from the far bank. */
export const CRESCENT = [
  '  .-.  ',
  " (   ` ",
  "  `-'  ",
] as const;

export function resolveFoxGlyphRows(
  width: number,
  availableRows: number,
  elapsedMs = 0,
): readonly string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const rows = Math.max(0, Math.trunc(availableRows));
  // 0..1 inhale weight from a smooth sine.
  const phase = (Math.sin((elapsedMs / FOX_BREATH_MS) * Math.PI * 2) + 1) / 2;
  const inhaling = phase >= 0.5;

  let base: readonly string[];
  if (safeWidth >= 48 && rows >= FOX_LARGE.length) {
    base = inhaling ? FOX_LARGE : FOX_LARGE_EXHALE;
  } else if (rows >= FOX_COMPACT.length) {
    base = inhaling ? FOX_COMPACT : FOX_COMPACT_EXHALE;
  } else {
    const compact = inhaling ? FOX_COMPACT : FOX_COMPACT_EXHALE;
    base = compact.slice(0, Math.max(1, Math.min(compact.length, rows)));
  }
  return applyFoxTail(base, elapsedMs);
}

/**
 * Wag the fox tail on the lower body rows.
 * Large fox: appends a 3-frame tail to the right of the hip.
 * Compact: flips a short tail tip on the last body row.
 */
export function applyFoxTail(rows: readonly string[], elapsedMs: number): string[] {
  if (rows.length === 0) return [];
  const frame = Math.floor(elapsedMs / FOX_TAIL_MS) % 4;
  // Frames: curl left, mid, curl right, mid
  const largeTails = ['~- ', '~~ ', '-~ ', '~~ '] as const;
  const compactTips = ['~', '~', '-', '~'] as const;
  const out = rows.map((line) => line);
  const isLarge = (rows[0]?.length ?? 0) >= 12;

  if (isLarge && out.length >= 5) {
    const tail = largeTails[frame] ?? '~~ ';
    // Hip + thigh rows (near end, not the feet line).
    for (const idx of [out.length - 3, out.length - 2]) {
      const line = out[idx];
      if (line === undefined) continue;
      // Trim trailing spaces, append tail, re-pad lightly.
      const core = line.replace(/\s+$/u, '');
      out[idx] = `${core}${tail}`;
    }
  } else if (out.length >= 4) {
    const tip = compactTips[frame] ?? '~';
    const idx = out.length - 2;
    const line = out[idx];
    if (line !== undefined) {
      // Replace last non-space-ish slot with wag tip when possible.
      const chars = [...line];
      // Find last non-space from the right half.
      for (let i = chars.length - 1; i >= Math.floor(chars.length / 2); i--) {
        if (chars[i] !== ' ') {
          // place tip just after body
          if (i + 1 < chars.length) chars[i + 1] = tip;
          else chars.push(tip);
          break;
        }
      }
      out[idx] = chars.join('');
    }
  }
  return out;
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-9;]*m/g, '');
}

export function padOrTrim(text: string, width: number): string {
  const w = visibleWidth(text);
  if (w === width) return text;
  if (w > width) return truncateToWidth(text, width, '…');
  return text + ' '.repeat(width - w);
}

export function centerText(width: number, text: string): string {
  const w = visibleWidth(text);
  if (w >= width) return truncateToWidth(text, width, '…');
  const pad = Math.floor((width - w) / 2);
  return `${' '.repeat(pad)}${text}`;
}

/** Center-blit styled lines onto a canvas starting at `top`. */
export function blitCentered(
  canvas: string[],
  lines: readonly string[],
  top: number,
  width: number,
): void {
  for (let i = 0; i < lines.length; i++) {
    const y = top + i;
    if (y < 0 || y >= canvas.length) continue;
    const line = lines[i];
    if (line === undefined) continue;
    const plainW = visibleWidth(line);
    const pad = Math.max(0, Math.floor((width - plainW) / 2));
    canvas[y] = padOrTrim(`${' '.repeat(pad)}${line}`, width);
  }
}

/** Left-aligned blit at column `left` (clamped). */
export function blitAt(
  canvas: string[],
  lines: readonly string[],
  top: number,
  left: number,
  width: number,
): void {
  const safeLeft = Math.max(0, Math.trunc(left));
  for (let i = 0; i < lines.length; i++) {
    const y = top + i;
    if (y < 0 || y >= canvas.length) continue;
    const line = lines[i];
    if (line === undefined) continue;
    const plain = stripAnsi(canvas[y] ?? ' '.repeat(width)).padEnd(width).slice(0, width);
    const glyphPlain = stripAnsi(line);
    const glyphW = visibleWidth(line);
    if (safeLeft >= width) continue;
    const fit = Math.min(glyphW, width - safeLeft);
    // Rebuild: left plain + glyph + right plain. Glyph may carry ANSI — place as-is
    // when it fully fits; otherwise fall back to plain slice.
    if (fit < glyphW) {
      const slice = glyphPlain.slice(0, fit);
      const next = `${plain.slice(0, safeLeft)}${slice}${plain.slice(safeLeft + fit)}`;
      canvas[y] = padOrTrim(next, width);
      continue;
    }
    const next = `${plain.slice(0, safeLeft)}${line}${plain.slice(safeLeft + glyphW)}`;
    canvas[y] = padOrTrim(next, width);
  }
}

function hash2(a: number, b: number): number {
  let x = (a * 374761393 + b * 668265263) | 0;
  x = (x ^ (x >>> 13)) | 0;
  x = Math.imul(x, 1274126177);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * Soft fireflies — horizontal drift, low density, warm twinkle.
 * Different motion language from splash starfield.
 */
export function paintFireflies(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  density: number,
  style: (glyph: string, intensity: number) => string,
): void {
  if (width <= 0 || rows <= 0 || density <= 0) return;
  // Keep the lower river band freer so waves stay readable.
  const skyRows = Math.max(1, Math.floor(rows * 0.55));
  const count = Math.max(3, Math.floor(width * skyRows * density * 0.05));
  for (let i = 0; i < count; i++) {
    const phase = elapsedMs / 220 + i * 1.7;
    const drift = Math.floor((elapsedMs / 140 + i * 11) % Math.max(1, width));
    const baseX = hash2(i * 19 + 2, 41) % width;
    const x = (baseX + drift) % width;
    const y = hash2(i * 29 + 5, 17) % skyRows;
    const twinkle = (Math.sin(phase) + 1) / 2;
    // Fireflies blink fully off more often than stars — breath-like.
    if (twinkle < 0.35) continue;
    const glyph = FIREFLY_GLYPHS[hash2(i, 3) % FIREFLY_GLYPHS.length] ?? '·';
    const row = canvas[y];
    if (row === undefined) continue;
    const plain = stripAnsi(row);
    if (plain[x] !== ' ' && plain[x] !== undefined) continue;
    canvas[y] = padOrTrim(`${plain.slice(0, x)}${style(glyph, twinkle)}${plain.slice(x + 1)}`, width);
  }
}

/**
 * Soft river-mist bands that drift slowly left→right across the mid air.
 * Sparse, low-contrast — atmosphere, not noise.
 */
export function paintMist(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  style: (glyph: string, intensity: number) => string,
): void {
  if (width <= 0 || rows < 6) return;
  const bandCount = Math.min(3, Math.max(1, Math.floor(rows / 7)));
  for (let b = 0; b < bandCount; b++) {
    const y = Math.floor(rows * (0.22 + b * 0.12)) % rows;
    if (y < 0 || y >= canvas.length) continue;
    const plain = stripAnsi(canvas[y] ?? ' '.repeat(width)).padEnd(width).slice(0, width);
    const cells: string[] = [];
    for (let x = 0; x < width; x++) {
      // Soft cloudlets: sin envelope + slow drift.
      const drift = elapsedMs / 1_800 + b * 1.7;
      const n =
        Math.sin(x * 0.11 - drift) * 0.55 +
        Math.sin(x * 0.03 + drift * 0.4 + b) * 0.45;
      const intensity = (n + 1) / 2;
      // Only paint mist on empty sky cells so fox/reeds stay crisp.
      if (plain[x] !== ' ') {
        cells.push(plain[x] ?? ' ');
        continue;
      }
      // Sparse mist — only the densest cloud cores paint, so the sky stays calm.
      if (intensity < 0.72) {
        cells.push(' ');
        continue;
      }
      const idx = Math.min(
        MIST_CHARS.length - 1,
        Math.floor(intensity * (MIST_CHARS.length - 0.01)),
      );
      const ch = MIST_CHARS[idx] ?? '·';
      if (ch === ' ') {
        cells.push(' ');
        continue;
      }
      cells.push(style(ch, intensity));
    }
    // Merge: prefer mist only where we wrote a glyph; keep original elsewhere.
    // cells already holds either original non-space or mist glyph / space.
    // Rebuild from plain + mist overlays (cells has mixed plain+styled).
    // Simpler: if cell is space keep plain; else use cell.
    const out: string[] = [];
    for (let x = 0; x < width; x++) {
      const c = cells[x] ?? ' ';
      if (c === ' ' || c === plain[x]) out.push(plain[x] ?? ' ');
      else out.push(c);
    }
    // When we pushed styled glyphs, out already has them; padOrTrim handles width.
    // But out may mix styled and plain — join carefully by rebuilding via plain
    // walk + style inserts.
    let built = '';
    let cursor = 0;
    const runPlain = plain;
    while (cursor < width) {
      if (cells[cursor] === ' ' || cells[cursor] === runPlain[cursor]) {
        // gather plain run
        let end = cursor + 1;
        while (
          end < width &&
          (cells[end] === ' ' || cells[end] === runPlain[end])
        ) {
          end += 1;
        }
        built += runPlain.slice(cursor, end);
        cursor = end;
      } else {
        built += cells[cursor] ?? ' ';
        cursor += 1;
      }
    }
    canvas[y] = padOrTrim(built, width);
  }
}

/**
 * Soft night rain — diagonal streaks that fall through empty sky cells only.
 * Keeps density low so fireflies and the fox stay readable.
 */
export function paintRain(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  style: (glyph: string, intensity: number) => string,
): void {
  if (width <= 0 || rows <= 0) return;
  // Rain covers sky + a touch of the bank, not the deep river chrome.
  const rainRows = Math.max(1, Math.floor(rows * 0.72));
  const count = Math.max(4, Math.floor(width * rainRows * 0.035));
  const fall = Math.floor(elapsedMs / RAIN_STEP_MS);
  for (let i = 0; i < count; i++) {
    const seedX = hash2(i * 13 + 1, 7) % Math.max(1, width + rainRows);
    // Diagonal: as y increases, x shifts right a little.
    const y = (hash2(i * 41 + 3, 11) + fall) % rainRows;
    const x = (seedX + y + fall) % width;
    const row = canvas[y];
    if (row === undefined) continue;
    const plain = stripAnsi(row);
    if (plain[x] !== ' ' && plain[x] !== undefined) continue;
    // Alternate droplet glyphs for a wet shimmer.
    const glyph = (i + fall) % 5 === 0 ? '·' : (i + y) % 3 === 0 ? '/' : '|';
    const intensity = 0.35 + ((i % 5) / 10);
    canvas[y] = padOrTrim(
      `${plain.slice(0, x)}${style(glyph, intensity)}${plain.slice(x + 1)}`,
      width,
    );
  }
}

/**
 * Moonlight path across the river — a wandering bright column, not a moon glyph.
 * Call after waves are painted so it brightens existing water cells.
 */
export function paintMoonlightPath(
  canvas: string[],
  riverTop: number,
  riverRows: number,
  width: number,
  elapsedMs: number,
  style: (ch: string) => string,
): void {
  if (width <= 0 || riverRows <= 0) return;
  // Path center drifts slowly across the river.
  const center = Math.floor((Math.sin(elapsedMs / 2_400) * 0.5 + 0.5) * Math.max(1, width - 6)) + 2;
  const half = Math.max(1, Math.floor(width * 0.06));
  for (let r = 0; r < riverRows; r++) {
    const y = riverTop + r;
    if (y < 0 || y >= canvas.length) continue;
    // Path narrows slightly with depth for perspective.
    const band = Math.max(1, half - Math.floor(r / 2));
    const pathStart = Math.max(0, center - band);
    const pathEnd = Math.min(width, center + band + 1);
    const pathChars: string[] = [];
    for (let x = pathStart; x < pathEnd; x++) {
      const dist = Math.abs(x - center);
      const sparkle = Math.sin(elapsedMs / 180 + x * 0.5 + r) > 0.3;
      const ch = sparkle ? (dist === 0 ? '≈' : '~') : '·';
      pathChars.push(style(ch));
    }
    blitAt(canvas, [pathChars.join('')], y, pathStart, width);
  }
}

/** Distant hill / tree silhouette line (1 row). */
export function renderHillLine(width: number, elapsedMs: number): string {
  if (width <= 0) return '';
  const cells: string[] = [];
  for (let x = 0; x < width; x++) {
    const n = Math.sin(x * 0.17 + elapsedMs / 9000) * 0.5 + Math.sin(x * 0.07) * 0.5;
    if (n > 0.55) cells.push('▲');
    else if (n > 0.25) cells.push('^');
    else if (n > 0.05) cells.push('.');
    else cells.push(' ');
  }
  return cells.join('');
}

/** Build a lantern glyph stack with a flickering flame on top. */
export function resolveLanternGlyph(elapsedMs: number, seed: number): readonly string[] {
  // Each lantern has its own flicker phase so they don't blink in lockstep.
  const phase = elapsedMs / 160 + seed * 1.9;
  const flicker = (Math.sin(phase) + Math.sin(phase * 2.3) * 0.4 + 1) / 2;
  // Occasional full snuff (~8% of the time) — candle realism.
  if (flicker < 0.12) {
    return ['   ', LANTERN_BODY[1]!, LANTERN_BODY[2]!];
  }
  const idx = Math.min(
    LANTERN_FLAMES.length - 1,
    Math.floor(flicker * (LANTERN_FLAMES.length - 0.01)),
  );
  const flame = LANTERN_FLAMES[idx] ?? '·';
  return [` ${flame} `, LANTERN_BODY[1]!, LANTERN_BODY[2]!];
}

/**
 * River band with shimmer + drifting paper lanterns (flame-aware).
 */
export function paintRiverBand(
  canvas: string[],
  top: number,
  width: number,
  riverRows: number,
  elapsedMs: number,
  styleWave: (ch: string, intensity: number) => string,
  styleLantern: (line: string, kind: 'body' | 'flame') => string,
): void {
  if (width <= 0 || riverRows <= 0) return;
  for (let r = 0; r < riverRows; r++) {
    const y = top + r;
    if (y < 0 || y >= canvas.length) continue;
    const cells: string[] = [];
    for (let x = 0; x < width; x++) {
      const wave = Math.sin(x * 0.33 + elapsedMs / 380 + r * 0.9);
      const intensity = (wave + 1) / 2;
      const idx = Math.min(WAVE_CHARS.length - 1, Math.floor(intensity * (WAVE_CHARS.length - 0.01)));
      const ch = WAVE_CHARS[idx] ?? '~';
      cells.push(styleWave(ch, intensity));
    }
    canvas[y] = padOrTrim(cells.join(''), width);
  }

  // Paper lanterns float left→right on staggered paths.
  const lanternCount = Math.max(1, Math.min(5, Math.floor(width / 18)));
  for (let i = 0; i < lanternCount; i++) {
    const cycle = 9_000 + i * 1_700;
    const t = ((elapsedMs + i * 2_400) % cycle) / cycle;
    const x = Math.floor(t * Math.max(1, width - 3)) - 1;
    const bob = Math.sin(elapsedMs / 420 + i) > 0 ? 0 : 1;
    const glyph = resolveLanternGlyph(elapsedMs, i + 1);
    const lanternTop = top + Math.min(riverRows - glyph.length, 0 + bob + (i % 2));
    const styled = glyph.map((line, rowIdx) =>
      styleLantern(line, rowIdx === 0 ? 'flame' : 'body'),
    );
    blitAt(canvas, styled, lanternTop, x, width);
  }
}

/** Soft bank rail between land and river. */
export function renderBankRail(width: number, elapsedMs: number, fancy: boolean): string {
  if (width <= 0) return '';
  if (!fancy) return '─'.repeat(width);
  const cells: string[] = [];
  for (let x = 0; x < width; x++) {
    const sway = Math.sin(x * 0.4 + elapsedMs / 700);
    if (sway > 0.6) cells.push('░');
    else if (sway > 0.1) cells.push('─');
    else cells.push('·');
  }
  return cells.join('');
}

/**
 * Compose the full story canvas (no title/tip chrome).
 * `storyRows` is the sky+river budget above bottom chrome.
 */
export function paintIdleStoryScene(options: {
  readonly canvas: string[];
  readonly width: number;
  readonly storyRows: number;
  readonly elapsedMs: number;
  readonly showAmbient: boolean;
  readonly premium: boolean;
  readonly paint: (hex: string, text: string) => string;
  readonly colors: {
    readonly glow: string;
    readonly particle: string;
    readonly primary: string;
    readonly accent: string;
    readonly textDim: string;
    readonly textMuted: string;
    readonly warning: string;
  };
}): void {
  const {
    canvas,
    width,
    storyRows,
    elapsedMs,
    showAmbient,
    premium,
    paint,
    colors,
  } = options;
  if (width <= 0 || storyRows <= 0) return;

  // --- Layer 1: fireflies in the upper air ---
  if (showAmbient) {
    const density = premium ? 0.16 : 0.11;
    paintFireflies(canvas, width, storyRows, elapsedMs, density, (glyph, intensity) => {
      const hex =
        intensity > 0.75 ? colors.warning : intensity > 0.45 ? colors.glow : colors.particle;
      return paint(hex, glyph);
    });
  }

  // --- Layer 2: drifting mist (mid-air atmosphere) ---
  if (showAmbient && storyRows >= 8) {
    paintMist(canvas, width, storyRows, elapsedMs, (glyph, intensity) => {
      const hex = intensity > 0.8 ? colors.textDim : colors.textMuted;
      return paint(hex, glyph);
    });
  }

  // --- Layer 2b: soft night rain ---
  if (showAmbient && storyRows >= 8) {
    paintRain(canvas, width, storyRows, elapsedMs, (glyph, intensity) => {
      const hex = intensity > 0.5 ? colors.textDim : colors.textMuted;
      return paint(hex, glyph);
    });
  }

  // --- Layer 3: distant hills ---
  if (storyRows >= 6) {
    const hillY = Math.max(0, Math.floor(storyRows * 0.12));
    const hill = renderHillLine(width, elapsedMs);
    canvas[hillY] = padOrTrim(
      showAmbient ? paint(colors.textMuted, hill) : paint(colors.textDim, hill),
      width,
    );
  }

  // --- Layer 3b: thin crescent on the far-right sky (not Blood Moon blocks) ---
  if (showAmbient && width >= 48 && storyRows >= 10) {
    const crescent = CRESCENT.map((line) => paint(premium ? colors.glow : colors.textDim, line));
    const cTop = Math.max(0, Math.floor(storyRows * 0.05));
    const cLeft = Math.max(0, width - visibleWidth(CRESCENT[0] ?? '') - 3);
    blitAt(canvas, crescent, cTop, cLeft, width);
  }

  // Layout: fox on the left bank, river on the lower story band.
  const fox = resolveFoxGlyphRows(width, storyRows, elapsedMs);
  const riverRows = Math.max(
    3,
    Math.min(Math.floor(storyRows * 0.34), storyRows - fox.length - 2),
  );
  const bankY = Math.max(fox.length + 1, storyRows - riverRows - 1);
  // Keep lift subtle: only shift when premium + tall stage (avoid layout thrash).
  const foxTopBase = Math.max(1, bankY - fox.length);
  const foxTop =
    premium && storyRows >= 14 && showAmbient
      ? Math.max(1, foxTopBase - (Math.sin((elapsedMs / FOX_BREATH_MS) * Math.PI * 2) > 0.55 ? 1 : 0))
      : foxTopBase;
  const foxLeft =
    width >= 56
      ? Math.max(2, Math.floor(width * 0.08))
      : Math.max(0, Math.floor((width - visibleWidth(fox[0] ?? '')) / 2));

  // --- Layer 4: reeds near the fox ---
  if (showAmbient && width >= 40 && storyRows >= 8) {
    const reedLeft = Math.min(width - 6, foxLeft + visibleWidth(fox[0] ?? '') + 2);
    const reedTop = Math.max(0, bankY - REED_CLUMP.length);
    const reed = REED_CLUMP.map((line) => paint(colors.accent, line));
    // Gentle sway: alternate reed set offset every ~1.2s
    const sway = Math.floor(elapsedMs / 1_200) % 2;
    blitAt(canvas, reed, reedTop, reedLeft + sway, width);
  }

  // --- Layer 5: the paper fox (breathing) ---
  const foxHex = premium ? colors.glow : colors.primary;
  const foxLines = fox.map((line) =>
    showAmbient ? paint(foxHex, line) : paint(colors.textDim, line),
  );
  blitAt(canvas, foxLines, foxTop, foxLeft, width);

  // Soft ground dots under the fox — denser on inhale (weight on the bank).
  if (bankY - 1 >= 0 && bankY - 1 < canvas.length) {
    const inhale = (Math.sin((elapsedMs / FOX_BREATH_MS) * Math.PI * 2) + 1) / 2;
    const groundLen = Math.min(width, inhale > 0.5 ? 20 : 14);
    const ground = showAmbient
      ? paint(colors.textMuted, '·'.repeat(groundLen))
      : paint(colors.textDim, '·'.repeat(Math.min(width, 12)));
    const gLeft = Math.max(0, foxLeft - 1);
    const plain = stripAnsi(canvas[bankY - 1] ?? ' '.repeat(width)).padEnd(width).slice(0, width);
    const gPlain = stripAnsi(ground);
    const next = `${plain.slice(0, gLeft)}${ground}${plain.slice(gLeft + gPlain.length)}`;
    canvas[bankY - 1] = padOrTrim(next, width);
  }

  // --- Layer 6: bank rail ---
  if (bankY >= 0 && bankY < canvas.length) {
    const rail = renderBankRail(width, elapsedMs, showAmbient && premium);
    canvas[bankY] = padOrTrim(
      showAmbient ? paint(colors.primary, rail) : paint(colors.textDim, rail),
      width,
    );
  }

  // --- Layer 7: river + paper lanterns (flame flicker) ---
  const riverTop = Math.min(canvas.length - 1, bankY + 1);
  const riverHeight = Math.min(riverRows, canvas.length - riverTop);
  paintRiverBand(
    canvas,
    riverTop,
    width,
    riverHeight,
    elapsedMs,
    (ch, intensity) => {
      if (!showAmbient) return paint(colors.textDim, ch);
      const hex =
        intensity > 0.7 ? colors.accent : intensity > 0.4 ? colors.primary : colors.textMuted;
      return paint(hex, ch);
    },
    (line, kind) => {
      if (kind === 'flame') {
        return paint(premium ? colors.warning : colors.glow, line);
      }
      return paint(premium ? colors.glow : colors.primary, line);
    },
  );

  // --- Layer 8: moonlight path across the water ---
  if (showAmbient && riverHeight >= 2) {
    paintMoonlightPath(
      canvas,
      riverTop,
      riverHeight,
      width,
      elapsedMs,
      (ch) => paint(premium ? colors.glow : colors.primary, ch),
    );
  }
}
