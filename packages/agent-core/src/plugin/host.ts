import type { McpServerConfig } from '../config/schema';
import type { HookDef } from '../session/hooks';
import type { SkillRoot } from '../skill';
import { componentPresenceFromManifest, type PluginPackageView } from './canon';
import { resolvePluginDependencies } from './dependencies';
import { renderChannelsReminder } from './channels';
import { loadPluginLspServers, type PluginLspServerDef } from './lsp-bridge';
import type { PluginManager } from './manager';
import {
  loadPluginOutputStyles,
  renderOutputStylesReminder,
  type PluginOutputStyle,
} from './output-styles';
import {
  mergeEnabledSettingsOverlays,
  type PluginSettingsOverlay,
} from './settings-overlay';
import { loadPluginThemes, type PluginThemeDef } from './themes';
import type {
  PluginAgentDef,
  PluginChannelDef,
  PluginCommandDef,
  PluginDiagnostic,
  PluginManifest,
  PluginMonitorDef,
  PluginRecord,
  PluginUserConfigSchema,
} from './types';
import { loadPluginWorkflows, renderWorkflowScriptsReminder } from './workflows';

/**
 * Session-facing host over {@link PluginManager}.
 *
 * Today this is a thin façade so call sites can migrate off scattered
 * `plugins.enabled*()` wiring. Later slices attach monitors/LSP/userConfig
 * here without changing `/plugins` UX.
 */
export class PluginHost {
  constructor(private readonly manager: PluginManager) {}

  /** Claude package views for all installed plugins (any enable state). */
  packages(): readonly PluginPackageView[] {
    return this.manager.list().map((record) => this.toPackageView(record));
  }

  /** Enabled packages only — what a session should host. */
  enabledPackages(): readonly PluginPackageView[] {
    return this.packages().filter((pkg) => pkg.enabled && this.manager.get(pkg.id)?.state === 'ok');
  }

  skillRoots(): readonly SkillRoot[] {
    return this.manager.pluginSkillRoots();
  }

  mcpServers(): Record<string, McpServerConfig> {
    return this.manager.enabledMcpServers();
  }

  hooks(): readonly HookDef[] {
    return this.manager.enabledHooks();
  }

  /** Enabled monitors with env for session arming. */
  monitors(): ReadonlyArray<{
    readonly pluginId: string;
    readonly monitor: PluginMonitorDef;
    readonly env: Readonly<Record<string, string>>;
  }> {
    return this.manager.enabledMonitors();
  }

  userConfigSchema(pluginId: string): PluginUserConfigSchema | undefined {
    return this.manager.get(pluginId)?.manifest?.userConfig;
  }

  async commands(): Promise<readonly PluginCommandDef[]> {
    return this.manager.enabledCommands();
  }

  async agents(): Promise<readonly PluginAgentDef[]> {
    return this.manager.enabledAgents();
  }

  binDirs(): readonly string[] {
    return this.manager.enabledBinDirs();
  }

  enabledManifests(): readonly PluginManifest[] {
    const out: PluginManifest[] = [];
    for (const pkg of this.enabledPackages()) {
      const manifest = this.manager.get(pkg.id)?.manifest;
      if (manifest !== undefined) out.push(manifest);
    }
    return out;
  }

  async settingsOverlay(): Promise<PluginSettingsOverlay> {
    return mergeEnabledSettingsOverlays(this.enabledManifests());
  }

  async outputStyles(): Promise<readonly PluginOutputStyle[]> {
    const out: PluginOutputStyle[] = [];
    for (const pkg of this.enabledPackages()) {
      const manifest = this.manager.get(pkg.id)?.manifest;
      if (manifest?.outputStylesDir === undefined) continue;
      out.push(
        ...(await loadPluginOutputStyles({
          pluginId: pkg.id,
          outputStylesDir: manifest.outputStylesDir,
        })),
      );
    }
    return out;
  }

  async outputStylesReminder(): Promise<string | undefined> {
    return renderOutputStylesReminder(await this.outputStyles());
  }

  themeRoots(): ReadonlyArray<{ readonly pluginId: string; readonly themesDir: string }> {
    const out: Array<{ pluginId: string; themesDir: string }> = [];
    for (const pkg of this.enabledPackages()) {
      const themesDir = this.manager.get(pkg.id)?.manifest?.themesDir;
      if (themesDir !== undefined) out.push({ pluginId: pkg.id, themesDir });
    }
    return out;
  }

