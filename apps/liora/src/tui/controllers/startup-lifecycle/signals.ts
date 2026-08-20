import {
  buildDiskPressureDegradedEvent,
  isDiskFullError,
  reportDiskPressure,
} from '@superliora/sdk';

import { NativeTerminalSession } from '#/tui/renderer';

import { isDeadTerminalError } from '../../utils/terminal/dead-terminal';
import type { StartupLifecycleHost } from './types';

export interface StartupSignalCallbacks {
  emergencyTerminalExit(exitCode?: number): never;
  stop(exitCode?: number): Promise<void>;
}

/**
 * Put the terminal back the way we found it: leave the alternate screen, stop
 * mouse/paste reporting, and drop raw mode. Safe to call more than once.
 */
function restoreTerminalSync(): void {
  try {
    NativeTerminalSession.writeRestoreSequencesSync(process.stdout, process.stdin);
  } catch {
    // Swallow — this runs on exit paths that must never throw.
  }
}

export function shouldSwallowUncaught(error: unknown): boolean {
  return isDiskFullError(error);
}

export function registerStartupSignalHandlers(
  host: StartupLifecycleHost,
  callbacks: StartupSignalCallbacks,
): void {
  unregisterStartupSignalHandlers(host);

  process.on('exit', restoreTerminalSync);
  host.signalCleanupHandlers.push(() => {
    process.off('exit', restoreTerminalSync);
  });

  // A throw that escapes the TUI skips `stop()`, and Node's default handler
  // prints the trace straight into the alternate screen before exiting — the
  // user is left with a terminal that does not echo. Restore first, then let
  // the default behavior print and exit.
  const crashHandler = (error: unknown): void => {
    if (shouldSwallowUncaught(error)) {
      void (async () => {
        try {
          const snap = await reportDiskPressure(error);
          host.harness.broadcastRuntimeDegraded(buildDiskPressureDegradedEvent(snap));
        } catch {
          /* never crash the TUI on the pressure path */
        }
      })();
      return;
    }
    restoreTerminalSync();
    host.isShuttingDown = true;
    process.off('uncaughtException', crashHandler);
    process.off('unhandledRejection', crashHandler);
    throw error;
  };
  process.on('uncaughtException', crashHandler);
  process.on('unhandledRejection', crashHandler);
  host.signalCleanupHandlers.push(() => {
    process.off('uncaughtException', crashHandler);
    process.off('unhandledRejection', crashHandler);
  });

  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  if (process.platform !== 'win32') {
    signals.push('SIGHUP');
  }

  for (const signal of signals) {
    const handler = (): void => {
      if (signal === 'SIGHUP') {
        host.harness.emergencyFlushSync();
        callbacks.emergencyTerminalExit();
        return;
      }
      const code = 128 + (signal === 'SIGINT' ? 2 : 15);
      callbacks.stop(code).then(
        () => {
          process.exit(code);
        },
        () => {
          callbacks.emergencyTerminalExit(code);
        },
      );
    };
    process.prependListener(signal, handler);
    host.signalCleanupHandlers.push(() => {
      process.off(signal, handler);
    });
  }

  const terminalErrorHandler = (error: Error): void => {
    if (isDeadTerminalError(error)) {
      callbacks.emergencyTerminalExit();
    }
  };
  process.stdout.on('error', terminalErrorHandler);
  process.stderr.on('error', terminalErrorHandler);
  host.signalCleanupHandlers.push(() => {
    process.stdout.off('error', terminalErrorHandler);
  });
  host.signalCleanupHandlers.push(() => {
    process.stderr.off('error', terminalErrorHandler);
  });
}

export function unregisterStartupSignalHandlers(host: StartupLifecycleHost): void {
  const handlers = host.signalCleanupHandlers;
  host.signalCleanupHandlers = [];
  for (const cleanup of handlers) cleanup();
}

export function emergencyStartupTerminalExit(
  host: StartupLifecycleHost,
  exitCode = 129,
): never {
  host.isShuttingDown = true;
  // Restore before unregistering: the `exit` handler that would otherwise do
  // it is one of the handlers being torn down here, so dropping it first would
  // exit with the alternate screen, mouse reporting, and raw mode still on.
  restoreTerminalSync();
  unregisterStartupSignalHandlers(host);
  try {
    host.harness.emergencyFlushSync();
  } catch {
    // Swallow — we are exiting regardless.
  }
  process.exit(exitCode);
}
