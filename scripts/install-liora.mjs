#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { ensureBinOnPath } from './install/path.mjs';
import {
  DEFAULT_NODE_VERSION,
  WRAPPER_MARKER,
  renderPosixSeaShim,
  renderPosixWrapper,
  renderWindowsCmdWrapper,
  renderWindowsSeaShim,
} from './install/wrappers.mjs';

const args = parseArgs(process.argv.slice(2));
const homeDir = process.env['HOME'] ?? process.env['USERPROFILE'] ?? homedir();
const scriptDir = import.meta.dirname;
const repoRoot = resolve(scriptDir, '..');
const sourceRoot = process.env['LIORA_INSTALL_SOURCE_ROOT']
  ? resolve(process.env['LIORA_INSTALL_SOURCE_ROOT'])
  : repoRoot;
const appRoot = resolve(sourceRoot, 'apps/liora');
const binDir = resolveHome(args.binDir ?? process.env['LIORA_INSTALL_BIN_DIR'] ?? defaultBinDir());
const commandName = args.name ?? process.env['LIORA_INSTALL_NAME'] ?? 'liora';
const seaBinary = args.seaBinary ? resolveHome(args.seaBinary) : null;
const windows = args.windows || process.platform === 'win32';

await mkdir(binDir, { recursive: true });
writeStdout('__LIORA_UPGRADE_STAGE__=installing\n');

if (seaBinary) {
  await installSeaShim(binDir, commandName, seaBinary, windows);
} else if (windows) {
  await installWindowsWrappers(appRoot, binDir, commandName);
} else {
  const commandPath = resolve(binDir, commandName);
  await installPosixWrapper(commandPath, appRoot);
}

const pathResult = args.shellRc
  ? await ensureBinOnPath(binDir, { noShellRc: false })
  : { updated: [] };

writeStdout(`Installed ${commandName} -> ${binDir}\n`);
if (pathResult.updated.length > 0) {
  writeStdout(`Updated PATH: ${pathResult.updated.join(', ')}\n`);
  writeStdout('Open a new shell, then run:\n');
  writeStdout(`  ${commandName} --version\n`);
}
writeStdout('__LIORA_UPGRADE_STAGE__=done\n');

async function installPosixWrapper(filePath, appDir) {
  if (existsSync(filePath) && !(await isManagedWrapper(filePath)) && !args.force) {
    fail(`${filePath} already exists and is not managed by this installer. Re-run with --force to replace it.`);
  }
  const wrapper = renderPosixWrapper(appDir, args.nodeVersion ?? DEFAULT_NODE_VERSION);
  await writeFile(filePath, wrapper, { mode: 0o755 });
  await chmod(filePath, 0o755);
}

async function installSeaShim(outDir, name, binaryPath, isWin) {
  if (isWin) {
    const cmdPath = resolve(outDir, `${name}.cmd`);
    if (existsSync(cmdPath) && !(await isManagedWrapper(cmdPath)) && !args.force) {
      fail(`${cmdPath} already exists and is not managed by this installer. Re-run with --force.`);
    }
    await writeFile(cmdPath, renderWindowsSeaShim(binaryPath), 'utf8');
    return;
  }
  const shim = resolve(outDir, name);
  if (existsSync(shim) && !(await isManagedWrapper(shim)) && !args.force) {
    fail(`${shim} already exists and is not managed by this installer. Re-run with --force.`);
  }
  // If binary already lives in binDir, nothing to do; otherwise symlink/copy path exec.
  if (resolve(binaryPath) === shim) return;
  await writeFile(shim, renderPosixSeaShim(binaryPath), { mode: 0o755 });
  await chmod(shim, 0o755);
}

