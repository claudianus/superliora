/**
 * Session agent create/resume lifecycle — extracted from Session class.
 */

import type { Kaos } from '@superliora/kaos';

import { ErrorCodes, LioraError } from '#/errors/index';
import { log } from '#/logging/logger';
import type { Logger } from '#/logging/types';
import { proxyWithExtraPayload } from '#/rpc/types';
import type { SDKSessionRPC } from '#/rpc';

import { Agent, type AgentOptions, type AgentType } from '../../agent';
import type { PermissionManagerOptions } from '../../agent/permission';
import { HookEngine } from '../hooks';
import { McpConnectionManager } from '../../mcp';
import { prepareSystemPromptContext, type ResolvedAgentProfile } from '../../profile';
import type { SessionSkillRegistry } from '../../skill';
import type { TelemetryClient } from '../../telemetry';
import type { SandboxProfile } from '../../tools/policies/path-access';
import { FileSnapshotStore } from '../file-snapshot';
import type { ExperimentalFlagResolver } from '../../flags';
import { responseLanguagePreferenceFromUnknown } from '../response-language';
import { SessionSubagentHost } from '../subagent/subagent-host';
import type { Session } from '../index';
import type {
  AgentEntry,
  ResumedAgent,
  SessionMeta,
  SessionOptions,
} from './session-types';

export interface SessionAgentLifecycleOptions {
  readonly session: Session;
  readonly options: SessionOptions;
  readonly agents: Map<string, AgentEntry>;
  getMetadata: () => SessionMeta;
  readonly skills: SessionSkillRegistry;
  getSkillsReady: () => Promise<void>;
  readonly mcp: McpConnectionManager;
  readonly hookEngine: HookEngine;
  readonly telemetry: TelemetryClient;
  readonly experimentalFlags: ExperimentalFlagResolver;
  readonly fileSnapshots: FileSnapshotStore;
  readonly log: Logger;
  readonly rpc: SDKSessionRPC;
  getToolKaos: () => Kaos;
  getAdditionalDirs: () => readonly string[];
  getAgentsMdWarning: () => string | undefined;
  setAgentsMdWarning: (warning: string | undefined) => void;
  systemContextKaos: (cwd: string) => Kaos;
  writeMetadata: () => void;
}

export class SessionAgentLifecycle {
  private agentIdCounter = 0;

  constructor(private readonly opts: SessionAgentLifecycleOptions) {}

  /**
   * Applies a profile's derived config — cwd, system prompt, active tools — to
   * an agent. Fresh creation and resume-of-an-incomplete-wire both route
   * through here so the two paths cannot drift apart.
   */
  async bootstrapAgentProfile(agent: Agent, profile: ResolvedAgentProfile): Promise<void> {
    const context = await prepareSystemPromptContext(
      this.opts.systemContextKaos(agent.kaos.getcwd()),
      this.opts.options.kimiHomeDir,
      { additionalDirs: this.opts.getAdditionalDirs() },
    );
    agent.useProfile(profile, context);
    const { agentsMdWarning } = context;
    if (agentsMdWarning !== undefined) {
      this.opts.setAgentsMdWarning(agentsMdWarning);
      log.warn('AGENTS.md exceeds recommended size', { message: agentsMdWarning });
      agent.emitEvent({
        type: 'warning',
        message: agentsMdWarning,
        code: 'agents-md-oversized',
      });
    }
  }

