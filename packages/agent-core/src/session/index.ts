import { homedir } from 'node:os';
import { join } from 'pathe';
import { type Kaos } from '@superliora/kaos';
import type { SessionWarning } from '@superliora/protocol';

import { ErrorCodes, LioraError } from '#/errors';
import { getRootLogger, log } from '#/logging/logger';
import type { Logger, SessionLogHandle } from '#/logging/types';
import type { LioraConfig, SDKSessionRPC } from '#/rpc';
import { proxyWithExtraPayload } from '#/rpc/types';

import { Agent, type AgentOptions, type AgentType } from '../agent';
import { type ConversationLoopState } from '../agent/conversation-loop';
import { HookEngine, type HookDef } from './hooks';
import type { PermissionManagerOptions, PermissionRule } from '../agent/permission';
import type { SandboxProfile } from '../tools/policies/path-access';
import { FileSnapshotStore } from './file-snapshot';
import {
  appendWorkspaceAdditionalDir,
  normalizeAdditionalDirs,
  readWorkspaceAdditionalDirs,
  resolveWorkspaceAdditionalDirs,
  type BackgroundConfig,
  type WorkspaceAdditionalDirsLoadResult,
} from '../config';
import { makeErrorPayload } from '../errors';
import {
  McpConnectionManager,
  McpOAuthService,
  type McpServerEntry,
  type SessionMcpConfig,
} from '../mcp';
import type { EnabledPluginSessionStart, PluginCommandDef } from '../plugin';
import {
  DEFAULT_AGENT_PROFILES,
  prepareSystemPromptContext,
  type ResolvedAgentProfile,
} from '../profile';
import type { ProviderManager } from './provider-manager';
import {
  registerBuiltinSkills,
  SessionSkillRegistry,
  resolveSkillRoots,
  summarizeSkill,
  type SkillRoot,
  type SkillSearchHit,
  type SkillSummary,
} from '../skill';
import { noopTelemetryClient, type TelemetryClient } from '../telemetry';
import { SessionSubagentHost } from './subagent-host';
import type { ToolServices } from '../tools/support/services';
import { FlagResolver, type ExperimentalFlagResolver } from '../flags';
import type { SessionMemoryRuntime } from '../memory';
import type { LioraRecallStore } from '../memory/store';
import { responseLanguagePreferenceFromUnknown } from './response-language';
import { SessionMetadataPersistence } from './metadata-persistence';
import { ConversationLoopManager } from './conversation-loops';
import { SessionCloseLifecycle } from './session-close-lifecycle';
import {
  appendPluginSessionStartReminder as applyPluginSessionStartReminder,
  runGenerateAgentsMd,
} from './session-plugin-reminder';

export interface SessionOptions {
  readonly kaos: Kaos;
  readonly persistenceKaos?: Kaos;
  readonly config?: LioraConfig;
  readonly id?: string | undefined;
  readonly homedir: string;
  readonly kimiHomeDir?: string;
  readonly rpc: SDKSessionRPC;
  readonly toolServices?: ToolServices;
  readonly initializeMainAgent?: boolean | undefined;
  readonly providerManager?: ProviderManager | undefined;
  readonly background?: BackgroundConfig | undefined;
  readonly hooks?: readonly HookDef[];
  readonly permissionRules?: readonly PermissionRule[];
  readonly skills?: SessionSkillConfig;
  readonly mcpConfig?: SessionMcpConfig;
  readonly telemetry?: TelemetryClient | undefined;
  readonly pluginSessionStarts?: readonly EnabledPluginSessionStart[];
  readonly pluginCommands?: readonly PluginCommandDef[];
  readonly appVersion?: string;
  readonly experimentalFlags?: ExperimentalFlagResolver;
  readonly additionalDirs?: readonly string[];
  readonly memory?: SessionMemoryRuntime;
  readonly dreamStore?: LioraRecallStore;
  /**
   * Print-mode (`liora -p`) only: hold the main turn open while background
   * subagents are still running before the run exits.
   */
  readonly drainAgentTasksOnStop?: boolean;
}

