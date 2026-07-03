import type { NativeInputEvent } from './input-events';

export type NativeInputRoute = 'modal' | 'focused' | 'global' | 'unhandled';

export interface NativeInputRouteContext {
  readonly router: NativeInputRouter;
  readonly route: Exclude<NativeInputRoute, 'unhandled'>;
  readonly targetId: string;
}

export type NativeInputHandler = (
  event: NativeInputEvent,
  context: NativeInputRouteContext,
) => boolean | void;

export interface NativeInputTarget {
  readonly id: string;
  readonly onInput: NativeInputHandler;
  readonly focusable?: boolean;
  readonly enabled?: boolean | (() => boolean);
}

export interface NativeGlobalInputHandler {
  readonly id: string;
  readonly onInput: NativeInputHandler;
  readonly enabled?: boolean | (() => boolean);
}

export interface NativeInputRouteResult {
  readonly event: NativeInputEvent;
  readonly route: NativeInputRoute;
  readonly handled: boolean;
  readonly targetId?: string;
}

export class NativeInputRouter {
  private readonly targets = new Map<string, NativeInputTarget>();
  private readonly targetOrder: string[] = [];
  private readonly globalHandlers = new Map<string, NativeGlobalInputHandler>();
  private readonly globalOrder: string[] = [];
  private readonly modalStack: string[] = [];
  private readonly focusStack: Array<string | undefined> = [];
  private focused: string | undefined;

  get focusedTargetId(): string | undefined {
    return this.focused;
  }

  get modalTargetId(): string | undefined {
    return this.modalStack.at(-1);
  }

  registerTarget(target: NativeInputTarget): () => void {
    if (!this.targets.has(target.id)) this.targetOrder.push(target.id);
    this.targets.set(target.id, target);
    return () => {
      this.unregisterTarget(target.id);
    };
  }

  unregisterTarget(targetId: string): void {
    this.targets.delete(targetId);
    removeAll(this.targetOrder, targetId);
    removeAll(this.modalStack, targetId);
    removeAll(this.focusStack, targetId);
    if (this.focused === targetId) this.focused = undefined;
  }

  registerGlobalHandler(handler: NativeGlobalInputHandler): () => void {
    if (!this.globalHandlers.has(handler.id)) this.globalOrder.push(handler.id);
    this.globalHandlers.set(handler.id, handler);
    return () => {
      this.globalHandlers.delete(handler.id);
      removeAll(this.globalOrder, handler.id);
    };
  }

  focus(targetId: string | undefined): boolean {
    if (targetId === undefined) {
      this.focused = undefined;
      return true;
    }
    const target = this.targets.get(targetId);
    if (target === undefined || !isTargetEnabled(target) || target.focusable === false) return false;
    this.focused = targetId;
    return true;
  }

  pushFocus(targetId: string): () => void {
    const previous = this.focused;
    this.focusStack.push(previous);
    this.focus(targetId);
    return () => {
      const last = this.focusStack.pop();
      this.focus(last);
    };
  }

  pushModal(targetId: string): () => void {
    if (!this.targets.has(targetId)) {
      throw new Error(`Cannot push unknown native input modal target: ${targetId}`);
    }
    this.modalStack.push(targetId);
    return () => {
      this.popModal(targetId);
    };
  }

  popModal(targetId?: string): string | undefined {
    if (targetId === undefined) return this.modalStack.pop();
    const index = this.modalStack.lastIndexOf(targetId);
    if (index === -1) return undefined;
    const [removed] = this.modalStack.splice(index, 1);
    return removed;
  }

  focusNext(): string | undefined {
    return this.focusByOffset(1);
  }

  focusPrevious(): string | undefined {
    return this.focusByOffset(-1);
  }

  dispatch(event: NativeInputEvent): NativeInputRouteResult {
    const modal = this.activeTarget(this.modalTargetId);
    if (modal !== undefined) {
      const handled = modal.onInput(event, { router: this, route: 'modal', targetId: modal.id }) === true;
      if (handled) return { event, route: 'modal', handled, targetId: modal.id };
    }

    const focused = this.activeTarget(this.focused);
    if (focused !== undefined) {
      const handled = focused.onInput(event, {
        router: this,
        route: 'focused',
        targetId: focused.id,
      }) === true;
      if (handled) return { event, route: 'focused', handled, targetId: focused.id };
    }

    for (const id of this.globalOrder) {
      const handler = this.globalHandlers.get(id);
      if (handler === undefined || !isHandlerEnabled(handler)) continue;
      const handled = handler.onInput(event, { router: this, route: 'global', targetId: id }) === true;
      if (handled) return { event, route: 'global', handled, targetId: id };
    }

    return { event, route: 'unhandled', handled: false };
  }

  private activeTarget(targetId: string | undefined): NativeInputTarget | undefined {
    if (targetId === undefined) return undefined;
    const target = this.targets.get(targetId);
    if (target === undefined || !isTargetEnabled(target)) return undefined;
    return target;
  }

  private focusByOffset(offset: 1 | -1): string | undefined {
    const candidates = this.targetOrder.filter((id) => {
      const target = this.targets.get(id);
      return target !== undefined && target.focusable !== false && isTargetEnabled(target);
    });
    if (candidates.length === 0) {
      this.focused = undefined;
      return undefined;
    }

    const current = this.focused === undefined ? (offset === 1 ? -1 : 0) : candidates.indexOf(this.focused);
    const next = mod(current + offset, candidates.length);
    const targetId = candidates[next];
    this.focused = targetId;
    return targetId;
  }
}

function isTargetEnabled(target: Pick<NativeInputTarget, 'enabled'>): boolean {
  return isEnabled(target.enabled);
}

function isHandlerEnabled(handler: Pick<NativeGlobalInputHandler, 'enabled'>): boolean {
  return isEnabled(handler.enabled);
}

function isEnabled(value: boolean | (() => boolean) | undefined): boolean {
  if (typeof value === 'function') return value();
  return value !== false;
}

function removeAll<T>(items: T[], value: T): void {
  for (;;) {
    const index = items.indexOf(value);
    if (index === -1) return;
    items.splice(index, 1);
  }
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
