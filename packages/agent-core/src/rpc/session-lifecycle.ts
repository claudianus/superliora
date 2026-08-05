/**
 * Session lifecycle RPC method bodies — extracted from core-impl.ts.
 *
 * Create, resume, reload, fork, export, rename, archive, and close session
 * flows. These take a `SessionLifecycleContext` view of `LioraCore` instead
 * of the whole class so they stay independently testable.
 */

import { ErrorCodes, LioraError } from '#/errors/index';
import { getRootLogger, log } from '#/logging/logger';
import type { PluginHost, PluginManager } from '#/plugin/index';
import type { Kaos } from '@superliora/kaos';

import type { LioraConfig } from '../config';
import {
  normalizeAdditionalDirs,
  readWorkspaceAdditionalDirs,
  resolveWorkspaceAdditionalDirs,
} from '../config';
import type { FlagResolver } from '../flags';
import { resolveSessionMcpConfig, mergeCallerMcpServers, type SessionMcpConfig } from '../mcp';
import type { LioraRecallStore } from '../memory';
import { Session, type SessionSkillConfig } from '../session';
import {
  responseLanguagePreferenceFromHostLocale,
  responseLanguagePreferenceFromUnknown,
} from '../session/response-language';
import { exportSessionDirectory } from '../session/export';
import { buildWorktreeMetadata, createSessionWorktree } from '../session/worktree';
import type { ProviderManager } from '../session/provider/provider-manager';
import { SessionAPIImpl } from '../session/rpc';
import type { SessionStore } from '../session/store/index';
import {
  withTelemetryContext,
  withTelemetryProperties,
  type TelemetryClient,
} from '../telemetry';
import type { ToolServices } from '../tools/support/services';
import { resolveThinkingLevel } from '../agent/config/thinking';

import type {
  ArchiveSessionPayload,
  CloseSessionPayload,
  CreateSessionPayload,
  EmptyPayload,
  ExportSessionPayload,
  ExportSessionResult,
  ForkSessionPayload,
  JsonObject,
  ListSessionsPayload,
  ReloadPluginsResult,
  ReloadSessionPayload,
  RenameSessionPayload,
  ResumeSessionPayload,
  SessionSummary,
} from './core-api';
import type { ResumeSessionResult } from './resumed';
import type { SDKRPC } from './sdk-api';
import { proxyWithExtraPayload } from './types';
import {
  clientTelemetryProperties,
  createSessionId,
  requiredWorkDir,
  resumeSessionResult,
  telemetryErrorReason,
  warnIfLogFlushFails,
  withAdditionalDirs,
} from './session-helpers';
import * as pluginWiring from './core-plugin-wiring';

export interface SessionLifecycleContext {
  readonly homeDir: string;
  readonly projectDir: string;
  readonly channelServers: readonly string[];
  readonly sessions: Map<string, Session>;
  readonly sessionStore: SessionStore;
  readonly plugins: PluginManager;
  readonly pluginHost: PluginHost;
  readonly pluginsReady: Promise<void>;
  readonly memory: LioraRecallStore;
  readonly experimentalFlags: FlagResolver;
  readonly telemetry: TelemetryClient;
  readonly appVersion: string | undefined;
  readonly sdk: Promise<SDKRPC>;
  readonly config: LioraConfig;

  reloadProviderManager(): LioraConfig;
  getKaos(): Promise<Kaos>;
  mergePluginMcpConfig(base: SessionMcpConfig | undefined): SessionMcpConfig | undefined;
  buildSessionToolServices(config: LioraConfig, sessionId: string): Promise<ToolServices>;
  resolveProviderManager(sessionId: string): ProviderManager;
  resolveSessionSkillConfig(config: LioraConfig): SessionSkillConfig;
  clearRuntimeCache(): void;
  reloadPlugins(payload: EmptyPayload): Promise<ReloadPluginsResult>;
  refreshSessionRuntimeConfig(session: Session, config: LioraConfig): Promise<void>;
}

