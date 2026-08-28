import { chmod, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
  runSetupCommand,
  type SetupCommandOptions,
  type SetupCommandResult,
} from '../setup-command';
import { findFreePort } from './browser-support';

/**
 * Pinned Lightpanda release. `nightly` is a moving target that gets executed
 * as a CDP sidecar, so pin a versioned release and verify the artifact
 * against the sha256 digests GitHub records for the release assets. Bumping:
 * read the digests from the new release's asset list and update the tag and
 * map below together.
 */
const LIGHTPANDA_RELEASE_TAG = '0.3.7';
const LIGHTPANDA_ASSET_SHA256: Readonly<Record<string, string>> = {
  'lightpanda-aarch64-linux': '4c0ecb28b4fcfb6d5bce82ec86e15fc6cde89cea168cf3840494f0ee26755852',
  'lightpanda-aarch64-macos': 'ae99542d81af23087296ec037abb0d57a57002502f5ff4c1b0b05dfa484b79b8',
  'lightpanda-x86_64-linux': '895339b02205171a181dde743ae0068bb4564884076feac8482baca9c212aa5a',
  'lightpanda-x86_64-macos': '5e118b6e91c2cccb1ce7f0d34fc39dab262b947e4dea29a90b1a75b9399d7862',
};
const DEFAULT_CACHE_DIR = join(homedir(), '.cache', 'superliora-lightpanda');

export interface LightpandaBinaryOptions {
  readonly cacheDir?: string | undefined;
  readonly binaryPath?: string | undefined;
}

export function resolveLightpandaBinaryPath(options: LightpandaBinaryOptions = {}): string {
  if (options.binaryPath !== undefined) return options.binaryPath;
  const envPath = process.env['LIGHTPANDA_EXECUTABLE_PATH'];
  if (envPath !== undefined && envPath.length > 0) return envPath;
  const cacheDir = options.cacheDir ?? process.env['LIGHTPANDA_CACHE_DIR'] ?? DEFAULT_CACHE_DIR;
  return join(cacheDir, lightpandaBinaryName());
}

export async function installLightpandaBinary(
  options: SetupCommandOptions & LightpandaBinaryOptions = {},
): Promise<SetupCommandResult> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return unsupportedPlatformResult('install');
  }

  const target = resolveLightpandaBinaryPath(options);
  const asset = lightpandaAssetName();
  if (asset === undefined) {
    return {
      ok: false,
      code: 1,
      stdout: '',
      stderr: `Unsupported CPU architecture for Lightpanda: ${process.arch}`,
      command: ['lightpanda', 'install'],
      error: `Unsupported CPU architecture for Lightpanda: ${process.arch}`,
    };
  }

  const url = `https://github.com/lightpanda-io/browser/releases/download/${LIGHTPANDA_RELEASE_TAG}/${asset}`;
  const command = ['curl', '-fsSL', url, '-o', target] as const;
  try {
    await mkdir(dirname(target), { recursive: true });
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 10 * 60_000);
    const signal =
      options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);
    const response = await fetch(url, { signal });
    if (!response.ok || response.body === null) {
      return {
        ok: false,
        code: response.status,
        stdout: '',
        stderr: `Failed to download Lightpanda from ${url}`,
        command,
        error: `HTTP ${String(response.status)} while downloading Lightpanda`,
      };
    }
    await pipeline(response.body, createWriteStream(target));
    // Integrity gate before the binary is chmod'd and later spawned: a
    // mismatched hash removes the artifact and fails the install.
    const digest = createHash('sha256').update(await readFile(target)).digest('hex');
    const expected = LIGHTPANDA_ASSET_SHA256[asset];
    if (expected === undefined || digest !== expected) {
      await rm(target, { force: true });
      return {
        ok: false,
        code: 1,
        stdout: '',
        stderr: `Lightpanda download failed integrity check for ${asset}`,
        command,
        error: `sha256 mismatch for ${asset}: expected ${expected ?? 'none'}, got ${digest}`,
      };
    }
    await chmod(target, 0o755);
    return {
      ok: true,
      code: 0,
      stdout: `Installed Lightpanda to ${target}\n`,
      stderr: '',
      command,
    };
  } catch (error) {
    return {
      ok: false,
      code: 1,
      stdout: '',
      stderr: describeError(error),
      command,
      error: describeError(error),
    };
  }
}

