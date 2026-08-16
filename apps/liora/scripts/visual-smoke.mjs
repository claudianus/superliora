#!/usr/bin/env node
// Real-surface visual smoke (harness reform T3-5): spawn the built TUI under
// node-pty, drive a short input scenario, capture ANSI frames, and assert the
// live chrome actually renders. Snapshots land in .superliora/visual-smoke/
// so regressions can be diffed by hand.
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawn } from 'node-pty';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '..');
const repoRoot = join(appRoot, '..', '..');
const bundlePath = join(appRoot, 'dist', 'main.mjs');
const snapshotDir = join(repoRoot, '.superliora', 'visual-smoke');

const COLS = 120;
const ROWS = 32;
const SETTLE_MS = 4_000;
const STEP_MS = 600;
const STATUS_SETTLE_MS = 1_000;
const STRESS_STEP_MS = 35;
const STRESS_SETTLE_MS = 800;
const EXIT_GRACE_MS = 8_000;
const PROMPT_TEXT = 'hello visual smoke';
const WHEEL_UP = '\x1b[<64;60;15M';
const WHEEL_DOWN = '\x1b[<65;60;15M';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Child PTY env must not inherit the parent harness mute flags.
 * `NO_COLOR` / `FORCE_COLOR=0` / `TERM=dumb` silence chrome paint on Windows
 * ConPTY hosts; kitty/iTerm graphics probes dump `Gi=31,...` into the capture
 * unless `SUPERLIORA_IMAGE_PROTOCOL=none` short-circuits the boot probe.
 */
function buildChildEnv(home) {
  const env = { ...process.env };
  delete env.NO_COLOR;
  // Drop parent force-color so our pin below wins even when parent had `0`.
  delete env.FORCE_COLOR;
  if ((env.TERM ?? '').toLowerCase() === 'dumb') {
    delete env.TERM;
  }
  env.SUPERLIORA_HOME = home;
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.FORCE_COLOR = '1';
  env.SUPERLIORA_IMAGE_PROTOCOL = 'none';
  if (!env.LANG) env.LANG = 'C.UTF-8';
  if (!env.LC_ALL) env.LC_ALL = 'C.UTF-8';
  return env;
}

function stripAnsi(text) {
  return text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\u0007]*(\u0007|\x1b\\)/g, '')
    .replace(/\x1b[=>]/g, '');
}

function countOccurrences(text, needle) {
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(needle, offset)) !== -1) {
    count++;
    offset += needle.length;
  }
  return count;
}

function countEraseDisplays(text) {
  return (
    countOccurrences(text, '\x1b[2J') +
    countOccurrences(text, '\x1b[3J') +
    countOccurrences(text, '\x1b[0J')
  );
}

function inspectSynchronizedFrames(text) {
  const begin = '\x1b[?2026h';
  const end = '\x1b[?2026l';
  const bodies = [];
  let outside = '';
  let offset = 0;

  while (offset < text.length) {
    const beginOffset = text.indexOf(begin, offset);
    if (beginOffset === -1) {
      outside += text.slice(offset);
      break;
    }
    outside += text.slice(offset, beginOffset);
    const bodyOffset = beginOffset + begin.length;
    const endOffset = text.indexOf(end, bodyOffset);
    if (endOffset === -1) {
      outside += text.slice(beginOffset);
      return { balanced: false, bodies, outside };
    }
    bodies.push(text.slice(bodyOffset, endOffset));
    offset = endOffset + end.length;
  }

  return { balanced: true, bodies, outside };
}

