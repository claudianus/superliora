import { onUnexpectedError } from '../errors/unexpectedError';

export interface IDisposableTracker {
  trackDisposable(disposable: IDisposable): void;
  setParent(child: IDisposable, parent: IDisposable | null): void;
  markAsDisposed(disposable: IDisposable): void;
  markAsSingleton(disposable: IDisposable): void;
}

interface DisposableInfo {
  value: IDisposable;
  source: string | null;
  parent: IDisposable | null;
  isSingleton: boolean;
  idx: number;
}

export class DisposableTracker implements IDisposableTracker {
  private static idx = 0;
  private readonly livingDisposables = new Map<IDisposable, DisposableInfo>();

  private getDisposableData(d: IDisposable): DisposableInfo {
    let val = this.livingDisposables.get(d);
    if (!val) {
      val = {
        parent: null,
        source: null,
        isSingleton: false,
        value: d,
        idx: DisposableTracker.idx++,
      };
      this.livingDisposables.set(d, val);
    }
    return val;
  }

  trackDisposable(d: IDisposable): void {
    const data = this.getDisposableData(d);
    data.source ??= new Error('Disposable tracking').stack ?? null;
  }

  setParent(child: IDisposable, parent: IDisposable | null): void {
    this.getDisposableData(child).parent = parent;
  }

  markAsDisposed(x: IDisposable): void {
    this.livingDisposables.delete(x);
  }

  markAsSingleton(d: IDisposable): void {
    this.getDisposableData(d).isSingleton = true;
  }

  private getRootParent(
    data: DisposableInfo,
    cache: Map<DisposableInfo, DisposableInfo>,
  ): DisposableInfo {
    const cached = cache.get(data);
    if (cached) return cached;
    const result = data.parent
      ? this.getRootParent(this.getDisposableData(data.parent), cache)
      : data;
    cache.set(data, result);
    return result;
  }

  getTrackedDisposables(): IDisposable[] {
    const cache = new Map<DisposableInfo, DisposableInfo>();
    return [...this.livingDisposables.entries()]
      .filter(
        ([, v]) => v.source !== null && !this.getRootParent(v, cache).isSingleton,
      )
      .map(([k]) => k);
  }
}

let disposableTracker: IDisposableTracker | null = null;

export function setDisposableTracker(tracker: IDisposableTracker | null): void {
  disposableTracker = tracker;
}

export function trackDisposable<T extends IDisposable>(x: T): T {
  disposableTracker?.trackDisposable(x);
  return x;
}

export function markAsDisposed(disposable: IDisposable): void {
  disposableTracker?.markAsDisposed(disposable);
}

export function setParentOfDisposable(
  child: IDisposable,
  parent: IDisposable | null,
): void {
  disposableTracker?.setParent(child, parent);
}

function setParentOfDisposables(
  children: IDisposable[],
  parent: IDisposable | null,
): void {
  if (!disposableTracker) return;
  for (const child of children) {
    disposableTracker.setParent(child, parent);
  }
}

export function markAsSingleton<T extends IDisposable>(singleton: T): T {
  disposableTracker?.markAsSingleton(singleton);
  return singleton;
}

export interface IDisposable {
  dispose(): void;
}

export function isDisposable<E>(thing: E): thing is E & IDisposable {
  return (
    typeof thing === 'object' &&
    thing !== null &&
    typeof (thing as unknown as IDisposable).dispose === 'function' &&
    (thing as unknown as IDisposable).dispose.length === 0
  );
}

