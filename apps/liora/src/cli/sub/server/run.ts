/**
 * `liora server run` — starts the local API server.
 *
 * By default this ensures a single background daemon is running (spawning a
 * detached `liora server run --daemon` child when needed) and returns once it is
 * healthy. Pass `--foreground` to run the server in-process and keep this
 * terminal attached until SIGINT/SIGTERM. OS-managed background operation
 * OS-managed background operation (launchd / systemd / schtasks) lives in the
 * hidden lifecycle command builder.
 *
 */

import { shutdownTelemetry, track } from '@superliora/telemetry';
import { startServer, type RunningServer } from '@superliora/server';
import chalk from 'chalk';
import { Option, type Command } from 'commander';

import { CLI_SHUTDOWN_TIMEOUT_MS } from '#/constant/app';
import { t, tln } from '#/cli/i18n';
import { darkColors } from '#/tui/theme/colors';
import { getDataDir } from '#/utils/paths';

import { initializeServerTelemetry } from '../../telemetry';
import { createLioraHostIdentity, getVersion } from '../../version';
import { accessUrlLines, isLoopbackHost } from './access-urls';
import { ensureDaemon, type EnsureDaemonResult } from './daemon';
import { type NetworkAddress } from './networks';
import {
  DEFAULT_FOREGROUND_LOG_LEVEL,
  DEFAULT_LAN_HOST,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  parseServerOptions,
  tryResolveServerToken,
  VALID_LOG_LEVELS,
  type ParsedServerOptions,
  type ServerCliOptions,
} from './shared';

export interface RunCliOptions extends ServerCliOptions {
  /** Run the server in-process instead of spawning a background daemon. */
  foreground?: boolean;
}

export interface StartForegroundHooks {
  /** Fires once the server is listening, before the foreground runner blocks. */
  onReady?: (origin: string) => void;
}

export interface RunCommandDeps {
  startServerBackground(options: ParsedServerOptions): Promise<{
    origin: string;
    /** True when an already-running daemon was reused (no new server started). */
    reused?: boolean;
    /** Bind host the running daemon is actually listening on (from the lock). */
    host?: string;
    /** Port the running daemon is actually listening on (from the lock). */
    port?: number;
  }>;
  /** Foreground runner; defaults to the real in-process runner when omitted. */
  startServerForeground?: (
    options: ParsedServerOptions,
    hooks?: StartForegroundHooks,
  ) => Promise<never>;
  /**
   * Best-effort read of the server's persistent bearer token. When it returns
   * a token, the ready banner prints it. Optional so callers/tests that don't
   * supply it simply print the server origin.
   */
  resolveToken?: () => string | undefined;
  /**
   * Non-loopback interface addresses to display for a wildcard bind. Defaults
   * to the machine's own interfaces (`listNetworkAddresses()`); inject a fixed
   * list in tests for deterministic output.
   */
  networkAddresses?: NetworkAddress[];
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
}

/** Build the `run` subcommand, mounted under a parent (`server` or top-level). */
export function buildRunCommand(cmd: Command): Command {
  return cmd
    .option(
      '--port <port>',
      t('cli.sub.server.option.port', { port: String(DEFAULT_SERVER_PORT) }),
      String(DEFAULT_SERVER_PORT),
    )
    .option(
      '--host [host]',
      t('cli.sub.server.option.host', {
        defaultHost: DEFAULT_SERVER_HOST,
        lanHost: DEFAULT_LAN_HOST,
      }),
    )
    .option(
      '--allowed-host <host...>',
      t('cli.sub.server.option.allowedHost'),
    )
    .option(
      '--insecure-no-tls',
      t('cli.sub.server.option.insecureNoTls'),
      true,
    )
    .option(
      '--allow-remote-shutdown',
      t('cli.sub.server.option.allowRemoteShutdown'),
      false,
    )
    .option(
      '--allow-remote-terminals',
      t('cli.sub.server.option.allowRemoteTerminals'),
      false,
    )
    .option(
      '--log-level <level>',
      t('cli.sub.server.option.logLevel', { levels: VALID_LOG_LEVELS.join('|') }),
    )
    .option(
      '--debug-endpoints',
      t('cli.sub.server.option.debugEndpoints'),
      false,
    )
    .option(
      '--foreground',
      t('cli.sub.server.option.foreground'),
      false,
    )
    .addOption(
      new Option('--daemon', 'Run as an idle-exiting background daemon (internal).').hideHelp(),
    )
    .addOption(
      new Option(
        '--idle-grace-ms <ms>',
        'Idle-shutdown grace in ms (daemon mode, internal).',
      ).hideHelp(),
    )
    .action(async (opts: RunCliOptions) => {
      try {
        await handleRunCommand(opts);
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
      }
    });
}

