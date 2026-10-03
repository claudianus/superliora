import { join } from 'pathe';
import { type Kaos } from '@superliora/kaos';

import { workerAncestrySchema } from '@superliora/protocol';
import { ErrorCodes, LioraError } from '#/errors/index';
import { getRootLogger, log } from '#/logging/logger';
import type { SessionLogHandle } from '#/logging/types';
import { Agent, type AgentOptions } from '../agent';
import { type ConversationLoopState } from '../agent/conversation-loop';
import { FileSnapshotStore } from './file-snapshot';
import { FileProvenanceRecorder } from './file-provenance';
import {
  appendWorkspaceAdditionalDir,
  normalizeAdditionalDirs,
  readWorkspaceAdditionalDirs,
  resolveWorkspaceAdditionalDirs,
  type WorkspaceAdditionalDirsLoadResult,
} from '../config';
import { resolveMainAgentProfile } from '../profile';
import { SessionSubagentHost } from './subagent/subagent-host';
import { noopTelemetryClient } from '../telemetry';
import { SessionMetadataPersistence } from './metadata-persistence';
import { ConversationLoopManager } from './conversation-loops';
import { SessionCloseLifecycle } from './lifecycle/session-close-lifecycle';
import { flushAgentJobLedgerCrashMirrorSync } from '../tools/builtin/job/job-crash-mirror';
import { bindJobWorkerHost } from '../tools/builtin/job/job-handles';
import { openJobAdmissions } from '../tools/builtin/job/job-runtime';
import { SessionAgentLifecycle } from './lifecycle/session-agent-lifecycle';
import { collectSessionWarnings } from './lifecycle/session-warnings';
import {
  SESSION_STATE_VERSION,
  type AgentEntry,
  type CreateAgentOptions,
  type SessionMeta,
  type SessionOptions,
} from './lifecycle/session-types';

export type {
  AgentMeta,
  CreateAgentOptions,
  SessionCustomMetadata,
  SessionMeta,
  SessionOptions,
} from './lifecycle/session-types';
export { SESSION_STATE_VERSION } from './lifecycle/session-types';

export class Session {
  readonly rpc: SessionOptions['rpc'];
  readonly telemetry: NonNullable<SessionOptions['telemetry']>;
  readonly agents: Map<string, AgentEntry> = new Map();
  readonly log: ReturnType<typeof log.createChild> | typeof log;
  /** Session-scoped write/edit snapshots shared by all agents for `/rewind`. */
  readonly fileSnapshots: FileSnapshotStore;
  /** Session-scoped file-provenance recorder shared by all agents. */
  readonly fileProvenance: FileProvenanceRecorder;
  private readonly logHandle: SessionLogHandle | undefined;
  private toolKaos: Kaos;
  private persistenceKaos: Kaos;
  private additionalDirs: readonly string[];
  private readonly subagentHosts = new Map<string, SessionSubagentHost>();
  private readonly metadataPersistence: SessionMetadataPersistence;
  private readonly conversationLoopManager: ConversationLoopManager;
  private readonly closeLifecycle: SessionCloseLifecycle;
  private readonly agentLifecycle: SessionAgentLifecycle;
  private closePromise: Promise<void> | undefined;
  private readonly creatingAgents = new Set<Promise<void>>();
  isClosing = false;
  metadata: SessionMeta = {
    version: SESSION_STATE_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: 'New Session',
    isCustomTitle: false,
    agents: {},
    custom: {},
  };
  private agentsMdWarning: string | undefined;

