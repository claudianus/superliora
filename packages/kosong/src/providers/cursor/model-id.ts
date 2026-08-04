/**
 * Map a catalog / config model id onto the AgentService/Run wire id.
 *
 * Live GetUsableModels returns Grok as `cursor-grok-4.5-high-fast` (prefix
 * required) and Composer/GPT as bare ids. Run accepts those ids verbatim —
 * stripping `cursor-` from Grok yields ERROR_BAD_MODEL_NAME (live-verified).
 */

/** Stale inverted form from a brief SuperLiora mis-rewrite. */
const FAST_THEN_EFFORT = /^(.+)-fast-(none|low|medium|high|xhigh|max)$/i;

/**
 * Undo stale `*-fast-{effort}` catalog ids → current `*-{effort}-fast`.
 * Does NOT strip a leading `cursor-` prefix.
 */
export function rewriteCursorLegacyFastSuffix(modelId: string): string {
  const match = FAST_THEN_EFFORT.exec(modelId);
  if (match === null) return modelId;
  return `${match[1]}-${match[2]!.toLowerCase()}-fast`;
}

/**
 * @deprecated Comparison helper only — never call before AgentService/Run for Grok.
 */
export function stripCursorWirePrefix(modelId: string): string {
  const id = modelId.trim();
  return id.startsWith('cursor-') ? id.slice('cursor-'.length) : id;
}

/** Restore the GetUsableModels `cursor-` prefix for Grok family ids. */
export function ensureCursorGrokWirePrefix(modelId: string): string {
  if (modelId.startsWith('cursor-')) return modelId;
  // Live catalog: cursor-grok-4.5-{low,medium,high}[-fast]
  if (/^grok-4\.5(?:-|$)/.test(modelId)) return `cursor-${modelId}`;
  return modelId;
}

/** Resolve the model id Cursor Connect expects for AgentService/Run. */
export function toCursorWireModelId(modelId: string): string {
  const id = modelId.trim();
  if (id === 'auto' || id === 'cursor-auto') return 'default';
  return ensureCursorGrokWirePrefix(rewriteCursorLegacyFastSuffix(id));
}
