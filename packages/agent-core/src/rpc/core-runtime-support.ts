/**
 * Runtime, Kaos, and session wiring helpers — extracted from core-impl.ts.
 */

import { homedir } from 'node:os';

import { ErrorCodes, LioraError } from '#/errors';
import {
  createContext7Provider,
  isContext7Enabled,
  readContext7ApiKeyFromConfig,
} from '#/tools/providers/context7-session';
import { KaosShellNotFoundError, LocalKaos, type Kaos } from '@superliora/kaos';

import type { LioraConfig } from '../config';
import type { PluginManager } from '../plugin';
import type { SessionMcpConfig } from '../mcp';
import { Session, type SessionSkillConfig } from '../session';
import {
  ProviderManager,
  type OAuthTokenProviderResolver,
} from '../session/provider/provider-manager';
import { SessionAPIImpl } from '../session/rpc';
import type { ToolServices } from '../tools/support/services';
import {
  combinePluginMcpConfig,
  managedKimiCodeEnvForPlugins,
  withManagedKimiPluginEnv,
} from './plugin-mcp-env';
import { createRuntimeConfig, hasStatefulGuiRuntime } from './runtime-factory';
import type { SDKRPC } from './sdk-api';

export interface CoreRuntimeSupportContext {
  readonly homeDir: string;
  readonly userHomeDir: string;
  readonly skillDirs: readonly string[];
  readonly plugins: PluginManager;
  readonly kimiRequestHeaders: Record<string, string> | undefined;
  readonly resolveOAuthTokenProvider: OAuthTokenProviderResolver | undefined;
  readonly runtimeOverride: ToolServices | undefined;
  readonly sdk: Promise<SDKRPC>;
  config: LioraConfig;
  readonly sessions: Map<string, Session>;
  kaos: Promise<Kaos> | undefined;
  runtime: ToolServices | undefined;

  setKimiConfig(input: { research: { context7: { apiKey: string } } }): Promise<LioraConfig>;
}

export async function resolveRuntime(context: CoreRuntimeSupportContext): Promise<ToolServices> {
  if (context.runtimeOverride !== undefined) return context.runtimeOverride;
  const statefulGui = hasStatefulGuiRuntime(context.config);
  if (!statefulGui && context.runtime !== undefined) return context.runtime;
  const runtime = await createRuntimeConfig({
    config: context.config,
    homeDir: context.homeDir,
    kimiRequestHeaders: context.kimiRequestHeaders,
    resolveOAuthTokenProvider: context.resolveOAuthTokenProvider,
  });
  if (!statefulGui) context.runtime = runtime;
  return runtime;
}

export async function buildSessionToolServices(
  context: CoreRuntimeSupportContext,
  config: LioraConfig,
  sessionId: string,
): Promise<ToolServices> {
  const runtime = await resolveRuntime(context);
  const context7 = createContext7Provider({
    isEnabled: () => isContext7Enabled(config),
    readApiKey: () => readContext7ApiKeyFromConfig(context.config),
    requestApiKey: async ({ toolCallId }) => {
      const sdk = await context.sdk;
      const response = await sdk.requestCredential({
        sessionId,
        agentId: 'main',
        id: 'context7',
        title: 'Context7',
        subtitleLines: [
          'Free API keys: https://context7.com/dashboard',
          'Saved to ~/.superliora/config.toml',
        ],
        toolCallId,
      });
      const value = response?.value;
      return value !== undefined && value.length > 0 ? value : undefined;
    },
    persistApiKey: async (apiKey) => {
      await context.setKimiConfig({ research: { context7: { apiKey } } });
    },
  });
  if (context7 === undefined) return runtime;
  return { ...runtime, context7 };
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

export function resolveSessionSkillConfig(
  context: CoreRuntimeSupportContext,
  config: LioraConfig,
): SessionSkillConfig {
  const explicitDirs = context.skillDirs.length > 0 ? context.skillDirs : undefined;
  return {
    userHomeDir: context.userHomeDir,
    brandHomeDir: context.homeDir,
    explicitDirs,
    extraDirs: config.extraSkillDirs,
    pluginSkillRoots: context.plugins.pluginSkillRoots(),
    mergeAllAvailableSkills: config.mergeAllAvailableSkills,
  };
}

export function resolveProviderManager(
  context: CoreRuntimeSupportContext,
  sessionId: string,
): ProviderManager {
  return new ProviderManager({
    config: () => context.config,
    kimiRequestHeaders: context.kimiRequestHeaders,
    resolveOAuthTokenProvider: context.resolveOAuthTokenProvider,
    promptCacheKey: sessionId,
  });
}

export function mergePluginMcpConfig(
  context: CoreRuntimeSupportContext,
  base: SessionMcpConfig | undefined,
): SessionMcpConfig | undefined {
  const managedEnv = managedKimiCodeEnvForPlugins(context.config);
  const pluginServers = withManagedKimiPluginEnv(context.plugins.enabledMcpServers(), managedEnv);
  return combinePluginMcpConfig(base, pluginServers);
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

export function clearRuntimeCache(context: CoreRuntimeSupportContext): void {
  if (context.runtimeOverride !== undefined) return;
  context.runtime = undefined;
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

export function createCoreRuntimeSupportDefaults(): {
  userHomeDir: string;
  kaos: undefined;
  runtime: undefined;
} {
  return {
    userHomeDir: homedir(),
    kaos: undefined,
    runtime: undefined,
  };
}
