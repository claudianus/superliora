import {
  ANSI_QUERY_SYNCHRONIZED_OUTPUT_SUPPORT,
  NATIVE_TERMINAL_SYNCHRONIZED_OUTPUT_MODE,
  parseNativeTerminalDecModeReports,
  resolveNativeSynchronizedOutputSupport,
  type NativeTerminalDecModeReport,
  type NativeTerminalSynchronizedOutputSupport,
} from './terminal-features';
import type { NativeTerminalInput, NativeTerminalOutput } from './terminal-session';

export interface NativeTerminalProbeTimer {
  unref?(): void;
}

export interface NativeTerminalProbeScheduler {
  setTimeout(callback: () => void, delayMs: number): NativeTerminalProbeTimer;
  clearTimeout(timer: NativeTerminalProbeTimer): void;
}

export interface NativeTerminalCapabilityProbeOptions {
  readonly input: NativeTerminalInput;
  readonly output: NativeTerminalOutput;
  readonly scheduler?: NativeTerminalProbeScheduler;
  readonly timeoutMs?: number;
  readonly unrefTimer?: boolean;
  readonly signal?: AbortSignal;
}

export interface NativeTerminalCapabilityProbeRunOptions {
  readonly timeoutMs?: number;
  readonly force?: boolean;
}

export interface NativeTerminalSynchronizedOutputProbeResult {
  readonly support: NativeTerminalSynchronizedOutputSupport;
  readonly report?: NativeTerminalDecModeReport;
  readonly timedOut: boolean;
  readonly aborted?: boolean;
}

const DEFAULT_NATIVE_TERMINAL_PROBE_TIMEOUT_MS = 1000;

const DEFAULT_NATIVE_TERMINAL_PROBE_SCHEDULER: NativeTerminalProbeScheduler = {
  setTimeout(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clearTimeout(timer) {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};

export function probeNativeSynchronizedOutputSupport(
  options: NativeTerminalCapabilityProbeOptions,
): Promise<NativeTerminalSynchronizedOutputProbeResult> {
  const scheduler = options.scheduler ?? DEFAULT_NATIVE_TERMINAL_PROBE_SCHEDULER;
  const timeoutMs = normalizeProbeTimeoutMs(options.timeoutMs);

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: NativeTerminalProbeTimer | undefined;
    let onAbort: (() => void) | undefined;

    const cleanup = () => {
      if (timer !== undefined) {
        scheduler.clearTimeout(timer);
        timer = undefined;
      }
      removeInputListener(options.input, 'data', onData);
      if (onAbort !== undefined) options.signal?.removeEventListener('abort', onAbort);
    };
    const settle = (result: NativeTerminalSynchronizedOutputProbeResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onData = (data: unknown) => {
      if (!(typeof data === 'string' || Buffer.isBuffer(data))) return;
      const report = parseNativeTerminalDecModeReports(data).find((candidate) =>
        candidate.privateMode &&
        candidate.mode === NATIVE_TERMINAL_SYNCHRONIZED_OUTPUT_MODE
      );
      if (report === undefined) return;
      settle({
        support: resolveNativeSynchronizedOutputSupport(report),
        report,
        timedOut: false,
      });
    };

    if (options.signal?.aborted === true) {
      settle({ support: 'unknown', timedOut: false, aborted: true });
      return;
    }

    options.input.on('data', onData);
    if (options.signal !== undefined) {
      onAbort = () => {
        settle({ support: 'unknown', timedOut: false, aborted: true });
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    timer = scheduler.setTimeout(() => {
      settle({ support: 'unknown', timedOut: true });
    }, timeoutMs);
    if (options.unrefTimer !== false) timer.unref?.();

    try {
      options.output.write(ANSI_QUERY_SYNCHRONIZED_OUTPUT_SUPPORT);
    } catch (error) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    }
  });
}

export class NativeTerminalCapabilityProbe {
  private synchronizedOutputResult: NativeTerminalSynchronizedOutputProbeResult | undefined;
  private synchronizedOutputPromise: Promise<NativeTerminalSynchronizedOutputProbeResult> | undefined;

  constructor(private readonly options: NativeTerminalCapabilityProbeOptions) {}

  probeSynchronizedOutput(
    options: NativeTerminalCapabilityProbeRunOptions = {},
  ): Promise<NativeTerminalSynchronizedOutputProbeResult> {
    if (options.force !== true) {
      if (this.synchronizedOutputResult !== undefined) {
        return Promise.resolve(this.synchronizedOutputResult);
      }
      if (this.synchronizedOutputPromise !== undefined) return this.synchronizedOutputPromise;
    }

    const probeOptions: NativeTerminalCapabilityProbeOptions = {
      ...this.options,
      timeoutMs: options.timeoutMs ?? this.options.timeoutMs,
    };
    const promise = probeNativeSynchronizedOutputSupport(probeOptions)
      .then((result) => {
        this.synchronizedOutputResult = result;
        if (this.synchronizedOutputPromise === promise) this.synchronizedOutputPromise = undefined;
        return result;
      }, (error: unknown) => {
        if (this.synchronizedOutputPromise === promise) this.synchronizedOutputPromise = undefined;
        throw error;
      });
    this.synchronizedOutputPromise = promise;
    return promise;
  }

  reset(): void {
    this.synchronizedOutputResult = undefined;
    this.synchronizedOutputPromise = undefined;
  }
}

function removeInputListener(
  target: NativeTerminalInput,
  event: 'data' | 'resize',
  listener: (...args: unknown[]) => void,
): void {
  if (target.off !== undefined) {
    target.off(event, listener);
  } else {
    target.removeListener?.(event, listener);
  }
}

function normalizeProbeTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_NATIVE_TERMINAL_PROBE_TIMEOUT_MS;
  if (!Number.isFinite(value) || value < 0) return DEFAULT_NATIVE_TERMINAL_PROBE_TIMEOUT_MS;
  return Math.floor(value);
}
