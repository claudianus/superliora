import { formatErrorMessage } from '../../utils/event-payload';
import { ttui } from '#/tui/utils/tui-i18n';

/**
 * Extra guidance after an OAuth login failure. Experimental unofficial
 * clients stay behind flags; this only points at supported alternatives
 * or the env override for a stale client-version pin.
 */
export function oauthLoginFollowUp(providerId: string, error: unknown): string | undefined {
  const message = formatErrorMessage(error).toLowerCase();
  if (providerId === 'anthropic-oauth') {
    return ttui('tui.provider.oauthAnthropicRejected');
  }
  if (providerId === 'cursor-oauth' && /outdated|client.version|upgrade your/.test(message)) {
    return ttui('tui.provider.oauthCursorVersion');
  }
  if (providerId === 'xai-grok' && /outdated|x-grok-client-version|grok cli/.test(message)) {
    return ttui('tui.provider.oauthXaiVersion');
  }
  // Broker error 2007: the ZCode desktop app consumed the single-use code
  // before the paste could reach the broker.
  if (providerId === 'glm-zcode' && /2007|broker|single.use|already.*(used|consumed)/.test(message)) {
    return ttui('tui.provider.oauthGlmZcodeBroker');
  }
  return undefined;
}
