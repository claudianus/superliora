/**
 * Session skills and MCP bootstrap — extracted from Session class.
 */

import { homedir } from 'node:os';

import { ErrorCodes } from '#/errors/index';
import type { Logger } from '#/logging/types';
import type { SDKSessionRPC } from '#/rpc';

import { makeErrorPayload } from '../../errors';
import { McpConnectionManager, type McpServerEntry } from '../../mcp';
import {
  registerBuiltinSkills,
  resolveSkillRoots,
  type SessionSkillRegistry,
} from '../../skill';
import type { TelemetryClient } from '../../telemetry';
import type { SessionOptions } from './session-types';

export interface SessionResourcesOptions {
  readonly options: SessionOptions;
  readonly skills: SessionSkillRegistry;
  readonly mcp: McpConnectionManager;
  readonly telemetry: TelemetryClient;
  readonly log: Logger;
  readonly rpc: SDKSessionRPC;
  readonly readyAgents: () => Iterable<import('../../agent').Agent>;
}

export class SessionResources {
  constructor(private readonly opts: SessionResourcesOptions) {}

  async loadSkills(): Promise<void> {
    const { options, skills } = this.opts;
    const roots = await resolveSkillRoots({
      paths: {
        userHomeDir: options.skills?.userHomeDir ?? homedir(),
        brandHomeDir: options.skills?.brandHomeDir ?? options.kimiHomeDir,
        workDir: options.kaos.getcwd(),
      },
      explicitDirs: options.skills?.explicitDirs,
      extraDirs: options.skills?.extraDirs,
      pluginSkillRoots: options.skills?.pluginSkillRoots,
      mergeAllAvailableSkills: options.skills?.mergeAllAvailableSkills,
      builtinDir: options.skills?.builtinDir,
    });
    await skills.loadRoots(roots);
    registerBuiltinSkills(skills);
    // Builtin catalog skills load lazily on first SearchSkill/Skill use.
  }

  async loadMcpServers(): Promise<void> {
    const { options, mcp, telemetry } = this.opts;
    const servers = options.mcpConfig?.servers;
    if (servers === undefined || Object.keys(servers).length === 0) return;
    await mcp.connectAll(servers);
    const entries = mcp.list().filter((entry) => entry.status !== 'disabled');
    const totalCount = entries.length;
    if (totalCount === 0) return;

    const connectedCount = entries.filter((entry) => entry.status === 'connected').length;
    if (connectedCount > 0) {
      telemetry.track('mcp_connected', {
        server_count: connectedCount,
        total_count: totalCount,
      });
    }

    const failedCount = entries.filter((entry) => entry.status === 'failed').length;
    if (failedCount > 0) {
      telemetry.track('mcp_failed', {
        failed_count: failedCount,
        total_count: totalCount,
      });
    }
  }

  emitInitialMcpLoadError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.opts.log.error('mcp initial load failed', error);
    void this.opts.rpc.emitEvent({
      type: 'error',
      agentId: 'main',
      ...makeErrorPayload(ErrorCodes.MCP_STARTUP_FAILED, message),
    });
  }

  onMcpServerStatusChange(entry: McpServerEntry): void {
    // Always surface server-level status changes to clients so the TUI/SDK
    // can keep its dashboard in sync, even before the main agent exists.
    void this.opts.rpc.emitEvent({
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

  refreshAgentBuiltinTools(): void {
    for (const agent of this.opts.readyAgents()) {
      if (!agent.config.hasProvider) continue;
      agent.tools.initializeBuiltinTools();
    }
  }
}
