import { NativeTerminalSession } from '#/tui/renderer';

import { isDeadTerminalError } from '../../utils/terminal/dead-terminal';
import type { StartupLifecycleHost } from './types';

export interface StartupSignalCallbacks {
  emergencyTerminalExit(exitCode?: number): never;
  stop(exitCode?: number): Promise<void>;
}

export function registerStartupSignalHandlers(
  host: StartupLifecycleHost,
  callbacks: StartupSignalCallbacks,
): void {
  unregisterStartupSignalHandlers(host);

  const exitHandler = (): void => {
    try {
      NativeTerminalSession.writeRestoreSequencesSync(process.stdout);
    } catch {
      // Swallow — must never throw at process exit.
    }
  };
  process.on('exit', exitHandler);
  host.signalCleanupHandlers.push(() => {
    process.off('exit', exitHandler);
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
  unregisterStartupSignalHandlers(host);
  try {
    host.harness.emergencyFlushSync();
  } catch {
    // Swallow — we are exiting regardless.
  }
  process.exit(exitCode);
}
