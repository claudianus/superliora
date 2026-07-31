import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { loadClaudeAgentEntries } from './agents';
import { loadPluginChannels } from './channels';
import { loadClaudeHooks } from './hooks-adapter';
import { loadClaudeMcpServers } from './mcp';
import { loadClaudeMonitors } from './monitors';
import {
  isDir,
  isFile,
  isObject,
  pathEntries,
  resolvePluginPath,
  stringArrayField,
  stringField,
} from './paths';
import {
  PLUGIN_NAME_REGEX,
  type PluginChannelDef,
  type PluginCommandEntry,
  type PluginDiagnostic,
  type PluginManifest,
  type PluginManifestKind,
} from './types';
import { parseUserConfigSchema } from './user-config';

const CLAUDE_MANIFEST_REL = path.join('.claude-plugin', 'plugin.json');

/** Manifest fields still accepted as format-compatible no-ops (partial host). */
const RUNTIME_NOOP_FIELDS = ['experimental'] as const;

export interface ParsedManifestResult {
  readonly manifest?: PluginManifest;
  readonly manifestKind?: PluginManifestKind;
  readonly manifestPath?: string;
  readonly diagnostics: readonly PluginDiagnostic[];
}

export async function parseManifest(
  pluginRoot: string,
  options: { readonly projectDir?: string; readonly pluginDataDir?: string } = {},
): Promise<ParsedManifestResult> {
  const manifestPath = path.join(pluginRoot, CLAUDE_MANIFEST_REL);
  const hasManifest = await isFile(manifestPath);
  const diagnostics: PluginDiagnostic[] = [];

  let raw: Record<string, unknown> = {};
  let manifestKind: PluginManifestKind = 'claude-autodiscover';
  let resolvedManifestPath: string | undefined;

  if (hasManifest) {
    manifestKind = 'claude-plugin';
    resolvedManifestPath = manifestPath;
    try {
      const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (!isObject(parsed)) {
        return {
          manifestKind,
          manifestPath: resolvedManifestPath,
          diagnostics: [{ severity: 'error', message: 'manifest must be a JSON object' }],
        };
      }
      raw = parsed;
    } catch (error) {
      return {
        manifestKind,
        manifestPath: resolvedManifestPath,
        diagnostics: [
          {
            severity: 'error',
            message: `Failed to parse ${CLAUDE_MANIFEST_REL}: ${(error as Error).message}`,
          },
        ],
      };
    }
  }

  // Reject legacy Kimi manifests so authors do not silently run the wrong format.
  if (
    (await isFile(path.join(pluginRoot, 'kimi.plugin.json'))) ||
    (await isFile(path.join(pluginRoot, '.kimi-plugin', 'plugin.json')))
  ) {
    diagnostics.push({
      severity: 'error',
      message:
        'Legacy kimi.plugin.json / .kimi-plugin/plugin.json is not supported; use .claude-plugin/plugin.json',
    });
    return { diagnostics, manifestKind, manifestPath: resolvedManifestPath };
  }

  const dirName = path.basename(await realpath(pluginRoot).catch(() => pluginRoot));
  const nameRaw = stringField(raw, 'name') ?? (hasManifest ? '' : sanitizeDirName(dirName));
  const name = nameRaw.trim();
  if (name.length === 0) {
    diagnostics.push({
      severity: 'error',
      message: hasManifest
        ? '"name" is required'
        : `Cannot autodiscover plugin name from directory "${dirName}"`,
    });
    return { diagnostics, manifestKind, manifestPath: resolvedManifestPath };
  }
  if (!PLUGIN_NAME_REGEX.test(name)) {
    diagnostics.push({
      severity: 'error',
      message: `"name" must match ${PLUGIN_NAME_REGEX} (got "${name}")`,
    });
    return { diagnostics, manifestKind, manifestPath: resolvedManifestPath };
  }

  for (const field of RUNTIME_NOOP_FIELDS) {
    if (raw[field] !== undefined) {
      diagnostics.push({
        severity: 'info',
        message: `"${field}" is present but not executed by SuperLiora yet`,
      });
    }
  }

  const vars = {
    pluginRoot,
    pluginData: options.pluginDataDir ?? path.join(pluginRoot, '.plugin-data'),
    projectDir: options.projectDir ?? process.cwd(),
  };

  const skills = await resolveSkills({
    pluginRoot,
    raw: raw['skills'],
    diagnostics,
  });
  const commandsOverride = raw['commands'] !== undefined;
  const agentsOverride = raw['agents'] !== undefined;
  const hooksOverride = raw['hooks'] !== undefined;

  const commands = await resolveCommands({
    pluginRoot,
    raw: raw['commands'],
    diagnostics,
    useDefault: !commandsOverride,
  });
  const agents = await loadClaudeAgentEntries({
    pluginRoot,
    raw: raw['agents'],
    diagnostics,
    useDefault: !agentsOverride,
  });
  const hooks = await loadClaudeHooks({
    pluginRoot,
    raw: raw['hooks'],
    vars,
    diagnostics,
    useDefault: !hooksOverride,
  });
  const mcpServers = await loadClaudeMcpServers({
    pluginRoot,
    raw: raw['mcpServers'],
    vars,
    diagnostics,
    useDefault: true,
  });
  const monitors = await loadClaudeMonitors({
    pluginRoot,
    raw: raw['monitors'],
    vars,
    diagnostics,
  });
  const userConfig = parseUserConfigSchema(raw['userConfig'], diagnostics);

  let binDir: string | undefined;
  const binPath = path.join(pluginRoot, 'bin');
  if (await isDir(binPath)) binDir = binPath;

  const extras = await discoverClaudeExtras({
    pluginRoot,
    raw,
    diagnostics,
  });

  const mcpServerNames = new Set(Object.keys(mcpServers ?? {}));
  let channels: readonly PluginChannelDef[] | undefined;
  if (extras.channelsPath !== undefined || Array.isArray(raw['channels'])) {
    channels = await loadPluginChannels({
      channelsPath: extras.channelsPath ?? pluginRoot,
      inline: raw['channels'],
      mcpServerNames,
      diagnostics,
    });
  }

  const author = readAuthor(raw['author']);
  const defaultEnabled =
    typeof raw['defaultEnabled'] === 'boolean' ? raw['defaultEnabled'] : undefined;

  const manifest: PluginManifest = {
    name,
    displayName: stringField(raw, 'displayName'),
    version: stringField(raw, 'version'),
    description: stringField(raw, 'description'),
    keywords: stringArrayField(raw, 'keywords'),
    homepage: stringField(raw, 'homepage'),
    repository: stringField(raw, 'repository'),
    license: stringField(raw, 'license'),
    author,
    defaultEnabled,
    skills,
    commands,
    agents,
    mcpServers,
    hooks,
    binDir,
    monitors,
    userConfig,
    ...extras,
    ...(channels !== undefined && channels.length > 0 ? { channels } : {}),
  };

  return {
    manifest,
    manifestKind,
    manifestPath: resolvedManifestPath,
    diagnostics,
  };
}

