import { ProcessTerminal, TUI } from '@earendil-works/pi-tui';
import type {
  NativeRenderCause,
  NativeTerminalRenderer,
  RendererRootUI,
  RendererTerminalHost,
} from '@harness-kit/tui-renderer';

export type TerminalRendererBackend = 'pi-tui' | 'native';

export interface TerminalRenderer {
  readonly backend: TerminalRendererBackend;
  readonly terminal: RendererTerminalHost;
  readonly ui: RendererRootUI;
  readonly nativeRuntime?: NativeTerminalRenderer;
  readonly autoFramesHeld: boolean;
  readonly hasHeldAutoFrame: boolean;
  attachNativeRuntime(runtime: NativeTerminalRenderer): void;
  detachNativeRuntime(): void;
  setAutoFrameHold(hold: (() => boolean) | undefined): void;
  releaseHeldAutoFrames(): void;
  start(): void;
  stop(): void;
  requestRender(force?: boolean): void;
  drainInput(): Promise<void>;
}

export function createTerminalRenderer(): TerminalRenderer {
  const terminal = new ProcessTerminal();
  const ui = new TUI(terminal);
  return createPiTUIRenderer({ terminal, ui });
}

export function createPiTUIRenderer(options: {
  readonly terminal: ProcessTerminal;
  readonly ui: TUI;
}): TerminalRenderer {
  const { terminal, ui } = options;
  const originalRequestRender = ui.requestRender.bind(ui);
  let nativeRuntime: NativeTerminalRenderer | undefined;
  let started = false;
  let autoFrameHold: (() => boolean) | undefined;
  let heldPiTUIAutoFrame = false;
  let releasingHeldPiTUIAutoFrame = false;
  const nativeRenderCause = (force: boolean | undefined): NativeRenderCause =>
    force === true ? 'manual' : 'request';
  const shouldHoldAutoFrames = () => autoFrameHold?.() === true;
  const renderer: TerminalRenderer = {
    get backend() {
      return nativeRuntime === undefined ? 'pi-tui' : 'native';
    },
    terminal,
    ui,
    get nativeRuntime() {
      return nativeRuntime;
    },
    get autoFramesHeld() {
      return nativeRuntime?.areAutoFramesHeld ?? shouldHoldAutoFrames();
    },
    get hasHeldAutoFrame() {
      return heldPiTUIAutoFrame || nativeRuntime?.areAutoFramesHeld === true;
    },
    attachNativeRuntime: (runtime) => {
      if (nativeRuntime === runtime) return;
      const previousRuntime = nativeRuntime;
      nativeRuntime = runtime;
      syncNativeRuntimeAutoFrameHold();
      if (!started) return;
      if (previousRuntime === undefined) {
        ui.stop();
      } else {
        previousRuntime.stop();
      }
      runtime.start();
      runtime.requestRender('manual');
    },
    detachNativeRuntime: () => {
      if (nativeRuntime === undefined) return;
      const previousRuntime = nativeRuntime;
      nativeRuntime = undefined;
      if (!started) return;
      previousRuntime.stop();
      ui.start();
      originalRequestRender(true);
    },
    setAutoFrameHold: (hold) => {
      autoFrameHold = hold;
      syncNativeRuntimeAutoFrameHold();
      if (!shouldHoldAutoFrames()) renderer.releaseHeldAutoFrames();
    },
    releaseHeldAutoFrames: () => {
      nativeRuntime?.releaseHeldAutoFrames?.();
      if (!heldPiTUIAutoFrame) return;
      heldPiTUIAutoFrame = false;
      releasingHeldPiTUIAutoFrame = true;
      try {
        renderer.requestRender(false);
      } finally {
        releasingHeldPiTUIAutoFrame = false;
      }
    },
    start: () => {
      if (started) return;
      started = true;
      if (nativeRuntime !== undefined) {
        nativeRuntime.start();
      } else {
        ui.start();
      }
    },
   stop: () => {
     if (nativeRuntime !== undefined) {
       nativeRuntime.stop();
     } else {
       ui.stop();
     }
      started = false;
   },
    requestRender: (force?: boolean) => {
      if (nativeRuntime !== undefined) {
        syncNativeRuntimeAutoFrameHold();
        nativeRuntime.requestRender(nativeRenderCause(force));
        return;
      }
      if (force === true) {
        if (!shouldHoldAutoFrames()) heldPiTUIAutoFrame = false;
        originalRequestRender(force);
        return;
      }
      if (!releasingHeldPiTUIAutoFrame && shouldHoldAutoFrames()) {
        heldPiTUIAutoFrame = true;
        return;
      }
      heldPiTUIAutoFrame = false;
      originalRequestRender(force);
    },
    drainInput: () => terminal.drainInput(),
  };

  ui.requestRender = (force?: boolean) => {
    renderer.requestRender(force);
  };

  return renderer;

  function syncNativeRuntimeAutoFrameHold(): void {
    if (nativeRuntime === undefined) return;
    if (autoFrameHold === undefined) {
      nativeRuntime.clearAutoFrameHoldOverride?.();
      return;
    }
    nativeRuntime.setAutoFrameHold?.(autoFrameHold());
  }
}
