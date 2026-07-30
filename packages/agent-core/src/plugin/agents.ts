import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ResolvedAgentProfile } from '../profile/types';
import { parseFrontmatter } from '../skill/parser';
import { isDir, isFile, pathEntries, resolvePluginPath } from './paths';
import {
  pluginAgentProfileName,
  type PluginAgentDef,
  type PluginAgentEntry,
  type PluginDiagnostic,
} from './types';

const FORBIDDEN_AGENT_FIELDS = ['hooks', 'mcpServers', 'permissionMode'] as const;

/**
 * Resolve Claude `agents/` markdown entries (default dir or manifest override).
 */
export async function loadClaudeAgentEntries(input: {
  readonly pluginRoot: string;
  readonly raw: unknown;
  readonly diagnostics: PluginDiagnostic[];
  readonly useDefault: boolean;
}): Promise<readonly PluginAgentEntry[]> {
  const dirs: string[] = [];

  if (input.raw !== undefined) {
    const entries = pathEntries(input.raw);
    if (entries === undefined) {
      input.diagnostics.push({
        severity: 'warn',
        message: '"agents" must be a string or string[]',
      });
    } else {
      for (const entry of entries) {
        const resolved = await resolvePluginPath({
          pluginRoot: input.pluginRoot,
          field: 'agents',
          value: entry,
          diagnostics: input.diagnostics,
        });
        if (resolved === undefined) continue;
        if (await isDir(resolved)) dirs.push(resolved);
        else if ((await isFile(resolved)) && resolved.endsWith('.md')) {
          return [
            {
              path: resolved,
              name: path.basename(resolved).replace(/\.md$/i, ''),
            },
          ];
        } else {
          input.diagnostics.push({
            severity: 'warn',
            message: `"agents" entry must be a directory or .md file (${entry})`,
          });
        }
      }
    }
  } else if (input.useDefault) {
    const defaultDir = path.join(input.pluginRoot, 'agents');
    if (await isDir(defaultDir)) dirs.push(defaultDir);
  }

  const files: PluginAgentEntry[] = [];
  for (const dir of dirs) {
    files.push(...(await listMarkdownFiles(dir)));
  }
  return files.toSorted((a, b) => a.name.localeCompare(b.name));
}

export async function loadPluginAgents(input: {
  readonly pluginId: string;
  readonly entries: readonly PluginAgentEntry[];
  readonly diagnostics?: PluginDiagnostic[];
}): Promise<readonly PluginAgentDef[]> {
  const out: PluginAgentDef[] = [];
  for (const entry of input.entries) {
    const def = await loadPluginAgent({
      pluginId: input.pluginId,
      agentPath: entry.path,
      fallbackName: entry.name,
      diagnostics: input.diagnostics,
    });
    if (def !== undefined) out.push(def);
  }
  return out;
}

export async function loadPluginAgent(input: {
  readonly pluginId: string;
  readonly agentPath: string;
  readonly fallbackName?: string;
  readonly diagnostics?: PluginDiagnostic[];
}): Promise<PluginAgentDef | undefined> {
  let text: string;
  try {
    text = await readFile(input.agentPath, 'utf8');
  } catch {
    return undefined;
  }

  const parsed = parseFrontmatter(text);
  const frontmatter = isRecord(parsed.data) ? parsed.data : {};

  for (const field of FORBIDDEN_AGENT_FIELDS) {
    if (frontmatter[field] !== undefined) {
      input.diagnostics?.push({
        severity: 'info',
        message: `Plugin agent "${input.fallbackName ?? path.basename(input.agentPath)}" ignores forbidden field "${field}"`,
      });
    }
  }

  const name =
    nonEmptyString(frontmatter['name']) ??
    input.fallbackName ??
    path.basename(input.agentPath).replace(/\.md$/i, '');
  const description = nonEmptyString(frontmatter['description']);
  const body = parsed.body.trim();
  const tools = stringList(frontmatter['tools']);
  const disallowed = new Set(stringList(frontmatter['disallowedTools']) ?? []);
  const allowedTools =
    tools === undefined
      ? ['*']
      : tools.filter((tool) => !disallowed.has(tool));

  const model = nonEmptyString(frontmatter['model']);
  const effort = nonEmptyString(frontmatter['effort']);
  const maxTurns = positiveInt(frontmatter['maxTurns']);
  const skills = stringList(frontmatter['skills']);
  const memory = boolOrString(frontmatter['memory']);
  const background =
    typeof frontmatter['background'] === 'boolean' ? frontmatter['background'] : undefined;
  const isolation = nonEmptyString(frontmatter['isolation']);

  const profileName = pluginAgentProfileName(input.pluginId, name);
  const systemPromptBody = body.length > 0 ? body : `You are the ${name} agent.`;
  const profile: ResolvedAgentProfile = {
    name: profileName,
    description,
    systemPrompt: () => systemPromptBody,
    tools: allowedTools.length > 0 ? allowedTools : ['*'],
    whenToUse: description,
  };

  return {
    pluginId: input.pluginId,
    name,
    profileName,
    description,
    path: path.resolve(input.agentPath),
    profile,
    model,
    effort,
    maxTurns,
    skills,
    memory,
    background,
    isolation,
  };
}

async function listMarkdownFiles(root: string): Promise<readonly PluginAgentEntry[]> {
  const out: PluginAgentEntry[] = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const full = path.join(root, entry.name);
    out.push({ path: full, name: entry.name.replace(/\.md$/i, '') });
  }
  return out;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function positiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return undefined;
}

function boolOrString(value: unknown): string | boolean | undefined {
  if (typeof value === 'boolean') return value;
  return nonEmptyString(value);
}

function stringList(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Resolve Agent tool `subagent_type` to a namespaced plugin profile.
 * Accepts `plugin:agent` (canonical) or bare `agent` when unique among plugin agents.
 */
export function resolvePluginAgentType(
  requested: string,
  pluginAgents: readonly PluginAgentDef[],
): string {
  const trimmed = requested.trim();
  if (trimmed.length === 0) return trimmed;
  if (pluginAgents.some((agent) => agent.profileName === trimmed)) return trimmed;
  const bareMatches = pluginAgents.filter((agent) => agent.name === trimmed);
  if (bareMatches.length === 1) return bareMatches[0]!.profileName;
  return trimmed;
}