  constructor(public readonly options: SessionOptions) {
    // Session logs must exist before persistence and child-session setup.
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
    this.telemetry = options.telemetry ?? noopTelemetryClient;
    this.toolKaos = options.kaos;
    this.persistenceKaos = options.persistenceKaos ?? options.kaos;
    this.additionalDirs = normalizeAdditionalDirs(options.additionalDirs ?? []);
    this.fileSnapshots = new FileSnapshotStore({
      kaos: this.toolKaos,
      snapshotDir: FileSnapshotStore.snapshotDirForSession(options.homedir),
    });
    this.fileProvenance = new FileProvenanceRecorder({
      filePath: FileProvenanceRecorder.provenancePathForSession(options.homedir),
      cwd: options.kaos.getcwd(),
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
    });
    this.agentLifecycle = new SessionAgentLifecycle({
      session: this,
      options: this.options,
      agents: this.agents,
      getMetadata: () => this.metadata,
      telemetry: this.telemetry,
      fileSnapshots: this.fileSnapshots,
      fileProvenance: this.fileProvenance,
      log: this.log,
      rpc: this.rpc,
      getToolKaos: () => this.toolKaos,
      getAdditionalDirs: () => this.additionalDirs,
      getAgentsMdWarning: () => this.agentsMdWarning,
      setAgentsMdWarning: (warning) => {
        this.agentsMdWarning = warning;
      },
      systemContextKaos: (cwd) => this.systemContextKaos(cwd),
      writeMetadata: () => { void this.writeMetadata(); },
    });
  }

  setToolKaos(kaos: Kaos) {
    this.toolKaos = kaos;
    for (const agent of this.readyAgents()) {
      agent.setKaos(kaos.withCwd(agent.config.cwd));
    }
  }

  getKaos(): Kaos {
    return this.toolKaos;
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
      return { ...result, additionalDirs, persisted: true };
    }

