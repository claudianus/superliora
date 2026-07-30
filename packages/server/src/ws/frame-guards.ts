/** Extract the `type` discriminator from a parsed inbound WS frame, if present. */
export function frameType(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return undefined;
  }
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

/** True iff `err` is an object carrying a `name` property equal to `name`. */
export function hasErrorName(err: unknown, name: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === name
  );
}

/**
 * Return true iff `message` is an outbound event envelope marked volatile
 * (deltas / progress / status). Only such frames are eligible for the
 * slow-consumer drop; durable events, acks, ping, and `resync_required`
 * itself must always be sent.
 */
export function isVolatileEnvelope(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'volatile' in message &&
    (message as { volatile?: unknown }).volatile === true
  );
}