  /** Enabled-plugin Claude themes for the TUI `/theme` host. */
  async themes(): Promise<readonly PluginThemeDef[]> {
    const out: PluginThemeDef[] = [];
    for (const root of this.themeRoots()) {
      out.push(
        ...(await loadPluginThemes({
          pluginId: root.pluginId,
          themesDir: root.themesDir,
        })),
      );
    }
    return out;
  }

  async lspServers(): Promise<
    ReadonlyArray<{
      readonly pluginId: string;
      readonly servers: readonly PluginLspServerDef[];
      readonly diagnostics: readonly PluginDiagnostic[];
    }>
  > {
    const out: Array<{
      pluginId: string;
      servers: readonly PluginLspServerDef[];
      diagnostics: PluginDiagnostic[];
    }> = [];
    for (const pkg of this.enabledPackages()) {
      const path = this.manager.get(pkg.id)?.manifest?.lspServersPath;
      if (path === undefined) continue;
      const diagnostics: PluginDiagnostic[] = [];
      const servers = await loadPluginLspServers({ lspServersPath: path, diagnostics });
      out.push({ pluginId: pkg.id, servers, diagnostics });
    }
    return out;
  }

  dependencyDiagnostics(): readonly PluginDiagnostic[] {
    const diagnostics: PluginDiagnostic[] = [];
    const installed = this.manager.list();
    for (const record of installed) {
      if (!record.enabled || record.manifest?.dependencies === undefined) continue;
      const resolved = resolvePluginDependencies({
        dependencies: record.manifest.dependencies,
        installed,
      });
      diagnostics.push(
        ...resolved.diagnostics.map((d) => ({
          ...d,
          message: `[${record.id}] ${d.message}`,
        })),
      );
    }
    return diagnostics;
  }

  channels(): ReadonlyArray<{
    readonly pluginId: string;
    readonly channels: readonly PluginChannelDef[];
  }> {
    const out: Array<{ pluginId: string; channels: readonly PluginChannelDef[] }> = [];
    for (const pkg of this.enabledPackages()) {
      const channels = this.manager.get(pkg.id)?.manifest?.channels;
      if (channels !== undefined && channels.length > 0) {
        out.push({ pluginId: pkg.id, channels });
      }
    }
    return out;
  }

  async channelsReminder(): Promise<string | undefined> {
    const blocks: string[] = [];
    for (const bundle of this.channels()) {
      const text = renderChannelsReminder(bundle);
      if (text !== undefined) blocks.push(text);
    }
    return blocks.length > 0 ? blocks.join('\n\n') : undefined;
  }

  async workflowScriptsReminder(): Promise<string | undefined> {
    const blocks: string[] = [];
    for (const pkg of this.enabledPackages()) {
      const workflowsDir = this.manager.get(pkg.id)?.manifest?.workflowsDir;
      if (workflowsDir === undefined) continue;
      const loaded = await loadPluginWorkflows({
        pluginId: pkg.id,
        workflowsDir,
      });
      const text = renderWorkflowScriptsReminder({
        pluginId: pkg.id,
        scriptNames: loaded.scriptNames,
      });
      if (text !== undefined) blocks.push(text);
    }
    return blocks.length > 0 ? blocks.join('\n\n') : undefined;
  }

  /** Flattened LSP server defs for the session live bridge. */
  async flatLspServers(): Promise<readonly PluginLspServerDef[]> {
    const bundles = await this.lspServers();
    return bundles.flatMap((bundle) => bundle.servers);
  }

  private toPackageView(record: PluginRecord): PluginPackageView {
    const manifest = record.manifest;
    return {
      id: record.id,
      scope: record.scope,
      root: record.root,
      enabled: record.enabled,
      version: manifest?.version,
      displayName: manifest?.displayName ?? record.id,
      components: componentPresenceFromManifest({
        skills: manifest?.skills ?? [],
        commands: manifest?.commands ?? [],
        agents: manifest?.agents ?? [],
        hooks: manifest?.hooks ?? [],
        mcpServers: manifest?.mcpServers,
        binDir: manifest?.binDir,
        hasMonitors: (manifest?.monitors.length ?? 0) > 0,
        hasUserConfig: manifest?.userConfig !== undefined,
        hasSettings: manifest?.settingsPath !== undefined,
        hasThemes: manifest?.themesDir !== undefined,
        hasOutputStyles: manifest?.outputStylesDir !== undefined,
        hasLsp: manifest?.lspServersPath !== undefined,
        hasWorkflows: manifest?.workflowsDir !== undefined,
        hasChannels:
          (manifest?.channels?.length ?? 0) > 0 || manifest?.channelsPath !== undefined,
        hasDependencies: manifest?.dependencies !== undefined,
      }),
    };
  }
}
