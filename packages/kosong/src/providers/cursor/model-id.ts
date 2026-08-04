/**
 * Map a catalog / config model id onto the AgentService/Run wire id.
 *
 * Mirrors opencodex v2.10 (`cursorCodexToWireModelId` + issue #117 + #797):
 * - GetUsableModels may return ids with a `cursor-` prefix
 *   (`cursor-grok-4.5-high-fast`); strip before Run.
 * - Grok Fast puts the mode marker AFTER effort (`grok-4.5-high-fast`), not
 *   before (`grok-4.5-fast-high`). See opencodex `cursorWireModelIdWithEffort`.
 * - Auto-router is advertised as `auto`; the wire id is `default`.
 */

const CURSOR_WIRE_PREFIX = 'cursor-';

/** Strip the GetUsableModels `cursor-` prefix when present. */
export function stripCursorWirePrefix(modelId: string): string {
  const id = modelId.trim();
  return id.startsWith(CURSOR_WIRE_PREFIX) ? id.slice(CURSOR_WIRE_PREFIX.length) : id;
}

/**
 * Older SuperLiora catalogs rewrote effort-then-fast → fast-then-effort.
 * Current Cursor / opencodex wire ids use effort-then-fast; undo that rewrite
 * when a stale config still has the inverted form.
 */
export function rewriteCursorLegacyFastSuffix(modelId: string): string {
  // Stale inverted form from #880: grok-4.5-fast-high → grok-4.5-high-fast
  const inverted = /^(.+)-fast-(none|low|medium|high|xhigh|max)$/i.exec(modelId);
  if (inverted !== null) {
    return `${inverted[1]}-${inverted[2]!.toLowerCase()}-fast`;
  }
  return modelId;
}

/** Resolve the model id Cursor Connect expects for AgentService/Run. */
export function toCursorWireModelId(modelId: string): string {
  const stripped = stripCursorWirePrefix(modelId);
  if (stripped === 'auto') return 'default';
  return rewriteCursorLegacyFastSuffix(stripped);
}