export interface SessionSkillConfig {
  readonly userHomeDir?: string;
  /** Brand data dir (SUPERLIORA_HOME); user brand skills live under `<brandHomeDir>/skills`. */
  readonly brandHomeDir?: string;
  readonly explicitDirs?: readonly string[];
  readonly extraDirs?: readonly string[];
  readonly pluginSkillRoots?: readonly SkillRoot[];
  readonly mergeAllAvailableSkills?: boolean;
  readonly builtinDir?: string;
}

export interface AgentMeta {
  readonly homedir: string;
  readonly type: AgentType;
  readonly parentAgentId: string | null;
  readonly swarmItem?: string;
}

interface ResumedAgent {
  readonly agent: Agent;
  readonly warning?: string;
}

type AgentEntry = Agent | Promise<ResumedAgent>;

export interface CreateAgentOptions {
  readonly profile?: ResolvedAgentProfile;
  readonly parentAgentId?: string;
  readonly swarmItem?: string;
  readonly persistMetadata?: boolean;
}

export interface SessionMeta {
  createdAt: string;
  updatedAt: string;
  title: string;
  isCustomTitle: boolean;
  lastPrompt?: string;
  forkedFrom?: string;
  /** Absolute working directory the session was created in. Persisted so the
   *  session directory is self-describing and the global session index does not
   *  have to be trusted for the (one-way-hashed) workDir. */
  workDir?: string;
  agents: Record<string, AgentMeta>;
  custom: Record<string, any>;
}

export class Session {
  readonly rpc: SDKSessionRPC;
  readonly telemetry: TelemetryClient;
  readonly skills: SessionSkillRegistry;
  readonly agents: Map<string, AgentEntry> = new Map();
  readonly mcp: McpConnectionManager;
  readonly log: Logger;
  /** Session-scoped write/edit snapshots shared by all agents for `/rewind`. */
  readonly fileSnapshots: FileSnapshotStore;
  private readonly logHandle: SessionLogHandle | undefined;
  readonly hookEngine: HookEngine;
  readonly experimentalFlags: ExperimentalFlagResolver;
  private toolKaos: Kaos;
  private persistenceKaos: Kaos;
  private additionalDirs: readonly string[];
  private agentIdCounter = 0;
  private readonly skillsReady: Promise<void>;
  private readonly metadataPersistence: SessionMetadataPersistence;
  private readonly conversationLoopManager: ConversationLoopManager;
  private readonly closeLifecycle: SessionCloseLifecycle;
  metadata: SessionMeta = {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: 'New Session',
    isCustomTitle: false,
    agents: {},
    custom: {},
  };
  private agentsMdWarning: string | undefined;

