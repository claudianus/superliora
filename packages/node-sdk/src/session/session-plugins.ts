/**
 * Plugin, MCP, and skill activation RPC delegation for Session — extracted from session.ts.
 */

import { ErrorCodes } from '@superliora/agent-core';

import { normalizeOptionalString, normalizeRequiredString } from '#/session/session-helpers';
import { SessionGoalsUltraworkMixin } from '#/session/session-goals-ultrawork';
import type {
  McpServerInfo,
  McpStartupMetrics,
  PluginInfo,
  PluginSummary,
  ReloadSummary,
} from '#/session/types';

export abstract class SessionPluginsMixin extends SessionGoalsUltraworkMixin {
  async listMcpServers(): Promise<readonly McpServerInfo[]> {
    this.ensureOpen();
    return this.rpc.listMcpServers({ sessionId: this.id });
  }

  async getMcpStartupMetrics(): Promise<McpStartupMetrics> {
    this.ensureOpen();
    return this.rpc.getMcpStartupMetrics({ sessionId: this.id });
  }

  async reconnectMcpServer(name: string): Promise<void> {
    this.ensureOpen();
    await this.rpc.reconnectMcpServer({ sessionId: this.id, name });
  }

  async listPlugins(): Promise<readonly PluginSummary[]> {
    this.ensureOpen();
    return this.rpc.listPlugins();
  }

  async installPlugin(source: string): Promise<PluginSummary> {
    this.ensureOpen();
    return this.rpc.installPlugin(source);
  }

  async setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    this.ensureOpen();
    await this.rpc.setPluginEnabled(id, enabled);
  }

  async setPluginMcpServerEnabled(
    id: string,
    server: string,
    enabled: boolean,
  ): Promise<void> {
    this.ensureOpen();
    await this.rpc.setPluginMcpServerEnabled(id, server, enabled);
  }

  async removePlugin(id: string): Promise<void> {
    this.ensureOpen();
    await this.rpc.removePlugin(id);
  }

  async reloadPlugins(): Promise<ReloadSummary> {
    this.ensureOpen();
    return this.rpc.reloadPlugins();
  }

  async getPluginInfo(id: string): Promise<PluginInfo> {
    this.ensureOpen();
    return this.rpc.getPluginInfo(id);
  }

  async activateSkill(name: string, args?: string | undefined): Promise<void> {
    this.ensureOpen();
    const skillName = normalizeRequiredString(
      name,
      'Skill name cannot be empty',
      ErrorCodes.SKILL_NAME_EMPTY,
    );
    const skillArgs = normalizeOptionalString(args);
    await this.rpc.activateSkill({
      sessionId: this.id,
      name: skillName,
      ...(skillArgs !== undefined ? { args: skillArgs } : {}),
    });
  }

  async activatePluginCommand(
    pluginId: string,
    commandName: string,
    args?: string | undefined,
  ): Promise<void> {
    this.ensureOpen();
    const normalizedPluginId = normalizeRequiredString(
      pluginId,
      'Plugin id cannot be empty',
      ErrorCodes.REQUEST_INVALID,
    );
    const normalizedCommandName = normalizeRequiredString(
      commandName,
      'Plugin command name cannot be empty',
      ErrorCodes.REQUEST_INVALID,
    );
    const commandArgs = normalizeOptionalString(args);
    await this.rpc.activatePluginCommand({
      sessionId: this.id,
      pluginId: normalizedPluginId,
      commandName: normalizedCommandName,
      ...(commandArgs !== undefined ? { args: commandArgs } : {}),
    });
  }
}
