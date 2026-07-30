import { join } from 'pathe';
import { type Kaos } from '@superliora/kaos';

import { ErrorCodes, LioraError } from '#/errors';
import { getRootLogger, log } from '#/logging/logger';
import type { SessionLogHandle } from '#/logging/types';
import { Agent, type AgentOptions } from '../agent';
import { type ConversationLoopState } from '../agent/conversation-loop';
import { HookEngine } from './hooks';
import { FileSnapshotStore } from './file-snapshot';
import {
  appendWorkspaceAdditionalDir,
  normalizeAdditionalDirs,
  readWorkspaceAdditionalDirs,
  resolveWorkspaceAdditionalDirs,
  type WorkspaceAdditionalDirsLoadResult,
} from '../config';
import {
  McpConnectionManager,
  McpOAuthService,
} from '../mcp';
import { DEFAULT_AGENT_PROFILES } from '../profile';
import {
  SessionSkillRegistry,
  summarizeSkill,
  type SkillSearchHit,
  type SkillSummary,
} from '../skill';
import { noopTelemetryClient } from '../telemetry';
import type { PluginCommandDef } from '../plugin';
import { FlagResolver } from '../flags';
import { SessionMetadataPersistence } from './metadata-persistence';
import { ConversationLoopManager } from './conversation-loops';
import { SessionCloseLifecycle } from './lifecycle/session-close-lifecycle';
import {
  appendPluginSessionStartReminder as applyPluginSessionStartReminder,
  runGenerateAgentsMd,
} from './lifecycle/session-plugin-reminder';
import { SessionAgentLifecycle } from './lifecycle/session-agent-lifecycle';
import { SessionResources } from './lifecycle/session-resources';
import { triggerSessionEnd, triggerSessionStart } from './lifecycle/session-lifecycle-hooks';
import { notifyAdditionalDirAdded } from './lifecycle/session-workspace-dirs';
import { collectSessionWarnings } from './lifecycle/session-warnings';
import type {
  AgentEntry,
  CreateAgentOptions,
  SessionMeta,
  SessionOptions,
} from './lifecycle/session-types';

export type {
  AgentMeta,
  CreateAgentOptions,
  SessionMeta,
  SessionOptions,
  SessionSkillConfig,
} from './lifecycle/session-types';

