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
const EXIT_GRACE_MS = 8_000;
const PROMPT_TEXT = 'hello visual smoke';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stripAnsi(text) {
  return text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\u0007]*(\u0007|\x1b\\)/g, '')
    .replace(/\x1b[=>]/g, '');
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
    env: {
      ...process.env,
      SUPERLIORA_HOME: home,
      TERM: 'xterm-256color',
      FORCE_COLOR: '1',
    },
  });
  pty.onData((chunk) => {
    frames += chunk;
  });
  const exited = new Promise((resolve) => {
    pty.onExit((event) => resolve(event));
  });

  // Let the initial screen paint, then drive a minimal scenario.
  await sleep(SETTLE_MS);
  pty.write(PROMPT_TEXT);
  await sleep(STEP_MS);
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
  const checks = [
    ['rendered terminal chrome', plain.includes('Directory:') || plain.includes('SuperLiora')],
    ['echoed typed input', plain.includes(PROMPT_TEXT)],
    ['substantial frame output', frames.length > 500],
  ];

  await mkdir(snapshotDir, { recursive: true });
  await writeFile(join(snapshotDir, 'latest.ansi'), frames);
  await writeFile(join(snapshotDir, 'latest.txt'), plain);

  const failures = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  }
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
