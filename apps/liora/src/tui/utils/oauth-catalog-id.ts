/**
 * Maps an OAuth provider id (e.g. `xai-grok`) to its models.dev catalog
 * provider key (e.g. `xai`). OAuth profile ids don't always match the
 * catalog key, so callers that need to look a provider up in the catalog
 * route through here.
 */
export function oauthProviderCatalogId(id: string): string {
  if (id === 'openai-codex') return 'openai';
  if (id === 'xai-grok') return 'xai';
  // Cursor OAuth uses AvailableModels RPC, not models.dev.
  if (id === 'cursor-oauth') return 'cursor-oauth';
  // GLM ZCode provisions a Z.AI API key, so the GLM model catalog is shared.
  if (id === 'glm-zcode') return 'zai';
  // Code Assist login speaks the same Gemini model catalog.
  if (id === 'google-gemini-cli') return 'google';
  return id;
}