  constructor(public readonly options: SessionOptions) {
    // Attach the per-session log sink up front so the constructor's
    // fire-and-forget `loadSkills` / `loadMcpServers` failures (and
    // anything else that races) land in the session log, not just global.
    this.logHandle =
      options.id === undefined
        ? undefined
        : getRootLogger().attachSession({
          sessionId: options.id,
          sessionDir: options.homedir,
        });
    this.log =
      this.logHandle?.logger ??
      (options.id === undefined ? log : log.createChild({ sessionId: options.id }));
    this.rpc = options.rpc;
    this.experimentalFlags = options.experimentalFlags ?? new FlagResolver();
    this.hookEngine = new HookEngine(options.hooks, {
      cwd: options.kaos.getcwd(),
      sessionId: options.id,
    });
    this.telemetry = options.telemetry ?? noopTelemetryClient;
    this.toolKaos = options.kaos;
    this.persistenceKaos = options.persistenceKaos ?? options.kaos;
    this.additionalDirs = normalizeAdditionalDirs(options.additionalDirs ?? []);
    this.fileSnapshots = new FileSnapshotStore({
      kaos: this.toolKaos,
      snapshotDir: FileSnapshotStore.snapshotDirForSession(options.homedir),
    });
    this.metadataPersistence = new SessionMetadataPersistence({
      sessionHomedir: options.homedir,
      kaos: this.persistenceKaos,
      log: this.log,
    });
    this.conversationLoopManager = new ConversationLoopManager((prompt) => {
      const agent = this.getReadyAgent('main');
      if (agent !== undefined) {
        agent.turn.prompt([{ type: 'text', text: prompt }]);
      }
    });
    this.closeLifecycle = new SessionCloseLifecycle({
      log: this.log,
      agents: this.agents,
      readyAgents: () => this.readyAgents(),
      background: this.options.background,
    });
    this.skills = new SessionSkillRegistry({
      sessionId: options.id,
      defaultSearchLimit: options.config?.skillSearchLimit,
      maxSearchLimit: options.config?.skillSearchMaxLimit,
    });
    this.mcp = new McpConnectionManager({
      oauthService: new McpOAuthService({ kimiHomeDir: options.kimiHomeDir }),
      log: this.log,
      stdioCwd: options.kaos.getcwd(),
    });
    this.mcp.onStatusChange((entry) => {
      this.onMcpServerStatusChange(entry);
    });
    this.skillsReady = this.loadSkills()
      .catch((error: unknown) => {
        this.log.error('skills load failed', error);
      })
      .then(() => {
        this.refreshAgentBuiltinTools();
      });
    void this.loadMcpServers().catch((error: unknown) => {
      this.emitInitialMcpLoadError(error);
    });
  }


  setToolKaos(kaos: Kaos) {
    this.toolKaos = kaos;
    for (const agent of this.readyAgents()) {
      agent.setKaos(kaos.withCwd(agent.config.cwd));
    }
    this.refreshAgentBuiltinTools();
  }

  getAdditionalDirs(): readonly string[] {
    return this.additionalDirs;
  }

  async setAdditionalDirs(additionalDirs: readonly string[]): Promise<void> {
    this.additionalDirs = normalizeAdditionalDirs(additionalDirs);
    for (const agent of this.readyAgents()) {
      agent.setAdditionalDirs(this.additionalDirs);
    }
  }

  async addAdditionalDir(
    path: string,
    persist = true,
  ): Promise<WorkspaceAdditionalDirsLoadResult & { readonly persisted: boolean }> {
    const cwd = this.toolKaos.getcwd();
    const systemKaos = this.systemContextKaos(cwd);
    if (persist) {
      const result = await appendWorkspaceAdditionalDir(systemKaos, cwd, path, this.additionalDirs);
      const additionalDirs = normalizeAdditionalDirs([...this.additionalDirs, ...result.additionalDirs]);
      await this.setAdditionalDirs(additionalDirs);
      this.notifyAdditionalDirAdded(path, true, result.configPath);
      return { ...result, additionalDirs, persisted: true };
    }

    const workspace = await readWorkspaceAdditionalDirs(systemKaos, cwd);
    const additionalDirs = await resolveWorkspaceAdditionalDirs(systemKaos, cwd, [path]);
    const nextAdditionalDirs = normalizeAdditionalDirs([...this.additionalDirs, ...additionalDirs]);
    await this.setAdditionalDirs(nextAdditionalDirs);
    this.notifyAdditionalDirAdded(path, false, workspace.configPath);
    return {
      projectRoot: workspace.projectRoot,
      configPath: workspace.configPath,
      additionalDirs: nextAdditionalDirs,
      persisted: false,
    };
  }

  private notifyAdditionalDirAdded(path: string, persisted: boolean, configPath: string): void {
    const message = persisted
      ? `Added workspace directory:\n  ${path}\n  Saved to:\n  ${configPath}`
      : `Added workspace directory:\n  ${path}\n  For this session only`;
    this.requireMainAgent().context.appendLocalCommandStdout(message);
  }

  /**
   * Kaos used by session-internal bootstrap (AGENTS.md context, cwd listing)
   * and metadata persistence. Always backed by the persistence sink (typically
   * the local filesystem) so a transient ACP-side failure on system files like
   * `AGENTS.md` never blocks `bootstrapAgentProfile` — tool calls still route
   * through `agent.kaos` and continue to honor the ACP bridge.
   */
  systemContextKaos(cwd: string): Kaos {
    return this.persistenceKaos.withCwd(cwd);
  }