type RenameSessionRequest = { readonly sessionId: string } & RenameSessionPayload;

export async function createSession(
  context: SessionLifecycleContext,
  input: CreateSessionPayload,
): Promise<SessionSummary> {
  return createSessionWithOverrides(context, input, {});
}

export async function createSessionWithOverrides(
  context: SessionLifecycleContext,
  input: CreateSessionPayload,
  overrides: { kaos?: Kaos; persistenceKaos?: Kaos },
): Promise<SessionSummary> {
  const options = input;
  const workDir = requiredWorkDir('createSession', options.workDir);
  const config = context.reloadProviderManager();
  const id = options.id ?? createSessionId();
  const modelAlias = options.model ?? config.defaultModel;
  const thinkingLevel = resolveThinkingLevel(options.thinking, {
    ...config,
    model: modelAlias === undefined ? undefined : config.models?.[modelAlias],
  });
  const permissionMode = options.permission ?? config.defaultPermissionMode;
  const baseMcpConfig = await resolveSessionMcpConfig({
    cwd: workDir,
    homeDir: context.homeDir,
  });
  const withCallerMcp = mergeCallerMcpServers(baseMcpConfig, options.mcpServers);
  const parentKaos = overrides.kaos ?? (await context.getKaos());
  const persistenceKaos = overrides.persistenceKaos ?? parentKaos;
  const localWorkspaceDirs = await readWorkspaceAdditionalDirs(persistenceKaos, workDir);
  const callerAdditionalDirs = await resolveWorkspaceAdditionalDirs(
    parentKaos,
    workDir,
    options.additionalDirs ?? [],
  );
  const additionalDirs = normalizeAdditionalDirs([
    ...localWorkspaceDirs.additionalDirs,
    ...callerAdditionalDirs,
  ]);
  const summary = await context.sessionStore.create({
    id,
    workDir,
  });
  const result: SessionSummary = {
    ...summary,
    metadata: options.metadata,
  };
  const clientTelemetry = clientTelemetryProperties(options.client);
  const sessionTelemetryBase = withTelemetryContext(context.telemetry, { sessionId: summary.id });
  const sessionTelemetry =
    Object.keys(clientTelemetry).length === 0
      ? sessionTelemetryBase
      : withTelemetryProperties(sessionTelemetryBase, clientTelemetry);

  await context.pluginsReady;
  const wiringContext = {
    homeDir: context.homeDir,
    projectDir: context.projectDir,
    channelServers: context.channelServers,
    config,
    plugins: context.plugins,
    pluginHost: context.pluginHost,
  };
  const pluginSession = await pluginWiring.resolvePluginSessionConfig(wiringContext, config);
  const sessionConfig = pluginSession.config;
  const pluginSessionStarts = context.plugins.enabledSessionStarts();
  const pluginCommands = await context.pluginHost.commands();
  const pluginAgents = await context.pluginHost.agents();
  const pluginBinDirs = context.pluginHost.binDirs();
  const mcpConfig = context.mergePluginMcpConfig(withCallerMcp);

  const runtime = await context.buildSessionToolServices(sessionConfig, summary.id);
  let sessionKaos = parentKaos.withCwd(workDir);
  if (Object.keys(pluginSession.env).length > 0) {
    sessionKaos = sessionKaos.withEnv(pluginSession.env);
  }
  const session = new Session({
    kaos: sessionKaos,
    persistenceKaos,
    toolServices: runtime,
    config: sessionConfig,
    id,
    homedir: summary.sessionDir,
    kimiHomeDir: context.homeDir,
    rpc: proxyWithExtraPayload(await context.sdk, { sessionId: summary.id }),
    providerManager: context.resolveProviderManager(summary.id),
    background: sessionConfig.background,
    hooks: [...(sessionConfig.hooks ?? []), ...context.pluginHost.hooks()],
    permissionRules: sessionConfig.permission?.rules,
    skills: context.resolveSessionSkillConfig(sessionConfig),
    mcpConfig,
    experimentalFlags: context.experimentalFlags,
    telemetry: sessionTelemetry,
    pluginSessionStarts,
    appVersion: context.appVersion,
    additionalDirs,
    memory: context.memory.runtimeForSession({ sessionId: summary.id, workDir }),
    dreamStore: context.memory,
    pluginCommands,
    pluginAgents,
    pluginBinDirs,
    drainAgentTasksOnStop: options.drainAgentTasksOnStop,
  });
  try {
    session.metadata = {
      ...session.metadata,
      createdAt: new Date(summary.createdAt).toISOString(),
      updatedAt: new Date(summary.updatedAt).toISOString(),
      workDir,
      ...(summary.title !== undefined
        ? {
            title: summary.title,
            isCustomTitle: true,
          }
        : {}),
      custom: options.metadata === undefined ? {} : { ...options.metadata },
    };
    if (responseLanguagePreferenceFromUnknown(session.metadata.custom['responseLanguage']) === undefined) {
      const seeded = responseLanguagePreferenceFromHostLocale();
      if (seeded !== undefined) {
        session.metadata = {
          ...session.metadata,
          custom: {
            ...session.metadata.custom,
            responseLanguage: seeded,
          },
        };
      }
    }
    const mainAgent = await session.createMain();
    mainAgent.config.update({
      modelAlias: options.model ?? config.defaultModel,
      thinkingLevel,
    });
    if (permissionMode !== undefined) {
      mainAgent.permission.setMode(permissionMode);
    }
    // Bootstrap activates plan mode directly even on a Conductor lane: there is
    // no task context yet, and a plan-desk job needs one to brief a worker. The
    // desk handoff belongs to `EnterPlanMode`, once the model has a request.
    if (config.defaultPlanMode === true) {
      await mainAgent.planMode.enter();
    }
    await pluginWiring.wirePluginSessionHosts(wiringContext, session, mainAgent);
    await session.writeMetadata();
    await session.flushMetadata();
  } catch (error) {
    await session.close().catch(() => {});
    throw error;
  }
  context.sessions.set(id, session);
  if (Object.keys(clientTelemetry).length > 0) {
    sessionTelemetry.track('session_started', { resumed: false });
  }
  return withAdditionalDirs(result, session);
}

