import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyEditorChromeChase,
  editorChromePerimeterIndex,
} from '#/tui/components/editor/editor-chrome-motion';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
  setAppearanceTransportStability,
} from '#/tui/features/appearance/appearance-effects';
import { currentTheme, darkColors } from '#/tui/theme';
import type { RendererCell, RendererRegionLine } from '#/tui/renderer';

const MOTION_ENV_KEYS = ['TERM', 'NO_COLOR', 'SSH_TTY', 'SSH_CONNECTION', 'SSH_CLIENT'] as const;

const off = { ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' as const };
const premium = {
  ...DEFAULT_APPEARANCE_PREFERENCES,
  profile: 'premium' as const,
  particles: 'premium' as const,
};

const BORDER_FG = '#4a6fa5';
const INNER_FG = '#d8dee9';

function cell(char: string, fg: string): RendererCell {
  return { char, style: { fg } };
}

function closedBox(width: number, height: number): RendererCell[][] {
  const lines: RendererCell[][] = [];
  for (let y = 0; y < height; y++) {
    const row: RendererCell[] = [];
    for (let x = 0; x < width; x++) {
      let char = ' ';
      let fg = INNER_FG;
      if (y === 0 && x === 0) char = '╭';
      else if (y === 0 && x === width - 1) char = '╮';
      else if (y === height - 1 && x === 0) char = '╰';
      else if (y === height - 1 && x === width - 1) char = '╯';
      else if (y === 0 || y === height - 1) char = '─';
      else if (x === 0 || x === width - 1) char = '│';
      else if (y === 1 && x === 2) char = '>';
      else if (y === 1 && x === 4) char = 'h';
      if (char !== ' ' && char !== '>' && char !== 'h') fg = BORDER_FG;
      row.push(cell(char, fg));
    }
    lines.push(row);
  }
  return lines;
}

function glyphs(lines: readonly RendererRegionLine[]): string[] {
  return lines.map((line) =>
    typeof line === 'string' ? line : line.map((c) => c.char).join(''),
  );
}

function borderHexes(lines: readonly RendererRegionLine[]): string[] {
  const hexes: string[] = [];
  for (let y = 0; y < lines.length; y++) {
    const line = lines[y];
    if (line === undefined || typeof line === 'string') continue;
    for (let x = 0; x < line.length; x++) {
      const s = editorChromePerimeterIndex(x, y, line.length, lines.length);
      if (s === undefined) continue;
      const fg = line[x]?.style?.fg;
      if (fg !== undefined) hexes.push(fg);
    }
  }
  return hexes;
}

function restoreRunnerMotionEnv(): void {
  // Do not snapshot process.env at module load. A sibling file in this worker
  // may already have leaked TERM=dumb / NO_COLOR; restoring that snapshot would
  // hand the leak to later files (thinking / progress / chrome-band).
  for (const key of MOTION_ENV_KEYS) delete process.env[key];
  process.env['CI'] = process.env['GITHUB_ACTIONS'] ?? process.env['CI'] ?? 'true';
}

function resetAppearanceForTests(): void {
  currentTheme.setPalette(darkColors);
  setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  setAppearanceRenderHealth('healthy');
  setAppearanceRenderQuality('full');
  setAppearanceTransportStability('synchronized');
}

beforeEach(() => {
  resetAppearanceForTests();
});

afterEach(() => {
  resetAppearanceForTests();
  restoreRunnerMotionEnv();
});

describe('editorChromePerimeterIndex', () => {
  it('walks clockwise from the top-left corner', () => {
    expect(editorChromePerimeterIndex(0, 0, 8, 3)).toBe(0);
    expect(editorChromePerimeterIndex(7, 0, 8, 3)).toBe(7);
    expect(editorChromePerimeterIndex(7, 1, 8, 3)).toBe(8);
    expect(editorChromePerimeterIndex(7, 2, 8, 3)).toBe(9);
    expect(editorChromePerimeterIndex(0, 2, 8, 3)).toBe(16);
    expect(editorChromePerimeterIndex(0, 1, 8, 3)).toBe(17);
    expect(editorChromePerimeterIndex(3, 1, 8, 3)).toBeUndefined();
  });
});

describe('applyEditorChromeChase', () => {
  it('returns the same lines when ambient is off', () => {
    const box = closedBox(12, 3);
    const out = applyEditorChromeChase(box, { appearance: off, nowMs: 800, animated: false });
    expect(out).toBe(box);
    expect(glyphs(out)).toEqual(glyphs(box));
  });

  it('leaves prompt and input cells on their original color', () => {
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    const box = closedBox(12, 3);
    const out = applyEditorChromeChase(box, {
      appearance: premium,
      nowMs: 400,
      animated: true,
    });
    const row = out[1];
    if (row === undefined || typeof row === 'string') throw new Error('expected cells');
    expect(row[2]?.char).toBe('>');
    expect(row[2]?.style?.fg).toBe(INNER_FG);
    expect(row[4]?.char).toBe('h');
    expect(row[4]?.style?.fg).toBe(INNER_FG);
    expect(glyphs(out)).toEqual(glyphs(box));
  });

  it('keeps the chase moving on an unstable transport under premium prefs', () => {
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    setAppearanceTransportStability('unstable');
    setActiveAppearancePreferences(premium);
    const box = closedBox(16, 4);
    const first = applyEditorChromeChase(box, { appearance: premium, nowMs: 200 });
    const second = applyEditorChromeChase(box, { appearance: premium, nowMs: 200 + 280 });
    expect(borderHexes(first).join(',')).not.toBe(borderHexes(second).join(','));
  });

  it('paints a multi-cell trail that moves on the shared clock', () => {
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    const box = closedBox(16, 4);
    const first = applyEditorChromeChase(box, {
      appearance: premium,
      nowMs: 200,
      animated: true,
    });
    const second = applyEditorChromeChase(box, {
      appearance: premium,
      nowMs: 200 + 280,
      animated: true,
    });
    expect(glyphs(first)).toEqual(glyphs(box));
    expect(glyphs(second)).toEqual(glyphs(box));
    const firstHex = new Set(borderHexes(first));
    const secondHex = new Set(borderHexes(second));
    expect(firstHex.size).toBeGreaterThanOrEqual(4);
    expect(borderHexes(first).join(',')).not.toBe(borderHexes(second).join(','));
    expect(secondHex.size).toBeGreaterThanOrEqual(4);
  });

  it('passes string rows through unchanged', () => {
    const lines = ['╭────╮', '│ hi │', '╰────╯'];
    expect(applyEditorChromeChase(lines, { animated: true, nowMs: 50 })).toBe(lines);
  });

  it('leaves an inner scrollbar rail on its original color', () => {
    const box = closedBox(12, 3);
    box[1]![10] = cell('│', INNER_FG);
    const out = applyEditorChromeChase(box, {
      appearance: premium,
      nowMs: 120,
      animated: true,
    });
    const row = out[1];
    if (row === undefined || typeof row === 'string') throw new Error('expected cells');
    expect(row[10]?.char).toBe('│');
    expect(row[10]?.style?.fg).toBe(INNER_FG);
    expect(row[11]?.char).toBe('│');
    expect(row[11]?.style?.fg).not.toBe(INNER_FG);
  });
});
