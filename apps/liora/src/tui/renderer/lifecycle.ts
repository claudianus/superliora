import type {
  NativeRenderCause,
  NativeTerminalInput,
  NativeTerminalOutput,
  NativeTerminalRenderer,
  RendererRootUI,
  RendererTerminalHost,
} from '@harness-kit/tui-renderer';

import { LioraNativeRootUI } from './native-root-ui';
import type { FrameInvalidationIntent } from '#/tui/features/native-layout/native-frame-policy';
import { frameInvalidationIntentToCause } from '#/tui/features/native-layout/native-frame-policy';
import { ensureMountedTuiStdioGuard } from '#/tui/utils/stdio/tui-stdio-guard';

export type { FrameInvalidationIntent } from '#/tui/features/native-layout/native-frame-policy';

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
  invalidateFrame(intent: FrameInvalidationIntent): void;
  drainInput(): Promise<void>;
}

export function createTerminalRenderer(): TerminalRenderer {
  const stdio = ensureMountedTuiStdioGuard();
  const ui = new LioraNativeRootUI({
    input: process.stdin as NativeTerminalInput,
    output: Object.assign(process.stdout, {
      write: stdio.ttyWrite,
    }) as NativeTerminalOutput,
    // Full-screen alternate-screen takeover: isolates the TUI from the
    // terminal's pre-session scrollback (so scrolling up never escapes into
    // earlier shell output) and enables the advanced input features the
    // renderer-owned virtual scroll depends on (kitty keyboard, SGR mouse,
    // synchronized output, bracketed paste, focus events). Restores the
    // forced full-screen occupation that the inline/main-screen rendering
    // had lost.
    features: 'fullscreen-app',
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
      ui.start();
    },
    stop: () => {
      ui.stop();
    },
    requestRender: (force?: boolean | NativeRenderCause) => {
      if (autoFrameHold !== undefined) {
        nativeRuntime.setAutoFrameHold(autoFrameHold());
      }
      ui.requestRender(nativeRenderCause(force));
    },
    invalidateFrame: (intent: FrameInvalidationIntent) => {
      if (autoFrameHold !== undefined) {
        nativeRuntime.setAutoFrameHold(autoFrameHold());
      }
      const cause = frameInvalidationIntentToCause(intent);
      if (intent === 'layout' || intent === 'palette') {
        ui.requestLayout(cause);
      } else {
        ui.requestRender(cause);
      }
    },
    drainInput: () => terminal.drainInput?.() ?? Promise.resolve(),
  };

  return renderer;
}
