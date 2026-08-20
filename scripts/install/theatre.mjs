/**
 * Standalone install theatre (no chalk / app deps).
 *
 * Emits __LIORA_UPGRADE_STAGE__= markers for Upgrade Studio / observed-install
 * only in plain (piped / NO_COLOR) mode; on a live TTY the markers would both
 * clutter the screen and desync the in-place repaint. Frame painting clips
 * every line below the terminal width so soft-wrap can never corrupt the
 * cursor math, and erases leftovers from taller frames with erase-down.
 */

import { STAGE_MARKER_PREFIX } from './platform.mjs';
import { detectInstallLocale } from './locale.mjs';
import { t } from './strings.mjs';

/** @typedef {'checking'|'bootstrapping'|'fetching'|'downloading'|'building'|'installing'|'sidecars'|'done'|'failed'} InstallStage */

const STAGE_FRACTION = {
  checking: 0.04,
  bootstrapping: 0.1,
  fetching: 0.22,
  downloading: 0.28,
  building: 0.55,
  installing: 0.75,
  sidecars: 0.9,
  done: 1,
};

function stageLabel(stage, locale) {
  return t(`install.stage.${stage}`, undefined, locale);
}

const PREBUILT_PIPELINE = [
  'checking',
  'bootstrapping',
  'downloading',
  'installing',
  'sidecars',
  'done',
];

const SOURCE_PIPELINE = [
  'checking',
  'bootstrapping',
  'fetching',
  'building',
  'installing',
  'sidecars',
  'done',
];

const ESC = '\u001B';
const CSI = `${ESC}[`;
const HIDE_CURSOR = `${CSI}?25l`;
const SHOW_CURSOR = `${CSI}?25h`;
const ERASE_DOWN = `${CSI}0J`;
const RESET = `${CSI}0m`;

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const BAR_WIDTH = 28;
const GRADIENT_FROM = '#3D9BFF';
const GRADIENT_TO = '#2DD4BF';

export function useColor() {
  if (!process.stdout.isTTY) return false;
  const nc = process.env.NO_COLOR;
  if (nc !== undefined && nc !== '' && nc !== '0' && nc.toLowerCase() !== 'false' && nc.toLowerCase() !== 'off') {
    return false;
  }
  return true;
}

function supportsTruecolor() {
  const colorterm = (process.env.COLORTERM ?? '').toLowerCase();
  return colorterm.includes('truecolor') || colorterm.includes('24bit');
}

function terminalColumns() {
  const columns = process.stdout.columns;
  if (typeof columns === 'number' && Number.isFinite(columns) && columns >= 20) {
    return Math.floor(columns);
  }
  return 80;
}

