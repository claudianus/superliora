import { truncateToWidth, visibleWidth } from '#/tui/renderer';
import type { AppearancePreferences } from '#/tui/config';
import { currentTheme } from '#/tui/theme/theme';
import type { AppState } from '#/tui/types';
import {
  renderEnterBeat,
  renderShimmerPrefix,
} from '#/tui/features/appearance/appearance-effects';
import type { MotionBeatSnapshot } from '#/tui/utils/render/motion-beats';
import type { GitStatus } from '#/utils/git/git-status';

import {
  contextUsageSeverity,
  formatProviderQuotaFooterBadge,
  formatWorkingSetFooterBadge,
  styleFooterBadge,
} from '#/tui/components/chrome/footer-badges';
import { footerNextAction } from '#/tui/components/chrome/footer-chrome';
import { formatContextStatus } from '#/tui/components/chrome/footer-context';

export interface RenderFooterLine2Input {
  readonly state: AppState;
  readonly appearance: AppearancePreferences;
  readonly git: GitStatus | null;
  readonly width: number;
  readonly transientHint: string | null;
  readonly activeBeat: MotionBeatSnapshot | undefined;
}

export function renderFooterLine2(input: RenderFooterLine2Input): string {
  const { state, appearance, git, width, transientHint, activeBeat } = input;

  const contextBase = formatContextStatus(
    state.contextUsage,
    state.contextTokens,
    state.maxContextTokens,
  );
  const quotaBadge = formatProviderQuotaFooterBadge(state.providerQuota);
  const workingSetBadge = formatWorkingSetFooterBadge(
    state.workingSet,
    state.contextTokens,
    state.maxContextTokens,
  );
  const usageSeverity = contextUsageSeverity(state.contextUsage);
  const contextParts: string[] = [
    styleFooterBadge({ text: contextBase, severity: usageSeverity }, appearance),
  ];
  if (workingSetBadge !== null) {
    contextParts.push(styleFooterBadge(workingSetBadge, appearance));
  }
  if (quotaBadge !== null) {
    contextParts.push(styleFooterBadge(quotaBadge, appearance));
  }
  const contextText = contextParts.join(currentTheme.fg('textMuted', ' · '));
  const contextWidth = visibleWidth(contextText);
  const nextAction = footerNextAction(state, git);
  const resumeBeat =
    activeBeat?.name === 'session_resume' ? activeBeat : undefined;

  if (resumeBeat !== undefined && transientHint === null) {
    const hintWidth = Math.max(8, width - contextWidth - 1);
    const beatLines = renderEnterBeat(
      resumeBeat.title,
      hintWidth,
      resumeBeat.seed,
      resumeBeat.startedAtMs,
      appearance,
    );
    const beatLine = beatLines[beatLines.length - 1] ?? '';
    const pad = Math.max(0, width - visibleWidth(beatLine) - contextWidth);
    return beatLine + ' '.repeat(pad) + contextText;
  }

  const shimmer = transientHint === null ? renderShimmerPrefix(appearance) : '';
  const leftHint = transientHint ?? (nextAction === null ? null : shimmer + nextAction);
  if (leftHint !== null) {
    const maxHintWidth = Math.max(0, width - contextWidth - 1);
    const shownHint =
      visibleWidth(leftHint) <= maxHintWidth
        ? leftHint
        : truncateToWidth(leftHint, maxHintWidth, '…');
    const hintWidth = visibleWidth(shownHint);
    const pad = Math.max(0, width - hintWidth - contextWidth);
    const hintStyle = transientHint !== null
      ? (text: string) => currentTheme.boldFg('warning', text)
      : (text: string) => currentTheme.fg('textDim', text);
    return hintStyle(shownHint) + ' '.repeat(pad) + contextText;
  }

  const leftPad = Math.max(0, width - contextWidth);
  return ' '.repeat(leftPad) + contextText;
}
