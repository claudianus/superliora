import { chmod, mkdir, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { SetupCommandOptions, SetupCommandResult } from '../install';
import { findFreePort } from './browser-support';

const LIGHTPANDA_RELEASE_TAG = 'nightly';
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
    const response = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 10 * 60_000) });
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

  try {
    const deadline = Date.now() + (options.timeoutMs ?? 15_000);
    while (Date.now() < deadline) {
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
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn(binaryPath, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, options.timeoutMs ?? 10_000);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        code: null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        command: [binaryPath, ...args],
        error: error.message,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        ok: code === 0,
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        command: [binaryPath, ...args],
      });
    });
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
