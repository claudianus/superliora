/**
 * SuperLiora entry point.
 *
 * Parses CLI arguments via Commander.js, validates options, runs the
 * outer update preflight, then delegates to the requested UI runner.
 */

import {
  createLioraHarness,
  flushDiagnosticLogs,
  installGlobalProxyDispatcher,
  log,
  resolveGlobalLogPath,
  resolveLioraHome,
  type TelemetryClient,
} from '@superliora/sdk';
import {
  installCrashHandlers,
  setTelemetryContext,
  shutdownTelemetry,
  track,
  withTelemetryContext,
} from '@superliora/telemetry';

import { createProgram } from './cli/commands';
import { resolveCliLocale, setCliLocale, tln } from './cli/i18n';
import { loadTuiConfig, TuiConfigParseError } from './tui/config';
import { finalizeHeadlessRun } from './cli/headless-exit';
import type { CLIOptions } from './cli/options';
import { OptionConflictError, validateOptions } from './cli/options';
import { runPrompt } from './cli/run-prompt';
import { runShell } from './cli/run-shell';
import { formatStartupError } from './cli/startup-error';
import { runPluginNodeEntry } from './cli/sub/plugin-run-node';
import { handleUpgrade } from './cli/sub/upgrade';
import { createCliTelemetryBootstrap, initializeCliTelemetry } from './cli/telemetry';
import { runUpdatePreflight } from './cli/update/preflight';
import { createLioraHostIdentity, getVersion } from './cli/version';
import { CLI_SHUTDOWN_TIMEOUT_MS, CLI_UI_MODE, PROCESS_NAME } from './constant/app';
import { cleanupStaleNativeCacheForCurrent } from './native/native-assets';
import { installNativeModuleHook } from './native/module-hook';
import { runNativeAssetSmokeIfRequested } from './native/smoke';

// Suppress Node.js's experimental SQLite warning on startup while keeping
// other warnings visible.
process.on('warning', (warning) => {
  if (
    warning.name === 'ExperimentalWarning' &&
    warning.message.includes('SQLite')
  ) {
    return;
  }
  console.warn(warning);
});

export interface MainCommandOutcome {
  readonly headlessCompleted: boolean;
}

export async function handleMainCommand(
  opts: CLIOptions,
  version: string,
): Promise<MainCommandOutcome> {
  let validated: ReturnType<typeof validateOptions>;
  try {
    validated = validateOptions(opts);
  } catch (error) {
    if (error instanceof OptionConflictError) {
      process.stderr.write(tln('cli.runtime.main.errorPrefix', { message: error.message }));
      process.exit(1);
    }
    throw error;
  }

  const preflightResult = await runUpdatePreflight(
    version,
    validated.uiMode === 'print' ? { track, isTTY: false } : { track },
  );
  if (preflightResult === 'exit') {
    process.exit(0);
  }

  // Structured update feedback for the TUI (available badge + lifecycle toast).
  const updateNotice =
    typeof preflightResult === 'object' && preflightResult !== null
      ? preflightResult.updateNotice
      : undefined;
  const updateLifecycle =
    typeof preflightResult === 'object' && preflightResult !== null
      ? preflightResult.lifecycle
      : undefined;

  if (validated.uiMode === 'print') {
    applyCliProfileOverride(validated.options.profile);
    await runPrompt(validated.options, version);
    return { headlessCompleted: true };
  }

  applyCliProfileOverride(validated.options.profile);
  await runShell(validated.options, version, updateNotice, updateLifecycle);
  return { headlessCompleted: false };
}