export class Session {
  readonly rpc: SessionOptions['rpc'];
  readonly telemetry: NonNullable<SessionOptions['telemetry']>;
  readonly skills: SessionSkillRegistry;
  readonly agents: Map<string, AgentEntry> = new Map();
  readonly mcp: McpConnectionManager;
  readonly log: ReturnType<typeof log.createChild> | typeof log;
  /** Session-scoped write/edit snapshots shared by all agents for `/rewind`. */
  readonly fileSnapshots: FileSnapshotStore;
  private readonly logHandle: SessionLogHandle | undefined;
  readonly hookEngine: HookEngine;
  readonly experimentalFlags: NonNullable<SessionOptions['experimentalFlags']>;
  private toolKaos: Kaos;
  private persistenceKaos: Kaos;
  private additionalDirs: readonly string[];
  private readonly skillsReady: Promise<void>;
  private readonly metadataPersistence: SessionMetadataPersistence;
  private readonly conversationLoopManager: ConversationLoopManager;
  private readonly closeLifecycle: SessionCloseLifecycle;
  private readonly agentLifecycle: SessionAgentLifecycle;
  private readonly resources: SessionResources;
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
    this.resources = new SessionResources({
      options: this.options,
      skills: this.skills,
      mcp: this.mcp,
      telemetry: this.telemetry,
      log: this.log,
      rpc: this.rpc,
      readyAgents: () => this.readyAgents(),
    });
    this.mcp.onStatusChange((entry) => {
      this.resources.onMcpServerStatusChange(entry);
    });
    this.skillsReady = this.resources
      .loadSkills()
      .catch((error: unknown) => {
        this.log.error('skills load failed', error);
      })
      .then(() => {
        this.resources.refreshAgentBuiltinTools();
      });
    this.agentLifecycle = new SessionAgentLifecycle({
      session: this,
      options: this.options,
      agents: this.agents,
      getMetadata: () => this.metadata,
      skills: this.skills,
      getSkillsReady: () => this.skillsReady,
      mcp: this.mcp,
      hookEngine: this.hookEngine,
      telemetry: this.telemetry,
      experimentalFlags: this.experimentalFlags,
      fileSnapshots: this.fileSnapshots,
      log: this.log,
      rpc: this.rpc,
      getToolKaos: () => this.toolKaos,
      getAdditionalDirs: () => this.additionalDirs,
      getAgentsMdWarning: () => this.agentsMdWarning,
      setAgentsMdWarning: (warning) => {
        this.agentsMdWarning = warning;
      },
      systemContextKaos: (cwd) => this.systemContextKaos(cwd),
      writeMetadata: () => this.writeMetadata(),
    });
    void this.resources.loadMcpServers().catch((error: unknown) => {
      this.resources.emitInitialMcpLoadError(error);
    });
  }

  setToolKaos(kaos: Kaos) {
    this.toolKaos = kaos;
    for (const agent of this.readyAgents()) {
      agent.setKaos(kaos.withCwd(agent.config.cwd));
    }
    this.resources.refreshAgentBuiltinTools();
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
      notifyAdditionalDirAdded(this.requireMainAgent(), path, true, result.configPath);
      return { ...result, additionalDirs, persisted: true };
    }

    const workspace = await readWorkspaceAdditionalDirs(systemKaos, cwd);
    const additionalDirs = await resolveWorkspaceAdditionalDirs(systemKaos, cwd, [path]);
    const nextAdditionalDirs = normalizeAdditionalDirs([...this.additionalDirs, ...additionalDirs]);
    await this.setAdditionalDirs(nextAdditionalDirs);
    notifyAdditionalDirAdded(this.requireMainAgent(), path, false, workspace.configPath);
    return {
      projectRoot: workspace.projectRoot,
      configPath: workspace.configPath,
      additionalDirs: nextAdditionalDirs,
      persisted: false,
    };
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
    await triggerSessionStart(this.hookEngine, 'startup');
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
      agents['main'] === undefined ? { warning: undefined } : await this.agentLifecycle.resumeAgent('main');
    // A session migrated from an external tool ships a wire without the
    // `config.update` bootstrap events a natively-created agent writes, so the
    // main agent comes back with an empty system prompt and no tools. Apply the
    // default profile so the resumed session is usable. Native sessions always
    // replay a non-empty system prompt and never enter this branch.
    const main = this.getReadyAgent('main');
    const profile = DEFAULT_AGENT_PROFILES['agent'];
    if (main !== undefined && profile !== undefined && main.config.systemPrompt === '') {
      await this.agentLifecycle.bootstrapAgentProfile(main, profile);
    }
    await triggerSessionStart(this.hookEngine, 'resume');
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
      await triggerSessionEnd(this.hookEngine, 'exit');
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
    const id = type === 'main' ? 'main' : this.agentLifecycle.nextGeneratedAgentId();
    const homedir = config.homedir ?? join(this.options.homedir, 'agents', id);
    const parentAgentId = options.parentAgentId ?? null;
    const agent = this.agentLifecycle.instantiateAgent(id, homedir, type, config, parentAgentId);
    if (options.profile) {
      await this.agentLifecycle.bootstrapAgentProfile(agent, options.profile);
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
    if (entry !== undefined) return (await this.agentLifecycle.resolveAgentEntry(entry)).agent;
    if (this.metadata.agents[id] === undefined) {
      throw new LioraError(ErrorCodes.AGENT_NOT_FOUND, `Agent "${id}" was not found`);
    }
    return (await this.agentLifecycle.resumeAgent(id)).agent;
  }

  async getSessionWarnings() {
    return collectSessionWarnings({
      kimiHomeDir: this.options.kimiHomeDir,
      additionalDirs: this.additionalDirs,
      systemContextKaos: (cwd) => this.systemContextKaos(cwd),
      toolKaosCwd: () => this.toolKaos.getcwd(),
      getAgentsMdWarning: () => this.agentsMdWarning,
      setAgentsMdWarning: (warning) => {
        this.agentsMdWarning = warning;
      },
    });
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

  getReadyAgent(id: string): Agent | undefined {
    return this.agentLifecycle.getReadyAgent(id);
  }

  *readyAgents(): Iterable<Agent> {
    yield* this.agentLifecycle.readyAgents();
  }

  private requireMainAgent(): Agent {
    return this.agentLifecycle.requireMainAgent();
  }
}

export * from './subagent/subagent-host';
export {
  FileSnapshotStore,
  type FileSnapshotEntry,
  type FileSnapshotStoreOptions,
  type TurnFileSnapshot,
} from './file-snapshot';
