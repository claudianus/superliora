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
  // The OAuth-minted OpenRouter key unlocks the full router catalog.
  if (id === 'openrouter-oauth') return 'openrouter';
  // MiniMax Coding Plan logins serve the public MiniMax model family.
  if (id === 'minimax-oauth') return 'minimax';
  if (id === 'minimax-oauth-cn') return 'minimax-cn';
  // `qwen-oauth`, `nous`, `google-antigravity`, `devin`, `muse-code`, `kilo`,
  // `factory-droid` have no models.dev entry — they resolve from profile
  // presets and each provider's live discovery (Devin GetCliModelConfigs,
  // Nous /models, Kilo gateway, Meta catalog).
  return id;
}
