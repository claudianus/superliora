/**
 * Map a catalog / config model id onto the AgentService/Run wire id.
 *
 * Mirrors opencodex (`cursorCodexToWireModelId` + issue #117 + GetUsableModels naming):
 * - Discovery may return ids with a `cursor-` prefix (`cursor-grok-4.5-high`).
 * - AvailableModels `legacySlug` uses effort-then-fast (`grok-4.5-high-fast`);
 *   Run / GetUsableModels want fast-then-effort (`grok-4.5-fast-high`).
 * - Auto-router is advertised as `auto`; the wire id is `default`.
 */

const CURSOR_WIRE_PREFIX = 'cursor-';
const EFFORT_THEN_FAST =
  /^(.+)-(none|low|medium|high|xhigh|max)-fast$/i;

/** Strip the GetUsableModels `cursor-` prefix when present. */
export function stripCursorWirePrefix(modelId: string): string {
  const id = modelId.trim();
  return id.startsWith(CURSOR_WIRE_PREFIX) ? id.slice(CURSOR_WIRE_PREFIX.length) : id;
}

/**
 * Rewrite AvailableModels legacySlug ordering to the GetUsableModels / Run form.
 * `grok-4.5-high-fast` → `grok-4.5-fast-high`.
 */
export function rewriteCursorLegacyFastSuffix(modelId: string): string {
  const match = EFFORT_THEN_FAST.exec(modelId);
  if (match === null) return modelId;
  return `${match[1]}-fast-${match[2]!.toLowerCase()}`;
}

/** Resolve the model id Cursor Connect expects for AgentService/Run. */
export function toCursorWireModelId(modelId: string): string {
  const stripped = stripCursorWirePrefix(modelId);
  if (stripped === 'auto') return 'default';
  return rewriteCursorLegacyFastSuffix(stripped);
}
