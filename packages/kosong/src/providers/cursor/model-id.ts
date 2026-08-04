/**
 * Map a catalog / config model id onto the AgentService/Run wire id.
 *
 * Mirrors opencodex (`cursorCodexToWireModelId` + issue #117):
 * - GetUsableModels / AvailableModels may return ids with a `cursor-` prefix
 *   (`cursor-grok-4.5-high`), but Run rejects those as unknown.
 * - Auto-router is advertised as `auto` / `default`; the wire id is `default`.
 */

const CURSOR_WIRE_PREFIX = 'cursor-';

/** Strip the GetUsableModels `cursor-` prefix when present. */
export function stripCursorWirePrefix(modelId: string): string {
  const id = modelId.trim();
  return id.startsWith(CURSOR_WIRE_PREFIX) ? id.slice(CURSOR_WIRE_PREFIX.length) : id;
}

/** Resolve the model id Cursor Connect expects for AgentService/Run. */
export function toCursorWireModelId(modelId: string): string {
  const stripped = stripCursorWirePrefix(modelId);
  if (stripped === 'auto') return 'default';
  return stripped;
}
