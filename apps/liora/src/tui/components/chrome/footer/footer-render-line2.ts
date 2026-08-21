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
import { workingSetPressure } from '#/tui/utils/agent/context-working-set';

import {
  contextUsageSeverity,
  formatProviderQuotaFooterBadge,
  formatWorkingSetFooterBadge,
  styleFooterBadge,
} from '#/tui/components/chrome/footer/footer-badges';
import {
  activeProviderKeyFromState,
  resolveLiveQuotaSnapshot,
} from '#/tui/utils/usage/quota-glance';
import { footerNextAction } from '#/tui/components/chrome/footer/footer-chrome';
import { formatContextStatus } from '#/tui/components/chrome/footer/footer-context';
import {
  footerSlotVisible,
  resolveFooterPreferences,
} from '#/tui/components/chrome/footer/footer-preferences';

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
  const prefs = resolveFooterPreferences(state);
  const labels = prefs.labels;

  const contextParts: string[] = [];
  if (footerSlotVisible(prefs.context, true)) {
    const usageSeverity = contextUsageSeverity(state.contextUsage);
    const filledToken =
      usageSeverity === 'danger'
        ? 'error'
        : usageSeverity === 'warning'
          ? 'warning'
          : usageSeverity === 'info'
            ? 'primary'
            : 'textMuted';
    contextParts.push(
      formatContextStatus(
        state.contextUsage,
        state.contextTokens,
        state.maxContextTokens,
        labels,
        { appearance, filledToken },
      ),
    );
  }

  const pressure =
    state.workingSet !== undefined && state.workingSet !== null
      ? workingSetPressure({
          contextTokens: state.contextTokens,
          maxContextTokens: state.maxContextTokens,
          maxWorkingSetTokens: state.workingSet.maxWorkingSetTokens,
        })
      : 'ok';
  const workingSetAutoOk = pressure === 'warn' || pressure === 'danger';
  if (
    footerSlotVisible(
      prefs.workingSet,
      state.workingSet !== undefined && state.workingSet !== null,
      workingSetAutoOk,
    )
  ) {
    const workingSetBadge = formatWorkingSetFooterBadge(
      state.workingSet,
      state.contextTokens,
      state.maxContextTokens,
      labels,
    );
    if (workingSetBadge !== null) {
      contextParts.push(styleFooterBadge(workingSetBadge, appearance));
    }
  }

  const liveQuota = resolveLiveQuotaSnapshot(state.providerQuota, state.providerRouteStatus);
  const quotaBadge = formatProviderQuotaFooterBadge(
    liveQuota,
    labels,
    activeProviderKeyFromState(state),
  );
  if (footerSlotVisible(prefs.quota, quotaBadge !== null, quotaBadge !== null) && quotaBadge !== null) {
    contextParts.push(styleFooterBadge(quotaBadge, appearance));
  }

  const contextText =
    contextParts.length > 0
      ? contextParts.join(currentTheme.fg('textMuted', ' · '))
      : '';
  const contextWidth = visibleWidth(contextText);
  const nextActionEnabled = footerSlotVisible(prefs.nextAction, true);
  const nextAction = nextActionEnabled ? footerNextAction(state, git) : null;
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
    const beatLine = beatLines.at(-1) ?? '';
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
