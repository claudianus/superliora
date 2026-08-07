/**
 * Human-first target formatting for Mission Control (paths, Bash, patterns).
 * Pure — no TUIState. Prefer filename / command intent over absolute paths.
 */

import { isAbsolute, relative, sep } from 'node:path';

import { makeWorkspaceRelativePath } from '#/tui/components/messages/tool-call/format';

const WORKTREE_MARK = '.superliora/worktrees/';
/** Default max for dock-width targets before segment collapse. */
const DEFAULT_MAX = 28;

/** Strip leading `cd <path> &&|;` chains; return residual command (may be empty). */
export function stripLeadingCd(command: string): { residual: string; cdPath?: string } {
  let rest = command.trim();
  let cdPath: string | undefined;
  // Match `cd PATH` then optional separators; repeat while the head is only cd.
  const cdHead =
    /^(?:cd|pushd)\s+(?:(?:'[^']*'|"[^"]*"|`[^`]*`)|(?:\\ |[^\s;&|])+)\s*(?:&&|;|&)?\s*/u;
  while (true) {
    const match = cdHead.exec(rest);
    if (match === null) break;
    const token = match[0].replace(/^(?:cd|pushd)\s+/u, '').replace(/\s*(?:&&|;|&)?\s*$/u, '');
    cdPath = unquote(token);
    rest = rest.slice(match[0].length).trim();
  }
  return { residual: rest, ...(cdPath === undefined ? {} : { cdPath }) };
}

function unquote(value: string): string {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith('`') && value.endsWith('`'))
  ) {
    return value.slice(1, -1);
  }
  return value.replace(/\\ /gu, ' ');
}

/** True when the command is only directory changes (no meaningful residual). */
export function isLowSignalBash(command: string): boolean {
  const { residual } = stripLeadingCd(command);
  return residual.length === 0;
}

/** Last path segment; empty → original. */
export function pathLeaf(path: string): string {
  const segments = path.split(/[/\\]/u).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

/**
 * Collapse absolute / worktree-heavy paths to a short human label.
 * Prefer workspace-relative, then last 1–2 segments, then tail truncate.
 */
export function formatMissionPath(
  path: string,
  workspaceDir: string | undefined,
  maxWidth: number = DEFAULT_MAX,
): string {
  if (path.length === 0) return path;
  let display = makeWorkspaceRelativePath(path, workspaceDir);
  // Normalize for worktree prefix detection (emitters use `/`).
  const normalized = display.replaceAll('\\', '/');
  const wt = normalized.indexOf(WORKTREE_MARK);
  if (wt >= 0) {
    const after = normalized.slice(wt + WORKTREE_MARK.length);
    const slash = after.indexOf('/');
    display = slash >= 0 ? after.slice(slash + 1) : after;
  } else if (isAbsolute(display) && workspaceDir !== undefined && workspaceDir.length > 0) {
    const rel = relative(workspaceDir, display);
    if (rel.length > 0 && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)) {
      display = rel;
    }
  }
  if (display.length <= maxWidth) return display;
  const segments = display.split(/[/\\]/u).filter((s) => s.length > 0);
  if (segments.length >= 2) {
    const two = `${segments[segments.length - 2]!}/${segments[segments.length - 1]!}`;
    if (two.length <= maxWidth) return two;
  }
  const leaf = segments[segments.length - 1] ?? display;
  if (leaf.length <= maxWidth) return leaf;
  // Tail-preserve so the filename stays readable.
  return `…${leaf.slice(leaf.length - (maxWidth - 1))}`;
}

/**
 * Humanize a tool target for Mission Control rows / MOVES feed.
 * `toolName` selects Bash vs path vs pattern handling.
 */
export function formatMissionTarget(
  toolName: string,
  target: string | undefined,
  workspaceDir: string | undefined,
  maxWidth: number = DEFAULT_MAX,
): string | undefined {
  if (target === undefined || target.length === 0) return undefined;
  const lower = toolName.toLowerCase();
  if (lower === 'bash' || lower === 'shell') {
    return formatMissionBash(target, maxWidth);
  }
  // Paths: edit/write/read and anything that looks like a filesystem path.
  if (
    lower === 'edit' ||
    lower === 'write' ||
    lower === 'read' ||
    lower === 'lioraread' ||
    target.includes('/') ||
    target.includes('\\') ||
    isAbsolute(target)
  ) {
    return formatMissionPath(target, workspaceDir, maxWidth);
  }
  if (target.length <= maxWidth) return target;
  return `${target.slice(0, maxWidth - 1)}…`;
}

/** Bash: strip leading cd, show residual; pure-cd → `enter <leaf>`. */
export function formatMissionBash(command: string, maxWidth: number = DEFAULT_MAX): string {
  const { residual, cdPath } = stripLeadingCd(command);
  if (residual.length === 0) {
    const leaf = cdPath === undefined ? '.' : pathLeaf(cdPath);
    const label = `enter ${leaf}`;
    if (label.length <= maxWidth) return label;
    return `enter …${leaf.slice(Math.max(0, leaf.length - (maxWidth - 7)))}`;
  }
  // Prefer first line / flattened.
  const flat = residual.replace(/\s+/gu, ' ').trim();
  if (flat.length <= maxWidth) return flat;
  return `${flat.slice(0, maxWidth - 1)}…`;
}

/**
 * Collapse consecutive low-signal Bash ops (same worker, cd-only) into one
 * entry so MOVES does not spam directory hops.
 */
export function collapseLowSignalOps<T extends { name: string; target?: string; workerId: string }>(
  ops: readonly T[],
): T[] {
  const out: T[] = [];
  for (const entry of ops) {
    const prev = out[out.length - 1];
    const low =
      entry.name.toLowerCase() === 'bash' &&
      entry.target !== undefined &&
      isLowSignalBash(entry.target);
    if (
      prev !== undefined &&
      low &&
      prev.workerId === entry.workerId &&
      prev.name.toLowerCase() === 'bash' &&
      prev.target !== undefined &&
      isLowSignalBash(prev.target)
    ) {
      out[out.length - 1] = entry;
      continue;
    }
    out.push(entry);
  }
  return out;
}
