import { spawn, type ChildProcess } from 'node:child_process';

import { tryAcquireUpdateInstallLock } from './install-lock';
import {
  failureAttemptsFor,
  hasFreshActiveInstall,
  nowIso,
} from './install-runtime';
import { spawnForSource } from './install-spawn';
import {
  parseUpgradeStageLine,
  type UpgradeInstallStage,
} from './install-stages';
import { emptyUpdateInstallState, readUpdateInstallState, writeUpdateInstallState } from './install-state';
import type { InstallSource, UpdateInstallState, UpdateTarget } from './types';

export interface StartObservedUpgradeInstallOptions {
  readonly currentVersion: string;
  readonly targetVersion: string;
  readonly source: InstallSource;
  readonly platform: NodeJS.Platform;
  readonly onStage?: (stage: UpgradeInstallStage, detail?: string) => void;
}

export interface StartObservedUpgradeInstallDeps {
  readonly spawn?: typeof spawn;
  readonly tryAcquireUpdateInstallLock?: typeof tryAcquireUpdateInstallLock;
  readonly readUpdateInstallState?: typeof readUpdateInstallState;
  readonly writeUpdateInstallState?: typeof writeUpdateInstallState;
}

function initialObservedStage(source: InstallSource): UpgradeInstallStage {
  return source === 'github-checkout' ? 'fetching' : 'downloading';
}

function emitStage(
  onStage: StartObservedUpgradeInstallOptions['onStage'],
  stage: UpgradeInstallStage,
  detail?: string,
): void {
  try {
    onStage?.(stage, detail);
  } catch {
    // Stage callbacks must never affect install lifecycle.
  }
}

function attachStageLineReader(
  stream: NodeJS.ReadableStream | null | undefined,
  onLine: (line: string) => void,
): void {
  if (stream === null || stream === undefined) return;
  let buffer = '';
  stream.on('data', (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      onLine(line);
      newline = buffer.indexOf('\n');
    }
  });
  stream.on('end', () => {
    if (buffer.length > 0) {
      onLine(buffer);
      buffer = '';
    }
  });
}

/**
 * Start an upgrade install with piped stdout/stderr so the TUI can observe
 * `__LIORA_UPGRADE_STAGE__=…` markers (github) or synthesized npm stages.
 * Quiet passive preflight continues to use `startBackgroundInstall`.
 */
export async function startObservedUpgradeInstall(
  options: StartObservedUpgradeInstallOptions,
  deps: StartObservedUpgradeInstallDeps = {},
): Promise<{ readonly started: boolean; readonly reason?: 'lock-held' | 'already-active' }> {
  const spawnFn = deps.spawn ?? spawn;
  const acquireLock = deps.tryAcquireUpdateInstallLock ?? tryAcquireUpdateInstallLock;
  const readState = deps.readUpdateInstallState ?? readUpdateInstallState;
  const writeState = deps.writeUpdateInstallState ?? writeUpdateInstallState;
  const target: UpdateTarget = { version: options.targetVersion };
  const { source, platform, onStage } = options;

  const lock = await acquireLock({ version: target.version });
  if (lock === null) return { started: false, reason: 'lock-held' };

  try {
    const freshState = await readState().catch(() => emptyUpdateInstallState());
    if (hasFreshActiveInstall(freshState, target)) {
      return { started: false, reason: 'already-active' };
    }

    const startedState: UpdateInstallState = {
      ...freshState,
      active: {
        version: target.version,
        source,
        startedAt: nowIso(),
      },
    };
    await writeState(startedState);

    emitStage(onStage, 'checking');
    emitStage(onStage, initialObservedStage(source));

    const { cmd, args } = spawnForSource(source, target.version, platform);
    let settled = false;
    let installingEmitted = source === 'github-checkout';
    let installingTimer: ReturnType<typeof setTimeout> | undefined;
    const stderrLines: string[] = [];
    const stdoutLines: string[] = [];

    const rememberOutputLine = (line: string, fromStderr: boolean): void => {
      const trimmed = line.trim();
      if (trimmed.length === 0 || parseUpgradeStageLine(trimmed) !== null) return;
      const buf = fromStderr ? stderrLines : stdoutLines;
      buf.push(trimmed);
      if (buf.length > 8) buf.shift();
    };

    const failureDetail = (): string | undefined => {
      const lines = stderrLines.length > 0 ? stderrLines : stdoutLines;
      if (lines.length === 0) return undefined;
      const summary = lines.slice(-2).join(' · ');
      return summary.length > 160 ? `${summary.slice(0, 157)}…` : summary;
    };

    const finish = (succeeded: boolean): void => {
      if (settled) return;
      settled = true;
      if (installingTimer !== undefined) {
        clearTimeout(installingTimer);
        installingTimer = undefined;
      }
      if (succeeded) {
        emitStage(onStage, 'done');
      } else {
        emitStage(onStage, 'failed', failureDetail());
      }

      const attempts = failureAttemptsFor(startedState, target) + 1;
      const nextState: UpdateInstallState = succeeded
        ? {
          ...startedState,
          active: null,
          lastFailure: null,
          lastSuccess: {
            version: target.version,
            source,
            installedAt: nowIso(),
            notifiedAt: null,
          },
        }
        : {
          ...startedState,
          active: null,
          lastFailure: {
            version: target.version,
            failedAt: nowIso(),
            attempts,
          },
        };
      void writeState(nextState).catch(() => {});
    };

    const emitInstallingOnce = (): void => {
      if (installingEmitted || settled) return;
      installingEmitted = true;
      if (installingTimer !== undefined) {
        clearTimeout(installingTimer);
        installingTimer = undefined;
      }
      emitStage(onStage, 'installing');
    };

    const handleOutputLine = (line: string, fromStderr: boolean): void => {
      rememberOutputLine(line, fromStderr);
      const stage = parseUpgradeStageLine(line);
      if (stage !== null) {
        if (stage === 'installing') installingEmitted = true;
        // Prefer captured stderr/stdout summary for terminal failed; markers are noisy.
        if (stage === 'failed') {
          emitStage(onStage, stage, failureDetail());
          return;
        }
        if (stage === 'done') {
          emitStage(onStage, stage);
          return;
        }
        emitStage(onStage, stage, line.trim());
        return;
      }
      if (source !== 'github-checkout') {
        emitInstallingOnce();
      }
    };

    const child = spawnFn(cmd, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: platform === 'win32' ? true : undefined,
    }) as ChildProcess;

    if (source !== 'github-checkout') {
      installingTimer = setTimeout(() => {
        emitInstallingOnce();
      }, 50);
    }

    attachStageLineReader(child.stdout, (line) => { handleOutputLine(line, false); });
    attachStageLineReader(child.stderr, (line) => { handleOutputLine(line, true); });
    child.once('error', (err: Error) => {
      if (typeof err.message === 'string' && err.message.length > 0) {
        stderrLines.push(err.message);
        if (stderrLines.length > 8) stderrLines.shift();
      }
      finish(false);
    });
    child.once('exit', (code) => { finish(code === 0); });

    return { started: true };
  } finally {
    await lock.release().catch(() => {});
  }
}
