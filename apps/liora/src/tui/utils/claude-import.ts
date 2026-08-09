/**
 * Claude zero-config import — path allowlist + discovery plan.
 *
 * Security (FedRAMP AC6):
 * - Only project `.claude/**` and documented global `~/.claude/**` roots.
 * - Reject path escape (`..`) and non-allowlisted absolute paths.
 * - Imported settings are advisory inventory only — never permission-chain bypass.
 */

import { homedir } from 'node:os';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

import { ttui } from '#/tui/utils/tui-i18n';

export type ClaudeImportRootKind = 'project' | 'global';

export interface ClaudeImportRoot {
  readonly kind: ClaudeImportRootKind;
  readonly path: string;
  readonly label: string;
}

export interface ClaudeImportCandidate {
  readonly kind: 'settings' | 'skills' | 'commands' | 'hooks' | 'mcp' | 'other';
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly root: ClaudeImportRootKind;
}

export interface ClaudeImportPlan {
  readonly roots: readonly ClaudeImportRoot[];
  readonly candidates: readonly ClaudeImportCandidate[];
  readonly rejected: readonly { readonly path: string; readonly reason: string }[];
}

export interface ClaudeImportScanEntry {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly rootKind: ClaudeImportRootKind;
}

const PROJECT_CLAUDE_DIR = '.claude';
const GLOBAL_CLAUDE_DIR = '.claude';

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith(`~/`) || path.startsWith(`~${sep}`)) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function isWithinRoot(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  if (rel === '') return true;
  if (rel.startsWith('..')) return false;
  // Windows drive mismatch → relative starts with absolute path segment.
  if (isAbsolute(rel)) return false;
  return true;
}

/**
 * Build allowlisted roots for Claude import (project + global only).
 */
export function resolveClaudeImportRoots(workDir: string): readonly ClaudeImportRoot[] {
  const projectRoot = resolve(workDir, PROJECT_CLAUDE_DIR);
  const globalRoot = resolve(homedir(), GLOBAL_CLAUDE_DIR);
  return [
    {
      kind: 'project',
      path: projectRoot,
      label: ttui('tui.claudeImport.root.project', { dir: PROJECT_CLAUDE_DIR }),
    },
    {
      kind: 'global',
      path: globalRoot,
      label: ttui('tui.claudeImport.root.global', { dir: GLOBAL_CLAUDE_DIR }),
    },
  ];
}

/**
 * Validate that a user-supplied path is inside an allowlisted Claude root.
 * Returns the resolved absolute path on success, or a Korean reason on failure.
 */
export function validateClaudeImportPath(
  inputPath: string,
  workDir: string,
): { readonly ok: true; readonly absolutePath: string; readonly root: ClaudeImportRootKind } | {
  readonly ok: false;
  readonly reason: string;
} {
  const trimmed = inputPath.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: ttui('tui.claudeImport.error.emptyPath') };
  }

  // Reject null bytes and obvious escapes before normalize.
  if (trimmed.includes('\0')) {
    return { ok: false, reason: ttui('tui.claudeImport.error.invalidPath') };
  }

  const expanded = expandHome(trimmed);
  const absolute = resolve(isAbsolute(expanded) ? expanded : resolve(workDir, expanded));
  const normalized = normalize(absolute);
  const roots = resolveClaudeImportRoots(workDir);

  for (const root of roots) {
    if (isWithinRoot(normalized, root.path)) {
      return { ok: true, absolutePath: normalized, root: root.kind };
    }
  }

  return {
    ok: false,
    reason: ttui('tui.claudeImport.error.outsideAllowlist'),
  };
}

function classifyRelativePath(rel: string): ClaudeImportCandidate['kind'] {
  const lower = rel.toLowerCase().replaceAll('\\', '/');
  if (lower.includes('settings') || lower.endsWith('.json') && lower.includes('claude')) {
    return 'settings';
  }
  if (lower.includes('skill')) return 'skills';
  if (lower.includes('command') || lower.includes('slash')) return 'commands';
  if (lower.includes('hook')) return 'hooks';
  if (lower.includes('mcp')) return 'mcp';
  return 'other';
}

/**
 * Build an import plan from already-scanned filesystem entries.
 * Entries outside allowlisted roots are rejected (no symlink realpath — residual POAM).
 */
export function buildClaudeImportPlan(
  workDir: string,
  entries: readonly ClaudeImportScanEntry[],
): ClaudeImportPlan {
  const roots = resolveClaudeImportRoots(workDir);
  const candidates: ClaudeImportCandidate[] = [];
  const rejected: { path: string; reason: string }[] = [];

  for (const entry of entries) {
    const validated = validateClaudeImportPath(entry.absolutePath, workDir);
    if (!validated.ok) {
      rejected.push({ path: entry.absolutePath, reason: validated.reason });
      continue;
    }
    candidates.push({
      kind: classifyRelativePath(entry.relativePath),
      relativePath: entry.relativePath.replaceAll('\\', '/'),
      absolutePath: validated.absolutePath,
      root: validated.root,
    });
  }

  return { roots, candidates, rejected };
}

/**
 * Human-readable Korean summary for TUI status / modal body.
 * Never dumps secret values — paths and counts only.
 */
export function formatClaudeImportSummary(plan: ClaudeImportPlan): string {
  if (plan.candidates.length === 0 && plan.rejected.length === 0) {
    return ttui('tui.claudeImport.summary.none');
  }

  const byKind = new Map<string, number>();
  for (const c of plan.candidates) {
    byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + 1);
  }
  const parts = [...byKind.entries()].map(([kind, n]) =>
    `${claudeImportKindLabel(kind as ClaudeImportCandidate['kind'])} ${String(n)}`,
  );
  const lines = [
    ttui('tui.claudeImport.summary.plan', { count: String(plan.candidates.length) }),
    parts.length > 0 ? `  · ${parts.join(' · ')}` : '',
    plan.rejected.length > 0
      ? ttui('tui.claudeImport.summary.rejected', { count: String(plan.rejected.length) })
      : '',
    ttui('tui.claudeImport.summary.note'),
  ].filter((line) => line.length > 0);
  return lines.join('\n');
}

/** Kind labels for Extensions / import UI. */
export function claudeImportKindLabel(kind: ClaudeImportCandidate['kind']): string {
  return ttui(`tui.claudeImport.kind.${kind}`);
}