export async function closeSession(
  context: SessionLifecycleContext,
  { sessionId }: CloseSessionPayload,
): Promise<void> {
  const session = context.sessions.get(sessionId);
  if (session) {
    await session.close();
    context.sessions.delete(sessionId);
  }
}

export async function archiveSession(
  context: SessionLifecycleContext,
  payload: ArchiveSessionPayload,
): Promise<void> {
  await closeSession(context, payload);
  await context.sessionStore.archive(payload.sessionId);
}

export async function resumeSession(
  context: SessionLifecycleContext,
  input: ResumeSessionPayload,
): Promise<ResumeSessionResult> {
  return resumeSessionWithOverrides(context, input, {});
}

export async function resumeSessionWithOverrides(
  context: SessionLifecycleContext,
  input: ResumeSessionPayload,
  overrides: {
    kaos?: Kaos;
    persistenceKaos?: Kaos;
    forcePluginSessionStartReminder?: boolean;
  },
): Promise<ResumeSessionResult> {
  const summary = await context.sessionStore.get(input.sessionId);
  const parentKaosForRead = overrides.kaos ?? (await context.getKaos());
  const localWorkspaceDirs = await readWorkspaceAdditionalDirs(
    overrides.persistenceKaos ?? parentKaosForRead,
    summary.workDir,
  );
  const callerAdditionalDirs = await resolveWorkspaceAdditionalDirs(
    parentKaosForRead,
    summary.workDir,
    input.additionalDirs ?? [],
  );
  const additionalDirs = normalizeAdditionalDirs([
    ...localWorkspaceDirs.additionalDirs,
    ...callerAdditionalDirs,
  ]);
  const active = context.sessions.get(summary.id);
  if (active !== undefined) {
    if (overrides.kaos !== undefined) {
      active.setToolKaos(overrides.kaos.withCwd(summary.workDir));
    }
    await active.setAdditionalDirs(additionalDirs);
    return withAdditionalDirs(await resumeSessionResult(summary, active), active);
  }

  const config = context.reloadProviderManager();
  const baseMcpConfig = await resolveSessionMcpConfig({
    cwd: summary.workDir,
    homeDir: context.homeDir,
  });
  const withCallerMcp = mergeCallerMcpServers(baseMcpConfig, input.mcpServers);
  await context.pluginsReady;
  const wiringContext = {
    homeDir: context.homeDir,
    projectDir: context.projectDir,
    channelServers: context.channelServers,
    config,
    plugins: context.plugins,
    pluginHost: context.pluginHost,
  };
  const pluginSession = await pluginWiring.resolvePluginSessionConfig(wiringContext, config);
  const sessionConfig = pluginSession.config;
  const pluginSessionStarts = context.plugins.enabledSessionStarts();
  const pluginCommands = await context.pluginHost.commands();
  const pluginAgents = await context.pluginHost.agents();
  const pluginBinDirs = context.pluginHost.binDirs();
  const mcpConfig = context.mergePluginMcpConfig(withCallerMcp);
  const runtime = await context.buildSessionToolServices(sessionConfig, summary.id);
  const parentKaos = parentKaosForRead;
  const persistenceKaos = overrides.persistenceKaos ?? parentKaos;
  let sessionKaos = parentKaos.withCwd(summary.workDir);
  if (Object.keys(pluginSession.env).length > 0) {
    sessionKaos = sessionKaos.withEnv(pluginSession.env);
  }
  const session = new Session({
    kaos: sessionKaos,
    persistenceKaos,
    toolServices: runtime,
    config: sessionConfig,
    id: summary.id,
    homedir: summary.sessionDir,
    kimiHomeDir: context.homeDir,
    rpc: proxyWithExtraPayload(await context.sdk, { sessionId: summary.id }),
    providerManager: context.resolveProviderManager(summary.id),
    background: sessionConfig.background,
    hooks: [...(sessionConfig.hooks ?? []), ...context.pluginHost.hooks()],
    permissionRules: sessionConfig.permission?.rules,
    skills: context.resolveSessionSkillConfig(sessionConfig),
    mcpConfig,
    experimentalFlags: context.experimentalFlags,
    telemetry: withTelemetryContext(context.telemetry, { sessionId: summary.id }),
    initializeMainAgent: false,
    pluginSessionStarts,
    appVersion: context.appVersion,
    additionalDirs,
    memory: context.memory.runtimeForSession({ sessionId: summary.id, workDir: summary.workDir }),
    dreamStore: context.memory,
    pluginCommands,
    pluginAgents,
    pluginBinDirs,
  });
  let warning: string | undefined;
  try {
    const resumeResult = await session.resume();
    warning = resumeResult.warning;
    await context.refreshSessionRuntimeConfig(session, sessionConfig);
    const mainAgent = session.getReadyAgent('main');
    if (mainAgent !== undefined) {
      await pluginWiring.wirePluginSessionHosts(wiringContext, session, mainAgent);
    }
  } catch (error) {
    await session.close().catch(() => {});
    withTelemetryContext(context.telemetry, { sessionId: summary.id }).track('session_load_failed', {
      reason: telemetryErrorReason(error),
    });
    throw error;
  }
  context.sessions.set(summary.id, session);
  if (overrides.forcePluginSessionStartReminder === true) {
    await session.appendPluginSessionStartReminder();
  }
  return resumeSessionResult(summary, session, warning);
}

