import {
  isFocusable,
  NativeRendererTerminalHost,
  NativeTerminalRenderer,
  renderNativeRootChildren,
  resolveNativePremiumRendererDefaults,
  type Component,
  type NativeInputEvent,
  type NativeRootUIOptions,
  type NativeRenderCause,
  type NativeTerminalRendererRender,
  type RendererInputListener,
  type RendererInputListenerResult,
  type RendererRootUI,
  type RendererTerminalHost,
} from '@harness-kit/tui-renderer';

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
  private focusedComponent: TComponent | undefined;
  private inputRouter: { dispatch(event: NativeInputEvent): void } | undefined;
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
    this.renderer = new NativeTerminalRenderer({
      ...options,
      adaptiveQuality: false,
      outputPolicy: options.outputPolicy ?? premiumDefaults.outputPolicy,
      onInput: (data) => {
        this.handleRawInput(data.toString('utf8'));
      },
      onInputEvent: (event) => {
        this.inputRouter?.dispatch(event);
      },
      render: (frame) => this.renderCallback(frame),
    });
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
    this.renderer.stop();
  }

  requestRender(force?: boolean | NativeRenderCause): void {
    if (force === true) {
      this.renderer.requestRender('manual');
    } else if (force === false || force === undefined) {
      this.renderer.requestRender('request');
    } else {
      this.renderer.requestRender(force);
    }
  }

  addChild(component: TComponent): void {
    this.children.push(component);
    this.requestRender();
  }

  clear(): void {
    this.children.length = 0;
    this.focusedComponent = undefined;
    this.requestRender(true);
  }

  setFocus(component: TComponent): void {
    if (this.focusedComponent === component) return;
    if (this.focusedComponent !== undefined && isFocusable(this.focusedComponent)) {
      this.focusedComponent.focused = false;
    }
    this.focusedComponent = component;
    if (isFocusable(component)) component.focused = true;
    this.requestRender();
  }

  addInputListener(listener: RendererInputListener): () => void {
    this.inputListeners.push(listener);
    return () => {
      const index = this.inputListeners.indexOf(listener);
      if (index !== -1) this.inputListeners.splice(index, 1);
    };
  }

  private handleRawInput(data: string): void {
    let next = data;
    for (const listener of this.inputListeners) {
      const result = listener(next);
      next = applyListenerResult(next, result);
      if (result?.consume === true) {
        this.requestRender();
        return;
      }
    }
    if (this.inputRouter !== undefined) {
      // Structured input events are routed via onInputEvent; do not also feed
      // raw data to the focused component.
      return;
    }
    this.focusedComponent?.handleInput?.(next);
    this.requestRender();
  }
}

function applyListenerResult(
  data: string,
  result: RendererInputListenerResult,
): string {
  return result?.data ?? data;
}
