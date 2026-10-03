/**
 * Runtime, Kaos, and session wiring helpers — extracted from core-impl.ts.
 */


import { ErrorCodes, LioraError } from '#/errors/index';
import { KaosShellNotFoundError, LocalKaos, type Kaos } from '@superliora/kaos';

import type { LioraConfig } from '../config';
import { resolvePromptCacheKey } from '../config/prompt-cache-key';
import { Session } from '../session';
import {
  ProviderManager,
  type OAuthTokenProviderResolver,
} from '../session/provider/provider-manager';
import { SessionAPIImpl } from '../session/rpc';

export interface CoreRuntimeSupportContext {
  readonly kimiRequestHeaders: Record<string, string> | undefined;
  readonly resolveOAuthTokenProvider: OAuthTokenProviderResolver | undefined;
  config: LioraConfig;
  readonly sessions: Map<string, Session>;
  kaos: Promise<Kaos> | undefined;
}


export function getKaos(context: CoreRuntimeSupportContext): Promise<Kaos> {
  context.kaos ??= LocalKaos.create().catch((error: unknown) => {
    if (error instanceof KaosShellNotFoundError) {
      throw new LioraError(ErrorCodes.SHELL_GIT_BASH_NOT_FOUND, error.message);
    }
    throw error;
  });
  return context.kaos;
}


export function resolveProviderManager(
  context: CoreRuntimeSupportContext,
  sessionId: string,
): ProviderManager {
  return new ProviderManager({
    config: () => context.config,
    kimiRequestHeaders: context.kimiRequestHeaders,
    resolveOAuthTokenProvider: context.resolveOAuthTokenProvider,
    promptCacheKey: () => resolvePromptCacheKey(sessionId, context.config),
  });
}


export function requireSession(context: CoreRuntimeSupportContext, sessionId: string): Session {
  const session = context.sessions.get(sessionId);
  if (session === undefined) {
    throw new LioraError(ErrorCodes.SESSION_NOT_FOUND, `Session "${sessionId}" was not found`, {
      details: { sessionId },
    });
  }
  return session;
}

export function sessionApi(context: CoreRuntimeSupportContext, sessionId: string): SessionAPIImpl {
  return new SessionAPIImpl(requireSession(context, sessionId));
}


export async function refreshSessionRuntimeConfig(
  context: CoreRuntimeSupportContext,
  session: Session,
  config: LioraConfig,
): Promise<void> {
  const api = new SessionAPIImpl(session);
  // A session migrated from an external tool carries no model, and any
  // session may reference a model alias that no longer exists in config.toml.
  // Try the session's own model first, then fall back to the configured
  // default, so resume degrades gracefully instead of hard-failing.
  const requested = (await api.getModel({ agentId: 'main' })).trim();
  const fallback = config.defaultModel?.trim() ?? '';
  const candidates = [...new Set([requested, fallback].filter((model) => model.length > 0))];
  for (const model of candidates) {
    try {
      await api.setModel({ agentId: 'main', model });
      await session.flushMetadata();
      return;
    } catch (error) {
      // Skip a candidate only when the alias is genuinely absent from
      // config (a stale or migrated model) — that is the graceful-degrade
      // case. A *configured* alias that fails to resolve (missing provider,
      // no credentials, bad max_context_size) is an actionable config error
      // the user must see; surface it instead of silently swapping models.
      const aliasMissing = config.models?.[model] === undefined;
      if (
        aliasMissing &&
        error instanceof LioraError &&
        error.code === ErrorCodes.CONFIG_INVALID
      ) {
        continue;
      }
      throw error;
    }
  }
}

