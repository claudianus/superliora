import type { RendererViewportSnapshot } from '#/tui/renderer';
import { projectRendererViewportHistoryStatus } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme/theme';
import {
  formatGitBadgeBase,
  formatPullRequestBadge,
  type GitStatus,
} from '#/utils/git/git-status';
import type { FooterLabels } from '#/tui/config';

import { labelHistoryViewport } from '#/tui/components/chrome/footer/footer-labels';
import { foldPathForIdentity, pathsIdentical } from '@superliora/sdk';

const MAX_CWD_SEGMENTS = 3;

export type FooterTranscriptViewportSnapshot = Pick<
  RendererViewportSnapshot,
  'followOutput' | 'offsetFromBottom'
>;

function posixPath(value: string): string {
  let normalized = value.replaceAll('\\', '/');
  const msys = /^\/([a-zA-Z])(\/|$)/.exec(normalized);
  const drive = msys?.[1];
  if (drive !== undefined) {
    normalized = `${drive.toUpperCase()}:${normalized.slice(2)}`;
  }
  if (/^[a-z]:/.test(normalized)) {
    normalized = `${normalized[0]!.toUpperCase()}${normalized.slice(1)}`;
  }
  return normalized;
}

function homePrefixes(): readonly string[] {
  const prefixes: string[] = [];
  for (const raw of [process.env['HOME'], process.env['USERPROFILE']]) {
    if (!raw) continue;
    const normalized = posixPath(raw);
    if (normalized.length > 0 && !prefixes.includes(normalized)) prefixes.push(normalized);
  }
  return prefixes;
}

function pathEquals(left: string, right: string): boolean {
  return pathsIdentical(left, right);
}

function pathHasPrefix(path: string, prefix: string): boolean {
  if (prefix.length === 0) return false;
  const child = foldPathForIdentity(path);
  const base = foldPathForIdentity(prefix);
  return child.startsWith(base.endsWith('/') ? base : `${base}/`);
}

export function shortenCwd(path: string): string {
  if (!path) return path;
  const posix = posixPath(path);
  let work = posix;
  for (const home of homePrefixes()) {
    if (pathEquals(posix, home) || pathEquals(path, home)) {
      work = '~';
      break;
    }
    if (pathHasPrefix(posix, home)) {
      work = `~${posix.slice(home.length)}`;
      break;
    }
  }

  const segments = work.split('/').filter((s) => s.length > 0);
  if (segments.length <= MAX_CWD_SEGMENTS) return work;
  return `…/${segments.slice(-MAX_CWD_SEGMENTS).join('/')}`;
}

export function formatTranscriptViewportBadge(
  viewport: FooterTranscriptViewportSnapshot | undefined,
  labels: FooterLabels = 'plain',
): string | null {
  const status = projectRendererViewportHistoryStatus(viewport);
  if (status === undefined) return null;
  // Both wordings read the structured count — parsing the renderer's label
  // back apart would silently break on any wording change.
  const text = labelHistoryViewport(labels, status.rowsBehind);
  return currentTheme.boldFg('warning', `[${text}]`);
}


export function formatFooterGitBadge(status: GitStatus): string {
  const base = currentTheme.fg('textDim', formatGitBadgeBase(status));
  if (status.pullRequest === null) return base;

  const pullRequest = currentTheme.fg(
    'primary',
    formatPullRequestBadge(status.pullRequest, { linkPullRequest: true }),
  );
  return `${base} ${pullRequest}`;
}
