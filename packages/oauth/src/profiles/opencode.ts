/**
 * OpenCode Zen / Go base-URL helpers.
 *
 * SuperLiora ships OpenCode Zen (`https://opencode.ai/zen/v1`) and OpenCode
 * Go (`https://opencode.ai/zen/go/v1`) as `type: 'openai'` catalog providers
 * (see apps/liora `local-catalog-providers.ts`). OpenCode requires a stable
 * per-conversation identity header on inference requests:
 *
 *   `x-opencode-session: <stable-id-per-conversation>`
 *
 * Requests missing the header may error once their 09/06 policy lands. The
 * session key that already flows through provider configs as
 * `promptCacheKey` (`resolvePromptCacheKey` / `pinPromptCacheKeyToAgent`) is
 * stable per conversation, so it doubles as the session identity.
 *
 * Detection is host + path based (mirroring `isXaiGrokBuildBaseUrl` in
 * `xai.ts`) so custom reverse proxies that keep the `opencode.ai/zen` path
 * still match, while unrelated `opencode.ai` traffic does not.
 */

function hostAndPathOf(baseUrl: string | undefined): { host: string; path: string } | undefined {
  if (baseUrl === undefined) return undefined;
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const url = new URL(trimmed);
    return { host: url.host.toLowerCase(), path: url.pathname.toLowerCase() };
  } catch {
    // Accept bare host-ish strings or values missing a scheme.
    const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
    const [host = '', ...pathParts] = withoutScheme.split('/');
    return {
      host: host.toLowerCase(),
      path: pathParts.length > 0 ? `/${pathParts.join('/').toLowerCase()}` : '/',
    };
  }
}

/** True when `baseUrl` points at OpenCode Zen or OpenCode Go inference. */
export function isOpenCodeZenBaseUrl(baseUrl: string | undefined): boolean {
  const resolved = hostAndPathOf(baseUrl);
  return (
    resolved !== undefined &&
    resolved.host === 'opencode.ai' &&
    resolved.path.startsWith('/zen')
  );
}

/**
 * Session identity headers OpenCode Zen/Go endpoints expect per request.
 * Empty when no session key is available — callers merge the result ahead of
 * user-configured headers so explicit config always wins.
 */
export function opencodeSessionHeaders(promptCacheKey: string | undefined): Record<string, string> {
  const sessionKey = promptCacheKey?.trim();
  if (sessionKey === undefined || sessionKey.length === 0) return {};
  return { 'x-opencode-session': sessionKey };
}