  async createMain() {
    const { agent } = await this.createAgent({ type: 'main' }, {
      profile: DEFAULT_AGENT_PROFILES['agent'],
    });
    if (this.options.drainAgentTasksOnStop) {
      const ceilingS = this.options.background?.printWaitCeilingS ?? 3600;
      agent.printDrainAgentTasksOnStop = true;
      agent.printDrainDeadlineMs = Date.now() + ceilingS * 1000;
    }
    await this.triggerSessionStart('startup');
    return agent;
  }

  async resume(): Promise<{ warning?: string }> {
    await this.skillsReady;
    this.log.info('session resume', { app_version: this.options.appVersion });
    const { agents } = await this.readMetadata();
    this.agents.clear();
    // Only the main agent is needed to reopen the session; subagents replay
    // lazily when an RPC or Agent(resume=...) call asks for their state.
    const { warning } =
      agents['main'] === undefined ? { warning: undefined } : await this.resumeAgent('main');
    // A session migrated from an external tool ships a wire without the
    // `config.update` bootstrap events a natively-created agent writes, so the
    // main agent comes back with an empty system prompt and no tools. Apply the
    // default profile so the resumed session is usable. Native sessions always
    // replay a non-empty system prompt and never enter this branch.
    const main = this.getReadyAgent('main');
    const profile = DEFAULT_AGENT_PROFILES['agent'];
    if (main !== undefined && profile !== undefined && main.config.systemPrompt === '') {
      await this.bootstrapAgentProfile(main, profile);
    }
    await this.triggerSessionStart('resume');
    return { warning };
  }

  async close(): Promise<void> {
    try {
      await Promise.allSettled(
        Array.from(this.readyAgents(), async (agent) => agent.cron?.stop()),
      );
      await this.closeLifecycle.cancelActiveTurnsOnClose();
      await this.closeLifecycle.stopBackgroundTasksOnExit();
      // Flush each active Ultrawork run to a flushed checkpoint before the
      // records flush below, so an in-flight run survives an interrupt or a
      // process restart and can be auto-resumed from its last checkpoint
      // rather than being lost or left as `running`.
      await Promise.allSettled(
        Array.from(this.readyAgents(), async (agent) => {
          if (agent.ultrawork.getRun()) agent.ultrawork.flushCheckpoint();
        }),
      );
      await this.flushMetadata();
      await this.triggerSessionEnd('exit');
    } finally {
      try {
        await this.mcp.shutdown();
      } finally {
        await this.logHandle?.close();
      }
    }
  }

  async closeForReload(): Promise<void> {
    try {
      await Promise.allSettled(
        Array.from(this.readyAgents(), async (agent) => agent.cron?.stop()),
      );
      await this.flushMetadata();
    } finally {
      try {
        await this.mcp.shutdown();
      } finally {
        await this.logHandle?.close();
      }
    }
  }

  async createAgent(
    config: Partial<AgentOptions>,
    options: CreateAgentOptions = {},
  ): Promise<{ readonly id: string; readonly agent: Agent }> {
    await this.skillsReady;
    const type = config.type ?? 'main';
    const id = type === 'main' ? 'main' : this.nextGeneratedAgentId();
    const homedir = config.homedir ?? join(this.options.homedir, 'agents', id);
    const parentAgentId = options.parentAgentId ?? null;
    const agent = this.instantiateAgent(id, homedir, type, config, parentAgentId);
    if (options.profile) {
      await this.bootstrapAgentProfile(agent, options.profile);
    }

    this.agents.set(id, agent);
    if (options.persistMetadata !== false) {
      this.metadata.agents[id] = {
        homedir,
        type,
        parentAgentId,
        swarmItem: options.swarmItem,
      };
      void this.writeMetadata();
    }

    return { id, agent };
  }

