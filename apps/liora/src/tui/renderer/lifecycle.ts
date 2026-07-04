import type {
  NativeRenderCause,
  NativeTerminalInput,
  NativeTerminalOutput,
  NativeTerminalRenderer,
  RendererRootUI,
  RendererTerminalHost,
} from '@harness-kit/tui-renderer';

import { LioraNativeRootUI } from './native-root-ui';

export interface TerminalRenderer {
  readonly terminal: RendererTerminalHost;
  readonly ui: RendererRootUI;
  readonly nativeRuntime: NativeTerminalRenderer;
  readonly autoFramesHeld: boolean;
  readonly hasHeldAutoFrame: boolean;
  setAutoFrameHold(hold: (() => boolean) | undefined): void;
  releaseHeldAutoFrames(): void;
  start(): void;
  stop(): void;
  requestRender(force?: boolean | NativeRenderCause): void;
  drainInput(): Promise<void>;
}

export function createTerminalRenderer(): TerminalRenderer {
  const ui = new LioraNativeRootUI({
    input: process.stdin as NativeTerminalInput,
    output: process.stdout as NativeTerminalOutput,
  });
  return createNativeTerminalRenderer({ ui });
}

export function createNativeTerminalRenderer(options: {
  readonly ui: LioraNativeRootUI;
}): TerminalRenderer {
  const { ui } = options;
  const { terminal, renderer: nativeRuntime } = ui;
  let autoFrameHold: (() => boolean) | undefined;
  const nativeRenderCause = (force: boolean | NativeRenderCause | undefined): NativeRenderCause => {
    if (force === true) return 'manual';
    if (force === false || force === undefined) return 'request';
    return force;
  };
  const shouldHoldAutoFrames = () => autoFrameHold?.() === true;

  const renderer: TerminalRenderer = {
    terminal,
    ui,
    nativeRuntime,
    get autoFramesHeld() {
      return nativeRuntime.areAutoFramesHeld;
    },
    get hasHeldAutoFrame() {
      return nativeRuntime.areAutoFramesHeld;
    },
    setAutoFrameHold: (hold) => {
      autoFrameHold = hold;
      if (hold === undefined) {
        nativeRuntime.clearAutoFrameHoldOverride();
      } else {
        nativeRuntime.setAutoFrameHold(hold());
      }
      if (!shouldHoldAutoFrames()) renderer.releaseHeldAutoFrames();
    },
    releaseHeldAutoFrames: () => {
      nativeRuntime.releaseHeldAutoFrames();
    },
    start: () => {
      nativeRuntime.start();
    },
    stop: () => {
      nativeRuntime.stop();
    },
    requestRender: (force?: boolean | NativeRenderCause) => {
      if (autoFrameHold !== undefined) {
        nativeRuntime.setAutoFrameHold(autoFrameHold());
      }
      nativeRuntime.requestRender(nativeRenderCause(force));
    },
    drainInput: () => terminal.drainInput?.() ?? Promise.resolve(),
  };

  return renderer;
}