async function resolveSkills(input: {
  readonly pluginRoot: string;
  readonly raw: unknown;
  readonly diagnostics: PluginDiagnostic[];
}): Promise<readonly string[]> {
  const resolved: string[] = [];
  const defaultSkills = path.join(input.pluginRoot, 'skills');
  if (await isDir(defaultSkills)) resolved.push(defaultSkills);

  if (input.raw !== undefined) {
    const entries = pathEntries(input.raw);
    if (entries === undefined) {
      input.diagnostics.push({
        severity: 'error',
        message: '"skills" must be a string or string[]',
      });
    } else {
      for (const entry of entries) {
        const absolute = await resolvePluginPath({
          pluginRoot: input.pluginRoot,
          field: 'skills',
          value: entry,
          diagnostics: input.diagnostics,
          severity: 'error',
        });
        if (absolute === undefined) continue;
        if (!(await isDir(absolute))) {
          input.diagnostics.push({
            severity: 'warn',
            message: `"skills" path is not a directory (${entry})`,
          });
          continue;
        }
        if (!resolved.includes(absolute)) resolved.push(absolute);
      }
    }
  }

  if (resolved.length === 0) {
    const rootSkillMd = path.join(input.pluginRoot, 'SKILL.md');
    if (await isFile(rootSkillMd)) {
      resolved.push(input.pluginRoot);
    }
  }

  return resolved;
}

async function resolveCommands(input: {
  readonly pluginRoot: string;
  readonly raw: unknown;
  readonly diagnostics: PluginDiagnostic[];
  readonly useDefault: boolean;
}): Promise<readonly PluginCommandEntry[]> {
  const roots: string[] = [];

  if (input.raw !== undefined) {
    const entries = pathEntries(input.raw);
    if (entries === undefined) {
      input.diagnostics.push({
        severity: 'warn',
        message: '"commands" must be a string or string[]',
      });
    } else {
      for (const entry of entries) {
        const resolved = await resolvePluginPath({
          pluginRoot: input.pluginRoot,
          field: 'commands',
          value: entry,
          diagnostics: input.diagnostics,
        });
        if (resolved === undefined) continue;
        roots.push(resolved);
      }
    }
  } else if (input.useDefault) {
    const defaultDir = path.join(input.pluginRoot, 'commands');
    if (await isDir(defaultDir)) roots.push(defaultDir);
  }

  const files: PluginCommandEntry[] = [];
  for (const root of roots) {
    if (await isDir(root)) {
      files.push(...(await listMarkdownFilesRecursive(root)));
    } else if ((await isFile(root)) && root.endsWith('.md')) {
      files.push({ path: root, name: commandNameFromFile(root, path.dirname(root)) });
    } else {
      input.diagnostics.push({
        severity: 'warn',
        message: `"commands" entry must be a directory or .md file (${root})`,
      });
    }
  }
  return files.toSorted((a, b) => a.name.localeCompare(b.name));
}