export function dispose<T extends IDisposable>(disposable: T): T;
export function dispose<T extends IDisposable>(
  disposable: T | undefined,
): T | undefined;
export function dispose<T extends IDisposable, A extends Iterable<T> = Iterable<T>>(
  disposables: A,
): A;
export function dispose<T extends IDisposable>(disposables: Array<T>): Array<T>;
export function dispose<T extends IDisposable>(
  disposables: ReadonlyArray<T>,
): ReadonlyArray<T>;
export function dispose<T extends IDisposable>(
  arg: T | Iterable<T> | undefined,
): unknown {
  if (arg === undefined || arg === null) return arg;
  if (isIterable<T>(arg)) {
    const errors: unknown[] = [];
    for (const d of arg) {
      if (d) {
        try {
          d.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        'Encountered errors while disposing of store',
      );
    }

    return Array.isArray(arg) ? [] : arg;
  }
  (arg).dispose();
  return arg;
}

function isIterable<T>(arg: unknown): arg is Iterable<T> {
  return (
    typeof arg === 'object' &&
    arg !== null &&
    typeof (arg as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function'
  );
}

export function disposeIfDisposable<T extends IDisposable | object>(
  disposables: Array<T>,
): Array<T> {
  const disposableValues: IDisposable[] = [];
  for (const d of disposables) {
    if (isDisposable(d)) {
      disposableValues.push(d);
    }
  }
  dispose(disposableValues);
  return [];
}

class FunctionDisposable implements IDisposable {
  private _isDisposed = false;
  private readonly _fn: () => void;

  constructor(fn: () => void) {
    this._fn = fn;
    trackDisposable(this);
  }

  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    markAsDisposed(this);
    this._fn();
  }
}

export function toDisposable(fn: () => void): IDisposable {
  return new FunctionDisposable(fn);
}

export function combinedDisposable(...disposables: IDisposable[]): IDisposable {
  const parent = toDisposable(() => dispose(disposables));
  setParentOfDisposables(disposables, parent);
  return parent;
}

export class DisposableStore implements IDisposable {
  private readonly _toDispose = new Set<IDisposable>();
  private _isDisposed = false;

  constructor() {
    trackDisposable(this);
  }

  add<T extends IDisposable>(d: T): T {
    if ((d as unknown as DisposableStore) === this) {
      throw new Error('Cannot register a disposable on itself!');
    }
    setParentOfDisposable(d, this);
    if (this._isDisposed) {
      d.dispose();
      return d;
    }
    this._toDispose.add(d);
    return d;
  }

  delete<T extends IDisposable>(d: T): void {
    if (this._isDisposed) return;
    if ((d as unknown as DisposableStore) === this) {
      throw new Error('Cannot dispose a disposable on itself!');
    }
    this._toDispose.delete(d);
    d.dispose();
  }

  deleteAndLeak<T extends IDisposable>(d: T): void {
    if (this._isDisposed) return;
    if (this._toDispose.delete(d)) {
      setParentOfDisposable(d, null);
    }
  }

  clear(): void {
    if (this._toDispose.size === 0) return;
    try {
      dispose(this._toDispose);
    } finally {
      this._toDispose.clear();
    }
  }

  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    markAsDisposed(this);
    this.clear();
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  assertNotDisposed(): void {
    if (this._isDisposed) {
      onUnexpectedError(new Error('Object disposed'));
    }
  }
}

export abstract class Disposable implements IDisposable {
  protected readonly _store = new DisposableStore();

  constructor() {
    trackDisposable(this);
    setParentOfDisposable(this._store, this);
  }

  protected _register<T extends IDisposable>(d: T): T {
    if ((d as unknown as Disposable) === this) {
      throw new Error('Cannot register a disposable on itself!');
    }
    return this._store.add(d);
  }

  dispose(): void {
    markAsDisposed(this);
    this._store.dispose();
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Disposable {
  export const None: IDisposable = Object.freeze({
    dispose(): void {},
  });
}

export class MutableDisposable<T extends IDisposable> implements IDisposable {
  private _value: T | undefined;
  private _isDisposed = false;

  constructor() {
    trackDisposable(this);
  }

  get value(): T | undefined {
    return this._isDisposed ? undefined : this._value;
  }

  set value(value: T | undefined) {
    if (this._isDisposed) {
      if (value !== undefined) {
        value.dispose();
      }
      return;
    }
    if (this._value === value) return;
    this._value?.dispose();
    if (value) setParentOfDisposable(value, this);
    this._value = value;
  }

  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    markAsDisposed(this);
    const prev = this._value;
    if (prev !== undefined) {
      prev.dispose();
    }
    this._value = undefined;
  }

  clear(): void {
    if (this._isDisposed) return;
    this.value = undefined;
  }

  clearAndLeak(): T | undefined {
    if (this._isDisposed) return undefined;
    const prev = this._value;
    this._value = undefined;
    if (prev !== undefined) setParentOfDisposable(prev, null);
    return prev;
  }
}

export class MandatoryMutableDisposable<T extends IDisposable> implements IDisposable {
  private readonly _disposable = new MutableDisposable<T>();
  private _isDisposed = false;

  constructor(initialValue: T) {
    this._disposable.value = initialValue;
  }

  get value(): T {
    return this._disposable.value!;
  }

  set value(value: T) {
    if (this._isDisposed || value === this._disposable.value) return;
    this._disposable.value = value;
  }

  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    this._disposable.dispose();
  }
}

export {
  AsyncReferenceCollection,
  ImmortalReference,
  RefCountedDisposable,
  ReferenceCollection,
  type IReference,
} from './lifecycle-reference';
export { DisposableMap, DisposableSet } from './lifecycle-disposable-collections';

export function disposeOnReturn(fn: (store: DisposableStore) => void): void {
  const store = new DisposableStore();
  try {
    fn(store);
  } finally {
    store.dispose();
  }
}

export function thenIfNotDisposed<T>(
  promise: Promise<T>,
  then: (result: T) => void,
): IDisposable {
  let disposed = false;
  void promise.then((result) => {
    if (disposed) return;
    then(result);
  });
  return toDisposable(() => {
    disposed = true;
  });
}

export function thenRegisterOrDispose<T extends IDisposable>(
  promise: Promise<T>,
  store: DisposableStore,
): Promise<T> {
  return promise.then((disposable) => {
    if (store.isDisposed) {
      disposable.dispose();
    } else {
      store.add(disposable);
    }
    return disposable;
  });
}
