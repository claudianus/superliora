import { afterEach, describe, expect, it, vi } from 'vitest';

import { NativeTerminalSession } from '../../../src/tui/renderer';
import {
  emergencyStartupTerminalExit,
  registerStartupSignalHandlers,
  unregisterStartupSignalHandlers,
} from '../../../src/tui/controllers/startup-lifecycle/signals';
import type { StartupLifecycleHost } from '../../../src/tui/controllers/startup-lifecycle/types';

function makeHost(): StartupLifecycleHost {
  return {
    signalCleanupHandlers: [],
    isShuttingDown: false,
    harness: { emergencyFlushSync: vi.fn() },
  } as unknown as StartupLifecycleHost;
}

describe('startup signal terminal restore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores the terminal before tearing down the exit handler', () => {
    const host = makeHost();
    const restore = vi
      .spyOn(NativeTerminalSession, 'writeRestoreSequencesSync')
      .mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    registerStartupSignalHandlers(host, {
      emergencyTerminalExit: (() => {
        throw new Error('unused');
      }) as never,
      stop: async () => {},
    });

    // SIGHUP / dead-pty path: the `exit` handler that would normally restore
    // is one of the handlers this function unregisters.
    expect(() => emergencyStartupTerminalExit(host, 129)).toThrow('exit');

    expect(restore).toHaveBeenCalled();
    expect(host.signalCleanupHandlers).toHaveLength(0);
    expect(exit).toHaveBeenCalledWith(129);
  });

  it('passes stdin so raw mode is dropped, not just the ANSI sequences', () => {
    const host = makeHost();
    const restore = vi
      .spyOn(NativeTerminalSession, 'writeRestoreSequencesSync')
      .mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    registerStartupSignalHandlers(host, {
      emergencyTerminalExit: (() => {
        throw new Error('unused');
      }) as never,
      stop: async () => {},
    });
    expect(() => emergencyStartupTerminalExit(host)).toThrow('exit');

    expect(restore).toHaveBeenCalledWith(process.stdout, process.stdin);
  });

  it('restores the terminal when an exception escapes the TUI', () => {
    const host = makeHost();
    const restore = vi
      .spyOn(NativeTerminalSession, 'writeRestoreSequencesSync')
      .mockImplementation(() => {});

    registerStartupSignalHandlers(host, {
      emergencyTerminalExit: (() => {
        throw new Error('unused');
      }) as never,
      stop: async () => {},
    });

    try {
      const boom = new Error('boom');
      const handlers = process.listeners('uncaughtException');
      const crashHandler = handlers.at(-1);
      expect(crashHandler).toBeDefined();
      expect(() => crashHandler?.(boom, 'uncaughtException')).toThrow('boom');
      expect(restore).toHaveBeenCalledWith(process.stdout, process.stdin);
      expect(host.isShuttingDown).toBe(true);
    } finally {
      unregisterStartupSignalHandlers(host);
    }
  });
});

describe('NativeTerminalSession.writeRestoreSequencesSync', () => {
  it('drops raw mode and still writes the sequences when the write throws', () => {
    const setRawMode = vi.fn();
    const output = {
      write: vi.fn(() => {
        throw new Error('EIO');
      }),
    };

    expect(() => {
      NativeTerminalSession.writeRestoreSequencesSync(output, {
        isTTY: true,
        setRawMode,
      });
    }).not.toThrow();

    expect(setRawMode).toHaveBeenCalledWith(false);
    expect(output.write).toHaveBeenCalled();
  });

  it('leaves a non-tty stdin alone', () => {
    const setRawMode = vi.fn();
    NativeTerminalSession.writeRestoreSequencesSync(
      { write: vi.fn() },
      { isTTY: false, setRawMode },
    );
    expect(setRawMode).not.toHaveBeenCalled();
  });
});