async function installWindowsWrappers(appDir, outDir, name) {
  const mainFile = resolve(appDir, 'dist/main.mjs');
  const cmdPath = resolve(outDir, `${name}.cmd`);
  const psPath = resolve(outDir, `${name}.ps1`);
  if (existsSync(cmdPath) && !(await isManagedWrapper(cmdPath)) && !args.force) {
    fail(`${cmdPath} already exists and is not managed by this installer. Re-run with --force.`);
  }
  // PowerShell resolves `name.ps1` before `name.cmd`. A leftover .ps1 is then
  // blocked by the default ExecutionPolicy, so `name` looks like an install
  // failure. Only the .cmd shim is on PATH.
  if (existsSync(psPath)) {
    if (!(await isManagedWrapper(psPath)) && !args.force) {
      fail(`${psPath} would shadow ${name}.cmd. Re-run with --force to replace it.`);
    }
    await unlink(psPath);
  }
  const cmd = renderWindowsCmdWrapper(appDir, {
    mainFile,
    nodeFallback: process.execPath,
  });
  await writeFile(cmdPath, cmd, 'utf8');
}

async function isManagedWrapper(filePath) {
  try {
    const text = await readFile(filePath, 'utf-8');
    return text.includes(WRAPPER_MARKER);
  } catch {
    return false;
  }
}

function defaultBinDir() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA ?? resolve(homeDir, 'AppData/Local');
    return resolve(base, 'SuperLiora/bin');
  }
  return '~/.local/bin';
}

function resolveHome(value) {
  if (value === '~') return homeDir;
  if (value.startsWith('~/')) return resolve(homeDir, value.slice(2));
  return resolve(value);
}

function parseArgs(argv) {
  const parsed = {
    binDir: undefined,
    force: false,
    name: undefined,
    nodeVersion: undefined,
    shellRc: true,
    seaBinary: undefined,
    windows: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') {
      parsed.force = true;
    } else if (arg === '--no-shell-rc') {
      parsed.shellRc = false;
    } else if (arg === '--windows') {
      parsed.windows = true;
    } else if (arg === '--bin-dir') {
      parsed.binDir = readValue(argv, i, arg);
      i += 1;
    } else if (arg.startsWith('--bin-dir=')) {
      parsed.binDir = arg.slice('--bin-dir='.length);
    } else if (arg === '--name') {
      parsed.name = readValue(argv, i, arg);
      i += 1;
    } else if (arg.startsWith('--name=')) {
      parsed.name = arg.slice('--name='.length);
    } else if (arg === '--node-version') {
      parsed.nodeVersion = readValue(argv, i, arg);
      i += 1;
    } else if (arg.startsWith('--node-version=')) {
      parsed.nodeVersion = arg.slice('--node-version='.length);
    } else if (arg === '--sea-binary') {
      parsed.seaBinary = readValue(argv, i, arg);
      i += 1;
    } else if (arg.startsWith('--sea-binary=')) {
      parsed.seaBinary = arg.slice('--sea-binary='.length);
    } else if (arg === '--help' || arg === '-h') {
      writeStdout(`Usage: node scripts/install-liora.mjs [options]

Options:
  --bin-dir <path>       Install directory. Default: ~/.local/bin
  --name <command>       Command name. Default: liora
  --node-version <major> nvm Node version to request. Default: ${DEFAULT_NODE_VERSION}
  --sea-binary <path>    Install a shim to a SEA binary instead of source wrapper
  --windows              Write Windows .cmd/.ps1 wrappers
  --force                Replace an existing unmanaged command file
  --no-shell-rc          Install the wrapper without editing shell startup files
`);
      process.exit(0);
    } else {
      fail(`Unknown option: ${arg}`);
    }
  }

  if (parsed.name !== undefined && !/^[A-Za-z0-9._-]+$/.test(parsed.name)) {
    fail('--name must be a simple command name.');
  }
  return parsed;
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) fail(`${flag} requires a value.`);
  return value;
}

function fail(message) {
  writeStderr(`${message}\n`);
  process.exit(1);
}

function writeStdout(message) {
  process.stdout.write(message);
}

function writeStderr(message) {
  process.stderr.write(message);
}
