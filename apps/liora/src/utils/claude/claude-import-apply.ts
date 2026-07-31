/**
 * Claude Code → SuperLiora import apply helpers (skills + MCP).
 * Pure planning/merge logic is testable; I/O wrappers reuse skills-install + mcp-config-file.
 */

import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import {
  readMcpJsonFile,
  upsertMcpServer,
  type McpServerFileConfig,
} from '#/utils/mcp/mcp-config-file';
import { getDataDir } from '#/utils/paths';
import { installSkillFromPath } from '#/utils/skills/skills-install';
import { resolveClaudeImportRoots } from '#/tui/utils/claude-import';

export interface ClaudeSkillSource {
  readonly name: string;
  readonly sourcePath: string;
  readonly rootKind: 'project' | 'global';
}

export interface ClaudeMcpImportSource {
  readonly sourcePath: string;
  readonly servers: Readonly<Record<string, McpServerFileConfig>>;
}

export interface ClaudeImportApplyPlan {
  readonly skillSources: readonly ClaudeSkillSource[];
  readonly mcpSource: ClaudeMcpImportSource | null;
  readonly existingSkillNames: readonly string[];
  readonly existingMcpNames: readonly string[];
}

export interface ClaudeSkillsApplyResult {
  readonly copied: readonly string[];
  readonly skipped: readonly { readonly name: string; readonly reason: string }[];
}

export interface ClaudeMcpApplyResult {
  readonly added: readonly string[];
  readonly skipped: readonly { readonly name: string; readonly reason: string }[];
  readonly destPath: string;
}

/** Korean symlink / soft-link guidance for Extensions hub. */
export const CLAUDE_IMPORT_SYMLINK_GUIDANCE_KO: readonly string[] = [
  '심볼릭 링크(읽기 전용 공유):',
  '  ln -s ~/.claude/skills/<name> ~/.superliora/skills/<name>',
  '  (프로젝트) ln -s .claude/skills/<name> .superliora/skills/<name>',
  '',
  '플러그인 패키지(Claude Code):',
  '  <plugin-dir>/.claude-plugin/plugin.json — Extensions → Plugins → install <plugin-dir>',
  '  (zip URL/marketplace도 동일; hooks·MCP·skills는 manifest에서 로드)',
  '',
  'MCP는 ~/.superliora/mcp.json 에 병합됩니다. Claude ~/.claude.json 의 mcpServers 를 가져오거나,',
  '  ~/.claude/mcp.json 을 참고해 Extensions → MCP 에서 수동 추가할 수 있습니다.',
  '',
  '복사(import)는 기존 SuperLiora 스킬/MCP 이름을 덮어쓰지 않습니다.',
  '설치·가져오기 후 세션 hot-reload(footer ext↻) — 실패 시 MCP → Reload 또는 /reload.',
];

/**
 * Pure: pick skill sources from a directory listing (must contain SKILL.md).
 */
