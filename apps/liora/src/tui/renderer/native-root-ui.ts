import {
  FrameInvalidationCoordinator,
  isFocusable,
  NativeRendererTerminalHost,
  NativeTerminalRenderer,
  renderNativeRootChildren,
  resolveNativePremiumRendererDefaults,
  type Component,
  type FrameInvalidation,
  type FrameInvalidationRequest,
  type FrameInvalidationStatsSnapshot,
  type NativeInputEvent,
  type NativeRootUIOptions,
  type NativeRenderCause,
  type NativeTerminalRendererFrame,
  type NativeTerminalRendererRender,
  type RendererInputListener,
  type RendererInputListenerResult,
  type RendererRootUI,
  type RendererTerminalHost,
} from '@harness-kit/tui-renderer';
// Import state module directly — avoid the appearance-effects barrel (particles
// import `#/tui/renderer` and would cycle through this facade).
import { setAppearanceRenderHealth } from '../features/appearance/appearance-state';
import { noteFocusFeedback } from '../utils/render/feedback-vfx';
export interface LioraNativeRootUIOptions
  extends Omit<NativeRootUIOptions, 'render'> {}

/**
 * A {@link RendererRootUI} that owns a {@link NativeTerminalRenderer} and lets
 * the caller replace the renderer's render callback after the UI has been
 * created.
 *
 * This is needed because `apps/liora` builds its visible frame with
 * `buildTUIStateNativeFrame`, which requires the global `TUIState`, but the
 * root UI must exist before `TUIState` is constructed.  The render callback
 * is wired once `LioraTUI` has finished creating state.
 */
