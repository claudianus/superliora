import { execSync } from 'node:child_process';

import {
  createLioraHarness,
  log,
  resolveGlobalLogPath,
  type LioraHarness,
  type TelemetryClient,
} from '@superliora/sdk';
import {
  setCrashPhase,
  setTelemetryContext,
  shutdownTelemetry,
  track,
  withTelemetryContext,
} from '@superliora/telemetry';

import { tln } from '#/cli/i18n';
import { CLI_SHUTDOWN_TIMEOUT_MS, CLI_UI_MODE } from '#/constant/app';
import { refreshShikiPalette } from '#/tui/components/media/shiki-ansi';
import type { TuiConfig } from '#/tui/config';
import { loadTuiConfig, TuiConfigParseError } from '#/tui/config';
import { CHROME_GUTTER } from '#/tui/constant/rendering';
import { LioraTUI } from '#/tui/index';
import { currentTheme, getColorPalette, refreshPluginThemeCatalog } from '#/tui/theme';
import { initImageProtocolProbe } from '#/tui/utils/image/image-protocol-detect';
import { combineStartupNotice } from '#/tui/utils/startup';
import { toTerminalHyperlink } from '#/utils/terminal-hyperlink';

import { createMarketplaceSourceResolver } from '#/utils/plugin-marketplace-resolver';

import type { CLIOptions } from './options';
import { resolveSessionWorkDir } from './resolve-worktree';
import { createCliTelemetryBootstrap, initializeCliTelemetry } from './telemetry';
import type { UpdateLifecycleNotice, UpdateNoticeInfo } from './update/types';
import type { RuntimeDegradedEvent } from '@superliora/protocol';

import { startHarnessOAuthProactiveRefresh, buildOAuthRefreshDegradedEventFromOutcome } from '#/utils/oauth/proactive-refresh-host';

import { createLioraHostIdentity } from './version';