function isWideCodePoint(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function charWidth(char) {
  const cp = char.codePointAt(0) ?? 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  return isWideCodePoint(cp) ? 2 : 1;
}

function ansiSequenceEnd(text, start) {
  const next = text[start + 1];
  if (next === '[') {
    let i = start + 2;
    while (i < text.length) {
      const code = text.codePointAt(i) ?? 0;
      if (code >= 0x40 && code <= 0x7e) return i + 1;
      i += 1;
    }
    return text.length;
  }
  if (next === ']') {
    let i = start + 2;
    while (i < text.length) {
      if (text[i] === '\u0007') return i + 1;
      if (text[i] === ESC && text[i + 1] === '\\') return i + 2;
      i += 1;
    }
    return text.length;
  }
  return Math.min(text.length, start + 2);
}

function* scanAnsi(text) {
  let i = 0;
  while (i < text.length) {
    if (text[i] === ESC) {
      const end = ansiSequenceEnd(text, i);
      yield { kind: 'control', text: text.slice(i, end) };
      i = end;
      continue;
    }
    const cp = text.codePointAt(i) ?? 0;
    const char = String.fromCodePoint(cp);
    yield { kind: 'text', text: char };
    i += char.length;
  }
}

export function displayWidth(text) {
  let width = 0;
  for (const segment of scanAnsi(text)) {
    if (segment.kind === 'text') width += charWidth(segment.text);
  }
  return width;
}

export function clipAnsiLine(text, maxWidth) {
  if (maxWidth <= 0) return '';
  if (displayWidth(text) <= maxWidth) return text;
  let out = '';
  let width = 0;
  const budget = Math.max(0, maxWidth - 1);
  for (const segment of scanAnsi(text)) {
    if (segment.kind === 'control') {
      out += segment.text;
      continue;
    }
    const w = charWidth(segment.text);
    if (width + w > budget) break;
    out += segment.text;
    width += w;
  }
  return `${out}${RESET}…`;
}

function parseHex(hex) {
  const value = hex.startsWith('#') ? hex.slice(1) : hex;
  if (value.length !== 6) return undefined;
  const num = Number.parseInt(value, 16);
  if (!Number.isFinite(num)) return undefined;
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

function mixHex(from, to, ratio) {
  const a = parseHex(from);
  const b = parseHex(to);
  if (a === undefined || b === undefined) return ratio < 0.5 ? from : to;
  const clamped = Math.min(1, Math.max(0, ratio));
  const mix = (x, y) => Math.round(x + (y - x) * clamped);
  return { r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b) };
}

function fgTruecolor(rgb) {
  return `${CSI}38;2;${rgb.r};${rgb.g};${rgb.b}m`;
}

export function createTheatre(options = {}) {
  const locale = options.locale ?? detectInstallLocale(options.env ?? process.env);
  const title = options.title ?? t('install.title', undefined, locale);
  const startedAtMs = Date.now();
  let stage = /** @type {InstallStage} */ ('checking');
  let detail = '';
  let renderedRows = 0;
  let interval = null;

  function currentMode() {
    return options.mode === 'source' ? 'source' : 'prebuilt';
  }

  function emitMarker(next) {
    if (useColor()) return;
    process.stdout.write(`${STAGE_MARKER_PREFIX}${next}\n`);
  }

  function setMode(nextMode) {
    options.mode = nextMode === 'source' ? 'source' : 'prebuilt';
  }

  function setStage(next, nextDetail = '') {
    stage = next;
    detail = nextDetail;
    emitMarker(next);
    paint();
  }

  function setDetail(nextDetail) {
    detail = nextDetail;
    paint();
  }

  function paint() {
    if (!useColor()) {
      const label = stageLabel(stage, locale);
      if (detail) {
        process.stdout.write(`==> ${label}: ${detail}\n`);
      } else {
        process.stdout.write(`==> ${label}\n`);
      }
      return;
    }

    const maxWidth = terminalColumns() - 1;
    const lines = renderLines({
      title,
      mode: currentMode(),
      stage,
      detail,
      startedAtMs,
      locale,
      pipeline: currentMode() === 'source' ? SOURCE_PIPELINE : PREBUILT_PIPELINE,
    }).map((line) => clipAnsiLine(line, maxWidth));

    let chunk = HIDE_CURSOR;
    if (renderedRows > 1) chunk += `${CSI}${renderedRows - 1}A`;
    chunk += `\r${ERASE_DOWN}${lines.join('\n')}`;
    process.stdout.write(chunk);
    renderedRows = lines.length;
  }

  function erase() {
    if (!useColor() || renderedRows <= 0) return;
    let chunk = renderedRows > 1 ? `${CSI}${renderedRows - 1}A` : '';
    chunk += `\r${ERASE_DOWN}`;
    process.stdout.write(chunk);
    renderedRows = 0;
  }

  function startPulse() {
    if (!useColor() || interval) return;
    interval = setInterval(() => {
      paint();
    }, 120);
    if (typeof interval.unref === 'function') interval.unref();
  }

  function stopPulse() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  function finish(ok, message) {
    stopPulse();
    stage = ok ? 'done' : 'failed';
    detail = message ?? (ok ? t('install.ready', undefined, locale) : t('install.failed', undefined, locale));
    emitMarker(stage);
    if (useColor()) {
      paint();
      process.stdout.write(`\n${SHOW_CURSOR}`);
      renderedRows = 0;
    } else {
      process.stdout.write(`${ok ? '[ok]' : '[fail]'} ${detail}\n`);
    }
  }

  function note(message) {
    if (useColor()) {
      erase();
      const clipped = clipAnsiLine(`  ${CSI}33m!${RESET} ${message}`, terminalColumns() - 1);
      process.stdout.write(`${clipped}\n`);
      paint();
    } else {
      process.stdout.write(`${t('install.warning', { message }, locale)}\n`);
    }
  }

  return {
    setMode,
    setStage,
    setDetail,
    startPulse,
    stopPulse,
    finish,
    note,
    get stage() {
      return stage;
    },
  };
}

export function renderLines(frame) {
  const now = Date.now();
  const fraction = stageFraction(frame.stage);
  const pct = `${String(Math.round(fraction * 100)).padStart(3, ' ')}%`;
  const bar = renderBar(fraction, BAR_WIDTH, now, frame.stage !== 'done' && frame.stage !== 'failed');
  const elapsed = Math.max(0, (now - frame.startedAtMs) / 1000).toFixed(1);
  const locale = frame.locale ?? 'en';
  const checklist = formatChecklist(frame.pipeline, frame.stage, locale);
  const cyan = (s) => `${CSI}36m${s}${RESET}`;
  const bold = (s) => `${CSI}1m${s}${RESET}`;
  const dim = (s) => `${CSI}2m${s}${RESET}`;
  const green = (s) => `${CSI}32m${s}${RESET}`;
  const red = (s) => `${CSI}31m${s}${RESET}`;
  const spinner = SPINNER_FRAMES[Math.floor(now / 80) % SPINNER_FRAMES.length];
  const lines = [
    `${cyan('◆')} ${renderTitle(frame.title)}`,
    dim(t('install.modeLine', { mode: frame.mode, elapsed }, locale)),
    '',
  ];
  for (const row of checklist) {
    const mark =
      row.marker === 'done'
        ? green('✓')
        : row.marker === 'failed'
          ? red('✗')
          : row.marker === 'active'
            ? cyan(spinner)
            : dim('·');
    const label =
      row.marker === 'active'
        ? bold(cyan(row.label))
        : row.marker === 'done'
          ? green(row.label)
          : row.marker === 'failed'
            ? bold(red(row.label))
            : dim(row.label);
    lines.push(` ${mark} ${label}`);
  }
  lines.push('');
  lines.push(`${bar} ${bold(pct)}`);
  if (frame.detail) lines.push(dim(frame.detail));
  return lines;
}

function renderTitle(title) {
  if (!supportsTruecolor()) return `${CSI}1m${CSI}36m${title}${RESET}`;
  const chars = [...title];
  const denominator = Math.max(1, chars.length - 1);
  let out = `${CSI}1m`;
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    if (char === ' ') {
      out += char;
      continue;
    }
    out += `${fgTruecolor(mixHex(GRADIENT_FROM, GRADIENT_TO, i / denominator))}${char}`;
  }
  return `${out}${RESET}`;
}

