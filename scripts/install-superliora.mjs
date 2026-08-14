#!/usr/bin/env node
/**
 * SuperLiora installer orchestrator — prebuilt SEA first, source fallback.
 * Invoked by install.sh / install.ps1 after Node is available.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureGit } from './install/ensure-git.mjs';
import { ensureNode } from './install/ensure-node.mjs';
import { ensureBinOnPath } from './install/path.mjs';
import { tryInstallPrebuilt } from './install/prebuilt.mjs';
import {
  DEFAULT_MANIFEST_URL,
  DEFAULT_NODE_MIN,
  DEFAULT_REF,
  DEFAULT_REPO,
  commandFileName,
  defaultBinDir,
  defaultInstallDir,
  manifestUrlForVersion,
} from './install/platform.mjs';
import { spawnInstall } from './install/spawn.mjs';
import { installSidecars } from './install/sidecars.mjs';
import { buildSource, fetchSource } from './install/source.mjs';
import { createTheatre } from './install/theatre.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const args = parseArgs(process.argv.slice(2));

const fromMain = args.fromMain === true;
const preferSource = fromMain || args.preferSource === true;
const sourceRef = fromMain ? 'main' : args.ref;

const theatre = createTheatre({
  mode: preferSource ? 'source' : 'prebuilt',
  title: 'Installing SuperLiora',
});

let exitCode = 0;
try {
  theatre.startPulse();
  theatre.setStage('checking', 'Probing environment');

  theatre.setStage('bootstrapping', 'Ensuring Node.js runtime');
  const nodeInfo = await ensureNode({ nodeMin: args.nodeMin });
  theatre.setDetail(
    nodeInfo.bootstrapped
      ? `Installed Node ${nodeInfo.version} → ~/.superliora/runtime/node`
      : `Using Node ${nodeInfo.version}`,
  );

  theatre.setStage('bootstrapping', 'Ensuring Git');
  try {
    const gitInfo = await ensureGit({ skip: args.noGit, noShellRc: args.noShellRc });
    if (gitInfo.message) {
      theatre.note(gitInfo.message);
    } else if (gitInfo.bootstrapped) {
      theatre.setDetail(`Installed Git -> ${gitInfo.root ?? '~/.superliora/runtime/git'}`);
    } else if (!gitInfo.skipped) {
      theatre.setDetail(gitInfo.bashPath ? `Using Git Bash ${gitInfo.bashPath}` : 'Using Git on PATH');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    theatre.note(`Git bootstrap failed (${message}); continuing. Install Git later if the agent needs a shell.`);
  }

  const binDir = resolveHome(args.binDir ?? defaultBinDir());
  const installDir = resolveHome(args.installDir ?? defaultInstallDir());
  const commandName = args.commandName ?? 'liora';

  let mode = 'prebuilt';
  let sourceTree = null;

  if (preferSource) {
    mode = 'source';
  } else {
    // Default: published GitHub Release prebuilt only — no silent main tip fallback.
    theatre.setMode('prebuilt');
    theatre.setStage('downloading', 'Fetching release manifest');
    const expectedVersion = normalizeVersion(args.version);
    const manifestUrl =
      args.manifestUrl !== DEFAULT_MANIFEST_URL || expectedVersion === null
        ? args.manifestUrl
        : manifestUrlForVersion(expectedVersion);
    const pre = await tryInstallPrebuilt({
      manifestUrl,
      expectedVersion: expectedVersion ?? undefined,
      binDir,
      commandName,
    });
    if (!pre.ok) {
      throw new Error(
        `Prebuilt release unavailable (${pre.error}). ` +
          'Pass --main to build the tip of origin/main from source, ' +
          'or --prefer-source --ref <ref> for another checkout.',
      );
    }
    theatre.setDetail(`Placed SEA ${pre.result.version || ''} (${pre.result.target})`);
    await ensureBinOnPath(binDir, { noShellRc: args.noShellRc });
    theatre.setStage('installing', `Installed ${commandName} binary`);
  }

  if (mode === 'source') {
    theatre.setMode('source');
    theatre.setStage('fetching', fromMain ? 'Fetching tip of main' : 'Fetching SuperLiora source');
    const fetched = await fetchSource({
      repoUrl: args.repoUrl,
      ref: sourceRef,
      installDir,
      force: args.force,
    });
    sourceTree = fetched.installDir;
    theatre.setDetail(`Source via ${fetched.method} → ${fetched.installDir}`);

    if (!args.noBuild) {
      theatre.setStage('building', 'Installing dependencies and building CLI');
      buildSource(fetched.installDir);
    }

    theatre.setStage('installing', `Installing ${commandName} wrapper`);
    await installSourceWrapper(fetched.installDir, binDir, commandName, args);
    await ensureBinOnPath(binDir, { noShellRc: args.noShellRc });
  }

  theatre.setStage('sidecars', 'Installing browser / computer / retrieval');
  await installSidecars({
    installDir: sourceTree,
    commandName,
    noBrowserUse: args.noBrowserUse,
    noComputerUse: args.noComputerUse,
    noRetrieval: args.noRetrieval,
    onDetail: (msg) => theatre.setDetail(msg),
    onWarn: (msg) => theatre.note(msg),
  });

  // Warm --version when possible (prebuilt path already verified when expected).
  const warm = join(binDir, commandFileName(commandName));
  if (existsSync(warm) && mode === 'source') {
    spawnInstall(warm, ['--version'], { encoding: 'utf8', stdio: 'ignore' });
  }

  theatre.finish(true, `${commandName} is ready`);
  process.stdout.write('\n');
  process.stdout.write(`Command: ${commandName}\n`);
  process.stdout.write(`Bin dir: ${binDir}\n`);
  if (sourceTree) process.stdout.write(`Source:  ${sourceTree}\n`);
  process.stdout.write(`Mode:    ${mode}\n`);
  process.stdout.write(`Next:    ${commandName}   ·  ${commandName} upgrade\n`);
} catch (error) {
  exitCode = 1;
  const message = error instanceof Error ? error.message : String(error);
  theatre.finish(false, message);
  process.stderr.write(`error: ${message}\n`);
}

process.exit(exitCode);

async function installSourceWrapper(installDir, binDir, commandName, opts) {
  const script = join(installDir, 'scripts/install-liora.mjs');
  if (!existsSync(script)) {
    // Fallback: local tree of the orchestrator itself
    const local = join(here, 'install-liora.mjs');
    if (!existsSync(local)) throw new Error('install-liora.mjs not found in source tree');
    return runInstallLiora(local, binDir, commandName, opts, installDir);
  }
  return runInstallLiora(script, binDir, commandName, opts, installDir);
}

function runInstallLiora(script, binDir, commandName, opts, installDir) {
  const argv = [script, '--bin-dir', binDir, '--name', commandName];
  if (opts.force) argv.push('--force');
  if (opts.noShellRc) argv.push('--no-shell-rc');
  if (process.platform === 'win32') argv.push('--windows');
  const r = spawnSync(process.execPath, argv, {
    cwd: installDir ?? dirname(script),
    encoding: 'utf8',
    stdio: 'inherit',
    env: { ...process.env, LIORA_INSTALL_SOURCE_ROOT: installDir },
  });
  if (r.status !== 0) throw new Error('install-liora.mjs failed');
}

function resolveHome(value) {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (value === '~') return home;
  if (value.startsWith('~/')) return resolve(home, value.slice(2));
  return resolve(value);
}

function normalizeVersion(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^v/i, '');
  return trimmed.length > 0 ? trimmed : null;
}

function parseArgs(argv) {
  const out = {
    repoUrl: process.env.SUPERLIORA_REPO_URL ?? DEFAULT_REPO,
    ref: process.env.SUPERLIORA_REF ?? DEFAULT_REF,
    installDir: process.env.SUPERLIORA_INSTALL_DIR,
    binDir: process.env.SUPERLIORA_BIN_DIR,
    commandName: process.env.SUPERLIORA_COMMAND,
    nodeMin: process.env.SUPERLIORA_NODE_MIN ?? DEFAULT_NODE_MIN,
    manifestUrl: process.env.SUPERLIORA_MANIFEST_URL ?? DEFAULT_MANIFEST_URL,
    version: process.env.SUPERLIORA_VERSION ?? null,
    force: false,
    noBuild: false,
    noShellRc: process.env.SUPERLIORA_NO_SHELL_RC === '1',
    noBrowserUse: process.env.SUPERLIORA_SKIP_BROWSER_USE === '1',
    noComputerUse: process.env.SUPERLIORA_SKIP_COMPUTER_USE === '1',
    noRetrieval: process.env.SUPERLIORA_SKIP_RETRIEVAL === '1',
    noGit: process.env.SUPERLIORA_SKIP_GIT === '1',
    preferSource: process.env.SUPERLIORA_PREFER_SOURCE === '1',
    fromMain: process.env.SUPERLIORA_FROM_MAIN === '1',
    forcePrebuilt: process.env.SUPERLIORA_FORCE_PREBUILT === '1',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${arg} requires a value`);
      return v;
    };
    switch (arg) {
      case '--repo':
        out.repoUrl = take();
        break;
      case '--ref':
        out.ref = take();
        break;
      case '--install-dir':
        out.installDir = take();
        break;
      case '--bin-dir':
        out.binDir = take();
        break;
      case '--command':
        out.commandName = take();
        break;
      case '--node-min':
        out.nodeMin = take();
        break;
      case '--manifest':
        out.manifestUrl = take();
        break;
      case '--version':
        out.version = take();
        break;
      case '--force':
        out.force = true;
        break;
      case '--no-build':
        out.noBuild = true;
        break;
      case '--no-shell-rc':
      case '--no-path':
        out.noShellRc = true;
        break;
      case '--no-browser-use':
        out.noBrowserUse = true;
        break;
      case '--no-computer-use':
        out.noComputerUse = true;
        break;
      case '--no-retrieval':
        out.noRetrieval = true;
        break;
      case '--no-git':
        out.noGit = true;
        break;
      case '--prefer-source':
        out.preferSource = true;
        break;
      case '--main':
        out.fromMain = true;
        break;
      case '--force-prebuilt':
        out.forcePrebuilt = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--repo=')) out.repoUrl = arg.slice(7);
        else if (arg.startsWith('--ref=')) out.ref = arg.slice(6);
        else if (arg.startsWith('--install-dir=')) out.installDir = arg.slice(14);
        else if (arg.startsWith('--bin-dir=')) out.binDir = arg.slice(10);
        else if (arg.startsWith('--command=')) out.commandName = arg.slice(10);
        else if (arg.startsWith('--node-min=')) out.nodeMin = arg.slice(11);
        else if (arg.startsWith('--manifest=')) out.manifestUrl = arg.slice(11);
        else if (arg.startsWith('--version=')) out.version = arg.slice(10);
        else throw new Error(`unknown option: ${arg}`);
    }
  }

  if (out.commandName && !/^[A-Za-z0-9._-]+$/.test(out.commandName)) {
    throw new Error('--command must be a simple command name');
  }
  if (out.version && out.fromMain) {
    throw new Error('--version cannot be combined with --main');
  }
  return out;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/install-superliora.mjs [options]

Default: install the latest published GitHub Release prebuilt (SEA).
Use --main to build the tip of origin/main from source instead.

Options:
  --repo <url>          Git repository URL
  --ref <ref>           Branch or tag (source mode; ignored with --main)
  --install-dir <path>  Source checkout directory
  --bin-dir <path>      Command install directory
  --command <name>      Command name (default: liora)
  --node-min <version>  Minimum Node.js version
  --manifest <url>      Release manifest.json URL
  --version <semver>    Pin prebuilt install to a release tag (sets manifest URL)
  --force               Replace existing checkout/wrapper
  --no-build            Skip pnpm install/build (source mode)
  --no-browser-use      Skip browser-use sidecars
  --no-computer-use     Skip cua-driver
  --no-retrieval        Skip Granite embedder bootstrap
  --no-git              Skip Git / Git Bash bootstrap
  --no-shell-rc         Do not edit shell PATH / User PATH (or SUPERLIORA_NO_SHELL_RC=1)
  --main                Ignore releases; build tip of origin/main from source
  --prefer-source       Skip prebuilt; build from source (--ref, default main)
  --force-prebuilt      Fail if prebuilt unavailable (same as default without --main)
`);
}