export async function runShell(
  opts: CLIOptions,
  version: string,
  updateNotice?: UpdateNoticeInfo,
  updateLifecycle?: UpdateLifecycleNotice,
): Promise<void> {
  const startedAt = Date.now();
  const configStartedAt = startedAt;
  let tuiConfig: TuiConfig;
  let configWarning: string | undefined;
  try {
    tuiConfig = await loadTuiConfig();
  } catch (error) {
    if (!(error instanceof TuiConfigParseError)) throw error;
    tuiConfig = error.fallback;
    configWarning = error.message;
  }

  // Probe runtime kitty graphics support in the same pre-raw-mode window —
  // once the TUI owns stdin the probe reply would be eaten by the input loop.
  // Theme palette waits until plugin themes are catalogued so a persisted
  // plugin theme id does not silently fall back to dark.
  await initImageProtocolProbe();

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
    projectDir: workDir,
    pluginDirs: opts.pluginDirs,
    channelServers: opts.channelServers,
    skillDirs: opts.skillsDirs,
    resolveMarketplaceSource: createMarketplaceSourceResolver(workDir),
    telemetry: telemetryClient,
    onOAuthRefresh: (outcome) => {
      if (outcome.success) {
        track('oauth_refresh', { success: true });
        return;
      }
      track('oauth_refresh', { success: false, reason: outcome.reason });
      surfaceOAuthDegraded?.(buildOAuthRefreshDegradedEventFromOutcome(outcome));
    },
    sessionStartedProperties: { yolo: opts.yolo, auto: opts.auto, plan: opts.plan, afk: false },
  });
  let surfaceOAuthDegraded: ((event: RuntimeDegradedEvent) => void) | undefined;
  const oauthProactiveRefresh = startHarnessOAuthProactiveRefresh(harness, {
    onDegraded: (event) => surfaceOAuthDegraded?.(event),
  });
  log.info('liora starting', {
    version,
    uiMode: CLI_UI_MODE,
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    workDir,
    globalLogPath: resolveGlobalLogPath(harness.homeDir),
  });

  await harness.ensureConfigFile();
  await refreshPluginThemeCatalog(() => harness.listPluginThemes());
  // Initialise the global Theme singleton before pi-tui grabs stdin.
  const palette = await getColorPalette(tuiConfig.theme);
  currentTheme.setPalette(palette);
  const config = await harness.getConfig();
  for (const warning of (await harness.getConfigDiagnostics()).warnings) {
    configWarning = combineStartupNotice(configWarning, warning);
  }
  if (resolvedWork.worktreeMeta !== undefined) {
    configWarning = combineStartupNotice(
      configWarning,
      `Worktree session: ${resolvedWork.worktreeMeta.name} → ${resolvedWork.workDir}`,
    );
  }
  const configMs = Date.now() - configStartedAt;
  const tui = new LioraTUI(harness, {
    cliOptions: opts,
    additionalDirs: opts.addDirs?.length ? opts.addDirs : undefined,
    tuiConfig,
    version,
    workDir,
    startupNotice: configWarning,
    updateNotice,
    updateLifecycle,
    sessionMetadata: resolvedWork.metadata as import('@superliora/sdk').JsonObject | undefined,
  });
  surfaceOAuthDegraded = (event) => {
    tui.setAppState({
      runtimeDegraded: {
        scope: event.scope,
        reason: event.reason,
        hint: event.hint,
        atMs: event.atMs ?? Date.now(),
      },
    });
  };

  initializeCliTelemetry({
    harness,
    bootstrap: telemetryBootstrap,
    config,
    version,
    uiMode: CLI_UI_MODE,
  });
  setCrashPhase('runtime');

  const trackLifecycleForSession = (
    sessionId: string,
    event: string,
    properties?: Parameters<LioraHarness['track']>[1],
  ) => {
    if (sessionId.length === 0) {
      harness.track(event, properties);
      return;
    }
    withTelemetryContext({ sessionId }).track(event, properties);
  };
  const trackLifecycle = (event: string, properties?: Parameters<LioraHarness['track']>[1]) => {
    trackLifecycleForSession(tui.getCurrentSessionId(), event, properties);
  };

  tui.onExit = async (exitCode = 0) => {
    oauthProactiveRefresh?.stop();
    const sessionId = tui.getCurrentSessionId();
    const hasContent = tui.hasSessionContent();
    setCrashPhase('shutdown');
    trackLifecycle('exit', { duration_s: (Date.now() - startedAt) / 1000 });
    await shutdownTelemetry({ timeoutMs: CLI_SHUTDOWN_TIMEOUT_MS });
    const gutter = ' '.repeat(CHROME_GUTTER);
    process.stdout.write(`${gutter}${tln('cli.runtime.shell.bye').trimEnd()}\n`);
    const hints: string[] = [];
    if (sessionId !== '' && hasContent) {
      hints.push(`${gutter}To resume this session: liora -r ${sessionId}`);
    }
    if (tui.exitOpenUrl !== undefined) {
      hints.push(`${gutter}open ${toTerminalHyperlink(tui.exitOpenUrl, tui.exitOpenUrl)}`);
    }
    if (hints.length > 0) {
      process.stderr.write(`\n${hints.join('\n')}\n`);
    }
    process.exit(exitCode);
  };
  try {
    execSync('stty -ixon', { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
  try {
    const initStartedAt = Date.now();
    await tui.start();
    const initMs = Date.now() - initStartedAt;
    const startupSessionId = tui.getCurrentSessionId();
    const mcpMs = await tui.getStartupMcpMs();
    trackLifecycleForSession(startupSessionId, 'startup_perf', {
      duration_ms: Date.now() - startedAt,
      config_ms: configMs,
      init_ms: initMs,
      mcp_ms: mcpMs,
    });
  } catch (error) {
    oauthProactiveRefresh?.stop();
    setCrashPhase('shutdown');
    trackLifecycle('exit', { duration_s: (Date.now() - startedAt) / 1000 });
    await shutdownTelemetry({ timeoutMs: CLI_SHUTDOWN_TIMEOUT_MS });
    await harness.close();
    throw error;
  }
}
