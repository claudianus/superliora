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

import { createMarketplaceSourceResolver } from '#/utils/plugin-marketplace-resolver';
import { parseHeadlessGoalCreate } from './goal-prompt';
import { createCliTelemetryBootstrap, initializeCliTelemetry } from './telemetry';
import {
  captureJobBaseline,
  collectJobsCreatedDuringRun,
  formatHeadlessJobSummaryText,
  headlessJobExitCode,
  summarizeHeadlessJobs,
} from './headless-jobs';
import type { CLIOptions } from './options';
import { applyNoProcessSandboxFlag } from './options';
import { resolveSessionWorkDir } from './resolve-worktree';
import {
  installPromptTerminationCleanup,
  raceWithTimeout,
  type PromptRunIO,
} from './run-prompt-io';
import { runHeadlessGoal } from './run-prompt-headless-goal';
import { resolvePromptSession } from './run-prompt-session';
import { runPromptTurn } from './run-prompt-turn';
import { writeResumeHint } from './run-prompt-writers';
import { startHarnessOAuthProactiveRefresh } from '#/utils/oauth/proactive-refresh-host';

import { createLioraHostIdentity } from './version';

const PROMPT_UI_MODE = 'print';

export async function runPrompt(
  opts: CLIOptions,
  version: string,
  io: PromptRunIO = {},
): Promise<void> {
  applyNoProcessSandboxFlag(opts);
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
    projectDir: workDir,
    pluginDirs: opts.pluginDirs,
    channelServers: opts.channelServers,
    resolveMarketplaceSource: createMarketplaceSourceResolver(workDir),
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
  const oauthProactiveRefresh = startHarnessOAuthProactiveRefresh(harness, {
    onDegraded: (event) => {
      log.warn('oauth proactive refresh degraded', {
        scope: event.scope,
        reason: event.reason,
        hint: event.hint,
      });
    },
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
      oauthProactiveRefresh?.stop();
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
    () =>{  harness.emergencyFlushSync(); },
  );

  try {
    await harness.ensureConfigFile();
    const config = await harness.getConfig();
    for (const warning of (await harness.getConfigDiagnostics()).warnings) {
      stderr.write(`Warning: ${warning}\n`);
    }
    const { session, restorePermission, telemetryModel, goalModel } =
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
    const parsedGoal = parseHeadlessGoalCreate(opts.prompt!);
    const goalCreate =
      parsedGoal !== undefined && opts.autonomousGate !== undefined
        ? { ...parsedGoal, gateCommand: opts.autonomousGate }
        : parsedGoal;
    // Conductor jobs are spawned asynchronously from the main turn, so a plain
    // `-p` run used to print nothing about the jobs it created. Capture the
    // ledger baseline first, then report the jobs created during this run.
    const jobBaseline = await captureJobBaseline(session);
    if (goalCreate !== undefined) {
      await runHeadlessGoal(
        session,
        goalCreate,
        goalModel,
        outputFormat,
        opts.showThinking === true,
        stdout,
        stderr,
      );
    } else {
      await runPromptTurn(
        session,
        opts.prompt!,
        outputFormat,
        opts.showThinking === true,
        stdout,
        stderr,
      );
    }
    const createdJobs = await collectJobsCreatedDuringRun(session, jobBaseline);
    if (createdJobs.length > 0) {
      const summary = summarizeHeadlessJobs(createdJobs);
      if (outputFormat === 'stream-json') {
        stdout.write(`${JSON.stringify(summary)}\n`);
      } else {
        stderr.write(`${formatHeadlessJobSummaryText(summary)}\n`);
      }
      // The goal path already maps its terminal status to an exit code; keep
      // that authoritative. Plain prompts get the job exit-code contract.
      if (goalCreate === undefined) {
        process.exitCode = headlessJobExitCode(summary);
      }
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
