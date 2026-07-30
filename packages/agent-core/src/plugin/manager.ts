import { cp, mkdir, mkdtemp, realpath, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { McpServerConfig } from '../config/schema';
import type { HookDef } from '../session/hooks';
import { discoverSkills, type SkillRoot } from '../skill';
import { loadPluginAgents } from './agents';
import { downloadZip, extractZip } from './archive';
import { loadPluginCommand } from './commands';
import { expandPluginPlaceholders, expandRecordValues } from './expand';
import { resolveGithubSource } from './github-resolver';
import { parseManifest, type ParsedManifestResult } from './manifest';
import { resolveInstallSource } from './source';
import {
  readInstalled,
  readLocalInstalled,
  readProjectInstalled,
  writeInstalled,
  writeLocalInstalled,
  type InstalledRecord,
} from './store';
import {
  type PluginAgentDef,
  type PluginCapabilityState,
  type PluginCommandDef,
  type EnabledPluginSessionStart,
  type PluginGithubMetadata,
  type PluginInfo,
  type PluginMonitorDef,
  type PluginMcpServerInfo,
  type PluginRecord,
  type PluginScope,
  type PluginSource,
  type PluginSummary,
  type ReloadSummary,
  normalizePluginId,
  pluginMcpRuntimeName,
} from './types';
import { resolvePluginDependencies } from './dependencies';
import { resolveUserConfigValues, userConfigEnvVars } from './user-config';
import { loadPluginWorkflows } from './workflows';

const NODE_FALLBACK_SUBCOMMAND = '__plugin_run_node';

export interface PluginManagerOptions {
  readonly kimiHomeDir: string;
  readonly projectDir?: string;
  /** Ephemeral session plugin roots (`--plugin-dir`); not persisted. */
  readonly sessionPluginDirs?: readonly string[];
  /**
   * Resolve a marketplace plugin id to an install source.
   * When set, missing declared dependencies are auto-installed.
   */
  readonly resolveMarketplaceSource?: (
    pluginId: string,
  ) => Promise<string | undefined> | string | undefined;
}

const MAX_DEP_INSTALL_DEPTH = 5;

export class PluginManager {
  private readonly kimiHomeDir: string;
  private readonly projectDir: string;
  private readonly sessionPluginDirs: readonly string[];
  private readonly resolveMarketplaceSource:
    | ((pluginId: string) => Promise<string | undefined> | string | undefined)
    | undefined;
  private records = new Map<string, PluginRecord>();
  private installingDeps = false;

  constructor(options: PluginManagerOptions) {
    this.kimiHomeDir = options.kimiHomeDir;
    this.projectDir = options.projectDir ?? process.cwd();
    this.sessionPluginDirs = options.sessionPluginDirs ?? [];
    this.resolveMarketplaceSource = options.resolveMarketplaceSource;
  }

  async load(): Promise<void> {
    const next = new Map<string, PluginRecord>();

    const userFile = await readInstalled(this.kimiHomeDir);
    for (const entry of userFile.plugins) {
      next.set(entry.id, await this.materialize(entry, 'user'));
    }

    try {
      const projectFile = await readProjectInstalled(this.projectDir);
      for (const entry of projectFile.plugins) {
        // Project wins over user for the same id (Claude project overlay).
        next.set(entry.id, await this.materialize(entry, 'project'));
      }
    } catch (error) {
      // Corrupt project file should not block user plugins.
      const message = error instanceof Error ? error.message : String(error);
      void message;
    }

    try {
      const localFile = await readLocalInstalled(this.projectDir);
      for (const entry of localFile.plugins) {
        // Local wins over project/user (Claude local / gitignored overlay).
        next.set(entry.id, await this.materialize(entry, 'local'));
      }
    } catch {
      // Corrupt local file should not block other scopes.
    }

    for (const dir of this.sessionPluginDirs) {
      const record = await this.materializeSessionDir(dir);
      if (record !== undefined) {
        next.set(record.id, record);
      }
    }

    this.records = next;
    await this.ensureAllPluginDataDirs();
  }

  list(): readonly PluginRecord[] {
    return [...this.records.values()].toSorted((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): PluginRecord | undefined {
    return this.records.get(normalizePluginId(id));
  }

  async install(source: string): Promise<PluginRecord> {
    const resolved = resolveInstallSource(source);

    let normalizedRoot: string;
    let originalSource: string;
    let sourceType: PluginSource;
    let parsed: ParsedManifestResult;
    let id: string;
    let github: PluginGithubMetadata | undefined;

    if (resolved.kind === 'local-path') {
      const sourceRoot = await normalizeInstallRoot(resolved.path);
      originalSource = resolved.path;
      sourceType = 'local-path';
      parsed = await this.parse(sourceRoot);
      if (parsed.manifest === undefined) {
        const msg = parsed.diagnostics.find((d) => d.severity === 'error')?.message ?? 'no manifest';
        throw new Error(`Cannot install plugin at ${sourceRoot}: ${msg}`);
      }
      id = normalizePluginId(parsed.manifest.name);
      const versionKey = parsed.manifest.version ?? 'local';
      normalizedRoot = await copyPluginToCache(this.kimiHomeDir, id, versionKey, sourceRoot);
      parsed = await this.parse(normalizedRoot);
    } else {
      let zipUrl: string;
      if (resolved.kind === 'github') {
        const githubResolution = await resolveGithubSource(resolved);
        zipUrl = githubResolution.tarballUrl;
        originalSource = source.trim();
        sourceType = 'github';
        github = {
          owner: resolved.owner,
          repo: resolved.repo,
          ref: githubResolution.ref,
        };
      } else {
        zipUrl = resolved.path;
        originalSource = resolved.path;
        sourceType = 'zip-url';
      }
      const buffer = await downloadZip(zipUrl);
      const tmpDir = await mkdtemp(path.join(tmpdir(), 'claude-plugin-zip-'));
      try {
        const detectedRoot = await extractZip(buffer, tmpDir);
        parsed = await this.parse(detectedRoot);
        if (parsed.manifest === undefined) {
          const msg = parsed.diagnostics.find((d) => d.severity === 'error')?.message ?? 'no manifest';
          throw new Error(`Cannot install plugin from ${originalSource}: ${msg}`);
        }
        id = normalizePluginId(parsed.manifest.name);
        const versionKey =
          parsed.manifest.version ??
          (github?.ref.kind === 'sha' ? github.ref.value.slice(0, 12) : 'latest');
        normalizedRoot = await copyPluginToCache(this.kimiHomeDir, id, versionKey, detectedRoot);
        parsed = await this.parse(normalizedRoot);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    }

    if (parsed.manifest === undefined) {
      const msg = parsed.diagnostics.find((d) => d.severity === 'error')?.message ?? 'no manifest';
      throw new Error(`Cannot install plugin at ${normalizedRoot}: ${msg}`);
    }
    id = normalizePluginId(parsed.manifest.name);
    const existing = this.records.get(id);
    const now = new Date().toISOString();
    const defaultEnabled = parsed.manifest.defaultEnabled !== false;
    const record = await recordFrom({
      id,
      root: normalizedRoot,
      scope: 'user',
      enabled: existing?.scope === 'user' ? (existing.enabled ?? defaultEnabled) : defaultEnabled,
      installedAt: existing?.scope === 'user' ? (existing.installedAt ?? now) : now,
      updatedAt: now,
      originalSource,
      source: sourceType,
      capabilities: existing?.scope === 'user' ? existing.capabilities : undefined,
      github,
      parsed,
    });
    this.records.set(id, record);
    await this.ensurePluginDataDir(id);
    await this.persist();

    if (!this.installingDeps) {
      await this.installMissingDependencies(id, new Set([id]), 0);
    }

    const refreshed = this.records.get(id)!;
    const depCheck = resolvePluginDependencies({
      dependencies: refreshed.manifest?.dependencies,
      installed: [...this.records.values()],
    });
    if (depCheck.diagnostics.length > 0) {
      this.records.set(id, {
        ...refreshed,
        diagnostics: [...refreshed.diagnostics, ...depCheck.diagnostics],
      });
      await this.persist();
    }
    return this.records.get(id)!;
  }

  /**
   * Auto-install missing marketplace dependencies for a plugin.
   * Version mismatches stay warnings only (no forced reinstall).
   */
  private async installMissingDependencies(
    pluginId: string,
    seen: Set<string>,
    depth: number,
  ): Promise<void> {
    if (this.resolveMarketplaceSource === undefined) return;
    if (depth >= MAX_DEP_INSTALL_DEPTH) return;
    const record = this.records.get(normalizePluginId(pluginId));
    if (record?.manifest?.dependencies === undefined) return;

    const depCheck = resolvePluginDependencies({
      dependencies: record.manifest.dependencies,
      installed: [...this.records.values()],
    });
    for (const missingId of depCheck.missingIds) {
      if (seen.has(missingId)) continue;
      seen.add(missingId);
      const source = await this.resolveMarketplaceSource(missingId);
      if (source === undefined || source.trim() === '') {
        continue;
      }
      this.installingDeps = true;
      try {
        const installed = await this.install(source);
        this.records.set(installed.id, {
          ...installed,
          capabilities: { ...installed.capabilities, autoInstalled: true },
        });
        await this.persist();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const current = this.records.get(normalizePluginId(pluginId));
        if (current !== undefined) {
          this.records.set(current.id, {
            ...current,
            diagnostics: [
              ...current.diagnostics,
              {
                severity: 'warn',
                message: `Failed to auto-install dependency "${missingId}": ${message}`,
              },
            ],
          });
          await this.persist();
        }
        continue;
      } finally {
        this.installingDeps = false;
      }
      await this.installMissingDependencies(missingId, seen, depth + 1);
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const current = this.requireMutable(id);
    if (current.enabled === enabled) return;
    const now = new Date().toISOString();
    this.records.set(current.id, { ...current, enabled, updatedAt: now });
    await this.ensurePluginDataDir(current.id);
    await this.persist();
  }

  async setMcpServerEnabled(id: string, server: string, enabled: boolean): Promise<void> {
    const current = this.requireMutable(id);
    const key = current.id;
    if (current.manifest?.mcpServers?.[server] === undefined) {
      throw new Error(`Plugin "${id}" does not declare MCP server "${server}"`);
    }
    const currentMcpServers = current.capabilities?.mcpServers ?? {};
    const nextCapabilities: PluginCapabilityState = {
      ...current.capabilities,
      mcpServers: {
        ...currentMcpServers,
        [server]: { enabled },
      },
    };
    this.records.set(key, {
      ...current,
      capabilities: nextCapabilities,
      updatedAt: new Date().toISOString(),
    });
    await this.persist();
  }

  async setUserConfigValues(
    id: string,
    values: Readonly<Record<string, string>>,
  ): Promise<void> {
    const current = this.requireMutable(id);
    if (current.manifest?.userConfig === undefined) {
      throw new Error(`Plugin "${id}" does not declare userConfig`);
    }
    const schema = current.manifest.userConfig;
    const nextValues: Record<string, string> = {
      ...(current.capabilities?.userConfig ?? {}),
    };
    for (const [field, value] of Object.entries(values)) {
      if (schema[field] === undefined) {
        throw new Error(`Plugin "${id}" has no userConfig field "${field}"`);
      }
      nextValues[field] = value;
    }
    this.records.set(current.id, {
      ...current,
      capabilities: {
        ...current.capabilities,
        userConfig: nextValues,
      },
      updatedAt: new Date().toISOString(),
    });
    await this.persist();
  }

  async remove(id: string, options: { readonly keepData?: boolean } = {}): Promise<void> {
    const current = this.requireMutable(id);
    this.records.delete(normalizePluginId(id));
    await this.persist();
    if (options.keepData !== true) {
      // Keep Claude PLUGIN_DATA by default for reinstall friendliness; only
      // delete when explicitly requested via keepData: false from prune paths.
      void current;
    }
  }

  /**
   * Remove user-scoped plugins that were only pulled in as dependencies and
   * are no longer required by any remaining installed plugin.
   */
  async pruneOrphanDependencies(): Promise<readonly string[]> {
    const required = new Set<string>();
    for (const record of this.records.values()) {
      if (record.manifest?.dependencies === undefined) continue;
      for (const depId of Object.keys(record.manifest.dependencies)) {
        required.add(normalizePluginId(depId));
      }
    }
    const removed: string[] = [];
    for (const record of [...this.records.values()]) {
      if (record.scope !== 'user') continue;
      if (record.originalSource !== undefined && !record.originalSource.includes('marketplace')) {
        // Heuristic: only prune auto-installed marketplace deps marked via source.
      }
      if (required.has(record.id)) continue;
      // Only prune plugins that nothing depends on and that look like dep installs
      // (no direct user source path uniqueness). Skip if any other plugin lists it.
      const depended = [...this.records.values()].some(
        (other) =>
          other.id !== record.id &&
          other.manifest?.dependencies !== undefined &&
          Object.keys(other.manifest.dependencies).some(
            (d) => normalizePluginId(d) === record.id,
          ),
      );
      if (depended) continue;
      // Do not auto-remove plugins the user installed directly (originalSource set
      // to a concrete path/url and not solely as a dependency). Keep conservative:
      // only remove when capabilities flag autoInstalled is set — otherwise no-op.
      if (record.capabilities?.autoInstalled !== true) continue;
      this.records.delete(record.id);
      removed.push(record.id);
    }
    if (removed.length > 0) await this.persist();
    return removed;
  }

  async reload(): Promise<ReloadSummary> {
    const prevIds = new Set(this.records.keys());
    const next = new Map<string, PluginRecord>();
    const errors: Array<{ id: string; message: string }> = [];

    const userFile = await readInstalled(this.kimiHomeDir);
    for (const entry of userFile.plugins) {
      try {
        next.set(entry.id, await this.materialize(entry, 'user'));
      } catch (error) {
        errors.push({ id: entry.id, message: (error as Error).message });
      }
    }

    try {
      const projectFile = await readProjectInstalled(this.projectDir);
      for (const entry of projectFile.plugins) {
        try {
          next.set(entry.id, await this.materialize(entry, 'project'));
        } catch (error) {
          errors.push({ id: entry.id, message: (error as Error).message });
        }
      }
    } catch {
      // Corrupt project file should not block user plugins.
    }

    try {
      const localFile = await readLocalInstalled(this.projectDir);
      for (const entry of localFile.plugins) {
        try {
          next.set(entry.id, await this.materialize(entry, 'local'));
        } catch (error) {
          errors.push({ id: entry.id, message: (error as Error).message });
        }
      }
    } catch {
      // Corrupt local file should not block other scopes.
    }

    for (const dir of this.sessionPluginDirs) {
      try {
        const record = await this.materializeSessionDir(dir);
        if (record !== undefined) next.set(record.id, record);
      } catch (error) {
        errors.push({ id: dir, message: (error as Error).message });
      }
    }

    const added: string[] = [];
    for (const id of next.keys()) if (!prevIds.has(id)) added.push(id);
    const removed: string[] = [];
    for (const id of prevIds) if (!next.has(id)) removed.push(id);
    this.records = next;
    await this.ensureAllPluginDataDirs();
    return { added, removed, errors };
  }

  pluginSkillRoots(): readonly SkillRoot[] {
    const roots: SkillRoot[] = [];
    for (const record of this.records.values()) {
      if (!record.enabled || record.state !== 'ok' || record.manifest === undefined) continue;
      for (const dir of record.manifest.skills) {
        roots.push({
          path: dir,
          source: 'extra',
          plugin: { id: record.id },
        });
      }
    }
    return roots;
  }

  enabledSessionStarts(): readonly EnabledPluginSessionStart[] {
    return [];
  }

  enabledMcpServers(): Record<string, McpServerConfig> {
    const out: Record<string, McpServerConfig> = {};
    for (const record of this.records.values()) {
      if (!record.enabled || record.state !== 'ok' || record.manifest === undefined) continue;
      for (const [name, config] of Object.entries(record.manifest.mcpServers ?? {})) {
        if (!isMcpServerEnabled(record, name, config)) continue;
        out[pluginMcpRuntimeName(record.id, name)] = withPluginMcpRuntime(
          withMcpServerEnabled(config, true),
          record,
          this.kimiHomeDir,
        );
      }
    }
    return out;
  }

  enabledHooks(): readonly HookDef[] {
    const out: HookDef[] = [];
    for (const record of this.records.values()) {
      if (!record.enabled || record.state !== 'ok' || record.manifest === undefined) continue;
      const env = pluginEnv(this.kimiHomeDir, record);
      const expandVars = pluginExpandVars(this.kimiHomeDir, record);
      for (const hook of record.manifest.hooks) {
        out.push({
          ...hook,
          command: expandPluginPlaceholders(hook.command, expandVars),
          url: hook.url === undefined ? undefined : expandPluginPlaceholders(hook.url, expandVars),
          prompt:
            hook.prompt === undefined
              ? undefined
              : expandPluginPlaceholders(hook.prompt, expandVars),
          cwd: record.root,
          env,
        });
      }
    }
    return out;
  }

  enabledMonitors(): ReadonlyArray<{
    readonly pluginId: string;
    readonly monitor: PluginMonitorDef;
    readonly env: Readonly<Record<string, string>>;
  }> {
    const out: Array<{
      pluginId: string;
      monitor: PluginMonitorDef;
      env: Readonly<Record<string, string>>;
    }> = [];
    for (const record of this.records.values()) {
      if (!record.enabled || record.state !== 'ok' || record.manifest === undefined) continue;
      const env = pluginEnv(this.kimiHomeDir, record);
      for (const monitor of record.manifest.monitors) {
        out.push({ pluginId: record.id, monitor, env });
      }
    }
    return out;
  }

  async enabledCommands(): Promise<readonly PluginCommandDef[]> {
    const out: PluginCommandDef[] = [];
    for (const record of this.records.values()) {
      if (!record.enabled || record.state !== 'ok' || record.manifest === undefined) continue;
      for (const entry of record.manifest.commands) {
        const def = await loadPluginCommand({
          commandPath: entry.path,
          pluginId: record.id,
          fallbackName: entry.name,
        });
        if (def !== undefined) out.push(def);
      }
      if (record.manifest.workflowsDir !== undefined) {
        const workflows = await loadPluginWorkflows({
          pluginId: record.id,
          workflowsDir: record.manifest.workflowsDir,
        });
        out.push(...workflows.commands);
      }
    }
    return out;
  }

  async enabledAgents(): Promise<readonly PluginAgentDef[]> {
    const out: PluginAgentDef[] = [];
    for (const record of this.records.values()) {
      if (!record.enabled || record.state !== 'ok' || record.manifest === undefined) continue;
      const agents = await loadPluginAgents({
        pluginId: record.id,
        entries: record.manifest.agents,
      });
      out.push(...agents);
    }
    return out;
  }

  enabledBinDirs(): readonly string[] {
    const out: string[] = [];
    for (const record of this.records.values()) {
      if (!record.enabled || record.state !== 'ok' || record.manifest?.binDir === undefined) continue;
      out.push(record.manifest.binDir);
    }
    return out;
  }

  pluginDataDir(pluginId: string): string {
    return path.join(this.kimiHomeDir, 'plugins', 'data', normalizePluginId(pluginId));
  }

  summaries(): readonly PluginSummary[] {
    return this.list().map((record) => recordToSummary(record));
  }

  info(id: string): PluginInfo | undefined {
    const record = this.get(id);
    return record === undefined ? undefined : recordToInfo(record);
  }

  private parse(pluginRoot: string): Promise<ParsedManifestResult> {
    const idGuess = path.basename(pluginRoot);
    return parseManifest(pluginRoot, {
      projectDir: this.projectDir,
      pluginDataDir: path.join(this.kimiHomeDir, 'plugins', 'data', normalizePluginId(idGuess)),
    });
  }

  private requireMutable(id: string): PluginRecord {
    const key = normalizePluginId(id);
    const current = this.records.get(key);
    if (current === undefined) throw new Error(`Plugin "${id}" is not installed`);
    if (current.scope !== 'user' && current.scope !== 'local') {
      throw new Error(
        `Plugin "${id}" is ${current.scope}-scoped and cannot be changed via /plugins (edit the ${current.scope} install source instead)`,
      );
    }
    return current;
  }

  async ensurePluginDataDir(pluginId: string): Promise<string> {
    const dir = this.pluginDataDir(pluginId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  private async ensureAllPluginDataDirs(): Promise<void> {
    for (const record of this.records.values()) {
      if (!record.enabled) continue;
      await this.ensurePluginDataDir(record.id);
    }
  }

  private async persist(): Promise<void> {
    const toRecord = (scope: 'user' | 'local') =>
      [...this.records.values()]
        .filter((record) => record.scope === scope)
        .map((record) => ({
          id: record.id,
          root: record.root,
          source: record.source,
          enabled: record.enabled,
          installedAt: record.installedAt,
          updatedAt: record.updatedAt,
          originalSource: record.originalSource,
          capabilities: record.capabilities,
          github: record.github,
          scope,
        }));
    await writeInstalled(this.kimiHomeDir, { version: 2, plugins: toRecord('user') });
    const localPlugins = toRecord('local');
    // Avoid creating `.superliora/plugins/installed.local.json` in every cwd
    // when no local-scoped plugins are present (most tests / default installs).
    if (localPlugins.length > 0) {
      await writeLocalInstalled(this.projectDir, { version: 2, plugins: localPlugins });
    }
  }

  private async materialize(
    entry: InstalledRecord,
    scope: PluginScope,
  ): Promise<PluginRecord> {
    const root = await realpath(entry.root).catch(() => entry.root);
    const parsed = await parseManifest(root, {
      projectDir: this.projectDir,
      pluginDataDir: this.pluginDataDir(entry.id),
    });
    return recordFrom({
      id: entry.id,
      root,
      scope,
      enabled: entry.enabled,
      installedAt: entry.installedAt,
      updatedAt: entry.updatedAt,
      originalSource: entry.originalSource,
      capabilities: entry.capabilities,
      github: entry.github,
      source: entry.source,
      parsed,
    });
  }

  private async materializeSessionDir(dir: string): Promise<PluginRecord | undefined> {
    let root: string;
    try {
      root = await normalizeInstallRoot(path.resolve(this.projectDir, dir));
    } catch {
      return undefined;
    }
    const parsed = await this.parse(root);
    if (parsed.manifest === undefined) return undefined;
    const id = normalizePluginId(parsed.manifest.name);
    const now = new Date().toISOString();
    return recordFrom({
      id,
      root,
      scope: 'session',
      enabled: true,
      installedAt: now,
      updatedAt: now,
      originalSource: root,
      source: 'local-path',
      parsed,
    });
  }
}

async function normalizeInstallRoot(rootPath: string): Promise<string> {
  const trimmed = rootPath.trim();
  if (!path.isAbsolute(trimmed)) {
    throw new Error(`Plugin root must be an absolute path (got "${rootPath}")`);
  }
  let resolved: string;
  try {
    resolved = await realpath(trimmed);
  } catch (error) {
    throw new Error(`Plugin root does not exist: ${trimmed}`, { cause: error });
  }
  if (!(await stat(resolved)).isDirectory()) {
    throw new Error(`Plugin root is not a directory: ${trimmed}`);
  }
  return resolved;
}

async function copyPluginToCache(
  kimiHomeDir: string,
  id: string,
  versionKey: string,
  sourceRoot: string,
): Promise<string> {
  const safeVersion = versionKey.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const cacheRoot = path.join(kimiHomeDir, 'plugins', 'cache', id, safeVersion);
  const cacheParent = path.dirname(cacheRoot);
  await mkdir(cacheParent, { recursive: true });
  const stagingRoot = await mkdtemp(path.join(cacheParent, `${safeVersion}-`));
  try {
    await cp(sourceRoot, stagingRoot, { recursive: true });
    await rm(cacheRoot, { recursive: true, force: true });
    await rename(stagingRoot, cacheRoot);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
  return realpath(cacheRoot);
}

async function recordFrom(input: {
  id: string;
  root: string;
  scope: PluginScope;
  enabled: boolean;
  installedAt: string;
  updatedAt?: string;
  originalSource?: string;
  capabilities?: PluginCapabilityState;
  github?: PluginGithubMetadata;
  source?: PluginSource;
  parsed: ParsedManifestResult;
}): Promise<PluginRecord> {
  const { parsed } = input;
  const hasError = parsed.diagnostics.some((d) => d.severity === 'error');
  return {
    id: input.id,
    root: input.root,
    source: input.source ?? 'local-path',
    enabled: input.enabled,
    scope: input.scope,
    state: hasError || parsed.manifest === undefined ? 'error' : 'ok',
    installedAt: input.installedAt,
    updatedAt: input.updatedAt,
    originalSource: input.originalSource,
    capabilities: input.capabilities,
    github: input.github,
    skillCount: await countDiscoveredPluginSkills(input.id, parsed.manifest),
    agentCount: parsed.manifest?.agents.length ?? 0,
    manifest: parsed.manifest,
    manifestKind: parsed.manifestKind,
    manifestPath: parsed.manifestPath,
    diagnostics: parsed.diagnostics,
  };
}

function recordToSummary(record: PluginRecord): PluginSummary {
  return {
    id: record.id,
    displayName: record.manifest?.displayName ?? record.id,
    version: record.manifest?.version,
    enabled: record.enabled,
    state: record.state,
    scope: record.scope,
    skillCount: record.skillCount,
    mcpServerCount: Object.keys(record.manifest?.mcpServers ?? {}).length,
    enabledMcpServerCount: pluginMcpServersInfo(record).filter((server) => server.enabled).length,
    hookCount: record.manifest?.hooks.length ?? 0,
    commandCount: record.manifest?.commands.length ?? 0,
    agentCount: record.agentCount,
    hasErrors: record.diagnostics.some((d) => d.severity === 'error'),
    source: record.source,
    originalSource: record.originalSource,
    github: record.github,
  };
}

async function countDiscoveredPluginSkills(
  pluginId: string,
  manifest: PluginRecord['manifest'],
): Promise<number> {
  const roots = (manifest?.skills ?? []).map(
    (dir) =>
      ({
        path: dir,
        source: 'extra',
        plugin: { id: pluginId },
      }) satisfies SkillRoot,
  );
  if (roots.length === 0) return 0;
  const skills = await discoverSkills({ roots });
  return skills.length;
}

function recordToInfo(record: PluginRecord): PluginInfo {
  return {
    ...recordToSummary(record),
    root: record.root,
    installedAt: record.installedAt,
    updatedAt: record.updatedAt,
    manifestKind: record.manifestKind,
    manifestPath: record.manifestPath,
    manifest: record.manifest,
    mcpServers: pluginMcpServersInfo(record),
    diagnostics: record.diagnostics,
  };
}

function isMcpServerEnabled(
  record: PluginRecord,
  name: string,
  config: McpServerConfig,
): boolean {
  return record.capabilities?.mcpServers?.[name]?.enabled ?? config.enabled !== false;
}

function pluginMcpServersInfo(record: PluginRecord): readonly PluginMcpServerInfo[] {
  return Object.entries(record.manifest?.mcpServers ?? {})
    .map(([name, config]) => pluginMcpServerInfo(record, name, config))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

function pluginMcpServerInfo(
  record: PluginRecord,
  name: string,
  config: McpServerConfig,
): PluginMcpServerInfo {
  if (config.transport === 'http' || config.transport === 'sse') {
    return {
      name,
      runtimeName: pluginMcpRuntimeName(record.id, name),
      enabled: isMcpServerEnabled(record, name, config),
      transport: config.transport,
      url: config.url,
      headerKeys: config.headers === undefined ? undefined : Object.keys(config.headers).toSorted(),
    };
  }
  return {
    name,
    runtimeName: pluginMcpRuntimeName(record.id, name),
    enabled: isMcpServerEnabled(record, name, config),
    transport: 'stdio',
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    envKeys: config.env === undefined ? undefined : Object.keys(config.env).toSorted(),
  };
}

function withMcpServerEnabled(config: McpServerConfig, enabled: boolean): McpServerConfig {
  return { ...config, enabled };
}

function pluginExpandVars(
  kimiHomeDir: string,
  record: PluginRecord,
): {
  readonly pluginRoot: string;
  readonly pluginData: string;
  readonly projectDir: string;
  readonly userConfig: Record<string, string>;
} {
  const pluginData = path.join(kimiHomeDir, 'plugins', 'data', record.id);
  return {
    pluginRoot: record.root,
    pluginData,
    projectDir: process.cwd(),
    userConfig: resolveUserConfigValues(
      record.manifest?.userConfig,
      record.capabilities?.userConfig,
    ),
  };
}

function pluginEnv(
  kimiHomeDir: string,
  record: PluginRecord,
): Record<string, string> {
  const vars = pluginExpandVars(kimiHomeDir, record);
  return {
    SUPERLIORA_HOME: kimiHomeDir,
    CLAUDE_PLUGIN_ROOT: record.root,
    CLAUDE_PLUGIN_DATA: vars.pluginData,
    ...userConfigEnvVars(vars.userConfig),
  };
}

function withPluginMcpRuntime(
  config: McpServerConfig,
  record: PluginRecord,
  kimiHomeDir: string,
): McpServerConfig {
  const vars = pluginExpandVars(kimiHomeDir, record);
  if (config.transport === 'http' || config.transport === 'sse') {
    return {
      ...config,
      url: expandPluginPlaceholders(config.url, vars),
      headers: expandRecordValues(config.headers, vars),
    };
  }

  const env = {
    ...expandRecordValues(config.env, vars),
    ...pluginEnv(kimiHomeDir, record),
  };

  if (config.command === 'node' && isNativeBinary()) {
    return {
      ...config,
      command: process.execPath,
      args: [NODE_FALLBACK_SUBCOMMAND, ...(config.args ?? []).map((a) => expandPluginPlaceholders(a, vars))],
      cwd: config.cwd === undefined ? record.root : expandPluginPlaceholders(config.cwd, vars),
      env,
    };
  }

  return {
    ...config,
    command: expandPluginPlaceholders(config.command, vars),
    args: config.args?.map((a) => expandPluginPlaceholders(a, vars)),
    cwd: config.cwd === undefined ? record.root : expandPluginPlaceholders(config.cwd, vars),
    env,
  };
}

function isNativeBinary(): boolean {
  return !path.basename(process.execPath).toLowerCase().startsWith('node');
}
