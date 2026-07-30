import {
  setCrashPhase,
  setTelemetryContext,
  shutdownTelemetry,
  track,
  withTelemetryContext,
} from '@superliora/telemetry';
import {
  createLioraHarness,
  log,
  type TelemetryClient,
} from '@superliora/sdk';

import { CLI_SHUTDOWN_TIMEOUT_MS, PROMPT_CLEANUP_TIMEOUT_MS } from '#/constant/app';

import { parseHeadlessGoalCreate } from './goal-prompt';
import { createCliTelemetryBootstrap, initializeCliTelemetry } from './telemetry';
import type { CLIOptions } from './options';
import { resolveSessionWorkDir } from './resolve-worktree';
import {
  installPromptTerminationCleanup,
  raceWithTimeout,
  type PromptRunIO,
} from './run-prompt-io';
import {
  maybeAutoResumeHeadlessUltrawork,
  mergeRecoveryPrompt,
  runHeadlessGoal,
} from './run-prompt-headless-goal';
import { resolvePromptSession } from './run-prompt-session';
import { runPromptTurn } from './run-prompt-turn';
import { writeResumeHint } from './run-prompt-writers';
import { createLioraHostIdentity } from './version';

const PROMPT_UI_MODE = 'print';

export async function runPrompt(
  opts: CLIOptions,
  version: string,
  io: PromptRunIO = {},
): Promise<void> {
  const startedAt = Date.now();
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const promptProcess = io.process ?? process;
  const resolvedWork = await resolveSessionWorkDir({ worktree: opts.worktree });
  const workDir = resolvedWork.workDir;
  const telemetryBootstrap = createCliTelemetryBootstrap();
  const telemetryClient: TelemetryClient = {
    track,
    withContext: withTelemetryContext,
    setContext: setTelemetryContext,
  };
  const harness = createLioraHarness({
    homeDir: telemetryBootstrap.homeDir,
    identity: createLioraHostIdentity(version),
    uiMode: PROMPT_UI_MODE,
    skillDirs: opts.skillsDirs,
    telemetry: telemetryClient,
    onOAuthRefresh: (outcome) => {
      if (outcome.success) {
        track('oauth_refresh', { success: true });
        return;
      }
      track('oauth_refresh', { success: false, reason: outcome.reason });
    },
    sessionStartedProperties: { yolo: false, plan: false, afk: true },
  });
  log.info('liora starting', {
    version,
    uiMode: PROMPT_UI_MODE,
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    workDir,
  });
  let restorePromptSessionPermission = async (): Promise<void> => {};
  let removeTerminationCleanup: (() => void) | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanupPromptRun = async (): Promise<void> => {
    const pending = (cleanupPromise ??= (async () => {
      removeTerminationCleanup?.();
      setCrashPhase('shutdown');
      try {
        await restorePromptSessionPermission();
      } finally {
        await shutdownTelemetry({ timeoutMs: CLI_SHUTDOWN_TIMEOUT_MS });
        await harness.close();
      }
    })());
    await raceWithTimeout(pending, PROMPT_CLEANUP_TIMEOUT_MS);
  };
  removeTerminationCleanup = installPromptTerminationCleanup(
    promptProcess,
    cleanupPromptRun,
    () => harness.emergencyFlushSync(),
  );

  try {
    await harness.ensureConfigFile();
    const config = await harness.getConfig();
    for (const warning of (await harness.getConfigDiagnostics()).warnings) {
      stderr.write(`Warning: ${warning}\n`);
    }
    const { session, resumed, restorePermission, telemetryModel, goalModel } =
      await resolvePromptSession(
        harness,
        opts,
        workDir,
        config.defaultModel,
        stderr,
        (restorePermission) => {
          restorePromptSessionPermission = restorePermission;
        },
        resolvedWork.metadata as import('@superliora/sdk').JsonObject | undefined,
      );
    restorePromptSessionPermission = restorePermission;

    initializeCliTelemetry({
      harness,
      bootstrap: telemetryBootstrap,
      config,
      version,
      uiMode: PROMPT_UI_MODE,
      model: telemetryModel,
    });
    setCrashPhase('runtime');

    const outputFormat = opts.outputFormat ?? 'text';
    // Headless goal mode: `liora -p "/goal <objective>"`. The goal driver keeps
    // the turn-run alive across continuation turns, so the normal prompt-turn
    // waiter blocks until the goal is terminal; we then emit a summary and set a
    // distinct exit code.
    const goalCreate = parseHeadlessGoalCreate(opts.prompt!);
    const recoveryPrefix =
      resumed ? await maybeAutoResumeHeadlessUltrawork(session, stderr) : undefined;
    if (goalCreate !== undefined) {
      await runHeadlessGoal(
        session,
        goalCreate,
        goalModel,
        outputFormat,
        opts.showThinking === true,
        stdout,
        stderr,
        recoveryPrefix,
      );
    } else {
      const prompt = mergeRecoveryPrompt(opts.prompt!, recoveryPrefix);
      await runPromptTurn(
        session,
        prompt,
        outputFormat,
        opts.showThinking === true,
        stdout,
        stderr,
      );
    }
    writeResumeHint(session.id, outputFormat, stdout, stderr);

    withTelemetryContext({ sessionId: session.id }).track('exit', {
      duration_s: (Date.now() - startedAt) / 1000,
    });
  } finally {
    await cleanupPromptRun();
  }
}

export type { PromptRunIO } from './run-prompt-io';
