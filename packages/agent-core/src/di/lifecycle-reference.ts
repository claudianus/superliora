import type { IDisposable } from './lifecycle';

export interface IReference<T> extends IDisposable {
  readonly object: T;
}

export class RefCountedDisposable {
  private _counter = 1;

  constructor(private readonly _disposable: IDisposable) {}

  acquire(): this {
    this._counter += 1;
    return this;
  }

  release(): this {
    this._counter -= 1;
    if (this._counter === 0) {
      this._disposable.dispose();
    }
    return this;
  }
}

export abstract class ReferenceCollection<T> {
  private readonly references = new Map<
    string,
    { readonly object: T; counter: number }
  >();

  acquire(key: string, ...args: unknown[]): IReference<T> {
    let reference = this.references.get(key);
    if (!reference) {
      reference = {
        counter: 0,
        object: this.createReferencedObject(key, ...args),
      };
      this.references.set(key, reference);
    }

    const { object } = reference;
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      reference.counter -= 1;
      if (reference.counter === 0) {
        this.destroyReferencedObject(key, reference.object);
        this.references.delete(key);
      }
    };

    reference.counter += 1;
    return { object, dispose };
  }

  protected abstract createReferencedObject(key: string, ...args: unknown[]): T;
  protected abstract destroyReferencedObject(key: string, object: T): void;
}

export class AsyncReferenceCollection<T> {
  constructor(private readonly referenceCollection: ReferenceCollection<Promise<T>>) {}

  async acquire(key: string, ...args: unknown[]): Promise<IReference<T>> {
    const ref = this.referenceCollection.acquire(key, ...args);

    try {
      const object = await ref.object;
      return {
        object,
        dispose: () => { ref.dispose(); },
      };
    } catch (error) {
      ref.dispose();
      throw error;
    }
  }
}

export class ImmortalReference<T> implements IReference<T> {
  constructor(public readonly object: T) {}

  dispose(): void {}
}