export function listClaudeSkillSourcesFromEntries(
  skillsDir: string,
  rootKind: 'project' | 'global',
  entries: readonly { readonly name: string; readonly isDirectory: boolean; readonly hasSkillMd: boolean }[],
): readonly ClaudeSkillSource[] {
  const out: ClaudeSkillSource[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory || !entry.hasSkillMd) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    out.push({
      name: entry.name,
      sourcePath: join(skillsDir, entry.name),
      rootKind,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Pure: merge incoming MCP servers without overwriting existing names.
 */
export function mergeMcpServersForImport(
  existing: Readonly<Record<string, McpServerFileConfig>>,
  incoming: Readonly<Record<string, McpServerFileConfig>>,
): {
  readonly toAdd: Readonly<Record<string, McpServerFileConfig>>;
  readonly added: readonly string[];
  readonly skipped: readonly { readonly name: string; readonly reason: string }[];
} {
  const toAdd: Record<string, McpServerFileConfig> = {};
  const added: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const [name, config] of Object.entries(incoming)) {
    const trimmed = name.trim();
    if (trimmed.length === 0) continue;
    if (existing[trimmed] !== undefined) {
      skipped.push({ name: trimmed, reason: 'already in ~/.superliora/mcp.json' });
      continue;
    }
    if (toAdd[trimmed] !== undefined) {
      skipped.push({ name: trimmed, reason: 'duplicate in Claude source' });
      continue;
    }
    toAdd[trimmed] = config;
    added.push(trimmed);
  }

  return { toAdd, added, skipped };
}

/**
 * Pure: filter skills that would be skipped because dest already exists.
 */
export function planSkillsImport(
  sources: readonly ClaudeSkillSource[],
  existingDestNames: readonly string[],
): { readonly toCopy: readonly ClaudeSkillSource[]; readonly skipped: readonly { readonly name: string; readonly reason: string }[] } {
  const existing = new Set(existingDestNames);
  const seen = new Set<string>();
  const toCopy: ClaudeSkillSource[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const source of sources) {
    if (seen.has(source.name)) {
      skipped.push({ name: source.name, reason: 'duplicate source (project wins over global)' });
      continue;
    }
    seen.add(source.name);
    if (existing.has(source.name)) {
      skipped.push({ name: source.name, reason: 'already in ~/.superliora/skills' });
      continue;
    }
    toCopy.push(source);
  }

  return { toCopy, skipped };
}

/** Discover Claude skills + MCP sources under allowlisted roots. */
export async function discoverClaudeImportApplyPlan(
  workDir: string,
  homeDir: string = getDataDir(),
): Promise<ClaudeImportApplyPlan> {
  const roots = resolveClaudeImportRoots(workDir);
  const skillSources: ClaudeSkillSource[] = [];

  for (const root of roots) {
    const skillsDir = join(root.path, 'skills');
    if (!existsSync(skillsDir)) continue;
    const entries = await readSkillDirEntries(skillsDir);
    skillSources.push(...listClaudeSkillSourcesFromEntries(skillsDir, root.kind, entries));
  }

  // Project skills win over global when names collide (project listed first in roots).
  const orderedSkills = dedupeSkillsByName(skillSources, ['project', 'global']);

  const existingSkillNames = await listExistingSkillNames(homeDir);
  const existingMcpNames = Object.keys(await readMcpJsonFile(join(homeDir, 'mcp.json')));

  const mcpSource = await discoverClaudeMcpSource(workDir);

  return {
    skillSources: orderedSkills,
    mcpSource,
    existingSkillNames,
    existingMcpNames,
  };
}

export function formatClaudeImportApplyPreviewKo(plan: ClaudeImportApplyPlan): string {
  const skillCount = plan.skillSources.length;
  const mcpCount = plan.mcpSource ? Object.keys(plan.mcpSource.servers).length : 0;
  const lines = [
    `Claude Code 가져오기 미리보기`,
    `  · 스킬 후보 ${String(skillCount)} (${plan.existingSkillNames.length} already in ~/.superliora/skills)`,
    mcpCount > 0
      ? `  · MCP 서버 ${String(mcpCount)} (from ${basename(plan.mcpSource!.sourcePath)})`
      : '  · MCP: ~/.claude.json / ~/.claude/mcp.json 에서 찾지 못함',
    '',
    '가져오기는 복사/병합만 수행하며 기존 항목은 건너뜁니다.',
  ];
  return lines.join('\n');
}

export async function applyClaudeSkillsImport(
  sources: readonly ClaudeSkillSource[],
  existingDestNames: readonly string[],
): Promise<ClaudeSkillsApplyResult> {
  const { toCopy, skipped: planSkipped } = planSkillsImport(sources, existingDestNames);
  const copied: string[] = [];
  const skipped = [...planSkipped];

  for (const source of toCopy) {
    try {
      const result = await installSkillFromPath(source.sourcePath);
      copied.push(result.name);
    } catch (error: unknown) {
      skipped.push({
        name: source.name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { copied, skipped };
}

export async function applyClaudeMcpImport(
  workDir: string,
  incoming: Readonly<Record<string, McpServerFileConfig>>,
  homeDir: string = getDataDir(),
): Promise<ClaudeMcpApplyResult> {
  const destPath = join(homeDir, 'mcp.json');
  const existing = await readMcpJsonFile(destPath);
  const { toAdd, added, skipped } = mergeMcpServersForImport(existing, incoming);

  for (const [name, config] of Object.entries(toAdd)) {
    await upsertMcpServer(workDir, 'user', name, config, homeDir);
  }

  return { added, skipped, destPath };
}

async function readSkillDirEntries(
  skillsDir: string,
): Promise<readonly { name: string; isDirectory: boolean; hasSkillMd: boolean }[]> {
  let names: string[];
  try {
    names = await readdir(skillsDir);
  } catch {
    return [];
  }
  const out: { name: string; isDirectory: boolean; hasSkillMd: boolean }[] = [];
  for (const name of names) {
    const full = join(skillsDir, name);
    try {
      const st = await stat(full);
      if (!st.isDirectory()) continue;
      let hasSkillMd = false;
      try {
        await stat(join(full, 'SKILL.md'));
        hasSkillMd = true;
      } catch {
        hasSkillMd = false;
      }
      out.push({ name, isDirectory: true, hasSkillMd });
    } catch {
      continue;
    }
  }
  return out;
}

async function listExistingSkillNames(homeDir: string): Promise<string[]> {
  const skillsRoot = join(homeDir, 'skills');
  if (!existsSync(skillsRoot)) return [];
  try {
    return (await readdir(skillsRoot)).filter((n) => !n.startsWith('.'));
  } catch {
    return [];
  }
}

function dedupeSkillsByName(
  sources: readonly ClaudeSkillSource[],
  priority: readonly ('project' | 'global')[],
): readonly ClaudeSkillSource[] {
  const byName = new Map<string, ClaudeSkillSource>();
  for (const kind of priority) {
    for (const source of sources) {
      if (source.rootKind !== kind) continue;
      if (!byName.has(source.name)) byName.set(source.name, source);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function discoverClaudeMcpSource(workDir: string): Promise<ClaudeMcpImportSource | null> {
  const candidates = [
    join(homedir(), '.claude.json'),
    join(homedir(), '.claude', 'mcp.json'),
    join(homedir(), '.claude', 'settings.json'),
    join(resolve(workDir, '.claude'), 'mcp.json'),
  ];

  for (const sourcePath of candidates) {
    const servers = await readClaudeMcpFile(sourcePath);
    if (servers !== null && Object.keys(servers).length > 0) {
      return { sourcePath, servers };
    }
  }
  return null;
}

async function readClaudeMcpFile(
  filePath: string,
): Promise<Record<string, McpServerFileConfig> | null> {
  if (!existsSync(filePath)) return null;
  let text: string;
  try {
    text = await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
  if (text.trim().length === 0) return null;
  try {
    const data = JSON.parse(text) as { mcpServers?: Record<string, unknown> };
    const raw = data.mcpServers;
    if (raw === undefined || typeof raw !== 'object' || raw === null) return null;
    const out: Record<string, McpServerFileConfig> = {};
    for (const [name, value] of Object.entries(raw)) {
      const normalized = normalizeClaudeMcpEntry(value);
      if (normalized !== null) out[name] = normalized;
    }
    return out;
  } catch {
    return null;
  }
}

function normalizeClaudeMcpEntry(raw: unknown): McpServerFileConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  const command = typeof entry.command === 'string' ? entry.command : undefined;
  const url = typeof entry.url === 'string' ? entry.url : undefined;
  if (command === undefined && url === undefined) return null;

  const config: McpServerFileConfig = {
    enabled: entry.enabled !== false,
  };
  if (command !== undefined) {
    config.transport = 'stdio';
    config.command = command;
    if (Array.isArray(entry.args)) {
      config.args = entry.args.filter((a): a is string => typeof a === 'string');
    }
  }
  if (url !== undefined) {
    config.transport = 'http';
    config.url = url;
  }
  if (typeof entry.cwd === 'string') config.cwd = entry.cwd;
  if (typeof entry.bearerTokenEnvVar === 'string') config.bearerTokenEnvVar = entry.bearerTokenEnvVar;
  if (typeof entry.startupTimeoutMs === 'number') config.startupTimeoutMs = entry.startupTimeoutMs;
  if (typeof entry.toolTimeoutMs === 'number') config.toolTimeoutMs = entry.toolTimeoutMs;
  if (typeof entry.env === 'object' && entry.env !== null && !Array.isArray(entry.env)) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(entry.env as Record<string, unknown>)) {
      if (typeof v === 'string') env[k] = v;
    }
    if (Object.keys(env).length > 0) config.env = env;
  }
  if (typeof entry.headers === 'object' && entry.headers !== null && !Array.isArray(entry.headers)) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(entry.headers as Record<string, unknown>)) {
      if (typeof v === 'string') headers[k] = v;
    }
    if (Object.keys(headers).length > 0) config.headers = headers;
  }
  return config;
}