function stageFraction(stage) {
  if (stage === 'failed') return 0.4;
  return STAGE_FRACTION[stage] ?? 0;
}

function formatChecklist(pipeline, active, locale = 'en') {
  const failed = active === 'failed';
  let activeIndex = pipeline.indexOf(active);
  if (activeIndex < 0) {
    if (active === 'fetching') activeIndex = pipeline.indexOf('downloading');
    if (active === 'downloading') activeIndex = pipeline.indexOf('fetching');
    if (activeIndex < 0) activeIndex = failed ? pipeline.indexOf('installing') : 0;
  }
  return pipeline.map((stage, index) => {
    let marker = 'pending';
    if (failed) {
      if (index < activeIndex) marker = 'done';
      else if (index === activeIndex || (activeIndex < 0 && index === pipeline.length - 2)) marker = 'failed';
    } else if (stage === 'done' && active === 'done') {
      marker = 'done';
    } else if (index < activeIndex) {
      marker = 'done';
    } else if (index === activeIndex) {
      marker = active === 'done' ? 'done' : 'active';
    }
    return { stage, label: stageLabel(stage, locale), marker };
  });
}

function renderBar(fraction, width, nowMs, active) {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  const truecolor = supportsTruecolor();
  const shimmer = active && filled > 0 ? Math.floor(nowMs / 90) % filled : -1;
  let out = `${CSI}2m[${RESET}`;
  for (let i = 0; i < width; i += 1) {
    if (i < filled) {
      if (truecolor) {
        const ratio = width <= 1 ? 0 : i / (width - 1);
        let rgb = mixHex(GRADIENT_FROM, GRADIENT_TO, ratio);
        if (i === shimmer) rgb = mixHex(rgbToHex(rgb), '#F5F5F5', 0.7);
        out += `${fgTruecolor(rgb)}█${RESET}`;
      } else {
        out += i === shimmer ? `${CSI}96m▓${RESET}` : `${CSI}36m█${RESET}`;
      }
    } else {
      out += `${CSI}2m░${RESET}`;
    }
  }
  out += `${CSI}2m]${RESET}`;
  return out;
}

function rgbToHex(rgb) {
  const part = (value) => value.toString(16).padStart(2, '0');
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}
