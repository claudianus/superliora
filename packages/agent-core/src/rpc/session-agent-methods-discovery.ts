import type { SessionWarning } from '@superliora/protocol';

import type { EmptyPayload } from './core-api';

import type { SessionAgentMethodsContext } from './session-agent-methods';

type SessionScopedPayload<T> = T & { readonly sessionId: string };

export function getSessionWarnings(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): Promise<readonly SessionWarning[]> {
  return context.sessionApi(sessionId).getSessionWarnings(payload);
}
