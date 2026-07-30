import type { NativeRenderLoopScheduler } from './render-loop';
import {
  probeNativeSynchronizedOutputSupport,
  type NativeTerminalSynchronizedOutputProbeResult,
} from './terminal-probe';
import type { NativeTerminalInput, NativeTerminalOutput } from './terminal-session';

export interface NativeRendererSyncProbeCallbacks {
  readonly now: () => number;
  readonly recordMarker: (name: string, args?: Record<string, string | number | boolean>) => void;
  readonly getCurrentSynchronized: () => boolean | undefined;
  readonly setSynchronizedOutput: (synchronized: boolean | undefined) => void;
  readonly onSynchronizedOutputProbe?: (
    result: NativeTerminalSynchronizedOutputProbeResult,
  ) => void;
}

export interface NativeRendererSyncProbeOptions {
  readonly input?: NativeTerminalInput;
  readonly output: NativeTerminalOutput;
  readonly scheduler?: NativeRenderLoopScheduler;
  readonly synchronizedOutputProbe?: boolean;
  readonly synchronizedOutputProbeTimeoutMs?: number;
  readonly unrefTimers?: boolean;
}

export class NativeRendererSyncProbe {
  private resultValue: NativeTerminalSynchronizedOutputProbeResult | undefined;
  private probePromise: Promise<NativeTerminalSynchronizedOutputProbeResult> | undefined;
  private probeAbort: AbortController | undefined;

  constructor(
    private readonly options: NativeRendererSyncProbeOptions,
    private readonly callbacks: NativeRendererSyncProbeCallbacks,
  ) {}

  get result(): NativeTerminalSynchronizedOutputProbeResult | undefined {
    return this.resultValue;
  }

  start(): void {
    if (this.options.synchronizedOutputProbe !== true) return;
    if (this.options.input === undefined || this.callbacks.getCurrentSynchronized() !== true) return;
    if (this.probePromise !== undefined) return;

    this.probeAbort = new AbortController();
    const promise = probeNativeSynchronizedOutputSupport({
      input: this.options.input,
      output: this.options.output,
      // Reuse the render-loop scheduler so tests / custom clocks can drive the
      // probe timeout without real wall-clock waits.
      scheduler: this.options.scheduler,
      timeoutMs: this.options.synchronizedOutputProbeTimeoutMs,
      unrefTimer: this.options.unrefTimers,
      signal: this.probeAbort.signal,
    });
    this.probePromise = promise;
    void promise.then((result) => {
      if (this.probePromise !== promise) return;
      this.probePromise = undefined;
      this.probeAbort = undefined;
      this.resultValue = result;
      if (result.aborted === true) return;
      // Only an explicit "unsupported" report may disable sync. Timeout / unknown
      // used to flip sync off and tear fullscreen stage presents in kitty when
      // the DECRQM reply was lost under input load.
      const enabled =
        result.support === 'unsupported'
          ? false
          : result.support === 'supported'
            ? true
            : this.callbacks.getCurrentSynchronized() === true;
      this.callbacks.recordMarker('terminal.synchronized_output_probe', {
        support: result.support,
        timedOut: result.timedOut,
        enabled,
      });
      this.callbacks.onSynchronizedOutputProbe?.(result);
      this.callbacks.setSynchronizedOutput(enabled);
    }, () => {
      if (this.probePromise !== promise) return;
      this.probePromise = undefined;
      this.probeAbort = undefined;
    });
  }

  abort(): void {
    this.probePromise = undefined;
    this.probeAbort?.abort();
    this.probeAbort = undefined;
  }
}
