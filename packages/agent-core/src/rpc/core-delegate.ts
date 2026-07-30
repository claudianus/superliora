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
): (this: TContext, ...args: TArgs) => TResult {
  return function (this: TContext, ...args: TArgs): TResult {
    return fn(this, ...args);
  };
}

export function delegateContextMethodWithOptions<
  TContext,
  TArgs extends readonly unknown[],
  TOptions,
  TResult,
>(
  fn: (context: TContext, ...args: [...TArgs, TOptions?]) => TResult,
): (this: TContext, ...args: [...TArgs, TOptions?]) => TResult {
  return function (this: TContext, ...args: [...TArgs, TOptions?]): TResult {
    return fn(this, ...args);
  };
}
