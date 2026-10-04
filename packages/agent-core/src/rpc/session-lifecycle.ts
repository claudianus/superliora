/**
 * Session lifecycle RPC method bodies — extracted from core-impl.ts.
 *
 * Create, resume, reload, fork, export, rename, archive, and close session
 * flows. These take a `SessionLifecycleContext` view of `LioraCore` instead
 * of the whole class so they stay independently testable.
 */

import { ErrorCodes, LioraError } from '#/errors/index';
import { getRootLogger, log } from '#/logging/logger';
import { workerAncestrySchema } from '@superliora/protocol';
import type { Kaos } from '@superliora/kaos';

import type { LioraConfig } from '../config';
import {
  normalizeAdditionalDirs,
  readWorkspaceAdditionalDirs,
  resolveWorkspaceAdditionalDirs,
} from '../config';
import { Session } from '../session';
import { exportSessionDirectory } from '../session/export';
import { buildWorktreeMetadata, createSessionWorktree } from '../session/worktree';
import type { ProviderManager } from '../session/provider/provider-manager';
import { SessionAPIImpl } from '../session/rpc';
import type { SessionStore } from '../session/store/index';
import { readOptionalState } from '../session/store/session-store-helpers';
import { resolveConfiguredSessionRoute } from '../agent/routing';
import {
  withTelemetryContext,
  withTelemetryProperties,
  type TelemetryClient,
} from '../telemetry';
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

export interface SessionLifecycleContext {
  readonly homeDir: string;
  readonly sessions: Map<string, Session>;
  readonly sessionStore: SessionStore;
  readonly telemetry: TelemetryClient;
  readonly appVersion: string | undefined;
  readonly resolveSessionCoordinator?: (sessionId: string, scope: { readonly workDir: string; readonly additionalDirs: readonly string[] }) => Promise<import('../session/coordinator').SessionCoordinator>;
  readonly sdk: Promise<SDKRPC>;
  readonly config: LioraConfig;

  reloadProviderManager(): LioraConfig;
  getKaos(): Promise<Kaos>;
  resolveProviderManager(sessionId: string): ProviderManager;
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
  const workerAncestry = options.workerAncestry === undefined ? undefined : workerAncestrySchema.parse(options.workerAncestry);
  if (workerAncestry !== undefined && (workerAncestry.sessionId !== id || workerAncestry.agentId !== 'main')) {
    throw new Error('Worker ancestry must identify the admitted main agent and session');
  }
  const requestedModel = options.model ?? config.defaultModel;
  const modelAlias = requestedModel === undefined ? undefined
    : resolveConfiguredSessionRoute({ config, alias: requestedModel }).alias;
  const thinkingLevel = resolveThinkingLevel(options.thinking, {
    ...config,
    model: modelAlias === undefined ? undefined : config.models?.[modelAlias],
  });
  const permissionMode = options.permission ?? config.defaultPermissionMode;
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
  // Resolve before indexing so a refused coordinator leaves no session record.
  const coordination = options.role === 'interactive-conductor'
    ? await context.resolveSessionCoordinator?.(id, { workDir, additionalDirs }) : undefined;
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

