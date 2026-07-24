/**
 * Build a live post-splash morph scene: centered stage Welcome + Jewel Tank,
 * letterbox night sky, and stage frame — matching real TUI geometry.
 */

import chalk from 'chalk';

import { IdleStageComponent } from '#/tui/components/chrome/idle-stage';
import { WelcomeComponent } from '#/tui/components/chrome/welcome';
import { resolveStageLayout } from '#/tui/controllers/stage-layout';
import type { AppearancePreferences } from '#/tui/config';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import type { AppState } from '#/tui/types';
import { currentTheme } from '#/tui/theme';
import { padOrTrim } from '#/tui/utils/night-sky';
import {
  stageFrameBundleRect,
  stageFrameLetterboxBands,
  stageFrameStrokeCells,
} from '#/tui/utils/stage-frame';
import { paintStageLetterboxSky } from '#/tui/utils/stage-letterbox-sky';
import type { BrandMorphRect } from '#/tui/utils/splash-iris';

export interface SplashMorphScene {
  readonly lines: readonly string[];
  readonly stage: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Welcome hero (figlet) target inside the stage content. */
  readonly brandTarget: BrandMorphRect;
}


export function buildSplashMorphScene(options: {
  readonly width: number;
  readonly rows: number;
  readonly appState: AppState;
  readonly nowMs?: number;
  /** Pre-rendered header chrome lines (placed at stage content top). */
  readonly headerLines?: readonly string[];
  /** Pre-rendered footer chrome lines (placed at stage content bottom). */
  readonly footerLines?: readonly string[];
  /** Pre-rendered editor chrome lines (placed above footer). */
  readonly editorLines?: readonly string[];
}): SplashMorphScene {
  const width = Math.max(1, Math.trunc(options.width));
  const rows = Math.max(1, Math.trunc(options.rows));
  const layout = resolveStageLayout({
    width,
    height: rows,
  });
  const stage = layout.stage;
  const appearance: AppearancePreferences =
    options.appState.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
  const nowMs = options.nowMs ?? Date.now();

  const canvas: string[] = Array.from({ length: rows }, () => ' '.repeat(width));

  // Letterbox sky into absolute bands.
  const bundle = stageFrameBundleRect(layout);
  const bands = stageFrameLetterboxBands(bundle, width, rows);
  if (bands.length > 0) {
    const sky = paintStageLetterboxSky({
      bands,
      cols: width,
      rows,
      nowMs,
      appearance,
      freeze: false,
    });
    const particle = currentTheme.color('particle');
    const glow = currentTheme.color('glow');
    const muted = currentTheme.color('textMuted');
    for (const cell of sky) {
      if (cell.y < 0 || cell.y >= rows || cell.x < 0 || cell.x >= width) continue;
      const fg = cell.fg || (cell.bold ? glow : particle);
      const glyph = chalk.hex(fg)(cell.char);
      const line = canvas[cell.y] ?? ' '.repeat(width);
      canvas[cell.y] = spliceVisibleChar(line, width, cell.x, glyph);
    }
    // Soft veil on empty letterbox so it never reads as default-black voids.
    const veil = chalk.hex(muted)('·');
    for (const band of bands) {
      for (let y = band.y; y < band.y + band.height && y < rows; y++) {
        for (let x = band.x; x < band.x + band.width && x < width; x++) {
          // Only fill truly empty plain cells (sky already wrote glyphs).
          const plain = stripAnsi(canvas[y] ?? '');
          if ((plain[x] ?? ' ') !== ' ') continue;
          if ((hashCell(x, y) & 31) !== 0) continue;
          canvas[y] = spliceVisibleChar(canvas[y]!, width, x, veil);
        }
      }
    }
  }

  // Stage frame stroke (static — chase lives on the live TUI path).
  const stroke = stageFrameStrokeCells(bundle);
  const frameFg = chalk.hex(currentTheme.color('primary'));
  for (const cell of stroke) {
    if (cell.y < 0 || cell.y >= rows || cell.x < 0 || cell.x >= width) continue;
    canvas[cell.y] = spliceVisibleChar(
      canvas[cell.y]!,
      width,
      cell.x,
      frameFg(cell.char),
    );
  }

  // Welcome + Idle inside stage content width, with chrome reserves matching
  // the real native frame layout (header top, editor+footer bottom).
  const contentWidth = Math.max(1, stage.width);
  const headerLines = options.headerLines ?? [];
  const footerLines = options.footerLines ?? [];
  const editorLines = options.editorLines ?? [];
  const headerRows = headerLines.length;
  const footerRows = footerLines.length;
  const editorRows = editorLines.length;
  const chromeRows = headerRows + footerRows + editorRows;
  const contentBudget = Math.max(4, stage.height - chromeRows - 2);
  const contentTop = stage.y + 1 + headerRows;

  // Paint header chrome at stage content top.
  for (let i = 0; i < headerLines.length; i++) {
    const y = stage.y + 1 + i;
    if (y < 0 || y >= rows) continue;
    const src = padOrTrim(headerLines[i] ?? '', contentWidth);
    canvas[y] = replaceColumns(canvas[y]!, width, stage.x, src);
  }

  const welcome = new WelcomeComponent(options.appState).render(contentWidth);
  const used = welcome.length;
  const idleBudget = Math.max(0, contentBudget - used);
  const idle =
    idleBudget > 0
      ? new IdleStageComponent({
          state: options.appState,
          preferredRows: idleBudget,
        }).render(contentWidth)
      : [];
  const stacked = [...welcome, ...idle].slice(0, contentBudget);

  for (let i = 0; i < stacked.length; i++) {
    const y = contentTop + i;
    if (y < 0 || y >= rows) continue;
    const src = padOrTrim(stacked[i] ?? '', contentWidth);
    // Place stage content columns.
    canvas[y] = replaceColumns(canvas[y]!, width, stage.x, src);
  }

  // Paint editor + footer chrome at stage content bottom.
  const bottomStart = stage.y + stage.height - footerRows - editorRows;
  for (let i = 0; i < editorLines.length; i++) {
    const y = bottomStart + i;
    if (y < 0 || y >= rows) continue;
    const src = padOrTrim(editorLines[i] ?? '', contentWidth);
    canvas[y] = replaceColumns(canvas[y]!, width, stage.x, src);
  }
  for (let i = 0; i < footerLines.length; i++) {
    const y = bottomStart + editorRows + i;
    if (y < 0 || y >= rows) continue;
    const src = padOrTrim(footerLines[i] ?? '', contentWidth);
    canvas[y] = replaceColumns(canvas[y]!, width, stage.x, src);
  }

  // Welcome hero target: after outer '', frame top, particle rail → banner.
  // Empirically: blank + top border + rail ≈ 3 rows into Welcome render.
  const brandPadX = 3;
  const brandPadY = 3;
  const brandTarget: BrandMorphRect = {
    x: stage.x + brandPadX,
    y: contentTop + brandPadY,
    width: Math.max(8, contentWidth - 4),
  };

  return {
    lines: canvas.map((line) => padOrTrim(line, width)),
    stage,
    brandTarget,
  };
}

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function hashCell(x: number, y: number): number {
  return ((x * 73856093) ^ (y * 19349663)) >>> 0;
}

/** Replace a single visible column with an ANSI glyph (rest of line preserved as spaces). */
function spliceVisibleChar(line: string, width: number, x: number, glyph: string): string {
  const plain = padOrTrim(stripAnsi(line), width);
  const left = plain.slice(0, x);
  const right = plain.slice(x + 1);
  return padOrTrim(`${left}${glyph}${right}`, width);
}

/** Overlay a pre-styled stage content line into absolute columns. */
function replaceColumns(
  baseLine: string,
  width: number,
  x0: number,
  content: string,
): string {
  const plain = padOrTrim(stripAnsi(baseLine), width);
  const left = plain.slice(0, Math.max(0, x0));
  const right = plain.slice(Math.max(0, x0) + stripAnsi(content).length);
  return padOrTrim(`${left}${content}${right}`, width);
}
