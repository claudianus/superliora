import { Readable, Writable } from 'node:stream';

import {
  AgentSideConnection,
  ndJsonStream,
  type Implementation,
  type Stream,
} from '@agentclientprotocol/sdk';
import { log, type LioraHarness } from '@superliora/sdk';

import { redirectConsoleToStderr } from './log-guard';
import { AcpServer } from './server';
import type { SlashCommandsResolver } from './server-slash';

/**
 * Drive an {@link AcpServer} over an arbitrary ACP {@link Stream}.
 *
 * Useful for tests that build the stream with `ndJsonStream` over an
 * in-memory pair instead of process stdio.
 */
export async function runAcpServerWithStream(
  harness: LioraHarness,
  stream: Stream,
  opts?: {
    agentInfo?: Implementation;
    terminalAuthEnv?: Readonly<Record<string, string>>;
    terminalAuthLegacyCommand?: string;
    slashCommands?: SlashCommandsResolver;
  },
): Promise<void> {
  const conn = new AgentSideConnection((c) => new AcpServer(harness, c, opts), stream);
  await conn.closed;
}

/**
 * Drive an {@link AcpServer} over Node stdio (or the supplied streams).
 *
 * The ACP SDK speaks Web `ReadableStream` / `WritableStream`, so Node stdio
 * is bridged through `Readable.toWeb` / `Writable.toWeb`.
 *
 * Phase 11.1 wires SIGINT / SIGTERM to a single-shot cleanup that calls
 * {@link LioraHarness.close} so an editor terminating the agent process
 * (Zed closing the panel, JetBrains stopping the run config, the user
 * pressing Ctrl-C) drains in-flight sessions before the OS reaps the
 * process. The handlers are installed via `.once(...)` and explicitly
 * uninstalled in `finally` so repeat invocations from tests do not
 * pollute the process-wide listener set.
 *
 * The `signals` option exists primarily for tests — production callers
 * use the default of `process`. A test can pass a fresh
 * `EventEmitter`, emit `'SIGINT'` on it, and assert `harness.close()`
 * was called exactly once without touching the real Node signal
 * handlers (which vitest itself relies on).
 */
export async function runAcpServer(
  harness: LioraHarness,
  opts?: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    /**
     * Optional agent identity metadata advertised in the `initialize`
     * response (`InitializeResponse.agentInfo`). When omitted, the
     * field is left out of the response rather than serialized as
     * `null`, matching the kimi-cli reference implementation.
     */
    agentInfo?: Implementation;
    /**
     * Env vars to forward to the `liora login` subprocess clients spawn
     * via `terminal-auth`. See {@link AcpServer} ctor for the use case.
     */
    terminalAuthEnv?: Readonly<Record<string, string>>;
    /**
     * Absolute path to the agent binary, advertised in the legacy
     * `_meta['terminal-auth'].command` fallback. See {@link AcpServer}
     * ctor for compatibility rationale.
     */
    terminalAuthLegacyCommand?: string;
    /**
     * Slash commands to advertise to ACP clients so their slash-command
     * palette is populated. See {@link AcpServer} ctor for details.
     */
    slashCommands?: SlashCommandsResolver;
    /**
     * @internal Test seam — supply a fake `EventEmitter` (or a
     * subset that exposes `.once` / `.off`) to drive SIGINT / SIGTERM
     * without touching the real `process` listener set. Defaults to
     * `process` in production.
     */
    signals?: Pick<NodeJS.EventEmitter, 'once' | 'off'>;
  },
): Promise<void> {
  redirectConsoleToStderr();
  const input = (opts?.input ?? process.stdin) as Readable;
  const output = (opts?.output ?? process.stdout) as Writable;
  const stream = ndJsonStream(Writable.toWeb(output), Readable.toWeb(input));
  const signals = opts?.signals ?? process;

  let cleanedUp = false;
  const cleanup = async (signal?: NodeJS.Signals): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (signal) {
      log.info('acp: received signal, draining harness', { signal });
    }
    try {
      await harness.close();
    } catch (err) {
      log.error('acp: harness close failed during shutdown', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onSigint = (): void => {
    void cleanup('SIGINT');
  };
  const onSigterm = (): void => {
    void cleanup('SIGTERM');
  };
  signals.once('SIGINT', onSigint);
  signals.once('SIGTERM', onSigterm);

  try {
    await runAcpServerWithStream(harness, stream, {
      agentInfo: opts?.agentInfo,
      terminalAuthEnv: opts?.terminalAuthEnv,
      terminalAuthLegacyCommand: opts?.terminalAuthLegacyCommand,
      slashCommands: opts?.slashCommands,
    });
  } finally {
    signals.off('SIGINT', onSigint);
    signals.off('SIGTERM', onSigterm);
    await cleanup();
  }
}
