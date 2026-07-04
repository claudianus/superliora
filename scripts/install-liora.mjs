#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

const WRAPPER_MARKER = 'Managed by superliora scripts/install-liora.mjs';
const PATH_MARKER_START = '# >>> liora PATH >>>';
const PATH_MARKER_END = '# <<< liora PATH <<<';
const DEFAULT_NODE_VERSION = '24';

const args = parseArgs(process.argv.slice(2));
const homeDir = process.env['HOME'] || homedir();
const scriptDir = import.meta.dirname;
const repoRoot = resolve(scriptDir, '..');
const appRoot = resolve(repoRoot, 'apps/liora');
const binDir = resolveHome(args.binDir ?? process.env['LIORA_INSTALL_BIN_DIR'] ?? '~/.local/bin');
const commandName = args.name ?? process.env['LIORA_INSTALL_NAME'] ?? 'liora';
const commandPath = resolve(binDir, commandName);

if (process.platform === 'win32') {
  fail('scripts/install-liora.mjs currently supports POSIX shells only.');
}

await mkdir(binDir, { recursive: true });
await installWrapper(commandPath);

const shellFiles = args.shellRc === false ? [] : await installShellPath(binDir);

writeStdout(`Installed ${commandName} -> ${commandPath}\n`);
if (shellFiles.length > 0) {
  writeStdout(`Updated shell PATH files: ${shellFiles.join(', ')}\n`);
  writeStdout('Open a new shell, or source your shell startup file, then run:\n');
  writeStdout(`  ${commandName} --version\n`);
}

async function installWrapper(filePath) {
  if (existsSync(filePath) && !(await isManagedWrapper(filePath)) && !args.force) {
    fail(`${filePath} already exists and is not managed by this installer. Re-run with --force to replace it.`);
  }

  const wrapper = renderWrapper(appRoot, args.nodeVersion ?? DEFAULT_NODE_VERSION);
  await writeFile(filePath, wrapper, { mode: 0o755 });
  await chmod(filePath, 0o755);
}

async function isManagedWrapper(filePath) {
  try {
    const text = await readFile(filePath, 'utf-8');
    return text.includes(WRAPPER_MARKER);
  } catch {
    return false;
  }
}

function renderWrapper(appDir, nodeVersion) {
  return `#!/usr/bin/env bash
# ${WRAPPER_MARKER}
set -euo pipefail

app_root=${quotePosix(appDir)}
main_file="$app_root/dist/main.mjs"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # Keep local launches on the repository's supported Node major when nvm is available.
  # If nvm cannot switch, fall back to whatever node is already on PATH.
  . "$HOME/.nvm/nvm.sh"
  nvm use ${quotePosix(nodeVersion)} >/dev/null 2>&1 || true
fi

export SUPERLIORA_NO_AUTO_UPDATE="\${SUPERLIORA_NO_AUTO_UPDATE:-1}"

if [ -f "$main_file" ]; then
  exec node "$main_file" "$@"
fi

exec corepack pnpm -C "$app_root" run dev:cli-only -- "$@"
`;
}

async function installShellPath(pathDir) {
  const updated = [];
  const posixSnippet = renderPosixPathSnippet(pathDir);
  const fishSnippet = renderFishPathSnippet(pathDir);

  const posixTargets = [
    resolve(homeDir, '.zshrc'),
    resolve(homeDir, '.bashrc'),
    resolve(homeDir, '.profile'),
  ];
  for (const target of posixTargets) {
    if (await upsertMarkedBlock(target, posixSnippet)) updated.push(prettyHome(target));
  }

  for (const optionalTarget of [
    resolve(homeDir, '.zprofile'),
    resolve(homeDir, '.bash_profile'),
  ]) {
    if (existsSync(optionalTarget) && await upsertMarkedBlock(optionalTarget, posixSnippet)) {
      updated.push(prettyHome(optionalTarget));
    }
  }

  const fishConfig = resolve(homeDir, '.config/fish/config.fish');
  if (await upsertMarkedBlock(fishConfig, fishSnippet)) updated.push(prettyHome(fishConfig));

  return updated;
}

