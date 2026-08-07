/**
 * Plugin RPC delegation for `SDKRpcClientBase` — extracted from rpc.ts.
 */

import type {
  PluginCommandDef,
  PluginInfo,
  PluginSummary,
  PluginThemeDef,
  ReloadSummary,
} from '#/session/types';

import type {
  ActivatePluginCommandRpcInput,
  ActivateSkillRpcInput,
  SessionIdRpcInput,
} from './rpc-types';
import { SDKRpcClientGoalsMixin } from './rpc-goals-mixin';

export abstract class SDKRpcClientPluginsMixin extends SDKRpcClientGoalsMixin {
  async listPlugins(): Promise<readonly PluginSummary[]> {
    const rpc = await this.getRpc();
    return rpc.listPlugins({});
  }

  async installPlugin(source: string): Promise<PluginSummary> {
    const rpc = await this.getRpc();
    return rpc.installPlugin({ source });
  }

  async setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.setPluginEnabled({ id, enabled });
  }

  async setPluginMcpServerEnabled(
    id: string,
    server: string,
    enabled: boolean,
  ): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.setPluginMcpServerEnabled({ id, server, enabled });
  }

  async removePlugin(id: string): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.removePlugin({ id });
  }

  async reloadPlugins(): Promise<ReloadSummary> {
    const rpc = await this.getRpc();
    return rpc.reloadPlugins({});
  }

  async getPluginInfo(id: string): Promise<PluginInfo> {
    const rpc = await this.getRpc();
    return rpc.getPluginInfo({ id });
  }

  async listPluginThemes(): Promise<readonly PluginThemeDef[]> {
    const rpc = await this.getRpc();
    return rpc.listPluginThemes({});
  }

  async activateSkill(input: ActivateSkillRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.activateSkill({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      name: input.name,
      args: input.args,
    });
  }

  async activatePluginCommand(input: ActivatePluginCommandRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.activatePluginCommand({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      pluginId: input.pluginId,
      commandName: input.commandName,
      args: input.args,
    });
  }

  async listPluginCommands(input: SessionIdRpcInput): Promise<readonly PluginCommandDef[]> {
    const rpc = await this.getRpc();
    return rpc.listPluginCommands({ sessionId: input.sessionId });
  }
}