export async function handleRunCommand(
  opts: RunCliOptions,
  deps: RunCommandDeps = DEFAULT_RUN_COMMAND_DEPS,
): Promise<void> {
  const parsed = parseServerOptions(opts);
  if (parsed.daemon) {
    await startServerDaemon(parsed);
    return;
  }
  // Resolve the persistent token once so the ready banner can show API clients
  // the bearer value. Falls back to no token line when unavailable.
  const writeReady = (result: { origin: string; reused?: boolean; host?: string }): void => {
    const { origin } = result;
    const host = result.host ?? parsed.host;
    const token = deps.resolveToken?.();
    let output = '';
    if (result.reused === true) {
      // A daemon was already running, so this command's --host/--port/etc. did
      // not start a new one. Say so loudly, then print the actual running
      // server's URLs (using its real bind host, not the requested one).
      output += formatReuseNotice(origin);
    }
    output +=
      parsed.logLevel === DEFAULT_FOREGROUND_LOG_LEVEL
        ? formatReadyBanner(origin, host, {
            token,
            networkAddresses: deps.networkAddresses,
          })
        : formatReadyLine(origin, token);
    deps.stdout.write(output);
  };
  if (opts.foreground === true) {
    const run = deps.startServerForeground ?? startServerForeground;
    await run(parsed, {
      onReady: (origin) => {
        writeReady({ origin, reused: false, host: parsed.host });
      },
    });
    return;
  }
  const result = await deps.startServerBackground(parsed);
  writeReady(result);
}

function formatReuseNotice(origin: string): string {
  return (
    `${chalk.hex(darkColors.warning)(t('cli.runtime.server.reuseNoticePrefix'))} at ${origin} — ` +
    `${t('cli.runtime.server.reuseNoticeMiddle')} ` +
    `Run ${chalk.bold(t('cli.runtime.server.bannerStopCmd'))} ${t('cli.runtime.server.reuseNoticeSuffix')}\n`
  );
}

function formatReadyLine(origin: string, _token: string | undefined): string {
  return tln('cli.runtime.server.readyLine', { origin });
}

/**
 * `liora server run` (non-daemon) — ensures a background daemon is running
 * (spawning a detached `liora server run --daemon` child if needed), then
 * returns its origin so the caller can print the ready banner and exit. The
 * server keeps running in the background after this returns.
 */
export async function startServerBackground(
  options: ParsedServerOptions,
): Promise<EnsureDaemonResult> {
  return ensureDaemon({
    host: options.host,
    port: options.port,
    logLevel: options.logLevel,
    debugEndpoints: options.debugEndpoints,
    insecureNoTls: options.insecureNoTls,
    allowRemoteShutdown: options.allowRemoteShutdown,
    allowRemoteTerminals: options.allowRemoteTerminals,
    allowedHosts: options.allowedHosts,
    idleGraceMs: options.idleGraceMs,
  });
}

/**
 * `liora server run --daemon` — runs the local server as a background daemon.
 *
 * Spawned as a detached child by {@link startServerBackground}. The process is
 * expected to be detached (no controlling terminal) and self-terminates after
 * the last client disconnects and a grace period elapses. The grace timer
 * is driven by the WS connection count reported through `wsGatewayOptions`.
 * Resolves only via `process.exit`.
 */
export async function startServerDaemon(options: ParsedServerOptions): Promise<never> {
  return runServerInProcess(options, { daemon: true });
}

/**
 * `liora server run --foreground` — runs the local server in-process, attached
 * to the current terminal. Resolves only via `process.exit` (SIGINT/SIGTERM).
 */
export async function startServerForeground(
  options: ParsedServerOptions,
  hooks: StartForegroundHooks = {},
): Promise<never> {
  return runServerInProcess(options, { daemon: false }, hooks.onReady);
}

/**
 * Start the server in the current process and block until shutdown. Shared by
 * the detached daemon (`daemon: true`, with idle-exit) and the foreground
 * runner (`daemon: false`). `onReady` fires once the server is listening.
 */
async function runServerInProcess(
  options: ParsedServerOptions,
  mode: { daemon: boolean },
  onReady?: (origin: string) => void,
): Promise<never> {
  const version = getVersion();
  const telemetry = initializeServerTelemetry({ version });

  let running: RunningServer | undefined;
  let stopping = false;

  const idle = mode.daemon
    ? createIdleShutdownHandler({
        graceMs: options.idleGraceMs,
        onIdle: () => {
          void shutdown('idle');
        },
      })
    : undefined;

  async function shutdown(reason: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    idle?.cancel();
    running?.logger.info({ reason }, 'server shutting down');
    try {
      await running?.close();
      await shutdownTelemetry({ timeoutMs: CLI_SHUTDOWN_TIMEOUT_MS });
    } catch (error) {
      running?.logger.error(
        { err: error instanceof Error ? error : new Error(String(error)) },
        'server shutdown error',
      );
    }
    process.exit(0);
  }

  running = await startServer({
    host: options.host,
    port: options.port,
    logLevel: options.logLevel,
    debugEndpoints: options.debugEndpoints,
    insecureNoTls: options.insecureNoTls,
    allowRemoteShutdown: options.allowRemoteShutdown,
    allowRemoteTerminals: options.allowRemoteTerminals,
    allowedHosts: options.allowedHosts,
    coreProcessOptions: {
      identity: createLioraHostIdentity(version),
      telemetry,
    },
    wsGatewayOptions: {
      telemetry,
      onConnectionCountChange: idle
        ? (size) => {
            idle.onConnectionCountChange(size);
          }
        : undefined,
    },
  });

  track('server_started', { daemon: mode.daemon });

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  const readyFields = mode.daemon
    ? { address: running.address, idleGraceMs: options.idleGraceMs }
    : { address: running.address };
  running.logger.info(readyFields, mode.daemon ? 'daemon ready' : 'server ready');

  onReady?.(running.address);

  return new Promise<never>(() => {
    // Keeps the event loop alive; the process ends via shutdown()/process.exit.
  });
}

