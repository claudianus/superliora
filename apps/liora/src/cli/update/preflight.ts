import { spawn } from 'node:child_process';

import { log, type Logger } from '@superliora/sdk';
import type { TelemetryProperties } from '@superliora/telemetry';

import {
  NATIVE_INSTALL_COMMAND_UNIX,
  NATIVE_INSTALL_COMMAND_WIN,
  PRODUCT_NAME,
} from '#/constant/app';
import { t, tln } from '#/cli/i18n';
import { loadTuiConfig } from '#/tui/config';

import { readUpdateCache } from './cache';
import {
  detectSuperLioraGithubCheckout,
  gitCheckoutUpdateCommand,
  gitCheckoutUpdateScript,
  refreshGitCheckoutUpdateTarget,
} from './git-checkout';
import { tryAcquireUpdateInstallLock } from './install-lock';
import {
  parseUpgradeStageLine,
  type UpgradeInstallStage,
} from './install-stages';
import { emptyUpdateInstallState, readUpdateInstallState, writeUpdateInstallState } from './install-state';
import {
  CHANGELOG_URL,
  promptForInstallChoice,
  type InstallPromptChoiceValue,
  type InstallPromptOptions,
} from './prompt';
import { refreshUpdateCache } from './refresh';
import {
  appendRolloutDecisionLog,
  decidePassiveUpdateTarget,
  isRolloutBypassedByExperimentalEnv,
  resolveUpdateDeviceId,
  rolloutBucket,
  rolloutDelayForBucket,
  type PassiveUpdateDecision,
} from './rollout';
import { detectInstallSource } from './source';
import {
  NPM_PACKAGE_NAME,
  type InstallSource,
  type UpdateDecision,
  type UpdateInstallState,
  type UpdateManifest,
  type UpdatePreflightResult,
  type UpdateTarget,
} from './types';

export type { UpdatePreflightResult, UpdateNoticeInfo } from './types';
export { parseUpgradeStageLine, type UpgradeInstallStage } from './install-stages';

export interface RunUpdatePreflightOptions {
  readonly stdout?: { write(chunk: string): boolean };
  readonly stderr?: { write(chunk: string): boolean };
  readonly isTTY?: boolean;
  readonly track?: (event: string, properties?: TelemetryProperties) => void;
  readonly logger?: UpdateLogger;
}

const AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD = 2;
const AUTO_INSTALL_ACTIVE_TTL_MS = 6 * 60 * 60 * 1000;
const USER_VISIBLE_UPDATE_REFRESH_TIMEOUT_MS = 1_000;

type UpdateLogger = Pick<Logger, 'info' | 'warn'>;