export async function handleUpgradeCommand(
  version: string,
  options: { readonly fromMain?: boolean } = {},
): Promise<void> {
  const telemetryBootstrap = createCliTelemetryBootstrap();
  const telemetryClient: TelemetryClient = {
    track,
    withContext: withTelemetryContext,
    setContext: setTelemetryContext,
  };
  const harness = createLioraHarness({
    homeDir: telemetryBootstrap.homeDir,
    identity: createLioraHostIdentity(version),
    telemetry: telemetryClient,
  });
  let exitCode = 1;
  try {
    await harness.ensureConfigFile();
    const config = await harness.getConfig();
    initializeCliTelemetry({
      harness,
      bootstrap: telemetryBootstrap,
      config,
      version,
      uiMode: CLI_UI_MODE,
    });
    exitCode = await handleUpgrade(version, {
      track,
      logger: log,
      fromMain: options.fromMain === true,
    });
  } finally {
    await shutdownTelemetry({ timeoutMs: CLI_SHUTDOWN_TIMEOUT_MS }).catch(() => {});
    await harness.close().catch(() => {});
  }
  process.exit(exitCode);
}

export function main(): void {
  process.title = PROCESS_NAME;
  installCrashHandlers();
  // Route all outbound fetch through HTTP_PROXY/HTTPS_PROXY (honoring NO_PROXY)
  // before any client is constructed. No-op when no proxy variable is set; an
  // invalid proxy URL is reported and ignored rather than aborting startup.
  installGlobalProxyDispatcher();
  installNativeModuleHook();
  if (runNativeAssetSmokeIfRequested()) return;

  // Start the background cleanup of stale native cache. Fire-and-forget; must not block startup or throw.
  queueMicrotask(() => {
    try {
      cleanupStaleNativeCacheForCurrent();
    } catch {
      // ignore: cache GC must never affect process startup
    }
  });

  void bootstrapCli(process.argv);
}

async function bootstrapCli(argv: readonly string[]): Promise<void> {
  const version = getVersion();

  let localePreference: import('./tui/config').LocalePreference | undefined;
  try {
    const tuiConfig = await loadTuiConfig();
    localePreference = tuiConfig?.locale;
  } catch (error) {
    if (!(error instanceof TuiConfigParseError)) throw error;
    localePreference = error.fallback?.locale;
  }

  // Apply locale before building the program so commander help text and TUI
  // catalogs render in the user's language.
  setCliLocale(
    resolveCliLocale({
      preference: localePreference,
      env: process.env,
    }),
  );

  const program = createProgram(
    version,
    (opts) => {
      void handleMainCommand(opts, version)
        .then(async (outcome) => {
          if (outcome.headlessCompleted) {
            await finalizeHeadlessRun(
              process,
              [process.stdout, process.stderr],
              () => Number(process.exitCode) || 0,
            );
          }
        })
        .catch(async (error: unknown) => {
          const operation = opts.prompt !== undefined ? 'run prompt' : 'start shell';
          await logStartupFailure(operation, error);
          process.stderr.write(
            formatStartupError(error, {
              operation,
            }),
          );
          process.stderr.write(
            tln('cli.runtime.main.seeLog', { path: resolveGlobalLogPath(resolveLioraHome()) }),
          );
          process.exit(1);
        });
    },
    (entry, args) => {
      void runPluginNodeEntry(entry, args).catch(async (error: unknown) => {
        await logStartupFailure('run plugin node entry', error);
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
      });
    },
    (opts) => {
      void handleUpgradeCommand(version, opts).catch(async (error: unknown) => {
        await logStartupFailure('upgrade', error);
        process.stderr.write(formatStartupError(error, { operation: 'upgrade' }));
        process.stderr.write(
          tln('cli.runtime.main.seeLog', { path: resolveGlobalLogPath(resolveLioraHome()) }),
        );
        process.exit(1);
      });
    },
  );

  program.parse(argv);
}

main();

function applyCliProfileOverride(profile: string | undefined): void {
  const trimmed = profile?.trim();
  if (trimmed === undefined || trimmed.length === 0) return;
  process.env['SUPERLIORA_PROFILE'] = trimmed;
}

async function logStartupFailure(operation: string, error: unknown): Promise<void> {
  log.error('startup failed', { operation, error });
  try {
    await flushDiagnosticLogs();
  } catch {
    // Best-effort diagnostic flush only.
  }
}
