/**
 * Context settings glance — live instruction files + Liora Memory counts (SSOT §9.2 / W9).
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import type { MemoryStats } from '@superliora/sdk';

export const CONTEXT_WORKING_SET_TIP =
  'Working set — soft cap before auto-compact on 1M-class models. Presets: economy · balanced · deep · full_window. Change via /context or Settings → Harness → Context working set.';

export const CONTEXT_INSTRUCTION_SOFT_TIP =
  'Instruction — AGENTS.md, rules, skills: human SSOT; do not auto-write.';

export const CONTEXT_LEARNING_SOFT_TIP =
  'Learning — Liora Memory (/memory remember): agent-curated durable facts.';

export interface InstructionFileHit {
  readonly name: string;
  readonly path: string;
  readonly scope: 'brand' | 'user' | 'project';
}

export interface ContextInstructionGlance {
  readonly hits: readonly InstructionFileHit[];
}

export interface ContextMemoryGlance {
  readonly stats?: MemoryStats;
  readonly statsError?: string;
}

export interface ContextSettingsGlanceInput {
  readonly presetLine: string;
  readonly capLine: string;
  readonly instruction?: ContextInstructionGlance;
  readonly memory?: ContextMemoryGlance;
}

export interface DiscoverInstructionFilesInput {
  readonly workDir: string;
  readonly brandHome: string;
  readonly realHome?: string;
}

function isNonEmptyInstructionFile(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    const stat = statSync(path);
    if (!stat.isFile()) return false;
    if (stat.size === 0) return false;
    const sample = readFileSync(path, { encoding: 'utf8', flag: 'r' }).trim();
    return sample.length > 0;
  } catch {
    return false;
  }
}

function findProjectRoot(workDir: string): string {
  let current = workDir;
  while (true) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return workDir;
    current = parent;
  }
}

function dirsRootToLeaf(workDir: string, projectRoot: string): readonly string[] {
  const dirs: string[] = [];
  let current = workDir;
  while (true) {
    dirs.push(current);
    if (current === projectRoot) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs.toReversed();
}

function displayPath(absPath: string, workDir: string, realHome: string): string {
  const relToWork = relative(workDir, absPath);
  if (relToWork.length > 0 && !relToWork.startsWith('..')) {
    return relToWork.startsWith('.') ? relToWork : `./${relToWork}`;
  }
  if (absPath.startsWith(realHome)) {
    return `~${absPath.slice(realHome.length)}`;
  }
  return absPath;
}

function pushHit(
  hits: InstructionFileHit[],
  seen: Set<string>,
  hit: InstructionFileHit,
): void {
  const key = hit.path;
  if (seen.has(key)) return;
  seen.add(key);
  hits.push(hit);
}

/** Scan brand, user, and project instruction files (mirrors agent-core AGENTS.md discovery + CLAUDE.md). */
export function discoverInstructionFiles(input: DiscoverInstructionFilesInput): readonly InstructionFileHit[] {
  const realHome = input.realHome ?? homedir();
  const workDir = input.workDir;
  const hits: InstructionFileHit[] = [];
  const seen = new Set<string>();

  const brandAgents = join(input.brandHome, 'AGENTS.md');
  if (isNonEmptyInstructionFile(brandAgents)) {
    pushHit(hits, seen, {
      name: 'AGENTS.md',
      path: displayPath(brandAgents, workDir, realHome),
      scope: 'brand',
    });
  }

  const userAgentsDir = join(realHome, '.agents');
  for (const name of ['AGENTS.md', 'agents.md'] as const) {
    const userPath = join(userAgentsDir, name);
    if (isNonEmptyInstructionFile(userPath)) {
      pushHit(hits, seen, {
        name,
        path: displayPath(userPath, workDir, realHome),
        scope: 'user',
      });
      break;
    }
  }

  const projectRoot = findProjectRoot(workDir);
  for (const dir of dirsRootToLeaf(workDir, projectRoot)) {
    const superlioraAgents = join(dir, '.superliora', 'AGENTS.md');
    if (isNonEmptyInstructionFile(superlioraAgents)) {
      pushHit(hits, seen, {
        name: 'AGENTS.md',
        path: displayPath(superlioraAgents, workDir, realHome),
        scope: 'project',
      });
    }

    for (const name of ['AGENTS.md', 'agents.md'] as const) {
      const projectPath = join(dir, name);
      if (isNonEmptyInstructionFile(projectPath)) {
        pushHit(hits, seen, {
          name,
          path: displayPath(projectPath, workDir, realHome),
          scope: 'project',
        });
        break;
      }
    }

    const claudePath = join(dir, 'CLAUDE.md');
    if (isNonEmptyInstructionFile(claudePath)) {
      pushHit(hits, seen, {
        name: 'CLAUDE.md',
        path: displayPath(claudePath, workDir, realHome),
        scope: 'project',
      });
    }
  }

  return hits;
}

export function formatInstructionFilesLine(glance: ContextInstructionGlance | undefined): string {
  const hits = glance?.hits ?? [];
  if (hits.length === 0) {
    return 'Instruction files: none found (AGENTS.md · CLAUDE.md · ~/.superliora/AGENTS.md)';
  }
  const summary = hits
    .map((hit) => `${hit.name} (${hit.path})`)
    .join(' · ');
  return `Instruction files: ${String(hits.length)} present — ${summary}`;
}

export function formatLearningMemoryLine(memory: ContextMemoryGlance | undefined): string {
  const stats = memory?.stats;
  if (stats !== undefined) {
    const types = (['fact', 'event', 'procedure', 'task', 'rule'] as const)
      .filter((type) => (stats.byType[type] ?? 0) > 0)
      .map((type) => `${type} ${String(stats.byType[type])}`)
      .join(', ');
    const typePart = types.length > 0 ? ` · ${types}` : '';
    return `Learning (Liora Memory): ${String(stats.active)} active / ${String(stats.total)} total${typePart}`;
  }
  if (memory?.statsError !== undefined) {
    return `Learning (Liora Memory): unavailable (${memory.statsError})`;
  }
  return CONTEXT_LEARNING_SOFT_TIP;
}

export function buildContextSettingsLines(input: ContextSettingsGlanceInput): readonly string[] {
  const instructionLine = formatInstructionFilesLine(input.instruction);
  const learningLine = formatLearningMemoryLine(input.memory);

  return [
    '── Context (read-only) ─────────────────────',
    'Working-set caps control when auto-compaction reclaims context.',
    '',
    '── Working set ──────────────────────────────',
    input.presetLine,
    input.capLine,
    'Change preset: /context or Settings → Harness → Context working set.',
    'Presets: economy · balanced · deep · full_window.',
    '',
    '── Memory: Instruction vs Learning (W9) ─────',
    '── Live ─────────────────────────────────────',
    instructionLine,
    learningLine,
    CONTEXT_INSTRUCTION_SOFT_TIP,
    'Keep them separate — mixing causes drift and context poisoning.',
    'After compaction, durable state lives on disk (memory, artifacts, plans).',
    '',
    '── Ops ──────────────────────────────────────',
    '  /memory stats · /memory readiness · /memory remember <subject> :: <text>',
    '  Settings → Compaction for thresholds, structured handoff, Expand recover.',
    '  Settings → Skills for Trace→Skill draft tips (manual merge; no PR bot yet).',
  ];
}
