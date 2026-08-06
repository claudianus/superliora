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

export function shortenCwd(path: string): string {
  if (!path) return path;
  const home = process.env['HOME'] ?? '';
  let work = path;
  if (home && path === home) {
    return '~';
  }
  if (home && path.startsWith(home + '/')) {
    work = '~' + path.slice(home.length);
  }

  const segments = work.split('/').filter((s) => s.length > 0);
  if (segments.length <= MAX_CWD_SEGMENTS) return work;
  const tail = segments.slice(-MAX_CWD_SEGMENTS).join('/');
  return `…/${tail}`;
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
