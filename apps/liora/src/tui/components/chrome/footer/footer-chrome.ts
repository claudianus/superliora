import type { RendererViewportSnapshot } from '#/tui/renderer';
import { projectRendererViewportHistoryStatus } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme/theme';
import type { AppState } from '#/tui/types';
import {
  formatGitBadgeBase,
  formatPullRequestBadge,
  type GitStatus,
} from '#/utils/git/git-status';
import { ttui } from '#/tui/utils/tui-i18n';
import type { FooterLabels } from '#/tui/config';

import { mediaProviderKeyReady } from '#/tui/components/chrome/footer/footer-badges';
import { safeContextUsage } from '#/tui/components/chrome/footer/footer-context';
import { labelHistoryViewport } from '#/tui/components/chrome/footer/footer-labels';

const MAX_CWD_SEGMENTS = 3;

export type FooterTranscriptViewportSnapshot = Pick<
  RendererViewportSnapshot,
  'followOutput' | 'offsetFromBottom'
>;

function posixPath(value: string): string {
  let normalized = value.replace(/\\/g, '/');
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
  if (process.platform === 'win32') return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

function pathHasPrefix(path: string, prefix: string): boolean {
  if (prefix.length === 0) return false;
  if (process.platform === 'win32') {
    return path.toLowerCase().startsWith(`${prefix.toLowerCase()}/`);
  }
  return path.startsWith(`${prefix}/`);
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
  // status.label is like "history +42 rows" — rebuild plain text from rowsBehind
  const compact = status.label.replace(/^history \+/, '').replace(/ rows$/, '');
  const text = labelHistoryViewport(labels, status.rowsBehind, compact);
  return currentTheme.boldFg('warning', `[${text}]`);
}

export function footerNextAction(state: AppState, git: GitStatus | null): string | null {
  if (state.isCompacting) return ttui('tui.footer.compacting');
  if (state.isBackgroundCompacting) return ttui('tui.footer.compacting.background');
  if (state.isReplaying) return ttui('tui.footer.replaying');
  if (state.model.trim().length === 0) return ttui('tui.footer.next.login');
  if (safeContextUsage(state.contextUsage) >= 0.70) return ttui('tui.footer.next.compact');
  if (
    state.contextOS !== undefined &&
    state.contextOS !== null &&
    state.contextOS.missingEvidencePageCount > 0
  ) {
    return 'durable evidence missing after compaction — verify IDs before resume';
  }
  if (state.premiumQualityMode) {
    return ttui('tui.footer.premium');
  }
  if (state.streamingPhase !== 'idle') return null;
  if (git?.dirty === true) return ttui('tui.footer.next.review');
  // Beginner path: surface media readiness when keys are missing (image/video are zero-config otherwise).
  if (!mediaProviderKeyReady()) {
    return ttui('tui.footer.next.media');
  }
  return ttui('tui.footer.next.default');
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