  instantiateAgent(
    id: string,
    homedir: string,
    type: AgentType,
    config: Partial<AgentOptions> = {},
    parentAgentId: string | null = null,
  ): Agent {
    const parentAgent = parentAgentId !== null ? this.getReadyAgent(parentAgentId) : undefined;
    const cwd = parentAgent?.config.cwd ?? this.opts.getToolKaos().getcwd();
    return new Agent({
      ...config,
      type,
      kaos: this.opts.getToolKaos().withCwd(cwd),
      toolServices: this.opts.options.toolServices,
      config: this.opts.options.config,
      homedir,
      skills: this.opts.skills,
      rpc: proxyWithExtraPayload(this.opts.rpc, { agentId: id }),
      modelProvider: this.opts.options.providerManager,
      hookEngine: config.hookEngine ?? this.opts.hookEngine,
      subagentHost: config.subagentHost ?? new SessionSubagentHost(this.opts.session, id),
      mcp: this.opts.mcp,
      permission: this.permissionOptions(parentAgentId, config.permission),
      telemetry: this.opts.telemetry,
      log: this.opts.log.createChild({ agentId: id }),
      pluginSessionStarts: type === 'main' ? this.opts.options.pluginSessionStarts : undefined,
      pluginCommands: type === 'main' ? this.opts.options.pluginCommands : undefined,
      pluginAgents: this.opts.options.pluginAgents,
      pluginBinDirs: this.opts.options.pluginBinDirs,
      experimentalFlags: this.opts.experimentalFlags,
      additionalDirs: parentAgent?.getAdditionalDirs() ?? this.opts.getAdditionalDirs(),
      memory: this.opts.options.memory?.forAgent({
        sessionId: this.opts.options.id ?? '',
        agentId: id,
        agentType: type,
        workDir: cwd,
      }),
      responseLanguagePreference: () =>
        responseLanguagePreferenceFromUnknown(this.opts.getMetadata().custom['responseLanguage']),
      dreamStore: type === 'main' ? this.opts.options.dreamStore : undefined,
      fileSnapshots: config.fileSnapshots ?? this.opts.fileSnapshots,
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
        initialRules: input?.initialRules ?? this.opts.options.permissionRules,
      };
    }
    return {
      ...input,
      parent: input?.parent ?? this.getReadyAgent(parentAgentId)?.permission,
    };
  }

  getReadyAgent(id: string): Agent | undefined {
    const entry = this.opts.agents.get(id);
    return entry instanceof Agent ? entry : undefined;
  }

  *readyAgents(): Iterable<Agent> {
    for (const entry of this.opts.agents.values()) {
      if (entry instanceof Agent) yield entry;
    }
  }

  async resolveAgentEntry(entry: AgentEntry): Promise<ResumedAgent> {
    if (entry instanceof Agent) return { agent: entry };
    return entry;
  }

  resumeAgent(id: string, stack: readonly string[] = []): Promise<ResumedAgent> {
    if (stack.includes(id)) {
      throw new LioraError(
        ErrorCodes.SESSION_STATE_INVALID,
        `Session agent parent chain contains a cycle: ${[...stack, id].join(' -> ')}`,
      );
    }

    const entry = this.opts.agents.get(id);
    if (entry !== undefined) return this.resolveAgentEntry(entry);

    const promise = this.resumePersistedAgent(id, stack);
    this.opts.agents.set(id, promise);
    return promise;
  }

  async resumePersistedAgent(
    id: string,
    stack: readonly string[] = [],
  ): Promise<ResumedAgent> {
    await this.opts.getSkillsReady();
    const meta = this.opts.getMetadata().agents[id];
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
      // Publish before resume so fleet autopilot spawn → ensureAgentResumed(parent)
      // does not await this resume Promise (deadlock → jobs stuck queued/blocked).
      this.opts.agents.set(id, agent);
      const result = await agent.resume();
      return { agent, warning: parent?.warning ?? result.warning };
    } catch (error) {
      // Drop the failed agent we published, or the resume Promise placeholder.
      this.opts.agents.delete(id);
      throw error;
    }
  }

  nextGeneratedAgentId(): string {
    while (true) {
      const id = `agent-${this.agentIdCounter++}`;
      if (this.opts.agents.has(id)) continue;
      if (this.opts.getMetadata().agents[id] !== undefined) continue;
      return id;
    }
  }

  requireMainAgent(): Agent {
    const agent = this.getReadyAgent('main');
    if (agent === undefined) {
      throw new LioraError(ErrorCodes.AGENT_NOT_FOUND, 'Main agent was not found');
    }
    return agent;
  }

  private resolveSandboxProfile(): SandboxProfile {
    const raw = this.opts.getMetadata().custom['sandboxProfile'];
    if (raw === 'off' || raw === 'workspace' || raw === 'read-only') {
      return raw;
    }
    // Default workspace sandbox for safer file tools / AC4 tests.
    return 'workspace';
  }
}
