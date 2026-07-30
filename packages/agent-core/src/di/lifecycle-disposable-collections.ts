import {
  dispose,
  markAsDisposed,
  setParentOfDisposable,
  trackDisposable,
  type IDisposable,
} from './lifecycle';

export class DisposableMap<K, V extends IDisposable = IDisposable>
  implements IDisposable
{
  private readonly _store: Map<K, V>;
  private _isDisposed = false;

  constructor(store: Map<K, V> = new Map<K, V>()) {
    this._store = store;
    trackDisposable(this);
  }

  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    markAsDisposed(this);
    this.clearAndDisposeAll();
  }

  clearAndDisposeAll(): void {
    if (this._store.size === 0) return;
    try {
      dispose(this._store.values());
    } finally {
      this._store.clear();
    }
  }

  has(key: K): boolean {
    return this._store.has(key);
  }

  get size(): number {
    return this._store.size;
  }

  get(key: K): V | undefined {
    return this._store.get(key);
  }

  set(key: K, value: V, skipDisposeOnOverwrite = false): void {
    if (this._isDisposed) {
      // eslint-disable-next-line no-console
      console.warn(
        new Error(
          'Trying to add a disposable to a DisposableMap that has already been disposed of. The added object will be leaked!',
        ).stack,
      );
      return;
    }
    if (!skipDisposeOnOverwrite) {
      const prev = this._store.get(key);
      if (prev !== undefined && prev !== value) {
        prev.dispose();
      }
    }
    this._store.set(key, value);
    setParentOfDisposable(value, this);
  }

  deleteAndDispose(key: K): void {
    const value = this._store.get(key);
    if (value !== undefined) {
      value.dispose();
    }
    this._store.delete(key);
  }

  deleteAndLeak(key: K): V | undefined {
    const value = this._store.get(key);
    if (value !== undefined) setParentOfDisposable(value, null);
    this._store.delete(key);
    return value;
  }

  keys(): IterableIterator<K> {
    return this._store.keys();
  }

  values(): IterableIterator<V> {
    return this._store.values();
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this._store[Symbol.iterator]();
  }
}

export class DisposableSet<V extends IDisposable = IDisposable>
  implements IDisposable
{
  private readonly _store: Set<V>;
  private _isDisposed = false;

  constructor(store: Set<V> = new Set<V>()) {
    this._store = store;
    trackDisposable(this);
  }

  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    markAsDisposed(this);
    this.clearAndDisposeAll();
  }

  clearAndDisposeAll(): void {
    if (this._store.size === 0) return;
    try {
      dispose(this._store.values());
    } finally {
      this._store.clear();
    }
  }

  has(value: V): boolean {
    return this._store.has(value);
  }

  get size(): number {
    return this._store.size;
  }

  add(value: V): void {
    if (this._isDisposed) {
      // eslint-disable-next-line no-console
      console.warn(
        new Error(
          'Trying to add a disposable to a DisposableSet that has already been disposed of. The added object will be leaked!',
        ).stack,
      );
      return;
    }
    this._store.add(value);
    setParentOfDisposable(value, this);
  }

  deleteAndDispose(value: V): void {
    if (this._store.delete(value)) {
      value.dispose();
    }
  }

  deleteAndLeak(value: V): V | undefined {
    if (this._store.delete(value)) {
      setParentOfDisposable(value, null);
      return value;
    }
    return undefined;
  }

  values(): IterableIterator<V> {
    return this._store.values();
  }

  [Symbol.iterator](): IterableIterator<V> {
    return this._store[Symbol.iterator]();
  }
}