async function main() {
  try {
    await stat(bundlePath);
  } catch {
    console.error(`visual-smoke: missing bundle at ${bundlePath} — run "pnpm -C apps/liora run build" first`);
    process.exit(1);
  }

  const home = await mkdtemp(join(tmpdir(), 'visual-smoke-'));
  let frames = '';
  const pty = spawn(process.execPath, [bundlePath], {
    name: 'xterm-256color',
    cols: COLS,
    rows: ROWS,
    cwd: repoRoot,
    env: buildChildEnv(home),
  });
  pty.onData((chunk) => {
    frames += chunk;
  });
  const exited = new Promise((resolve) => {
    pty.onExit((event) => resolve(event));
  });

  // Let the initial screen paint, then create a real transcript surface.
  await sleep(SETTLE_MS);
  pty.write(PROMPT_TEXT);
  await sleep(STEP_MS);
  pty.write('\u0015'); // Ctrl-U: clear the editor before the local command.
  pty.write('/status\r');
  await sleep(STATUS_SETTLE_MS);

  // Mission Control dock: widen past the dock threshold, pin it, and let the
  // empty-state placeholder paint into the right band.
  pty.resize(160, 36);
  await sleep(STEP_MS);
  pty.write('/agents pinned\r');
  await sleep(STATUS_SETTLE_MS);

  // Exercise resize and high-rate SGR wheel input against the live PTY. The
  // stress segment excludes initial alternate-screen setup. Resize may erase
  // the display, but that erase must stay inside a synchronized redraw frame.
  const stressStart = frames.length;
  for (let index = 0; index < 12; index++) {
    const narrow = index % 2 === 0;
    pty.resize(narrow ? 96 : 132, narrow ? 27 : 36);
    pty.write((narrow ? WHEEL_DOWN : WHEEL_UP).repeat(8));
    await sleep(STRESS_STEP_MS);
  }
  await sleep(STRESS_SETTLE_MS);
  const stressFrames = frames.slice(stressStart);

  pty.write('\u0003'); // Ctrl-C: interrupt/cancel
  await sleep(STEP_MS);
  pty.write('\u0003'); // Ctrl-C again: exit
  await sleep(STEP_MS);
  pty.write('\u0003'); // some states need a third

  const exitEvent = await Promise.race([exited, sleep(EXIT_GRACE_MS).then(() => null)]);
  if (exitEvent === null) {
    try {
      pty.kill();
    } catch {
      // already gone
    }
  }
  await rm(home, { recursive: true, force: true });

  const plain = stripAnsi(frames);
  const stressSyncStarts = countOccurrences(stressFrames, '\x1b[?2026h');
  const stressSyncEnds = countOccurrences(stressFrames, '\x1b[?2026l');
  const stressEraseDisplays = countEraseDisplays(stressFrames);
  const stressInspection = inspectSynchronizedFrames(stressFrames);
  const outsideEraseDisplays = countEraseDisplays(stressInspection.outside);
  const eraseTransactions = stressInspection.bodies.filter((body) => countEraseDisplays(body) > 0);
  const eraseTransactionsWithRedraw = eraseTransactions.filter((body) =>
    /[!-~]/.test(stripAnsi(body)),
  );
  const checks = [
    ['rendered terminal chrome', plain.includes('Directory:') || plain.includes('SuperLiora')],
    ['echoed typed input', plain.includes(PROMPT_TEXT)],
    ['mission control dock renders when pinned', plain.includes('Mission Control')],
    ['substantial frame output', frames.length > 500],
    ['resize/wheel stress produced frames', stressFrames.length > 500 && stressSyncStarts > 0],
    ['stress synchronized frames are balanced', stressInspection.balanced && stressSyncStarts === stressSyncEnds],
    ['stress emitted no erase outside synchronized frame', outsideEraseDisplays === 0],
    ['stress erase transactions included a redraw', eraseTransactions.length === 0 || eraseTransactionsWithRedraw.length === eraseTransactions.length],
  ];

  await mkdir(snapshotDir, { recursive: true });
  await writeFile(join(snapshotDir, 'latest.ansi'), frames);
  await writeFile(join(snapshotDir, 'latest.txt'), plain);

  const failures = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  }
  console.log(
    `visual-smoke: stress frames=${String(stressSyncStarts)}, erase-display=${String(stressEraseDisplays)}, outside-erase=${String(outsideEraseDisplays)}, erase-tx=${String(eraseTransactions.length)}`,
  );
  console.log(`visual-smoke: snapshots at ${snapshotDir} (latest.ansi, latest.txt)`);
  if (exitEvent === null) {
    console.log('visual-smoke: WARN  TUI did not exit on Ctrl-C within the grace window (killed)');
  } else {
    console.log(`visual-smoke: exit code ${String(exitEvent.exitCode)}`);
  }
  if (failures.length > 0) {
    console.error(`visual-smoke: ${String(failures.length)} check(s) failed`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`visual-smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