  const sessionKaos = parentKaos.withCwd(workDir);
  const session = new Session({
    role: options.role,
    workerAncestry,
    coordination,
    kaos: sessionKaos,
    persistenceKaos,
    config,
    id,
    homedir: summary.sessionDir,
    kimiHomeDir: context.homeDir,
    rpc: proxyWithExtraPayload(await context.sdk, { sessionId: summary.id }),
    providerManager: context.resolveProviderManager(summary.id),
    background: config.background,
    permissionRules: config.permission?.rules,
    telemetry: sessionTelemetry,
    appVersion: context.appVersion,
    additionalDirs,
  });
  try {
    const seededCustom: Record<string, unknown> =
      options.metadata === undefined ? {} : { ...options.metadata };
    // Seed path-sandbox profile into session metadata when caller did not set it.
    // Priority: CLI/env already in options.metadata → local.toml → user config → off.
    if (seededCustom['sandboxProfile'] === undefined) {
      const { resolveSandboxProfileFromSources } = await import('#/config/sandbox-profile');
      const resolved = resolveSandboxProfileFromSources({
        env: process.env,
        localToml: localWorkspaceDirs.sandboxProfile,
        userConfig: config.sandboxProfile,
      });
      seededCustom['sandboxProfile'] = resolved.profile;
    }
    if (seededCustom['sandboxEnforcement'] === undefined) {
      const { resolveSandboxEnforcementFromSources } = await import('#/config/sandbox-enforcement');
      const resolved = resolveSandboxEnforcementFromSources({
        env: process.env,
        localToml: localWorkspaceDirs.sandboxEnforcement,
        userConfig: config.sandboxEnforcement,
      });
      seededCustom['sandboxEnforcement'] = resolved.enforcement;
    }
    session.metadata = {
      ...session.metadata,
      createdAt: new Date(summary.createdAt).toISOString(),
      updatedAt: new Date(summary.updatedAt).toISOString(),
      workDir,
      workerAncestry,
      ...(summary.title !== undefined
        ? {
            title: summary.title,
            isCustomTitle: true,
          }
        : {}),
      custom: seededCustom,
    };
    const mainAgent = await session.createMain();
    const sessionModelAlias = modelAlias;
    mainAgent.config.update({
      modelAlias: sessionModelAlias,
      thinkingLevel,
    });
    if (permissionMode !== undefined) {
      mainAgent.permission.setMode(permissionMode);
    }
    await session.writeMetadata();
    await session.flushMetadata();
  } catch (error) {
    // The original error is the one that matters, but a failed close can leave
    // wire/metadata files unflushed, and reporting success on that cleanup hid
    // a real durability problem.
    await session.close().catch((closeError: unknown) => {
      log.warn('session close failed while unwinding a failed start', {
        id,
        message: closeError instanceof Error ? closeError.message : String(closeError),
      });
    });
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
  let active = context.sessions.get(summary.id);
  const additionalDirs = normalizeAdditionalDirs([
    ...localWorkspaceDirs.additionalDirs,
    ...(active?.getAdditionalDirs() ?? []),
    ...callerAdditionalDirs,
  ]);
  const workerAncestry = input.workerAncestry === undefined ? undefined : workerAncestrySchema.parse(input.workerAncestry);
  if (workerAncestry !== undefined && (workerAncestry.sessionId !== summary.id || workerAncestry.agentId !== 'main')) {
    throw new Error('Worker ancestry must identify the resumed main agent and session');
  }
  const bound = active === undefined
    ? (await readOptionalState(summary.sessionDir))?.workerAncestry
    : active.options.workerAncestry ?? active.metadata.workerAncestry;
  // An admitted independent worker reports to its original conductor; opening
  // it as a conductor would split its lineage between two coordinators.
  const role = bound !== undefined || workerAncestry !== undefined
    ? 'worker'
    : input.role ?? active?.options.role ?? 'worker';
  if (active !== undefined && role !== (active.options.role ?? 'worker') && active.hasActiveTurn) {
    throw new LioraError(ErrorCodes.TURN_AGENT_BUSY, 'Cannot change a session role during an active turn');
  }
  if (active !== undefined && workerAncestry !== undefined
    && (bound === undefined || JSON.stringify(workerAncestrySchema.parse(bound)) !== JSON.stringify(workerAncestry))) {
    throw new LioraError(ErrorCodes.SESSION_STATE_INVALID, 'Cannot reparent an existing independent session');
  }
  const coordination = role === 'interactive-conductor'
    ? await context.resolveSessionCoordinator?.(summary.id, { workDir: summary.workDir, additionalDirs }) : undefined;
  if (active !== undefined && role !== (active.options.role ?? 'worker')) {
    // Agent execution roles are immutable. Reopen from the native journal
    // rather than changing only Session.options and leaving stale tool policy.
    await active.close();
    context.sessions.delete(summary.id);
    active = undefined;
  }
  if (active !== undefined) {
    if (role === 'interactive-conductor') Object.assign(active.options, { coordination });
    if (overrides.kaos !== undefined) {
      active.setToolKaos(overrides.kaos.withCwd(summary.workDir));
    }
    await active.setAdditionalDirs(additionalDirs);
    if (workerAncestry !== undefined) await active.writeMetadata();
    return withAdditionalDirs(await resumeSessionResult(summary, active), active);
  }

  const config = context.reloadProviderManager();
  const parentKaos = parentKaosForRead;
  const persistenceKaos = overrides.persistenceKaos ?? parentKaos;
  const sessionKaos = parentKaos.withCwd(summary.workDir);
  const session = new Session({
    role,
    coordination,
    workerAncestry,
    kaos: sessionKaos,
    persistenceKaos,
    config,
    id: summary.id,
    homedir: summary.sessionDir,
    kimiHomeDir: context.homeDir,
    rpc: proxyWithExtraPayload(await context.sdk, { sessionId: summary.id }),
    providerManager: context.resolveProviderManager(summary.id),
    background: config.background,
    permissionRules: config.permission?.rules,
    telemetry: withTelemetryContext(context.telemetry, { sessionId: summary.id }),
    initializeMainAgent: false,
    appVersion: context.appVersion,
    additionalDirs,
  });
  let warning: string | undefined;
  try {
    const resumeResult = await session.resume();
    if (workerAncestry !== undefined) await session.writeMetadata();
    warning = resumeResult.warning;
    await context.refreshSessionRuntimeConfig(session, config);
  } catch (error) {
    await session.close().catch((closeError: unknown) => {
      log.warn('session close failed while unwinding a failed resume', {
        sessionId: summary.id,
        message: closeError instanceof Error ? closeError.message : String(closeError),
      });
    });
    withTelemetryContext(context.telemetry, { sessionId: summary.id }).track('session_load_failed', {
      reason: telemetryErrorReason(error),
    });
    throw error;
  }
  context.sessions.set(summary.id, session);
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

  if (active !== undefined) {
    await active.close();
    context.sessions.delete(summary.id);
  }
  return resumeSessionWithOverrides(
    context,
    { sessionId: summary.id, ...(active === undefined ? {} : { role: active.options.role, additionalDirs: active.getAdditionalDirs() }) },
    {},
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