  async ensureAgentResumed(id: string): Promise<Agent> {
    const entry = this.agents.get(id);
    if (entry !== undefined) return (await this.resolveAgentEntry(entry)).agent;
    if (this.metadata.agents[id] === undefined) {
      throw new LioraError(ErrorCodes.AGENT_NOT_FOUND, `Agent "${id}" was not found`);
    }
    return (await this.resumeAgent(id)).agent;
  }

  /**
   * Applies a profile's derived config — cwd, system prompt, active tools — to
   * an agent. Fresh creation and resume-of-an-incomplete-wire both route
   * through here so the two paths cannot drift apart.
   */
  private async bootstrapAgentProfile(
    agent: Agent,
    profile: ResolvedAgentProfile,
  ): Promise<void> {
    const context = await prepareSystemPromptContext(
      this.systemContextKaos(agent.kaos.getcwd()),
      this.options.kimiHomeDir,
      { additionalDirs: this.additionalDirs },
    );
    agent.useProfile(profile, context);
    const { agentsMdWarning } = context;
    if (agentsMdWarning !== undefined) {
      this.agentsMdWarning = agentsMdWarning;
      log.warn('AGENTS.md exceeds recommended size', { message: agentsMdWarning });
      agent.emitEvent({
        type: 'warning',
        message: agentsMdWarning,
        code: 'agents-md-oversized',
      });
    }
  }

  async getSessionWarnings(): Promise<readonly SessionWarning[]> {
    const warnings: SessionWarning[] = [];
    const agentsMdWarning = await this.computeAgentsMdWarning();
    if (agentsMdWarning !== undefined) {
      warnings.push({
        code: 'agents-md-oversized',
        message: agentsMdWarning,
        severity: 'warning',
      });
    }
    return warnings;
  }

  private async computeAgentsMdWarning(): Promise<string | undefined> {
    if (this.agentsMdWarning !== undefined) {
      return this.agentsMdWarning;
    }
    // Resumed sessions skip bootstrap when their system prompt is already set, so
    // the cached value may be missing; recompute on demand so the warning still
    // surfaces for long-lived sessions.
    try {
      const context = await prepareSystemPromptContext(
        this.systemContextKaos(this.toolKaos.getcwd()),
        this.options.kimiHomeDir,
        { additionalDirs: this.additionalDirs },
      );
      this.agentsMdWarning = context.agentsMdWarning;
    } catch (error) {
      log.warn('failed to compute AGENTS.md warning', { error });
    }
    return this.agentsMdWarning;
  }

  async generateAgentsMd(): Promise<void> {
    await this.skillsReady;
    await runGenerateAgentsMd(this.requireMainAgent(), this.options.kimiHomeDir);
  }

  /**
   * Appends a fresh `<plugin_session_start>` system reminder to the main agent
   * using the currently enabled plugins, then flushes records so the reminder is
   * persisted and visible on the wire. Used by the explicit `/reload` flow after
   * the session has been re-resumed with reloaded plugin state.
   *
   * When no plugin session start is currently resolvable but an earlier
   * When no plugin session start is currently resolvable but the context may still
   * carry stale plugin guidance — either an earlier `<plugin_session_start>`
   * reminder, or a compaction summary that may have folded one in — appends a
   * neutralizing reminder instead, so the model does not keep following stale
   * plugin instructions and the turn-loop injector does not dedup against them.
   */
  async appendPluginSessionStartReminder(): Promise<void> {
    await this.skillsReady;
    await applyPluginSessionStartReminder(this.requireMainAgent());
  }

  get hasActiveTurn(): boolean {
    for (const agent of this.readyAgents()) {
      if (agent.turn.hasActiveTurn) return true;
    }
    return false;
  }

  writeMetadata() {
    return this.metadataPersistence.write(this.metadata);
  }

  async readMetadata() {
    this.metadata = await this.metadataPersistence.read(this.metadata);
    return this.metadata;
  }

  async flushMetadata() {
    await this.skillsReady;
    await this.metadataPersistence.flush();
    await Promise.all(Array.from(this.readyAgents()).map((agent) => agent.records.flush()));
  }

