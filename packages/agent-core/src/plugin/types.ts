import type { McpServerConfig } from '../config/schema';
import type { HookDef } from '../session/hooks/types';
import type { ResolvedAgentProfile } from '../profile/types';
import type { PluginScope } from './canon';

export type { PluginScope };

export type PluginDiagnosticSeverity = 'error' | 'warn' | 'info';

export interface PluginDiagnostic {
  readonly severity: PluginDiagnosticSeverity;
  readonly message: string;
}

export interface PluginAuthor {
  readonly name?: string;
  readonly email?: string;
  readonly url?: string;
}

/** Normalized Claude Code plugin package (resolved absolute paths). */
export interface PluginManifest {
  readonly name: string;
  readonly displayName?: string;
  readonly version?: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly author?: PluginAuthor;
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly defaultEnabled?: boolean;
  /** Absolute skill root directories. */
  readonly skills: readonly string[];
  /** Absolute markdown command files. */
  readonly commands: readonly PluginCommandEntry[];
  /** Absolute agent markdown files. */
  readonly agents: readonly PluginAgentEntry[];
  readonly mcpServers?: Readonly<Record<string, McpServerConfig>>;
  /** Runtime hook defs adapted from Claude nested schema (all action types). */
  readonly hooks: readonly HookDef[];
  /** Absolute bin directory when present. */
  readonly binDir?: string;
  /** Claude monitors armed at session start when enabled. */
  readonly monitors: readonly PluginMonitorDef[];
  /** Claude userConfig field schema (values live in capabilities). */
  readonly userConfig?: PluginUserConfigSchema;
  /** Absolute path to plugin settings.json when present. */
  readonly settingsPath?: string;
  /** Absolute themes directory when present. */
  readonly themesDir?: string;
  /** Absolute outputStyles directory when present. */
  readonly outputStylesDir?: string;
  /** Absolute LSP servers config path when present. */
  readonly lspServersPath?: string;
  /** Absolute workflows directory when present. */
  readonly workflowsDir?: string;
  /** Absolute channels config path/dir marker when present. */
  readonly channelsPath?: string;
  /** Parsed Claude channels bound to MCP servers. */
  readonly channels?: readonly PluginChannelDef[];
  /** Declared plugin dependencies (marketplace ids → version range). */
  readonly dependencies?: Readonly<Record<string, string>>;
}

export interface PluginChannelDef {
  readonly server: string;
  readonly userConfig?: Readonly<Record<string, unknown>>;
}

export interface PluginMonitorDef {
  readonly name: string;
  readonly command: string;
  readonly description?: string;
  /** Only `always` (or omitted) is armed today. */
  readonly when?: string;
}

export interface PluginUserConfigField {
  readonly type: 'string' | 'number' | 'boolean';
  readonly title?: string;
  readonly description?: string;
  readonly default?: unknown;
  readonly sensitive?: boolean;
  readonly required?: boolean;
}

export type PluginUserConfigSchema = Readonly<Record<string, PluginUserConfigField>>;

export interface PluginMcpServerState {
  readonly enabled: boolean;
}

export interface PluginCapabilityState {
  readonly mcpServers?: Readonly<Record<string, PluginMcpServerState>>;
  /** Persisted non-secret userConfig values (stringified). */
  readonly userConfig?: Readonly<Record<string, string>>;
  /** True when installed only to satisfy another plugin's dependencies. */
  readonly autoInstalled?: boolean;
}

export interface PluginMcpServerInfo {
  readonly name: string;
  readonly runtimeName: string;
  readonly enabled: boolean;
  readonly transport: 'stdio' | 'http' | 'sse';
  readonly command?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly url?: string;
  readonly envKeys?: readonly string[];
  readonly headerKeys?: readonly string[];
}

export interface PluginCommandDef {
  readonly pluginId: string;
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly path: string;
}

export interface PluginCommandEntry {
  readonly path: string;
  readonly name: string;
}

export interface PluginAgentEntry {
  readonly path: string;
  readonly name: string;
}

export interface PluginAgentDef {
  readonly pluginId: string;
  readonly name: string;
  /** Namespaced id used as Agent tool `subagent_type` (`plugin:agent`). */
  readonly profileName: string;
  readonly description?: string;
  readonly path: string;
  readonly profile: ResolvedAgentProfile;
  /** Claude agent frontmatter fields honored by the host when spawning. */
  readonly model?: string;
  readonly effort?: string;
  readonly maxTurns?: number;
  readonly skills?: readonly string[];
  readonly memory?: string | boolean;
  readonly background?: boolean;
  readonly isolation?: string;
}

export type PluginManifestKind = 'claude-plugin' | 'claude-autodiscover';
export type PluginSource = 'local-path' | 'zip-url' | 'github';
export type PluginState = 'ok' | 'error';

export interface PluginGithubRef {
  readonly kind: 'branch' | 'tag' | 'sha';
  readonly value: string;
}

export interface PluginGithubMetadata {
  readonly owner: string;
  readonly repo: string;
  readonly ref: PluginGithubRef;
  readonly installedSha?: string;
}

export interface PluginRecord {
  readonly id: string;
  readonly root: string;
  readonly source: PluginSource;
  readonly enabled: boolean;
  readonly state: PluginState;
  /** Claude install scope. Mutators persist only `user`. */
  readonly scope: PluginScope;
  readonly installedAt: string;
  readonly updatedAt?: string;
  readonly originalSource?: string;
  readonly capabilities?: PluginCapabilityState;
  readonly github?: PluginGithubMetadata;
  readonly skillCount: number;
  readonly agentCount: number;
  readonly manifest?: PluginManifest;
  readonly manifestKind?: PluginManifestKind;
  readonly manifestPath?: string;
  readonly diagnostics: readonly PluginDiagnostic[];
}

export interface PluginSummary {
  readonly id: string;
  readonly displayName: string;
  readonly version?: string;
  readonly enabled: boolean;
  readonly state: PluginState;
  readonly scope: PluginScope;
  readonly skillCount: number;
  readonly mcpServerCount: number;
  readonly enabledMcpServerCount: number;
  readonly hookCount: number;
  readonly commandCount: number;
  readonly agentCount: number;
  readonly hasErrors: boolean;
  readonly source: PluginSource;
  readonly originalSource?: string;
  readonly github?: PluginGithubMetadata;
}

export interface PluginInfo extends PluginSummary {
  readonly root: string;
  readonly installedAt: string;
  readonly updatedAt?: string;
  readonly manifestKind?: PluginManifestKind;
  readonly manifestPath?: string;
  readonly manifest?: PluginManifest;
  readonly mcpServers: readonly PluginMcpServerInfo[];
  readonly diagnostics: readonly PluginDiagnostic[];
}

/** Legacy session-start hook for Kimi-format plugins; Claude plugins use runtime wiring instead. */
export interface EnabledPluginSessionStart {
  readonly pluginId: string;
  readonly skillName: string;
}

export interface ReloadSummary {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly errors: ReadonlyArray<{ readonly id: string; readonly message: string }>;
}

/** Claude Code plugin ids: kebab-case, optional underscores. */
export const PLUGIN_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function normalizePluginId(name: string): string {
  return name.toLowerCase();
}

export function pluginAgentProfileName(pluginId: string, agentName: string): string {
  return `${normalizePluginId(pluginId)}:${agentName}`;
}

export function pluginMcpRuntimeName(pluginId: string, serverName: string): string {
  return `plugin:${normalizePluginId(pluginId)}:${serverName}`;
}