export async function infoLightpandaBinary(
  options: SetupCommandOptions & LightpandaBinaryOptions = {},
): Promise<SetupCommandResult> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return unsupportedPlatformResult('info');
  }

  const binaryPath = resolveLightpandaBinaryPath(options);
  try {
    await stat(binaryPath);
  } catch {
    return {
      ok: false,
      code: 1,
      stdout: '',
      stderr: `Lightpanda binary not found at ${binaryPath}`,
      command: [binaryPath, 'version'],
      error: `Lightpanda binary not found at ${binaryPath}`,
    };
  }

  const version = await runBinaryCommand(binaryPath, ['version'], options);
  if (!version.ok) return version;

  const probe = await probeLightpandaServe(binaryPath, options);
  if (!probe.ok) return probe;

  return {
    ok: true,
    code: 0,
    stdout: `${version.stdout.trim()}\n${probe.stdout.trim()}\n`,
    stderr: '',
    command: [binaryPath, 'serve'],
  };
}

async function probeLightpandaServe(
  binaryPath: string,
  options: SetupCommandOptions,
): Promise<SetupCommandResult> {
  const host = '127.0.0.1';
  const port = await findFreePort(host);
  const { spawn } = await import('node:child_process');
  const proc = spawn(binaryPath, [
    'serve',
    '--host',
    host,
    '--port',
    String(port),
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  // A missing or non-executable binary reports ENOENT/EACCES asynchronously.
  // Without a listener Node escalates it to an uncaught exception that takes
  // the host process down instead of failing this probe.
  let spawnError: Error | undefined;
  proc.once('error', (error) => {
    spawnError = error;
  });

  try {
    const deadline = Date.now() + (options.timeoutMs ?? 15_000);
    while (Date.now() < deadline) {
      if (spawnError !== undefined) {
        return {
          ok: false,
          code: 1,
          stdout: '',
          stderr: spawnError.message,
          command: [binaryPath, 'serve'],
          error: spawnError.message,
        };
      }
      try {
        const response = await fetch(`http://${host}:${String(port)}/json/version`, {
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok) {
          const body = (await response.text()).trim();
          return {
            ok: true,
            code: 0,
            stdout: body.length > 0 ? `cdp: ${body}` : 'cdp: ready',
            stderr: '',
            command: [binaryPath, 'serve'],
          };
        }
      } catch {
        await delay(100);
      }
    }
    return {
      ok: false,
      code: 1,
      stdout: '',
      stderr: `Lightpanda CDP probe timed out on ${host}:${String(port)}`,
      command: [binaryPath, 'serve'],
      error: `Lightpanda CDP probe timed out on ${host}:${String(port)}`,
    };
  } finally {
    proc.kill();
  }
}

async function runBinaryCommand(
  binaryPath: string,
  args: readonly string[],
  options: SetupCommandOptions,
): Promise<SetupCommandResult> {
  return runSetupCommand(binaryPath, args, {
    ...options,
    timeoutMs: options.timeoutMs ?? 10_000,
    quiet: true,
  });
}

function lightpandaBinaryName(): string {
  return process.platform === 'win32' ? 'lightpanda.exe' : 'lightpanda';
}

function lightpandaAssetName(): string | undefined {
  if (process.platform === 'linux') {
    if (process.arch === 'x64') return 'lightpanda-x86_64-linux';
    if (process.arch === 'arm64') return 'lightpanda-aarch64-linux';
    return undefined;
  }
  if (process.platform === 'darwin') {
    if (process.arch === 'arm64') return 'lightpanda-aarch64-macos';
    if (process.arch === 'x64') return 'lightpanda-x86_64-macos';
    return undefined;
  }
  return undefined;
}

function unsupportedPlatformResult(action: string): SetupCommandResult {
  return {
    ok: false,
    code: 1,
    stdout: '',
    stderr: `Lightpanda ${action} is unsupported on ${process.platform}.`,
    command: ['lightpanda', action],
    error: `Lightpanda ${action} is unsupported on ${process.platform}.`,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