/**
 * Pure idle-shutdown state machine, exported for tests.
 *
 * Watches the live WS connection count and fires `onIdle` exactly once, after
 * the count has dropped back to zero for `graceMs` ms *and* at least one
 * client had connected since startup. A reconnect before the grace elapses
 * cancels the pending exit. The initial "no clients yet" state never arms the
 * timer (so a freshly-spawned daemon is not killed before anyone connects).
 */
export function createIdleShutdownHandler(opts: { graceMs: number; onIdle: () => void }): {
  onConnectionCountChange(size: number): void;
  cancel(): void;
} {
  let timer: NodeJS.Timeout | undefined;
  let seenClient = false;

  const cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return {
    onConnectionCountChange(size: number): void {
      if (size > 0) {
        seenClient = true;
        cancel();
        return;
      }
      if (seenClient) {
        cancel();
        timer = setTimeout(opts.onIdle, opts.graceMs);
      }
    },
    cancel,
  };
}

interface FormatReadyBannerOptions {
  /** Persistent bearer token to print; omitted when unresolvable. */
  token?: string;
  /** Non-loopback interface addresses to list for a wildcard bind. */
  networkAddresses?: NetworkAddress[];
}

function formatReadyBanner(
  origin: string,
  host: string,
  opts: FormatReadyBannerOptions = {},
): string {
  const primary = (text: string): string => chalk.hex(darkColors.primary)(text);
  const title = (text: string): string => chalk.bold.hex(darkColors.primary)(text);
  const dim = (text: string): string => chalk.hex(darkColors.textDim)(text);
  const muted = (text: string): string => chalk.hex(darkColors.textMuted)(text);
  const label = (text: string): string => chalk.bold.hex(darkColors.textDim)(text);
  const url = (text: string): string => chalk.hex(darkColors.accent)(text);

  const port = Number(new URL(origin).port);
  // Borderless header: the Kimi sprite (the little mascot with eyes) sits next
  // to the title, keeping the brand without the enclosing box.
  const logo = ['▐█▛█▛█▌', '▐█████▌'] as const;
  const lines: string[] = [
    '',
    `  ${primary(logo[0])}  ${title(t('cli.runtime.server.bannerTitle'))}  ${dim(getVersion())}`,
    `  ${primary(logo[1])}  ${dim(t('cli.runtime.server.bannerSubtitle'))}`,
    '',
  ];

  // Access links.
  for (const { label: text, url: href } of accessUrlLines(
    host,
    port,
    opts.networkAddresses,
  )) {
    lines.push(`  ${label(text)}${url(href)}`);
  }
  // On a loopback bind there is no network URL; show how to enable one.
  if (isLoopbackHost(host)) {
    lines.push(
      `  ${label(t('cli.runtime.server.labelNetworkBanner'))}${muted(t('cli.runtime.server.bannerNetworkOff'))}${dim(t('cli.runtime.server.bannerNetworkHint'))}`,
    );
  }
  if (opts.token !== undefined) {
    // Set the token off with surrounding whitespace rather than color, so it is
    // easy to spot without being highlighted.
    lines.push('');
    lines.push(`  ${label(t('cli.runtime.server.labelToken'))}${opts.token}`);
    lines.push('');
  }

  // Auxiliary controls last.
  lines.push(
    `  ${label(t('cli.runtime.server.labelLogs'))}${muted(t('cli.runtime.server.bannerLogsOff'))}${dim(t('cli.runtime.server.bannerLogsHint'))}`,
  );
  lines.push(
    `  ${label(t('cli.runtime.server.labelStop'))}${muted(t('cli.runtime.server.bannerStopCmd'))}`,
  );
  lines.push('');
  return lines.join('\n');
}

const DEFAULT_RUN_COMMAND_DEPS: RunCommandDeps = {
  startServerBackground,
  startServerForeground,
  resolveToken: () => {
    // Read the persistent `<homeDir>/server.token` written on first boot
    // (M5.1). Best-effort: a missing/older server yields undefined and the
    // ready banner prints only the server origin.
    return tryResolveServerToken(getDataDir());
  },
  stdout: process.stdout,
  stderr: process.stderr,
};
