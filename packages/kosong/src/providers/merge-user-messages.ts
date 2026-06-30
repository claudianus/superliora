/**
 * Strict providers require user/model roles to alternate. After tool results
 * are converted to user-role turns, valid histories can contain adjacent user
 * turns, so normalize them at the provider boundary.
 */
export function mergeConsecutiveUserMessages<T>(
  messages: readonly T[],
  ops: {
    readonly isUser: (message: T) => boolean;
    readonly isToolResultOnly: (message: T) => boolean;
    readonly merge: (last: T, next: T) => T;
  },
): T[] {
  const out: T[] = [];
  for (const message of messages) {
    const lastIndex = out.length - 1;
    const last = lastIndex >= 0 ? out[lastIndex] : undefined;
    if (
      last !== undefined &&
      ops.isUser(last) &&
      ops.isUser(message) &&
      (ops.isToolResultOnly(last) || !ops.isToolResultOnly(message))
    ) {
      out[lastIndex] = ops.merge(last, message);
    } else {
      out.push(message);
    }
  }
  return out;
}
