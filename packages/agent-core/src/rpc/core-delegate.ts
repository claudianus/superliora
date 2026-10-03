/**
 * Binds a module-level RPC helper `(context, ...args) => result` as a class
 * method `(this, ...args) => result` without duplicating wrapper bodies.
 */

export function delegateContextMethod<
  TContext,
  TArgs extends readonly unknown[],
  TResult,
>(
  fn: (context: TContext, ...args: TArgs) => TResult,
): (this: TContext & { assertOpen?(): void; trackOperation?<T>(value: T): T }, ...args: TArgs) => TResult {
  return function (this: TContext & { assertOpen?(): void; trackOperation?<T>(value: T): T }, ...args: TArgs): TResult {
    this.assertOpen?.();
    const result = fn(this, ...args);
    return this.trackOperation === undefined ? result : this.trackOperation(result);
  };
}