export async function reloadSession(
  context: SessionLifecycleContext,
  input: ReloadSessionPayload,
): Promise<ResumeSessionResult> {
  const summary = await context.sessionStore.get(input.sessionId);
  const active = context.sessions.get(summary.id);
  if (active?.hasActiveTurn === true) {
    throw new LioraError(
      ErrorCodes.TURN_AGENT_BUSY,
      `Session "${summary.id}" cannot be reloaded while a turn is running`,
      { details: { sessionId: summary.id } },
    );
  }

  context.reloadProviderManager();
  context.clearRuntimeCache();
  await context.reloadPlugins({});

  if (active !== undefined) {
    await active.closeForReload();
    context.sessions.delete(summary.id);
  }
  return resumeSessionWithOverrides(
    context,
    { sessionId: summary.id },
    { forcePluginSessionStartReminder: input.forcePluginSessionStartReminder },
  );
}

export async function forkSession(
  context: SessionLifecycleContext,
  input: ForkSessionPayload,
): Promise<ResumeSessionResult> {
  const source = await context.sessionStore.get(input.sessionId);
  const active = context.sessions.get(source.id);
  if (active?.hasActiveTurn === true) {
    throw new LioraError(
      ErrorCodes.SESSION_FORK_ACTIVE_TURN,
      `Session "${source.id}" cannot be forked while a turn is running`,
      { details: { sessionId: source.id } },
    );
  }

  if (active !== undefined) {
    await active.flushMetadata();
  }

  const id = input.id ?? createSessionId();
  let forkWorkDir: string | undefined;
  let worktreeMetadata: JsonObject | undefined;

  if (input.worktree === true || (typeof input.worktree === 'object' && input.worktree !== null)) {
    const worktreeOpts = typeof input.worktree === 'object' ? input.worktree : {};
    const kaos = await context.getKaos();
    const created = await createSessionWorktree(kaos, {
      repoPath: source.workDir,
      name: worktreeOpts.name,
      baseRef: worktreeOpts.baseRef,
      homeDir: context.homeDir,
      sessionId: id,
    });
    forkWorkDir = created.workDir;
    worktreeMetadata = buildWorktreeMetadata(created.meta) as JsonObject;
  }

  const mergedMetadata: JsonObject | undefined =
    worktreeMetadata === undefined
      ? input.metadata
      : {
          ...input.metadata,
          ...worktreeMetadata,
        };

  await context.sessionStore.fork({
    sourceId: source.id,
    targetId: id,
    title: input.title,
    metadata: mergedMetadata,
    workDir: forkWorkDir,
  });
  return resumeSession(context, { sessionId: id });
}