    const workspace = await readWorkspaceAdditionalDirs(systemKaos, cwd);
    const additionalDirs = await resolveWorkspaceAdditionalDirs(systemKaos, cwd, [path]);
    const nextAdditionalDirs = normalizeAdditionalDirs([...this.additionalDirs, ...additionalDirs]);
    await this.setAdditionalDirs(nextAdditionalDirs);
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
    const profile = resolveMainAgentProfile();
    const { id, agent } = await this.createAgent({ type: 'main' }, {
      profile,
    });
    this.getSubagentHost(id);
    return agent;
  }

  async resume(): Promise<{ warning?: string }> {
    this.assertOpen();
    if (this.hasActiveTurn || this.agents.size > 0) throw new Error('Cannot resume a live session.');
    this.log.info('session resume', { app_version: this.options.appVersion });
    const { agents } = await this.readMetadata();
    this.agents.clear();
    // Children replay lazily when an explicit session operation requests them.
    const { warning } =
      agents['main'] === undefined ? { warning: undefined } : await this.agentLifecycle.resumeAgent('main');
    if (agents['main'] !== undefined) this.getSubagentHost('main');
    return { warning };
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    const completion = Promise.withResolvers<void>();
    this.closePromise = completion.promise;
    this.isClosing = true;
    void this.settleClose().then(completion.resolve, completion.reject);
    return this.closePromise;
  }

  private async settleClose(): Promise<void> {
    this.closeLifecycle.requestClose();
    for (const loop of this.conversationLoopManager.list()) this.conversationLoopManager.stop(loop.id);
    await Promise.allSettled(this.creatingAgents);
    this.closeLifecycle.requestClose();
    const results = await Promise.allSettled([
      this.closeLifecycle.interruptJobsOnClose(),
      this.closeLifecycle.cancelActiveTurnsOnClose(),
      this.closeLifecycle.stopBackgroundTasksOnExit(),
      ...Array.from(this.subagentHosts.values(), (host) => host.close()),
    ]);
    const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (errors.length > 0) throw new AggregateError(errors, 'Session shutdown failed.');
    await this.flushMetadata();
    const records = await Promise.allSettled(Array.from(this.readyAgents(), (agent) => agent.records.close()));
    const recordErrors = records.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (recordErrors.length > 0) throw new AggregateError(recordErrors, 'Session journal shutdown failed.');
    await this.logHandle?.close();
  }

  assertOpen(): void {
    if (this.isClosing) throw new Error('Session is closing.');
  }


  async createAgent(
    config: Partial<AgentOptions>,
    options: CreateAgentOptions = {},
  ): Promise<{ readonly id: string; readonly agent: Agent }> {
    this.assertOpen();
    const type = config.type ?? 'main';
    const id = type === 'main' ? 'main' : this.agentLifecycle.nextGeneratedAgentId();
    const homedir = config.homedir ?? join(this.options.homedir, 'agents', id);
    const parentAgentId = options.parentAgentId ?? null;
    const agent = this.agentLifecycle.instantiateAgent(id, homedir, type, config, parentAgentId);
    if (options.profile) {
      const preparation = this.agentLifecycle.bootstrapAgentProfile(agent, options.profile);
      this.creatingAgents.add(preparation);
      try {
        await preparation;
      } finally {
        this.creatingAgents.delete(preparation);
      }
    }

    this.agents.set(id, agent);
    this.getSubagentHost(id);
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

  /**
   * Register a copied worker so `host.resume(agentId)` works in this TUI chat.
   * Files must already live at `homedir` (see importWorkerHomedir).
   */
  registerImportedSubagent(agentId: string, homedir: string, parentAgentId = 'main'): void {
    this.assertOpen();
    this.metadata.agents[agentId] = {
      homedir,
      type: 'sub',
      parentAgentId,
    };
    void this.writeMetadata();
  }

  async ensureAgentResumed(id: string): Promise<Agent> {
    this.assertOpen();
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
    const stored = this.metadata.workerAncestry === undefined ? undefined : workerAncestrySchema.parse(this.metadata.workerAncestry);
    const supplied = this.options.workerAncestry;
    if (stored !== undefined && supplied !== undefined && JSON.stringify(workerAncestrySchema.parse(supplied)) !== JSON.stringify(stored)) {
      throw new Error('Cannot reparent an existing independent session');
    }
    const ancestry = supplied ?? stored;
    if (ancestry !== undefined) {
      if (ancestry.agentId !== 'main' || (this.options.id !== undefined && ancestry.sessionId !== this.options.id)) {
        throw new Error('Persisted worker ancestry does not identify this session');
      }
      this.metadata.workerAncestry = ancestry;
      Object.assign(this.options, { workerAncestry: ancestry });
    }
    return this.metadata;
  }

  async flushMetadata() {
    await this.metadataPersistence.flush();
    await Promise.all(Array.from(this.readyAgents(), (agent) => {
      agent.tools.flushRecordWrites();
      return agent.records.flush();
    }));
  }

  /** Crash-path flush; graceful shutdown uses flushMetadata(). */
  flushMetadataSync(): void {
    for (const agent of this.readyAgents()) {
      agent.records.flushSync();
    }
  }

  /**
   * Emergency synchronous flush for the hardest crash paths (SIGHUP on a dead
   * terminal, `uncaughtExceptionMonitor`) where no async cleanup can run.
   * Flushes each agent's on-disk mirror (its checkpoint write
   * is already synchronous) and then drains pending wire-log records with a
   * synchronous fsync. Best-effort: any record already inside an in-flight
   * async drain may or may not have been fsync'd, but nothing still pending
   * is lost. Never throws — a crash path must not fail twice.
   */
  emergencyFlushSync(): void {
    for (const agent of this.readyAgents()) {
      try {
        agent.records.flushSync();
      } catch {
        // Swallow — the process is dying anyway.
      }
      try {
        flushAgentJobLedgerCrashMirrorSync(agent);
      } catch {
        // Swallow — the process is dying anyway.
      }
    }
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
      const latest = turns.at(-1);
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
    this.assertOpen();
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

  getSubagentHost(agentId: string): SessionSubagentHost {
    let host = this.subagentHosts.get(agentId);
    if (host === undefined) {
      host = new SessionSubagentHost(this, agentId);
      this.subagentHosts.set(agentId, host);
    }
    const agent = this.getReadyAgent(agentId);
    if (!this.isClosing && agent !== undefined) {
      const store = agent.tools.getStore();
      openJobAdmissions(store);
      bindJobWorkerHost(store, host);
    }
    return host;
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
export {
  FileProvenanceRecorder,
  readProvenanceFile,
  FILE_PROVENANCE_ENV,
  type FileProvenanceHook,
  type FileProvenanceMutation,
  type FileProvenanceOp,
  type FileProvenanceRecord,
  type FileProvenanceRecorderOptions,
  type ProvenanceMutationContext,
} from './file-provenance';
