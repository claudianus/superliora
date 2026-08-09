import { ANSI16_FG, NEON_NOIR } from './neon-noir';

export interface AnsiSpan {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

export interface AnsiLine {
  spans: AnsiSpan[];
}

interface Style {
  color?: string;
  bold: boolean;
  dim: boolean;
}

function cloneStyle(style: Style): Style {
  return { color: style.color, bold: style.bold, dim: style.dim };
}

function applySgr(style: Style, params: number[]): Style {
  const next = cloneStyle(style);
  if (params.length === 0) params = [0];
  let i = 0;
  while (i < params.length) {
    const code = params[i] ?? 0;
    if (code === 0) {
      next.color = undefined;
      next.bold = false;
      next.dim = false;
      i += 1;
      continue;
    }
    if (code === 1) {
      next.bold = true;
      i += 1;
      continue;
    }
    if (code === 2) {
      next.dim = true;
      i += 1;
      continue;
    }
    if (code === 22) {
      next.bold = false;
      next.dim = false;
      i += 1;
      continue;
    }
    if (code === 39) {
      next.color = undefined;
      i += 1;
      continue;
    }
    if (code === 38) {
      const mode = params[i + 1];
      if (mode === 2 && params.length >= i + 5) {
        const r = params[i + 2] ?? 0;
        const g = params[i + 3] ?? 0;
        const b = params[i + 4] ?? 0;
        next.color = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
        i += 5;
        continue;
      }
      if (mode === 5 && params.length >= i + 3) {
        // Map common 256 palette slots toward Neon Noir accents.
        const idx = params[i + 2] ?? 0;
        if (idx === 51 || idx === 45 || idx === 39) next.color = NEON_NOIR.primary;
        else if (idx === 141 || idx === 135) next.color = NEON_NOIR.accent;
        else if (idx === 114 || idx === 78) next.color = NEON_NOIR.success;
        else if (idx === 203 || idx === 196) next.color = NEON_NOIR.error;
        else if (idx === 220 || idx === 214) next.color = NEON_NOIR.warning;
        else next.color = NEON_NOIR.textDim;
        i += 3;
        continue;
      }
      i += 1;
      continue;
    }
    if (ANSI16_FG[code]) {
      next.color = ANSI16_FG[code];
      i += 1;
      continue;
    }
    i += 1;
  }
  return next;
}

function pushSpan(spans: AnsiSpan[], text: string, style: Style) {
  if (!text) return;
  const last = spans[spans.length - 1];
  if (
    last &&
    last.color === style.color &&
    last.bold === style.bold &&
    last.dim === style.dim
  ) {
    last.text += text;
    return;
  }
  spans.push({
    text,
    color: style.color,
    bold: style.bold || undefined,
    dim: style.dim || undefined,
  });
}

/** Parse a single-frame ANSI dump into display lines (ignores cursor / OSC / sync). */
export function parseAnsiFrame(input: string): AnsiLine[] {
  const cleaned = input
    .replace(/\x1b\[\?2026[hl]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const lines: AnsiLine[] = [];
  let spans: AnsiSpan[] = [];
  let style: Style = { bold: false, dim: false };
  let i = 0;

  const flushLine = () => {
    lines.push({ spans });
    spans = [];
  };

  while (i < cleaned.length) {
    const ch = cleaned[i]!;
    if (ch === '\n') {
      flushLine();
      i += 1;
      continue;
    }
    if (ch === '\x1b') {
      const next = cleaned[i + 1];
      if (next === '[') {
        const end = cleaned.indexOf('m', i + 2);
        if (end !== -1) {
          const body = cleaned.slice(i + 2, end);
          const params = body
            .split(';')
            .filter(Boolean)
            .map((part) => Number.parseInt(part, 10))
            .filter((n) => !Number.isNaN(n));
          // Only SGR (`m`) affects paint; skip other CSI by consuming to letter.
          style = applySgr(style, params);
          i = end + 1;
          continue;
        }
      }
      // Skip unknown ESC sequences conservatively.
      i += 2;
      continue;
    }
    // Gather run of plain text
    let j = i + 1;
    while (j < cleaned.length && cleaned[j] !== '\n' && cleaned[j] !== '\x1b') j += 1;
    pushSpan(spans, cleaned.slice(i, j), style);
    i = j;
  }
  if (spans.length > 0 || lines.length === 0) flushLine();
  // Drop trailing empty lines for tighter stage
  while (lines.length > 1) {
    const last = lines[lines.length - 1];
    if (last && last.spans.every((s) => s.text.trim() === '')) lines.pop();
    else break;
  }
  return lines;
}