export async function listSessions(
  context: SessionLifecycleContext,
  input: ListSessionsPayload = {},
): Promise<readonly SessionSummary[]> {
  return context.sessionStore.list(input);
}

export async function renameSession(
  context: SessionLifecycleContext,
  { sessionId, ...payload }: RenameSessionRequest,
): Promise<void> {
  const session = context.sessions.get(sessionId);
  if (session !== undefined) {
    await new SessionAPIImpl(session).renameSession(payload);
    return;
  }
  await context.sessionStore.rename(sessionId, payload.title);
}

export async function exportSession(
  context: SessionLifecycleContext,
  input: ExportSessionPayload,
): Promise<ExportSessionResult> {
  const summary = await context.sessionStore.get(input.sessionId);
  const active = context.sessions.get(input.sessionId);
  const exportLog =
    active?.log ?? log.createChild({ sessionId: input.sessionId });
  if (active !== undefined) {
    try {
      await active.flushMetadata();
    } catch (error) {
      exportLog.warn('flushMetadata failed before export', { error });
    }
  }
  await warnIfLogFlushFails(exportLog, 'export session log flush failed', () =>
    getRootLogger().flushSession(input.sessionId),
  );
  if (input.includeGlobalLog === true) {
    await warnIfLogFlushFails(exportLog, 'export global log flush failed', () =>
      getRootLogger().flushGlobal(),
    );
  }
  return exportSessionDirectory({
    request: input,
    summary,
    homeDir: context.homeDir,
    globalLogPath: getRootLogger().getConfig()?.globalLogPath,
  });
}
