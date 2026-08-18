#!/usr/bin/env node
// Launch the source TUI/harness with a strict debug env. Never the installed SEA.
//
// Usage:
//   node scripts/debug-local.mjs                 # interactive source TUI
//   node scripts/debug-local.mjs -- -p "…"       # headless harness prompt
//   node scripts/debug-local.mjs --env           # print the debug env and exit
//   node scripts/debug-local.mjs --self-check    # assert env decisions
//   node scripts/debug-local.mjs --ephemeral     # tmpdir SUPERLIORA_HOME
//   node scripts/debug-local.mjs --home real     # operator ~/.superliora (dangerous)
//   node scripts/debug-local.mjs --no-keys       # chrome-only; strip provider keys
//   node scripts/debug-local.mjs --cli-only      # skip isolated marketplace server
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildDebugEnv,
  formatDebugEnvReport,
  selfCheckDebugEnv,
} from './debug-local-env.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_SCRIPT = join(repoRoot, 'apps/liora/scripts/dev.mjs');
const DEV_CLI_ONLY_SCRIPT = join(repoRoot, 'apps/liora/scripts/dev-cli-only.mjs');

function printHelp() {
  console.log(`debug-local — source TUI/harness with analysis on (not installed liora.exe)

Usage:
  node scripts/debug-local.mjs [options] [-- <cli args>]

Options:
  --env           print the debug env and exit
  --self-check    assert env decisions
  --ephemeral     tmpdir SUPERLIORA_HOME (deleted with the OS temp dir)
  --home real     use the operator SUPERLIORA_HOME / ~/.superliora (writes real state)
  --no-keys       strip provider keys (chrome / layout only)
  --cli-only      skip the isolated plugin marketplace server
  --help          this text

Examples:
  node scripts/debug-local.mjs
  node scripts/debug-local.mjs -- -p "say hello"
  pnpm run debug:cli -- --cli-only
`);
}

function parseArgs(argv) {
  const local = new Set();
  const forwarded = [];
  let homeMode = 'isolated';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      forwarded.push(...argv.slice(i + 1));
      break;
    }
    if (
      arg === '--env' ||
      arg === '--self-check' ||
      arg === '--help' ||
      arg === '-h' ||
      arg === '--ephemeral' ||
      arg === '--no-keys' ||
      arg === '--cli-only'
    ) {
      local.add(arg);
      continue;
    }
    if (arg === '--home') {
      const value = argv[i + 1];
      if (value !== 'real') {
        console.error('debug-local: --home accepts only "real"');
        process.exit(2);
      }
      homeMode = 'real';
      i += 1;
      continue;
    }
    forwarded.push(arg);
  }
  if (local.has('--ephemeral') && homeMode === 'real') {
    console.error('debug-local: --ephemeral and --home real cannot be combined');
    process.exit(2);
  }
  return { local, forwarded, homeMode };
}

function selfCheck() {
  let failed = 0;
  let total = 0;
  selfCheckDebugEnv((name, ok, detail) => {
    total += 1;
    if (!ok) {
      failed += 1;
      console.error(`self-check FAIL ${name}${detail === undefined ? '' : `: ${detail}`}`);
    }
  });
  console.log(failed === 0 ? `self-check OK (${String(total)} cases)` : `self-check FAILED (${String(failed)})`);
  process.exit(failed === 0 ? 0 : 1);
}

function warnNodeVersion() {
  try {
    const expected = readFileSync(join(repoRoot, '.nvmrc'), 'utf8').trim();
    const actualMajor = process.versions.node.split('.')[0];
    const expectedMajor = expected.split('.')[0];
    if (actualMajor !== expectedMajor) {
      console.error(
        `debug-local: Node ${process.versions.node} (expected ${expected} from .nvmrc). Motion/runtime may differ.`,
      );
    }
  } catch {
    // Banner must never fail the launch.
  }
}

function printBanner(built, forwarded) {
  const ssh =
    (built.env.SSH_TTY ?? '').length > 0 ||
    (built.env.SSH_CONNECTION ?? '').length > 0 ||
    (built.env.SSH_CLIENT ?? '').length > 0;
  console.error('debug-local: source TUI/harness (tsx) — not installed liora.exe');
  console.error(`  SUPERLIORA_HOME=${built.home} (${built.homeMode})`);
  console.error(`  SUPERLIORA_DEBUG_LOG=${built.debugLog}`);
  console.error(
    ssh
      ? '  motion: off (SSH_* present — same as a remote user session)'
      : `  motion: on (CI/NO_COLOR unset; TERM=${built.env.TERM}${built.termUpgraded ? ', upgraded from dumb/empty' : ''})`,
  );
  console.error(
    '  analysis: SUPERLIORA_DEBUG=1 · renderer trace · scroll probe · stdio persist · log=debug',
  );
  if (!process.stdin.isTTY && !forwarded.includes('-p') && !forwarded.includes('--prompt')) {
    console.error(
      'debug-local: stdin is not a TTY. Run this from a real terminal to judge layout/motion.',
    );
  }
}

const argv = process.argv.slice(2);
const { local, forwarded, homeMode } = parseArgs(argv);
if (local.has('--help') || local.has('-h')) {
  printHelp();
  process.exit(0);
}
if (local.has('--self-check')) selfCheck();

const ephemeralHomeDir =
  homeMode === 'ephemeral' || local.has('--ephemeral')
    ? mkdtempSync(join(tmpdir(), 'superliora-debug-home-'))
    : undefined;
const resolvedHomeMode = ephemeralHomeDir === undefined ? homeMode : 'ephemeral';
const built = buildDebugEnv(process.env, {
  repoRoot,
  homeMode: resolvedHomeMode,
  stripKeys: local.has('--no-keys'),
  ephemeralHomeDir,
});

if (local.has('--env')) {
  for (const line of formatDebugEnvReport(built)) console.log(line);
  process.exit(0);
}

if (!existsSync(join(repoRoot, 'node_modules'))) {
  console.error('debug-local: workspace deps missing. Run pnpm install first.');
  process.exit(1);
}

mkdirSync(join(built.home, 'logs'), { recursive: true });
warnNodeVersion();
printBanner(built, forwarded);

const script = local.has('--cli-only') ? DEV_CLI_ONLY_SCRIPT : DEV_SCRIPT;
const child = spawn(process.execPath, [script, ...forwarded], {
  cwd: repoRoot,
  env: built.env,
  stdio: 'inherit',
});
child.on('error', (error) => {
  console.error(`debug-local: failed to start source CLI: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal !== null) process.exit(1);
  process.exit(code ?? 0);
});
