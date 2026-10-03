/**
 * Session agent create/resume lifecycle — extracted from Session class.
 */

import type { Kaos } from '@superliora/kaos';

import { ErrorCodes, LioraError } from '#/errors/index';
import { log } from '#/logging/logger';
import type { Logger } from '#/logging/types';
import { agentRpcWithAncestry, resolveWorkerAncestry } from './worker-ancestry';
import type { SDKSessionRPC } from '#/rpc';

import { Agent, type AgentOptions, type AgentType } from '../../agent';
import type { PermissionManagerOptions } from '../../agent/permission';
import { prepareSystemPromptContext, resolveMainAgentProfile, type ResolvedAgentProfile } from '../../profile';
import type { TelemetryClient } from '../../telemetry';
import type { SandboxEnforcement } from '../../config/sandbox-enforcement';
import type { SandboxProfile } from '../../tools/policies/path-access';
import { FileSnapshotStore } from '../file-snapshot';
import type { FileProvenanceRecorder } from '../file-provenance';
import { ProviderManager } from '../provider/provider-manager';
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
  readonly telemetry: TelemetryClient;
  readonly fileSnapshots: FileSnapshotStore;
  readonly fileProvenance: FileProvenanceRecorder;
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
   * Applies the minimal environment/AGENTS prompt for fresh and resumed agents.
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
    const cwd = config.kaos?.getcwd() ?? parentAgent?.config.cwd ?? this.opts.getToolKaos().getcwd();
    return new Agent({
      ...config,
      type,
      kaos: (config.kaos ?? this.opts.getToolKaos()).withCwd(cwd),
      config: config.config ?? this.opts.options.config,
      homedir,
      rpc: agentRpcWithAncestry(this.opts.rpc, id, (subject) => resolveWorkerAncestry(this.opts.options, this.opts.getMetadata().agents, subject, subject === id ? parentAgentId : undefined)),
      modelProvider: config.modelProvider ?? providerManagerForAgent(this.opts.options.providerManager, id),
      sessionControl: config.sessionControl ?? this.opts.session.getSubagentHost(id),
      permission: this.permissionOptions(parentAgentId, config.permission),
      telemetry: this.opts.telemetry,
      log: this.opts.log.createChild({ agentId: id }),
      additionalDirs: config.additionalDirs ?? parentAgent?.getAdditionalDirs() ?? this.opts.getAdditionalDirs(),
      fileSnapshots: config.fileSnapshots ?? this.opts.fileSnapshots,
      fileProvenance: config.fileProvenance ?? this.opts.fileProvenance,
      sandboxProfile: config.sandboxProfile ?? this.resolveSandboxProfile(),
      sandboxEnforcement: config.sandboxEnforcement ?? this.resolveSandboxEnforcement(),
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

    const promise = Promise.resolve().then(() => this.resumePersistedAgent(id, stack));
    this.opts.agents.set(id, promise);
    return promise;
  }

  async resumePersistedAgent(
    id: string,
    stack: readonly string[] = [],
  ): Promise<ResumedAgent> {
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
      // Publish before replay so nested lookups cannot wait on this resume.
      this.opts.agents.set(id, agent);
      const result = await agent.resume();
      await this.bootstrapAgentProfile(agent, resolveMainAgentProfile());
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
    // Product default is off: path sandbox is opt-in via Settings / config /
    // --sandbox / SUPERLIORA_SANDBOX / local.toml. Sensitive-path checks stay on.
    return 'off';
  }

  private resolveSandboxEnforcement(): SandboxEnforcement {
    const raw = this.opts.getMetadata().custom['sandboxEnforcement'];
    if (raw === 'lexical' || raw === 'process') {
      return raw;
    }
    return 'lexical';
  }
}

function providerManagerForAgent(
  manager: SessionOptions['providerManager'],
  agentId: string,
): SessionOptions['providerManager'] {
  if (manager instanceof ProviderManager) return manager.forAgent(agentId);
  return manager;
}