async function listMarkdownFilesRecursive(root: string): Promise<readonly PluginCommandEntry[]> {
  const out: PluginCommandEntry[] = [];
  await walkMarkdown(root, root, out);
  return out;
}

async function walkMarkdown(
  root: string,
  dir: string,
  out: PluginCommandEntry[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdown(root, full, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push({ path: full, name: commandNameFromFile(full, root) });
    }
  }
}

function commandNameFromFile(file: string, root: string): string {
  const relative = path.relative(root, file).replace(/\.md$/i, '');
  return relative.split(path.sep).join('/');
}

function readAuthor(raw: unknown): PluginManifest['author'] {
  if (typeof raw === 'string') return { name: raw };
  if (!isObject(raw)) return undefined;
  const name = stringField(raw, 'name');
  const email = stringField(raw, 'email');
  const url = stringField(raw, 'url');
  if (name === undefined && email === undefined && url === undefined) return undefined;
  return { name, email, url };
}

/**
 * Discover Claude component paths that SuperLiora hosts partially today
 * (presence + PackageView flags; full runtime lands in later slices).
 */
async function discoverClaudeExtras(input: {
  readonly pluginRoot: string;
  readonly raw: Record<string, unknown>;
  readonly diagnostics: PluginDiagnostic[];
}): Promise<{
  settingsPath?: string;
  themesDir?: string;
  outputStylesDir?: string;
  lspServersPath?: string;
  workflowsDir?: string;
  channelsPath?: string;
  dependencies?: Readonly<Record<string, string>>;
}> {
  const { pluginRoot, raw, diagnostics } = input;
  const out: {
    settingsPath?: string;
    themesDir?: string;
    outputStylesDir?: string;
    lspServersPath?: string;
    workflowsDir?: string;
    channelsPath?: string;
    dependencies?: Readonly<Record<string, string>>;
  } = {};

  const settingsDefault = path.join(pluginRoot, 'settings.json');
  if (await isFile(settingsDefault)) {
    out.settingsPath = settingsDefault;
  }

  const themesDefault = path.join(pluginRoot, 'themes');
  if (await isDir(themesDefault)) {
    out.themesDir = themesDefault;
  }

  const outputStylesDefault = path.join(pluginRoot, 'output-styles');
  const outputStylesAlt = path.join(pluginRoot, 'outputStyles');
  if (await isDir(outputStylesDefault)) {
    out.outputStylesDir = outputStylesDefault;
  } else if (await isDir(outputStylesAlt)) {
    out.outputStylesDir = outputStylesAlt;
  }

  const lspPath = await resolveOptionalPathField({
    pluginRoot,
    field: 'lspServers',
    raw: raw['lspServers'],
    defaultRel: '.lsp.json',
    diagnostics,
  });
  if (lspPath !== undefined) {
    out.lspServersPath = lspPath;
  }

  const workflowsDefault = path.join(pluginRoot, 'workflows');
  if (await isDir(workflowsDefault)) {
    out.workflowsDir = workflowsDefault;
  }

  const channelsDefault = path.join(pluginRoot, 'channels');
  const channelsFile = path.join(pluginRoot, 'channels.json');
  if (await isDir(channelsDefault)) {
    out.channelsPath = channelsDefault;
  } else if (await isFile(channelsFile)) {
    out.channelsPath = channelsFile;
  } else if (raw['channels'] !== undefined) {
    out.channelsPath = pluginRoot;
  }

  if (isObject(raw['dependencies'])) {
    const deps: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw['dependencies'])) {
      if (typeof value === 'string' && value.trim() !== '') {
        deps[key] = value.trim();
      }
    }
    if (Object.keys(deps).length > 0) {
      out.dependencies = deps;
    }
  }

  return out;
}

async function resolveOptionalPathField(input: {
  readonly pluginRoot: string;
  readonly field: string;
  readonly raw: unknown;
  readonly defaultRel: string;
  readonly diagnostics: PluginDiagnostic[];
}): Promise<string | undefined> {
  if (input.raw === undefined) {
    const fallback = path.join(input.pluginRoot, input.defaultRel);
    return (await isFile(fallback)) ? fallback : undefined;
  }
  if (typeof input.raw !== 'string') {
    input.diagnostics.push({
      severity: 'warn',
      message: `"${input.field}" must be a path string when set`,
    });
    return undefined;
  }
  return resolvePluginPath({
    pluginRoot: input.pluginRoot,
    field: input.field,
    value: input.raw,
    diagnostics: input.diagnostics,
  });
}

function sanitizeDirName(name: string): string {
  const lower = name.toLowerCase().replaceAll(/[^a-z0-9_-]+/g, '-').replaceAll(/^-+|-+$/g, '');
  if (lower.length === 0) return '';
  if (!/^[a-z0-9]/.test(lower)) return `p-${lower}`.slice(0, 64);
  return lower.slice(0, 64);
}
