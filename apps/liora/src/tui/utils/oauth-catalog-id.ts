/**
 * Maps an OAuth provider id (e.g. `xai-grok`) to its models.dev catalog
 * provider key (e.g. `xai`). OAuth profile ids don't always match the
 * catalog key, so callers that need to look a provider up in the catalog
 * route through here.
 */
export function oauthProviderCatalogId(id: string): string {
  if (id === 'openai-codex') return 'openai';
  if (id === 'xai-grok') return 'xai';
  return id;
}