function withCmdSuffix(base: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${base}.cmd` : base;
}

function bunCommand(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'bun.exe' : 'bun';
}

export function installCommandFor(
  source: InstallSource,
  version: string,
  platform: NodeJS.Platform,
): string {
  switch (source) {
    case 'npm-global':
      return `npm install -g ${NPM_PACKAGE_NAME}@${version}`;
    case 'pnpm-global':
      return `pnpm add -g ${NPM_PACKAGE_NAME}@${version}`;
    case 'yarn-global':
      return `yarn global add ${NPM_PACKAGE_NAME}@${version}`;
    case 'bun-global':
      return `bun add -g ${NPM_PACKAGE_NAME}@${version}`;
    case 'homebrew':
      return 'brew upgrade kimi-code';
    case 'github-checkout':
      return gitCheckoutUpdateCommand();
    case 'native':
      return platform === 'win32' ? NATIVE_INSTALL_COMMAND_WIN : NATIVE_INSTALL_COMMAND_UNIX;
    case 'unsupported':
      return `npm install -g ${NPM_PACKAGE_NAME}@${version}`;
  }
}

export function canAutoInstall(source: InstallSource, platform: NodeJS.Platform): boolean {
  switch (source) {
    case 'npm-global':
    case 'pnpm-global':
    case 'yarn-global':
    case 'bun-global':
      return true;
    case 'homebrew':
      // Homebrew upgrade may mutate other dependents and the formula can lag
      // behind the CDN release — prompt the user to run `brew upgrade` manually.
      return false;
    case 'github-checkout':
      return platform !== 'win32';
    case 'native':
      return platform !== 'win32';
    case 'unsupported':
      return false;
  }
}

interface SpawnCommand {
  readonly cmd: string;
  readonly args: readonly string[];
}

export function spawnForSource(
  source: InstallSource,
  version: string,
  platform: NodeJS.Platform,
): SpawnCommand {
  switch (source) {
    case 'npm-global':
      return { cmd: withCmdSuffix('npm', platform), args: ['install', '-g', `${NPM_PACKAGE_NAME}@${version}`] };
    case 'pnpm-global':
      return { cmd: withCmdSuffix('pnpm', platform), args: ['add', '-g', `${NPM_PACKAGE_NAME}@${version}`] };
    case 'yarn-global':
      return { cmd: withCmdSuffix('yarn', platform), args: ['global', 'add', `${NPM_PACKAGE_NAME}@${version}`] };
    case 'bun-global':
      return { cmd: bunCommand(platform), args: ['add', '-g', `${NPM_PACKAGE_NAME}@${version}`] };
    case 'homebrew':
      return { cmd: 'brew', args: ['upgrade', 'kimi-code'] };
    case 'github-checkout':
      return { cmd: 'bash', args: ['-lc', gitCheckoutUpdateScript()] };
    case 'native':
      // `curl … | bash` reports only the trailing bash's exit status, so a
      // failed download (curl can't connect → empty stdin → bash exits 0)
      // would look like a successful update. `pipefail` makes the pipeline
      // surface curl's non-zero status so installUpdate() rejects and we warn
      // instead of printing "Updated …".
      return { cmd: 'bash', args: ['-c', `set -o pipefail; ${NATIVE_INSTALL_COMMAND_UNIX}`] };
    case 'unsupported':
      throw new Error('unsupported install source cannot be auto-installed');
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function renderManualUpdateMessage(
  currentVersion: string,
  target: UpdateTarget,
  source: InstallSource,
  installCommand: string,
): string {
  let sourceDesc: string;
  switch (source) {
    case 'npm-global':
    case 'pnpm-global':
    case 'yarn-global':
    case 'bun-global':
      sourceDesc = source;
      break;
    case 'homebrew':
      sourceDesc = 'homebrew';
      break;
    case 'github-checkout':
      sourceDesc = t('cli.runtime.update.source.githubCheckout');
      break;
    case 'native':
      sourceDesc = t('cli.runtime.update.source.native');
      break;
    case 'unsupported':
      sourceDesc = t('cli.runtime.update.source.unsupported');
      break;
  }
  return (
    `${t('cli.runtime.update.manualHeader', {
      package: NPM_PACKAGE_NAME,
      current: currentVersion,
      target: target.version,
    })}\n` +
    `${t('cli.runtime.update.manualSource', { source: sourceDesc })}\n` +
    `${t('cli.runtime.update.manualCommand', { command: installCommand })}\n`
  );
}

export function renderInstallSuccessMessage(target: UpdateTarget): string {
  return tln('cli.runtime.update.installSuccess', {
    package: NPM_PACKAGE_NAME,
    version: target.version,
  });
}

function renderGithubCheckoutInstallSuccessMessage(target: UpdateTarget): string {
  return tln('cli.runtime.update.githubInstallSuccess', {
    product: PRODUCT_NAME,
    version: target.version,
  });
}

function renderBackgroundInstallSuccessNotice(version: string, source?: InstallSource): string {
  if (source === 'github-checkout') {
    return tln('cli.runtime.update.backgroundGithub', {
      product: PRODUCT_NAME,
      version,
    });
  }
  const displayVersion = version.startsWith('v') ? version : `v${version}`;
  return t('cli.runtime.update.backgroundSuccess', {
    product: PRODUCT_NAME,
    version: displayVersion,
    changelog: CHANGELOG_URL,
  });
}

function refreshInBackground(): void {
  void refreshUpdateCache().catch(() => {});
}

/** Telemetry properties describing where this device sits in the rollout. */
interface RolloutTelemetry {
  readonly rollout_bucket: number;
  readonly rollout_delay_seconds: number;
  readonly rollout_from_manifest: boolean;
  readonly rollout_bypassed: boolean;
}

function rolloutTelemetryFor(
  deviceId: string,
  targetVersion: string,
  manifest: UpdateManifest | null,
  bypassRollout: boolean,
): RolloutTelemetry {
  const bucket = rolloutBucket(deviceId, targetVersion);
  return {
    rollout_bucket: bucket,
    rollout_delay_seconds:
      manifest === null || bypassRollout ? 0 : rolloutDelayForBucket(manifest.rollout, bucket),
    rollout_from_manifest: manifest !== null,
    rollout_bypassed: bypassRollout,
  };
}

type RolloutCheckPhase = 'startup-cache' | 'background-refresh' | 'prompt-refresh';

/** Record which case a passive version check hit in `updates/rollout.log`. */
function logRolloutDecision(
  phase: RolloutCheckPhase,
  currentVersion: string,
  latest: string | null,
  manifest: UpdateManifest | null,
  decision: PassiveUpdateDecision,
): void {
  void appendRolloutDecisionLog({
    ts: nowIso(),
    phase,
    reason: decision.reason,
    current: currentVersion,
    latest,
    target: decision.target?.version ?? null,
    manifestPresent: manifest !== null,
    publishedAt: manifest?.publishedAt ?? null,
    bucket: decision.bucket,
    delaySeconds: decision.delaySeconds,
    eligibleAt: decision.eligibleAt,
  });
}

function refreshAndMaybeInstallInBackground(
  currentVersion: string,
  deviceId: string,
  bypassRollout: boolean,
  isInteractive: boolean,
  installState: UpdateInstallState,
  platform: NodeJS.Platform,
  track: RunUpdatePreflightOptions['track'],
  logger: UpdateLogger,
): void {
  void (async () => {
    const refreshed = await refreshUpdateCache();
    if (!isInteractive) return;
    const decision = decidePassiveUpdateTarget(
      currentVersion,
      refreshed.latest,
      refreshed.manifest,
      deviceId,
      new Date(),
      bypassRollout,
    );
    logRolloutDecision('background-refresh', currentVersion, refreshed.latest, refreshed.manifest, decision);
    const target = decision.target;
    if (target === null) return;
    const source = await detectInstallSource().catch(() => 'unsupported' as const);
    await tryStartAutomaticBackgroundInstall(
      installState,
      currentVersion,
      target,
      source,
      platform,
      track,
      logger,
      rolloutTelemetryFor(deviceId, target.version, refreshed.manifest, bypassRollout),
    );
  })().catch(() => {});
}

interface UserVisibleUpdateTarget {
  readonly target: UpdateTarget | null;
  readonly manifest: UpdateManifest | null;
}

async function refreshUserVisibleUpdateTarget(
  currentVersion: string,
  deviceId: string,
  bypassRollout: boolean,
  fallbackTarget: UpdateTarget,
  fallbackManifest: UpdateManifest | null,
): Promise<UserVisibleUpdateTarget> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const fallback: UserVisibleUpdateTarget = {
    target: fallbackTarget,
    manifest: fallbackManifest,
  };
  try {
    const refresh = refreshUpdateCache()
      .then((refreshed) => {
        const decision = decidePassiveUpdateTarget(
          currentVersion,
          refreshed.latest,
          refreshed.manifest,
          deviceId,
          new Date(),
          bypassRollout,
        );
        logRolloutDecision('prompt-refresh', currentVersion, refreshed.latest, refreshed.manifest, decision);
        return {
          target: decision.target,
          manifest: refreshed.manifest,
        };
      })
      .catch(() => fallback);
    const timeoutFallback = new Promise<UserVisibleUpdateTarget>((resolve) => {
      timeout = setTimeout(() => {
        resolve(fallback);
      }, USER_VISIBLE_UPDATE_REFRESH_TIMEOUT_MS);
    });
    return await Promise.race([refresh, timeoutFallback]);
  } catch {
    return fallback;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function failureAttemptsFor(state: UpdateInstallState, target: UpdateTarget): number {
  return state.lastFailure?.version === target.version ? state.lastFailure.attempts : 0;
}

function hasFreshActiveInstall(state: UpdateInstallState, target: UpdateTarget): boolean {
  const active = state.active;
  if (active === null || active.version !== target.version) return false;
  const startedAt = Date.parse(active.startedAt);
  if (!Number.isFinite(startedAt)) return false;
  return Date.now() - startedAt < AUTO_INSTALL_ACTIVE_TTL_MS;
}

async function showPendingBackgroundInstallNotice(
  state: UpdateInstallState,
  currentVersion: string,
  stdout: { write(chunk: string): boolean },
  track: RunUpdatePreflightOptions['track'],
  logger: UpdateLogger,
): Promise<UpdateInstallState> {
  const success = state.lastSuccess;
  const shouldShowSuccessNotice = success !== null
    && success.notifiedAt === null
    && (success.version === currentVersion || success.source === 'github-checkout');
  if (shouldShowSuccessNotice) {
    stdout.write(renderBackgroundInstallSuccessNotice(success.version, success.source));
    trackUpdateEvent(track, 'update_success_notice_shown', {
      version: success.version,
      source: success.source,
      inferred_from_active: false,
    });
    logUpdateInfo(logger, 'background update success notice shown', {
      version: success.version,
      inferredFromActive: false,
    });
    const nextState: UpdateInstallState = {
      ...state,
      active: null,
      lastFailure: null,
      lastSuccess: {
        ...success,
        notifiedAt: nowIso(),
      },
    };
    await writeUpdateInstallState(nextState).catch(() => {});
    return nextState;
  }

  const active = state.active;
  if (active === null || active.version !== currentVersion) return state;
  if (success !== null && success.version === currentVersion && success.notifiedAt !== null) {
    return state;
  }

  const notifiedAt = nowIso();
  stdout.write(renderBackgroundInstallSuccessNotice(active.version, active.source));
  trackUpdateEvent(track, 'update_success_notice_shown', {
    version: active.version,
    source: active.source,
    inferred_from_active: true,
  });
  logUpdateInfo(logger, 'background update success notice shown', {
    version: active.version,
    inferredFromActive: true,
  });
  const nextState: UpdateInstallState = {
    ...state,
    active: null,
    lastFailure: null,
    lastSuccess: {
      version: active.version,
      source: active.source,
      installedAt: notifiedAt,
      notifiedAt,
    },
  };
  await writeUpdateInstallState(nextState).catch(() => {});
  return nextState;
}

/**
 * `SUPERLIORA_NO_AUTO_UPDATE` (or the legacy `KIMI_CLI_NO_AUTO_UPDATE` alias)
 * fully disables the update preflight — no check, no background install, no
 * prompt. Migrated from kimi-cli, where the variable gated all auto-update
 * behavior. Accepts the usual truthy values (`1`/`true`/`yes`/`on`).
 */
function isAutoUpdateDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const truthy = (value?: string): boolean =>
    ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
  return truthy(env['SUPERLIORA_NO_AUTO_UPDATE']) || truthy(env['KIMI_CLI_NO_AUTO_UPDATE']);
}

async function shouldAutoInstallUpdates(): Promise<boolean> {
  try {
    const config = await loadTuiConfig();
    return config.upgrade.autoInstall;
  } catch {
    return true;
  }
}

function trackUpdatePrompted(
  track: RunUpdatePreflightOptions['track'],
  currentVersion: string,
  target: UpdateTarget,
  source: InstallSource,
  decision: UpdateDecision,
  rolloutTelemetry: RolloutTelemetry,
): void {
  trackUpdateEvent(track, 'update_prompted', {
    current_version: currentVersion,
    target_version: target.version,
    source,
    decision,
    ...rolloutTelemetry,
  });
}

function trackUpdateEvent(
  track: RunUpdatePreflightOptions['track'],
  event: string,
  properties: TelemetryProperties,
): void {
  try {
    track?.(event, properties);
  } catch {
    // Telemetry must never affect update prompting.
  }
}

function logUpdateInfo(logger: UpdateLogger, message: string, payload: Record<string, unknown>): void {
  try {
    logger.info(message, payload);
  } catch {
    // Diagnostic logging must never affect update prompting.
  }
}

function logUpdateWarn(logger: UpdateLogger, message: string, payload: Record<string, unknown>): void {
  try {
    logger.warn(message, payload);
  } catch {
    // Diagnostic logging must never affect update prompting.
  }
}

async function promptInstall(
  currentVersion: string,
  target: UpdateTarget,
  source: InstallSource,
  installCommand: string,
): Promise<InstallPromptChoiceValue> {
  const options: InstallPromptOptions = {
    currentVersion,
    target,
    installSource: source,
    installCommand,
  };
  return promptForInstallChoice(options);
}

export async function installUpdate(
  source: InstallSource,
  version: string,
  platform: NodeJS.Platform,
): Promise<void> {
  const { cmd, args } = spawnForSource(source, version, platform);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, [...args], {
      stdio: 'inherit',
      shell: platform === 'win32' ? true : undefined,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = signal !== null ? `signal ${signal}` : `code ${String(code)}`;
      reject(new Error(`${cmd} exited with ${detail}`));
    });
  });
}

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
    });

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

async function startBackgroundInstall(
  state: UpdateInstallState,
  currentVersion: string,
  target: UpdateTarget,
  source: InstallSource,
  platform: NodeJS.Platform,
  track: RunUpdatePreflightOptions['track'],
  logger: UpdateLogger,
  rolloutTelemetry: RolloutTelemetry,
): Promise<void> {
  const lock = await tryAcquireUpdateInstallLock({ version: target.version });
  if (lock === null) return;

  try {
    const freshState = await readUpdateInstallState().catch(() => state);
    if (
      hasFreshActiveInstall(freshState, target) ||
      failureAttemptsFor(freshState, target) >= AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD
    ) {
      return;
    }

    const startedState: UpdateInstallState = {
      ...freshState,
      active: {
        version: target.version,
        source,
        startedAt: nowIso(),
      },
    };
    await writeUpdateInstallState(startedState);
    trackUpdateEvent(track, 'update_background_install_started', {
      current_version: currentVersion,
      target_version: target.version,
      source,
      ...rolloutTelemetry,
    });
    logUpdateInfo(logger, 'background update install started', {
      currentVersion,
      targetVersion: target.version,
      source,
    });

    const { cmd, args } = spawnForSource(source, target.version, platform);
    let settled = false;

    const finish = (succeeded: boolean): void => {
      if (settled) return;
      settled = true;
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
      void writeUpdateInstallState(nextState).catch(() => {});
      if (succeeded) {
        trackUpdateEvent(track, 'update_background_install_succeeded', {
          target_version: target.version,
          source,
        });
        logUpdateInfo(logger, 'background update install succeeded', {
          targetVersion: target.version,
          source,
        });
        return;
      }
      trackUpdateEvent(track, 'update_background_install_failed', {
        target_version: target.version,
        source,
        attempts,
      });
      logUpdateWarn(logger, 'background update install failed', {
        targetVersion: target.version,
        source,
        attempts,
      });
    };

    const child = spawn(cmd, [...args], {
      detached: true,
      stdio: 'ignore',
      shell: platform === 'win32' ? true : undefined,
    });
    child.once('error', () => { finish(false); });
    child.once('exit', (code) => { finish(code === 0); });
    child.unref();
  } finally {
    await lock.release().catch(() => {});
  }
}

async function tryStartAutomaticBackgroundInstall(
  installState: UpdateInstallState,
  currentVersion: string,
  target: UpdateTarget,
  source: InstallSource,
  platform: NodeJS.Platform,
  track: RunUpdatePreflightOptions['track'],
  logger: UpdateLogger,
  rolloutTelemetry: RolloutTelemetry,
): Promise<boolean> {
  const sourceCanAutoInstall = canAutoInstall(source, platform);
  const autoInstallUpdates = sourceCanAutoInstall ? await shouldAutoInstallUpdates() : false;
  if (!autoInstallUpdates || !sourceCanAutoInstall) return false;
  if (failureAttemptsFor(installState, target) >= AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD) {
    return false;
  }
  if (!hasFreshActiveInstall(installState, target)) {
    await startBackgroundInstall(
      installState,
      currentVersion,
      target,
      source,
      platform,
      track,
      logger,
      rolloutTelemetry,
    ).catch(() => {});
  }
  return true;
}

export function decideUpdateAction(
  target: UpdateTarget | null,
  isInteractive: boolean,
  source: InstallSource,
  platform: NodeJS.Platform,
): UpdateDecision {
  if (target === null || !isInteractive) return 'none';
  return canAutoInstall(source, platform) ? 'prompt-install' : 'manual-command';
}

export async function runUpdatePreflight(
  currentVersion: string,
  options: RunUpdatePreflightOptions = {},
): Promise<UpdatePreflightResult> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const logger = options.logger ?? log;
  const platform = process.platform;

  if (isAutoUpdateDisabledByEnv()) {
    return 'continue';
  }

  try {
    const isInteractive =
      options.isTTY ?? (process.stdin.isTTY && process.stdout.isTTY);
    const deviceId = resolveUpdateDeviceId();
    const bypassRollout = isRolloutBypassedByExperimentalEnv();
    let installState = await readUpdateInstallState().catch(() => emptyUpdateInstallState());
    if (isInteractive) {
      installState = await showPendingBackgroundInstallNotice(
        installState,
        currentVersion,
        stdout,
        options.track,
        logger,
      );
    }

    const githubCheckoutRoot =
      isInteractive ? await detectSuperLioraGithubCheckout().catch(() => null) : null;
    if (githubCheckoutRoot !== null) {
      const source: InstallSource = 'github-checkout';
      const refreshResult = await refreshGitCheckoutUpdateTarget(githubCheckoutRoot).catch(
        () => null,
      );
      // temporary shim until Task 2/3 lands structured handling
      const target = refreshResult?.status === 'update' ? refreshResult.target : null;
      if (target === null) return 'continue';
      const rolloutTelemetry = {
        rollout_bucket: 0,
        rollout_delay_seconds: 0,
        rollout_from_manifest: false,
        rollout_bypassed: true,
      };
      const decision = decideUpdateAction(target, isInteractive, source, platform);
      if (
        await tryStartAutomaticBackgroundInstall(
          installState,
          currentVersion,
          target,
          source,
          platform,
          options.track,
          logger,
          rolloutTelemetry,
        )
      ) {
        return 'continue';
      }
      const installCommand = installCommandFor(source, target.version, platform);
      trackUpdatePrompted(options.track, currentVersion, target, source, decision, rolloutTelemetry);
      if (decision === 'manual-command') {
        return { action: 'continue', updateNotice: { currentVersion, targetVersion: target.version, installCommand } };
      }
      const choice = await promptInstall(currentVersion, target, source, installCommand);
      if (choice === 'skip') return 'continue';
      try {
        await installUpdate(source, target.version, platform);
        stdout.write(renderGithubCheckoutInstallSuccessMessage(target));
        return 'exit';
      } catch (error) {
        stderr.write(
          tln('cli.runtime.upgrade.githubInstallFailed', {
            product: PRODUCT_NAME,
            reason: formatErrorMessage(error),
          }),
        );
        return 'continue';
      }
    }

    const cache = await readUpdateCache().catch(() => null);
    const cachedManifest = cache?.manifest ?? null;
    const cachedDecision = decidePassiveUpdateTarget(
      currentVersion,
      cache?.latest ?? null,
      cachedManifest,
      deviceId,
      new Date(),
      bypassRollout,
    );
    logRolloutDecision('startup-cache', currentVersion, cache?.latest ?? null, cachedManifest, cachedDecision);
    const target = cachedDecision.target;
    if (target === null) {
      refreshAndMaybeInstallInBackground(
        currentVersion,
        deviceId,
        bypassRollout,
        isInteractive,
        installState,
        platform,
        options.track,
        logger,
      );
      return 'continue';
    }

    const source: InstallSource =
      isInteractive
        ? await detectInstallSource().catch(() => 'unsupported' as const)
        : 'unsupported';
    const decision = decideUpdateAction(target, isInteractive, source, platform);
    if (decision === 'none') {
      refreshInBackground();
      return 'continue';
    }

    if (
      await tryStartAutomaticBackgroundInstall(
        installState,
        currentVersion,
        target,
        source,
        platform,
        options.track,
        logger,
        rolloutTelemetryFor(deviceId, target.version, cachedManifest, bypassRollout),
      )
    ) {
      refreshInBackground();
      return 'continue';
    }

    const userVisibleUpdate = await refreshUserVisibleUpdateTarget(
      currentVersion,
      deviceId,
      bypassRollout,
      target,
      cachedManifest,
    );
    const userVisibleTarget = userVisibleUpdate.target;
    if (userVisibleTarget === null) return 'continue';
    const userVisibleRollout = rolloutTelemetryFor(
      deviceId,
      userVisibleTarget.version,
      userVisibleUpdate.manifest,
      bypassRollout,
    );
    if (
      await tryStartAutomaticBackgroundInstall(
        installState,
        currentVersion,
        userVisibleTarget,
        source,
        platform,
        options.track,
        logger,
        userVisibleRollout,
      )
    ) {
      return 'continue';
    }

    const installCommand = installCommandFor(source, userVisibleTarget.version, platform);
    trackUpdatePrompted(options.track, currentVersion, userVisibleTarget, source, decision, userVisibleRollout);

    if (decision === 'manual-command') {
      return { action: 'continue', updateNotice: { currentVersion, targetVersion: userVisibleTarget.version, installCommand } };
    }

    const choice = await promptInstall(currentVersion, userVisibleTarget, source, installCommand);
    if (choice === 'skip') return 'continue';

    try {
      await installUpdate(source, userVisibleTarget.version, platform);
      stdout.write(renderInstallSuccessMessage(userVisibleTarget));
      return 'exit';
    } catch (error) {
      stderr.write(
        tln('cli.runtime.upgrade.installFailed', {
          package: NPM_PACKAGE_NAME,
          version: userVisibleTarget.version,
          reason: formatErrorMessage(error),
        }),
      );
      return 'continue';
    }
  } catch {
    return 'continue';
  }
}