  /**
   * Best-effort synchronous flush for crash paths (signal handlers,
   * `uncaughtExceptionMonitor`). Drains pending wire-log records with an
   * fsync so the most recent state survives a hard exit. It does NOT await
   * `writeMetadataPromise` or `skillsReady` — those are async and cannot
   * complete from a sync context. Use {@link flushMetadata} for normal
   * graceful shutdown.
   */
  flushMetadataSync(): void {
    for (const agent of this.readyAgents()) {
      agent.records.flushSync();
    }
  }

  /**
   * Emergency synchronous flush for the hardest crash paths (SIGHUP on a dead
   * terminal, `uncaughtExceptionMonitor`) where no async cleanup can run.
   * Flushes each active Ultrawork run's on-disk mirror (its checkpoint write
   * is already synchronous) and then drains pending wire-log records with a
   * synchronous fsync. Best-effort: any record already inside an in-flight
   * async drain may or may not have been fsync'd, but nothing still pending
   * is lost. Never throws — a crash path must not fail twice.
   */
  emergencyFlushSync(): void {
    for (const agent of this.readyAgents()) {
      try {
        if (agent.ultrawork.getRun()) agent.ultrawork.flushCheckpoint();
      } catch {
        // Best-effort: a mirror write failure must not skip the records flush.
      }
      try {
        agent.records.flushSync();
      } catch {
        // Swallow — the process is dying anyway.
      }
    }
  }

  async listSkills(): Promise<readonly SkillSummary[]> {
    await this.skillsReady;
    await this.skills.ensureCatalogLoaded();
    return this.skills.listSkills().map(summarizeSkill);
  }

  listPluginCommands(): readonly PluginCommandDef[] {
    return this.options.pluginCommands ?? [];
  }

  async searchSkills(query: string, limit?: number): Promise<readonly SkillSearchHit[]> {
    await this.skillsReady;
    return this.skills.searchByQuery(query, limit);
  }

  private async loadSkills(): Promise<void> {
    const roots = await resolveSkillRoots({
      paths: {
        userHomeDir: this.options.skills?.userHomeDir ?? homedir(),
        brandHomeDir: this.options.skills?.brandHomeDir ?? this.options.kimiHomeDir,
        workDir: this.options.kaos.getcwd(),
      },
      explicitDirs: this.options.skills?.explicitDirs,
      extraDirs: this.options.skills?.extraDirs,
      pluginSkillRoots: this.options.skills?.pluginSkillRoots,
      mergeAllAvailableSkills: this.options.skills?.mergeAllAvailableSkills,
      builtinDir: this.options.skills?.builtinDir,
    });
    await this.skills.loadRoots(roots);
    registerBuiltinSkills(this.skills);
    // Builtin catalog skills load lazily on first SearchSkill/Skill use.
  }

  private async loadMcpServers(): Promise<void> {
    const servers = this.options.mcpConfig?.servers;
    if (servers === undefined || Object.keys(servers).length === 0) return;
    await this.mcp.connectAll(servers);
    const entries = this.mcp.list().filter((entry) => entry.status !== 'disabled');
    const totalCount = entries.length;
    if (totalCount === 0) return;

    const connectedCount = entries.filter((entry) => entry.status === 'connected').length;
    if (connectedCount > 0) {
      this.telemetry.track('mcp_connected', {
        server_count: connectedCount,
        total_count: totalCount,
      });
    }

    const failedCount = entries.filter((entry) => entry.status === 'failed').length;
    if (failedCount > 0) {
      this.telemetry.track('mcp_failed', {
        failed_count: failedCount,
        total_count: totalCount,
      });
    }
  }