export class LioraNativeRootUI<TComponent extends Component = Component>
  implements RendererRootUI<TComponent>
{
  readonly terminal: RendererTerminalHost;
  readonly renderer: NativeTerminalRenderer;
  readonly children: TComponent[] = [];

  private readonly inputListeners: RendererInputListener[] = [];
  private readonly frameInvalidation: FrameInvalidationCoordinator;
  private focusedComponent: TComponent | undefined;
  private inputRouter: { dispatch(event: NativeInputEvent): void } | undefined;
  private currentNativeFrame: NativeTerminalRendererFrame | undefined;
  private currentRenderResult: ReturnType<NativeTerminalRendererRender> = undefined;
  private pendingInvalidationFlush: (() => void) | undefined;
  private pendingRequestedCauseMask = 0;
  private lastFrameInvalidationValue: FrameInvalidation | undefined;
  private renderCallback: NativeTerminalRendererRender = ({ renderer, size }) => {
    renderNativeRootChildren(renderer.frame, this.children, size.columns, size.rows);
  };

  constructor(options: LioraNativeRootUIOptions) {
    this.terminal = new NativeRendererTerminalHost(options.output, options.input);
    const premiumDefaults = resolveNativePremiumRendererDefaults({
      features: options.features,
      synchronized: options.synchronized,
      environment: process.env,
    });
    this.frameInvalidation = new FrameInvalidationCoordinator({
      schedule: (flush) => {
        this.pendingInvalidationFlush = flush;
        return () => {
          if (this.pendingInvalidationFlush === flush) {
            this.pendingInvalidationFlush = undefined;
          }
        };
      },
      // App frame construction performs layout and cell rendering together.
      layout: () => {},
      render: (invalidation) => {
        const frame = this.currentNativeFrame;
        if (frame === undefined) {
          throw new Error('Liora native invalidation flushed outside a native frame');
        }
        this.lastFrameInvalidationValue = invalidation;
        this.currentRenderResult = this.renderCallback(frame);
      },
      // NativeTerminalRenderer presents after this facade callback returns.
      present: () => {},
    });
    this.renderer = new NativeTerminalRenderer({
      ...options,
      // Adaptive quality must stay on so frame pressure softens VFX before
      // ambient freezes; health feeds appearance soft-degrade via onFrame.
      adaptiveQuality: options.adaptiveQuality ?? true,
      outputPolicy: options.outputPolicy ?? premiumDefaults.outputPolicy,
      onInput: (data) => {
        this.handleRawInput(data.toString('utf8'));
      },
      onInputEvent: (event) => {
        this.inputRouter?.dispatch(event);
      },
      onFrame: (result, stats) => {
        setAppearanceRenderHealth(stats.health);
        options.onFrame?.(result, stats);
      },
      render: (frame) => this.renderNativeFrame(frame),
    });
  }

  get frameInvalidationStats(): FrameInvalidationStatsSnapshot {
    return this.frameInvalidation.stats.snapshot();
  }

  get lastFrameInvalidation(): FrameInvalidation | undefined {
    return this.lastFrameInvalidationValue;
  }

  resetFrameInvalidationStats(): void {
    this.frameInvalidation.stats.reset();
  }

  setRenderCallback(callback: NativeTerminalRendererRender): void {
    this.renderCallback = callback;
  }

  setInputRouter(router: { dispatch(event: NativeInputEvent): void }): void {
    this.inputRouter = router;
  }

  start(): void {
    this.renderer.start();
  }

  stop(): void {
    this.frameInvalidation.cancelPending();
    this.pendingInvalidationFlush = undefined;
    this.pendingRequestedCauseMask = 0;
    this.renderer.stop();
  }

  requestRender(force?: boolean | NativeRenderCause): void {
    const cause = normalizeLioraNativeRenderCause(force);
    this.requestFrame(lioraFrameInvalidationForCause(cause, false), cause);
  }

  requestLayout(cause?: boolean | NativeRenderCause): void {
    const normalizedCause = normalizeLioraNativeRenderCause(cause);
    this.requestFrame(
      lioraFrameInvalidationForCause(normalizedCause, true),
      normalizedCause,
    );
  }

  addChild(component: TComponent): void {
    this.children.push(component);
    this.requestLayout();
  }

  clear(): void {
    this.children.length = 0;
    this.focusedComponent = undefined;
    this.requestLayout(true);
  }

  setFocus(component: TComponent): void {
    if (this.focusedComponent === component) return;
    if (this.focusedComponent !== undefined && isFocusable(this.focusedComponent)) {
      this.focusedComponent.focused = false;
    }
    this.focusedComponent = component;
    if (isFocusable(component)) {
      component.focused = true;
      noteFocusFeedback();
    }
    this.requestRender();
  }

  addInputListener(listener: RendererInputListener): () => void {
    this.inputListeners.push(listener);
    return () => {
      const index = this.inputListeners.indexOf(listener);
      if (index !== -1) this.inputListeners.splice(index, 1);
    };
  }

  private requestFrame(
    invalidation: FrameInvalidationRequest,
    cause: NativeRenderCause,
  ): void {
    this.frameInvalidation.request(invalidation);
    this.pendingRequestedCauseMask |= LIORA_NATIVE_RENDER_CAUSE_MASKS[cause];
    this.renderer.requestRender(cause);
  }

  private renderNativeFrame(
    frame: NativeTerminalRendererFrame,
  ): ReturnType<NativeTerminalRendererRender> {
    this.currentNativeFrame = frame;
    this.currentRenderResult = undefined;
    try {
      for (const cause of frame.frame.causes) {
        const causeMask = LIORA_NATIVE_RENDER_CAUSE_MASKS[cause];
        if ((this.pendingRequestedCauseMask & causeMask) !== 0) {
          this.pendingRequestedCauseMask &= ~causeMask;
        } else {
          this.frameInvalidation.request(lioraFrameInvalidationForCause(cause));
        }
      }
      if (!this.frameInvalidation.hasPendingFrame) {
        this.frameInvalidation.request({
          source: 'state',
          requiresLayout: true,
          priority: 'normal',
        });
      }

      const flush = this.pendingInvalidationFlush;
      if (flush === undefined) {
        throw new Error('Liora native frame rendered without a pending invalidation');
      }
      this.pendingInvalidationFlush = undefined;
      // The app callback must synchronously build the same frame buffer before
      // NativeTerminalRenderer evaluates diff/output policy and presents it.
      flush();
      return this.currentRenderResult;
    } finally {
      this.currentNativeFrame = undefined;
    }
  }

  private handleRawInput(data: string): void {
    let next = data;
    for (const listener of this.inputListeners) {
      const result = listener(next);
      next = applyListenerResult(next, result);
      if (result?.consume === true) {
        this.requestInputLayout();
        return;
      }
    }
    if (this.inputRouter !== undefined) {
      // Structured input events are routed via onInputEvent; do not also feed
      // raw data to the focused component.
      return;
    }
    this.focusedComponent?.handleInput?.(next);
    this.requestInputLayout();
  }

  private requestInputLayout(): void {
    this.requestFrame(
      { source: 'input', requiresLayout: true, priority: 'interactive' },
      'input',
    );
  }
}

const LIORA_NATIVE_RENDER_CAUSE_MASKS: Readonly<Record<NativeRenderCause, number>> = {
  start: 1,
  request: 1 << 1,
  input: 1 << 2,
  resize: 1 << 3,
  animation: 1 << 4,
  manual: 1 << 5,
  quality: 1 << 6,
  'transcript-scroll': 1 << 7,
};

function normalizeLioraNativeRenderCause(
  cause: boolean | NativeRenderCause | undefined,
): NativeRenderCause {
  if (cause === true) return 'manual';
  if (cause === false || cause === undefined) return 'request';
  return cause;
}

function lioraFrameInvalidationForCause(
  cause: NativeRenderCause,
  requiresLayout = cause === 'start' || cause === 'resize',
): FrameInvalidationRequest {
  if (cause === 'input') {
    return { source: 'input', requiresLayout, priority: 'interactive' };
  }
  if (cause === 'resize') {
    return { source: 'resize', requiresLayout: true, priority: 'interactive' };
  }
  if (cause === 'animation') {
    return { source: 'animation', requiresLayout, priority: 'ambient' };
  }
  if (requiresLayout) {
    return { source: 'layout', requiresLayout: true, priority: 'normal' };
  }
  return {
    source: 'state',
    requiresLayout: false,
    priority: cause === 'transcript-scroll' ? 'interactive' : 'normal',
  };
}

function applyListenerResult(
  data: string,
  result: RendererInputListenerResult,
): string {
  return result?.data ?? data;
}
