/**
 * Standalone install theatre (no chalk / app deps).
 * Emits __LIORA_UPGRADE_STAGE__= markers for Upgrade Studio / observed-install.
 */

import { clearLine, cursorTo, moveCursor } from 'node:readline';

import { STAGE_MARKER_PREFIX } from './platform.mjs';

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

const STAGE_LABEL = {
  checking: 'Checking',
  bootstrapping: 'Bootstrapping',
  fetching: 'Fetching',
  downloading: 'Downloading',
  building: 'Building',
  installing: 'Installing',
  sidecars: 'Sidecars',
  done: 'Done',
  failed: 'Failed',
};

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

const CSI = '\u001b[';
const HIDE_CURSOR = `${CSI}?25l`;
const SHOW_CURSOR = `${CSI}?25h`;

export function useColor() {
  if (!process.stdout.isTTY) return false;
  const nc = process.env.NO_COLOR;
  if (nc !== undefined && nc !== '' && nc !== '0' && nc.toLowerCase() !== 'false' && nc.toLowerCase() !== 'off') {
    return false;
  }
  return true;
}

export function createTheatre(options = {}) {
  const mode = options.mode === 'source' ? 'source' : 'prebuilt';
  const title = options.title ?? 'Installing SuperLiora';
  const startedAtMs = Date.now();
  let stage = /** @type {InstallStage} */ ('checking');
  let detail = '';
  let renderedLines = 0;
  let interval = null;

  const pipeline = mode === 'source' ? SOURCE_PIPELINE : PREBUILT_PIPELINE;

  function emitMarker(next) {
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
      if (detail) {
        process.stdout.write(`==> ${STAGE_LABEL[stage] ?? stage}: ${detail}\n`);
      } else {
        process.stdout.write(`==> ${STAGE_LABEL[stage] ?? stage}\n`);
      }
      return;
    }

    erase();
    const lines = renderLines({
      title,
      mode: options.mode === 'source' ? 'source' : 'prebuilt',
      stage,
      detail,
      startedAtMs,
      pipeline: options.mode === 'source' ? SOURCE_PIPELINE : PREBUILT_PIPELINE,
    });
    process.stdout.write(HIDE_CURSOR);
    process.stdout.write(`${lines.join('\n')}\n`);
    renderedLines = lines.length;
  }

  function erase() {
    if (!useColor() || renderedLines <= 0) return;
    for (let i = 0; i < renderedLines; i += 1) {
      moveCursor(process.stdout, 0, -1);
      clearLine(process.stdout, 0);
      cursorTo(process.stdout, 0);
    }
    renderedLines = 0;
  }

  function startPulse() {
    if (!useColor() || interval) return;
    interval = setInterval(() => paint(), 120);
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
    if (ok) {
      stage = 'done';
      detail = message ?? 'Ready';
      emitMarker('done');
    } else {
      stage = 'failed';
      detail = message ?? 'Failed';
      emitMarker('failed');
    }
    if (useColor()) {
      erase();
      const lines = renderLines({
        title,
        mode: options.mode === 'source' ? 'source' : 'prebuilt',
        stage,
        detail,
        startedAtMs,
        pipeline: options.mode === 'source' ? SOURCE_PIPELINE : PREBUILT_PIPELINE,
      });
      process.stdout.write(`${lines.join('\n')}\n`);
      process.stdout.write(SHOW_CURSOR);
    } else {
      process.stdout.write(`${ok ? '[ok]' : '[fail]'} ${detail}\n`);
    }
  }

  function note(message) {
    if (useColor()) {
      erase();
      process.stdout.write(`  \u001b[33m!\u001b[0m ${message}\n`);
      renderedLines = 0;
      paint();
    } else {
      process.stdout.write(`warning: ${message}\n`);
    }
  }

  // silence unused
  void pipeline;

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
  const fraction = stageFraction(frame.stage);
  const pct = `${String(Math.round(fraction * 100)).padStart(3, ' ')}%`;
  const bar = renderBar(fraction, 28, Date.now());
  const elapsed = Math.max(0, (Date.now() - frame.startedAtMs) / 1000).toFixed(1);
  const checklist = formatChecklist(frame.pipeline, frame.stage);
  const cyan = (s) => `\u001b[36m${s}\u001b[0m`;
  const bold = (s) => `\u001b[1m${s}\u001b[0m`;
  const dim = (s) => `\u001b[2m${s}\u001b[0m`;
  const green = (s) => `\u001b[32m${s}\u001b[0m`;
  const red = (s) => `\u001b[31m${s}\u001b[0m`;
  const lines = [
    bold(cyan(frame.title)),
    dim(`Mode: ${frame.mode}  ·  ${elapsed}s`),
    '',
  ];
  for (const row of checklist) {
    const mark =
      row.marker === 'done'
        ? green('✓')
        : row.marker === 'failed'
          ? red('✗')
          : row.marker === 'active'
            ? cyan('●')
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
  lines.push(`${cyan(bar)} ${bold(pct)}`);
  if (frame.detail) lines.push(dim(frame.detail));
  return lines;
}

function stageFraction(stage) {
  if (stage === 'failed') return 0.4;
  return STAGE_FRACTION[stage] ?? 0;
}

function formatChecklist(pipeline, active) {
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
    return { stage, label: STAGE_LABEL[stage] ?? stage, marker };
  });
}

function renderBar(fraction, width, nowMs) {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  const pulse = Math.floor(nowMs / 120) % Math.max(1, filled || 1);
  let out = '[';
  for (let i = 0; i < width; i += 1) {
    if (i < filled) {
      out += i === pulse ? '▓' : '█';
    } else {
      out += '░';
    }
  }
  out += ']';
  return out;
}