  private emitInitialMcpLoadError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.log.error('mcp initial load failed', error);
    void this.rpc.emitEvent({
      type: 'error',
      agentId: 'main',
      ...makeErrorPayload(ErrorCodes.MCP_STARTUP_FAILED, message),
    });
  }

  private onMcpServerStatusChange(entry: McpServerEntry): void {
    // Always surface server-level status changes to clients so the TUI/SDK
    // can keep its dashboard in sync, even before the main agent exists.
    void this.rpc.emitEvent({
      type: 'mcp.server.status',
      agentId: 'main',
      server: {
        name: entry.name,
        transport: entry.transport,
        status: entry.status,
        toolCount: entry.toolCount,
        error: entry.error,
      },
    });
  }

  private refreshAgentBuiltinTools(): void {
    for (const agent of this.readyAgents()) {
      if (!agent.config.hasProvider) continue;
      agent.tools.initializeBuiltinTools();
    }
  }

  private resolveSandboxProfile(): SandboxProfile {
    const raw = this.metadata.custom['sandboxProfile'];
    if (raw === 'off' || raw === 'workspace' || raw === 'read-only') {
      return raw;
    }
    // Default workspace sandbox for safer file tools / AC4 tests.
    return 'workspace';
  }

  /**
   * Restore disk files from a sealed turn snapshot.
   * When `turnId` is omitted, restores the latest sealed turn.
   * Does not rewrite conversation history — pair with `undoHistory` when needed.
   */
  async rewindFiles(options: { turnId?: string | undefined } = {}): Promise<{
    readonly turnId: string;
    readonly restored: readonly string[];
    readonly deleted: readonly string[];
    readonly skippedSensitive: readonly string[];
    readonly errors: readonly { path: string; message: string }[];
  }> {
    let turnId = options.turnId;
    if (turnId === undefined) {
      const turns = this.fileSnapshots.listTurns();
      const latest = turns[turns.length - 1];
      if (latest === undefined) {
        throw new LioraError(ErrorCodes.SESSION_STATE_INVALID, 'No file snapshots available to rewind');
      }
      turnId = latest.turnId;
    }
    const result = await this.fileSnapshots.restoreTurn(turnId);
    this.fileSnapshots.discardFrom(turnId);
    return { turnId, ...result };
  }

  startConversationLoop(options: {
    prompt: string;
    intervalMs?: number | undefined;
    maxIterations?: number | undefined;
    expiresAt?: number | undefined;
  }): ConversationLoopState {
    return this.conversationLoopManager.start(options);
  }

  stopConversationLoop(loopId?: string): ConversationLoopState | undefined {
    return this.conversationLoopManager.stop(loopId);
  }

  listConversationLoops(): readonly ConversationLoopState[] {
    return this.conversationLoopManager.list();
  }

  tickConversationLoops(): readonly ConversationLoopState[] {
    return this.conversationLoopManager.tick();
  }

  private instantiateAgent(
    id: string,
    homedir: string,
    type: AgentType,
    config: Partial<AgentOptions> = {},
    parentAgentId: string | null = null,
  ): Agent {
    const parentAgent = parentAgentId !== null ? this.getReadyAgent(parentAgentId) : undefined;
    const cwd = parentAgent?.config.cwd ?? this.toolKaos.getcwd();
    return new Agent({
      ...config,
      type,
      kaos: this.toolKaos.withCwd(cwd),
      toolServices: this.options.toolServices,
      config: this.options.config,
      homedir,
      skills: this.skills,
      rpc: proxyWithExtraPayload(this.rpc, { agentId: id }),
      modelProvider: this.options.providerManager,
      hookEngine: config.hookEngine ?? this.hookEngine,
      subagentHost: config.subagentHost ?? new SessionSubagentHost(this, id),
      mcp: this.mcp,
      permission: this.permissionOptions(parentAgentId, config.permission),
      telemetry: this.telemetry,
      log: this.log.createChild({ agentId: id }),
      pluginSessionStarts: type === 'main' ? this.options.pluginSessionStarts : undefined,
      pluginCommands: type === 'main' ? this.options.pluginCommands : undefined,
      experimentalFlags: this.experimentalFlags,
      additionalDirs: parentAgent?.getAdditionalDirs() ?? this.additionalDirs,
      memory: this.options.memory?.forAgent({
        sessionId: this.options.id ?? '',
        agentId: id,
        agentType: type,
        workDir: cwd,
      }),
      responseLanguagePreference: () =>
        responseLanguagePreferenceFromUnknown(this.metadata.custom['responseLanguage']),
      dreamStore: type === 'main' ? this.options.dreamStore : undefined,
      fileSnapshots: config.fileSnapshots ?? this.fileSnapshots,
      sandboxProfile: config.sandboxProfile ?? this.resolveSandboxProfile(),
    });
  }

  private permissionOptions(
    parentAgentId: string | null,
    input?: PermissionManagerOptions | undefined,
  ): PermissionManagerOptions {
    if (parentAgentId === null) {
      return {
        ...input,
        initialRules: input?.initialRules ?? this.options.permissionRules,
      };
    }
    return {
      ...input,
      parent: input?.parent ?? this.getReadyAgent(parentAgentId)?.permission,
    };
  }

  getReadyAgent(id: string): Agent | undefined {
    const entry = this.agents.get(id);
    return entry instanceof Agent ? entry : undefined;
  }

  *readyAgents(): Iterable<Agent> {
    for (const entry of this.agents.values()) {
      if (entry instanceof Agent) yield entry;
    }
  }

  private async resolveAgentEntry(entry: AgentEntry): Promise<ResumedAgent> {
    if (entry instanceof Agent) return { agent: entry };
    return entry;
  }

  private resumeAgent(
    id: string,
    stack: readonly string[] = [],
  ): Promise<ResumedAgent> {
    if (stack.includes(id)) {
      throw new LioraError(
        ErrorCodes.SESSION_STATE_INVALID,
        `Session agent parent chain contains a cycle: ${[...stack, id].join(' -> ')}`,
      );
    }

    const entry = this.agents.get(id);
    if (entry !== undefined) return this.resolveAgentEntry(entry);

    const promise = this.resumePersistedAgent(id, stack);
    this.agents.set(id, promise);
    return promise;
  }

  private async resumePersistedAgent(
    id: string,
    stack: readonly string[] = [],
  ): Promise<ResumedAgent> {
    await this.skillsReady;
    const meta = this.metadata.agents[id];
    if (meta === undefined) {
      throw new LioraError(ErrorCodes.SESSION_STATE_INVALID, `Session agent "${id}" is missing`);
    }

    const parentAgentId = meta.parentAgentId ?? null;
    const parent =
      parentAgentId === null
        ? undefined
        : await this.resumeAgent(parentAgentId, [...stack, id]);

    try {
      const agent = this.instantiateAgent(id, meta.homedir, meta.type, {}, parentAgentId);
      const result = await agent.resume();
      this.agents.set(id, agent);
      return { agent, warning: parent?.warning ?? result.warning };
    } catch (error) {
      const entry = this.agents.get(id);
      if (entry instanceof Promise) {
        this.agents.delete(id);
      }
      throw error;
    }
  }

  private nextGeneratedAgentId(): string {
    while (true) {
      const id = `agent-${this.agentIdCounter++}`;
      if (this.agents.has(id)) continue;
      if (this.metadata.agents[id] !== undefined) continue;
      return id;
    }
  }

  private requireMainAgent(): Agent {
    const agent = this.getReadyAgent('main');
    if (agent === undefined) {
      throw new LioraError(ErrorCodes.AGENT_NOT_FOUND, 'Main agent was not found');
    }
    return agent;
  }

  private async triggerSessionStart(source: 'startup' | 'resume'): Promise<void> {
    await this.hookEngine.trigger('SessionStart', {
      matcherValue: source,
      inputData: { source },
    });
  }

  private async triggerSessionEnd(reason: 'exit'): Promise<void> {
    await this.hookEngine.trigger('SessionEnd', {
      matcherValue: reason,
      inputData: { reason },
    });
  }
}

export * from './subagent-host';
export {
  FileSnapshotStore,
  type FileSnapshotEntry,
  type FileSnapshotStoreOptions,
  type TurnFileSnapshot,
} from './file-snapshot';

