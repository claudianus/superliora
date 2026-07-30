/**
 * Claude Code–canonical plugin model.
 *
 * Disk packages and component kinds follow Claude's plugin reference.
 * SuperLiora engines (HookEngine, BackgroundManager, MCP, TUI themes, …)
 * are host backends — not a parallel plugin schema.
 */

/** Claude install scopes we host today. `managed` reserved for org policy later. */
export type PluginScope = 'user' | 'project' | 'local' | 'session';

/** First-class Claude plugin components. */
export const PLUGIN_COMPONENT_KINDS = [
  'skills',
  'commands',
  'agents',
  'hooks',
  'mcpServers',
  'lspServers',
  'monitors',
  'bin',
  'themes',
  'outputStyles',
  'settings',
  'userConfig',
  'workflows',
  'channels',
  'dependencies',
] as const;

export type PluginComponentKind = (typeof PLUGIN_COMPONENT_KINDS)[number];

/**
 * Components that already have a SuperLiora host backend wired through
 * {@link PluginManager} / session create. Others are discovered/parsed in
 * later slices and stay inert until their host lands.
 */
export const HOSTED_PLUGIN_COMPONENT_KINDS = [
  'skills',
  'commands',
  'agents',
  'hooks',
  'mcpServers',
  'bin',
  'monitors',
  'userConfig',
  'settings',
  'outputStyles',
  'lspServers',
  'dependencies',
  'themes',
  'workflows',
  'channels',
] as const satisfies readonly PluginComponentKind[];

export type HostedPluginComponentKind = (typeof HOSTED_PLUGIN_COMPONENT_KINDS)[number];

/** Which Claude components are present on a materialized package. */
export type PluginComponentPresence = Readonly<Partial<Record<PluginComponentKind, boolean>>>;

/**
 * Claude-shaped view of an installed/enabled package for PluginHost.
 * Built from {@link PluginRecord} without changing the on-disk install store.
 */
export interface PluginPackageView {
  readonly id: string;
  readonly scope: PluginScope;
  readonly root: string;
  readonly enabled: boolean;
  readonly version?: string;
  readonly displayName: string;
  readonly components: PluginComponentPresence;
}

export function componentPresenceFromManifest(input: {
  readonly skills: readonly unknown[];
  readonly commands: readonly unknown[];
  readonly agents: readonly unknown[];
  readonly hooks: readonly unknown[];
  readonly mcpServers?: Readonly<Record<string, unknown>>;
  readonly binDir?: string;
  readonly hasLsp?: boolean;
  readonly hasMonitors?: boolean;
  readonly hasThemes?: boolean;
  readonly hasOutputStyles?: boolean;
  readonly hasSettings?: boolean;
  readonly hasUserConfig?: boolean;
  readonly hasWorkflows?: boolean;
  readonly hasChannels?: boolean;
  readonly hasDependencies?: boolean;
}): PluginComponentPresence {
  return {
    skills: input.skills.length > 0,
    commands: input.commands.length > 0,
    agents: input.agents.length > 0,
    hooks: input.hooks.length > 0,
    mcpServers: input.mcpServers !== undefined && Object.keys(input.mcpServers).length > 0,
    bin: input.binDir !== undefined,
    lspServers: input.hasLsp === true,
    monitors: input.hasMonitors === true,
    themes: input.hasThemes === true,
    outputStyles: input.hasOutputStyles === true,
    settings: input.hasSettings === true,
    userConfig: input.hasUserConfig === true,
    workflows: input.hasWorkflows === true,
    channels: input.hasChannels === true,
    dependencies: input.hasDependencies === true,
  };
}
