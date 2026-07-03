import {
  encodeNativeInputAsLegacySequence,
  nativeTerminalAdaptiveFeatureProfile,
  type NativeFrameStatsSnapshot,
  type NativeInputEvent,
  type NativeInputRouter,
  type NativeRenderCause,
  type NativeRenderLoopScheduler,
  type NativeTerminalFeatureInput,
  type NativeTerminalInput,
  type NativeTerminalKeyboardProtocol,
  type NativeTerminalMouseTracking,
  type NativeTerminalOutput,
  type NativeTerminalRenderer,
  type NativeTerminalRendererOptions,
  type RendererDiagnosticsSnapshot,
  type RendererQualitySnapshot,
  RendererTimelinePlayback,
  type RendererTimelinePlaybackOptions,
} from '#/tui/renderer';

import type { TUIState } from '../tui-state';
import {
  createTUIStateNativeRenderer,
  type TUIStateNativeRendererOptions,
} from './native-layout-frame';

export interface TUIStateNativeRenderMirrorOptions {
  readonly features?: NativeTerminalFeatureInput;
  readonly input?: NativeTerminalInput;
  readonly inputRouter?: NativeInputRouter;
  readonly output?: NativeTerminalOutput;
  readonly keyboardProtocol?: NativeTerminalKeyboardProtocol;
  readonly mouseTracking?: NativeTerminalMouseTracking;
  readonly scheduler?: NativeRenderLoopScheduler;
  readonly targetFps?: number;
  readonly bracketedPaste?: boolean;
  readonly focusEvents?: boolean;
  readonly adaptiveQuality?: NativeTerminalRendererOptions['adaptiveQuality'];
  readonly diagnosticsOverlay?: TUIStateNativeRendererOptions['diagnosticsOverlay'];
  readonly onInputEvent?: (event: NativeInputEvent) => void;
  readonly onLegacyInput?: (data: string) => void;
}

export class TUIStateNativeRenderMirror {
  readonly renderer: NativeTerminalRenderer;
  private started = false;
  private originalRequestRender: TUIState['renderer']['requestRender'] | undefined;

  constructor(
    private readonly state: TUIState,
    options: TUIStateNativeRenderMirrorOptions = {},
  ) {
    this.renderer = createTUIStateNativeRenderer(state, {
      features: options.features ?? nativeTerminalAdaptiveFeatureProfile('inline-app', process.env),
      input: options.input,
      inputRouter: options.inputRouter,
      output: options.output ?? createNoopNativeOutput(state),
      keyboardProtocol: options.keyboardProtocol,
      mouseTracking: options.mouseTracking,
      bracketedPaste: options.bracketedPaste,
      focusEvents: options.focusEvents,
      scheduler: options.scheduler,
      targetFps: options.targetFps,
      adaptiveQuality: options.adaptiveQuality,
      diagnosticsOverlay: options.diagnosticsOverlay,
      unrefTimers: true,
      onInputEvent:
        options.onInputEvent === undefined && options.onLegacyInput === undefined
          ? undefined
          : (event) => {
              options.onInputEvent?.(event);
              const legacy = encodeNativeInputAsLegacySequence(event);
              if (legacy !== undefined) options.onLegacyInput?.(legacy);
            },
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.originalRequestRender = this.state.renderer.requestRender.bind(this.state.renderer);
    this.state.renderer.requestRender = (force?: boolean) => {
      this.originalRequestRender?.(force);
      this.requestRender(force === true ? 'manual' : 'request');
    };
    this.renderer.start();
    this.requestRender('start');
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.renderer.stop();
    if (this.originalRequestRender !== undefined) {
      this.state.renderer.requestRender = this.originalRequestRender;
      this.originalRequestRender = undefined;
    }
  }

  requestRender(cause: NativeRenderCause = 'request'): void {
    this.renderer.requestRender(cause);
  }

  get quality(): RendererQualitySnapshot {
    return this.renderer.quality;
  }

  get stats(): NativeFrameStatsSnapshot {
    return this.renderer.stats;
  }

  get diagnostics(): RendererDiagnosticsSnapshot {
    return this.renderer.diagnostics;
  }

  createTimelinePlayback(
    options: Omit<RendererTimelinePlaybackOptions, 'clock'>,
  ): RendererTimelinePlayback {
    return new RendererTimelinePlayback({
      ...options,
      clock: this.renderer,
    });
  }

  playTimeline(
    options: Omit<RendererTimelinePlaybackOptions, 'clock' | 'autoStart'>,
  ): RendererTimelinePlayback {
    const playback = this.createTimelinePlayback(options);
    playback.start();
    return playback;
  }
}

export function createTUIStateNativeRenderMirror(
  state: TUIState,
  options: TUIStateNativeRenderMirrorOptions = {},
): TUIStateNativeRenderMirror {
  return new TUIStateNativeRenderMirror(state, options);
}

function createNoopNativeOutput(state: TUIState): NativeTerminalOutput {
  return {
    get columns() {
      return state.terminal.columns;
    },
    get rows() {
      return state.terminal.rows;
    },
    write: () => {},
  };
}