async function upsertMarkedBlock(filePath, block) {
  await mkdir(dirname(filePath), { recursive: true });
  let current = '';
  try {
    current = await readFile(filePath, 'utf-8');
  } catch {
    current = '';
  }

  const nextBlock = `${PATH_MARKER_START}\n${block.trimEnd()}\n${PATH_MARKER_END}`;
  const markerPattern = new RegExp(
    `${escapeRegExp(PATH_MARKER_START)}[\\s\\S]*?${escapeRegExp(PATH_MARKER_END)}`,
    'm',
  );
  const next = markerPattern.test(current)
    ? current.replace(markerPattern, nextBlock)
    : `${current}${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${nextBlock}\n`;

  if (next === current) return false;
  await writeFile(filePath, next, 'utf-8');
  return true;
}

function renderPosixPathSnippet(pathDir) {
  const expr = shellStartupPathExpr(pathDir);
  return `liora_bin_dir=${quotePosixStartupExpr(expr)}
case ":$PATH:" in
  *":$liora_bin_dir:"*) ;;
  *) export PATH="$liora_bin_dir:$PATH" ;;
esac
unset liora_bin_dir
`;
}

function renderFishPathSnippet(pathDir) {
  const expr = shellStartupPathExpr(pathDir);
  return `set -l liora_bin_dir ${quoteFishStartupExpr(expr)}
if type -q fish_add_path
    fish_add_path $liora_bin_dir
else if not contains -- $liora_bin_dir $PATH
    set -gx PATH $liora_bin_dir $PATH
end
`;
}

function shellStartupPathExpr(filePath) {
  const normalizedHome = homeDir.endsWith('/') ? homeDir.slice(0, -1) : homeDir;
  if (filePath === normalizedHome) return '$HOME';
  if (filePath.startsWith(`${normalizedHome}/`)) return `$HOME/${filePath.slice(normalizedHome.length + 1)}`;
  return filePath;
}

function resolveHome(value) {
  if (value === '~') return homeDir;
  if (value.startsWith('~/')) return resolve(homeDir, value.slice(2));
  return resolve(value);
}

function quotePosix(value) {
  return `'${value.replaceAll(`'`, `'\\''`)}'`;
}

function quotePosixStartupExpr(value) {
  if (value === '$HOME' || value.startsWith('$HOME/')) {
    return `"${value.replaceAll(/["\\`]/g, '\\$&')}"`;
  }
  return quotePosix(value);
}

function quoteFish(value) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll(`'`, "\\'")}'`;
}

function quoteFishStartupExpr(value) {
  if (value === '$HOME' || value.startsWith('$HOME/')) {
    return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  }
  return quoteFish(value);
}

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function prettyHome(filePath) {
  const normalizedHome = homeDir.endsWith('/') ? homeDir.slice(0, -1) : homeDir;
  if (filePath === normalizedHome) return '~';
  if (filePath.startsWith(`${normalizedHome}/`)) return `~/${filePath.slice(normalizedHome.length + 1)}`;
  return filePath;
}

function parseArgs(argv) {
  const parsed = {
    binDir: undefined,
    force: false,
    name: undefined,
    nodeVersion: undefined,
    shellRc: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') {
      parsed.force = true;
    } else if (arg === '--no-shell-rc') {
      parsed.shellRc = false;
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
    } else if (arg === '--help' || arg === '-h') {
      writeStdout(`Usage: node scripts/install-liora.mjs [options]

Options:
  --bin-dir <path>       Install directory. Default: ~/.local/bin
  --name <command>       Command name. Default: liora
  --node-version <major> nvm Node version to request. Default: ${DEFAULT_NODE_VERSION}
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
