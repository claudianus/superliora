import { truncateToWidth, visibleWidth } from '#/tui/renderer';
import type { AppearancePreferences } from '#/tui/config';
import { currentTheme } from '#/tui/theme/theme';
import type { AppState } from '#/tui/types';
import {
  appearanceAnimationNow,
  renderPulseText,
  renderShimmerPrefix,
  renderTypewriterLine,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import type { MotionBeatSnapshot } from '#/tui/utils/render/motion-beats';
import type { GitStatus } from '#/utils/git/git-status';

import {
  formatCacheHitFooterBadge,
  styleFooterBadge,
} from '#/tui/components/chrome/footer/footer-badges';
import { formatFleetFlourishFooterBadge } from '#/tui/utils/fleet/fleet-flourish';
import { formatPermissionApproveFooterBadge } from '#/tui/utils/never-halt/permission-approve-flourish';
import { formatGitChurnFooterBadge } from '#/tui/utils/git/git-churn-spark';
import {
  formatFooterGitBadge,
  formatTranscriptViewportBadge,
  shortenCwd,
  type FooterTranscriptViewportSnapshot,
} from '#/tui/components/chrome/footer/footer-chrome';
import {
  effectiveRouteModelLabel,
  formatModelRouteBadge,
  modelDisplayName,
  thinkingLevelLabel,
} from '#/tui/components/chrome/footer/footer-model';
import { footerCurrentTipIndex, tipsForIndex } from '#/tui/components/chrome/footer/footer-tips';
import {
  footerSlotVisible,
  resolveFooterPreferences,
} from '#/tui/components/chrome/footer/footer-preferences';
import {
  labelBackgroundAgent,
  labelBackgroundBash,
  labelConductorJobs,
  labelMenu,
  labelModeAuto,
  labelModeYolo,
} from '#/tui/components/chrome/footer/footer-labels';
import {
  formatSessionTokenGlance,
  sumRunningJobTokens,
} from '#/tui/utils/job/session-token-glance';

export interface FooterLine1TipState {
  tipDisplay: string;
  tipChangedAtMs: number;
}

export interface RenderFooterLine1Input {
  readonly state: AppState;
  readonly appearance: AppearancePreferences;
  readonly activeBeat: MotionBeatSnapshot | undefined;
  readonly getTranscriptViewport: (() => FooterTranscriptViewportSnapshot) | undefined;
  readonly backgroundBashTaskCount: number;
  readonly backgroundAgentCount: number;
  readonly git: GitStatus | null;
  readonly width: number;
  readonly tipState: FooterLine1TipState;
}

export function renderFooterLine1(input: RenderFooterLine1Input): string {
  const {
    state,
    appearance,
    activeBeat,
    getTranscriptViewport,
    backgroundBashTaskCount,
    backgroundAgentCount,
    git,
    width,
    tipState,
  } = input;

  const prefs = resolveFooterPreferences(state);
  const labels = prefs.labels;
  const left: string[] = [];
  const modes: string[] = [];
  const modeBeatTitle =
    activeBeat?.name === 'mode_enter' || activeBeat?.name === 'mode_exit'
      ? activeBeat.title
      : undefined;
  const withModeBeat = (title: string, body: string): string =>
    modeBeatTitle === title ? renderShimmerPrefix(appearance) + body : body;

  if (footerSlotVisible(prefs.modes, true)) {
    if (state.permissionMode === 'auto') {
      modes.push(currentTheme.boldFg('warning', labelModeAuto(labels)));
    }
    if (state.permissionMode === 'yolo') {
      const yoloText = labelModeYolo(labels);
      modes.push(
        withModeBeat(
          'yolo',
          modeBeatTitle === 'yolo'
            ? renderPulseText(yoloText, 'footer:yolo', 'warning', appearance)
            : currentTheme.boldFg('warning', yoloText),
        ),
      );
    }
    const jobs = state.conductorJobs;
    const showJobs =
      jobs !== undefined &&
      jobs !== null &&
      (jobs.total > 0 ||
        jobs.running > 0 ||
        jobs.queued > 0 ||
        jobs.unreadInbox > 0 ||
        jobs.interrupted > 0 ||
        jobs.needsUser > 0);
    if (showJobs && jobs !== undefined && jobs !== null) {
      const tokenGlance = formatSessionTokenGlance(sumRunningJobTokens(jobs.jobs));
      const liveNames = jobs.jobs
        .filter((card) => card.status === 'running' || card.status === 'needs_user')
        .map((card) => card.sessionName?.trim() || card.title)
        .filter((name) => name.length > 0);
      const jobLabel = labelConductorJobs(labels, jobs, {
        ...(tokenGlance === undefined ? {} : { tokenGlance }),
        ...(liveNames.length > 0 ? { liveNames } : {}),
      });
      if (jobLabel.length > 0) {
        // F15: stronger attention pulse when needs_user / unread (quality-aware).
        const attention = jobs.needsUser > 0 || jobs.unreadInbox > 0;
        const tone = jobs.needsUser > 0 ? 'warning' : jobs.unreadInbox > 0 ? 'glow' : 'accent';
        const seed = attention
          ? jobs.needsUser > 0
            ? 'footer:conductor-jobs:needs-user'
            : 'footer:conductor-jobs:inbox'
          : 'footer:conductor-jobs';
        modes.push(renderPulseText(jobLabel, seed, tone, appearance, attention ? 'fast' : 'slow'));
      }
    }
  }
  if (modes.length > 0) left.push(modes.join(' '));

  const transcriptViewportBadge = formatTranscriptViewportBadge(
    getTranscriptViewport?.(),
    labels,
  );
  if (transcriptViewportBadge !== null) left.push(transcriptViewportBadge);


  if (prefs.pulseFleetComplete) {
    const fleetFlourishBadge = formatFleetFlourishFooterBadge(
      state.fleetFlourish,
      Date.now(),
      labels,
    );
    if (fleetFlourishBadge !== null) {
      left.push(
        renderPulseText(fleetFlourishBadge.text, 'footer:fleet-flourish', 'primary', appearance),
      );
    }
  }

  if (prefs.pulsePermission) {
    const permissionApproveBadge = formatPermissionApproveFooterBadge(
      state.permissionApproveFlourish,
      Date.now(),
      labels,
    );
    if (permissionApproveBadge !== null) {
      left.push(
        renderPulseText(permissionApproveBadge.text, 'footer:perm-approve', 'primary', appearance),
      );
    }
  }

  if (prefs.pulseGitChurn) {
    const gitChurnBadge = formatGitChurnFooterBadge(state.gitChurn, Date.now(), labels);
    if (gitChurnBadge !== null) {
      left.push(styleFooterBadge(gitChurnBadge, appearance));
    }
  }


  if (footerSlotVisible(prefs.cache, true)) {
    const cacheBadge = formatCacheHitFooterBadge(state.cacheMeter, labels);
    if (cacheBadge !== null) left.push(styleFooterBadge(cacheBadge, appearance));
  }




  if (footerSlotVisible(prefs.model, state.model.trim().length > 0)) {
    const model = modelDisplayName(state);
    if (model) {
      const routeEffective = effectiveRouteModelLabel(state);
      const modelLabel =
        routeEffective !== undefined
          ? `${model}${thinkingLevelLabel(state)}→${routeEffective}`
          : `${model}${thinkingLevelLabel(state)}`;
      const modelHot =
        state.lastModelRouteNotice !== undefined &&
        state.lastModelRouteNotice !== null &&
        Date.now() - state.lastModelRouteNotice.atMs < 45_000;
      left.push(
        modelHot || state.streamingPhase !== 'idle' || state.thinking
          ? renderPulseText(
              modelLabel,
              modelHot ? 'footer:model-route' : 'footer:model',
              modelHot ? 'glow' : 'text',
              appearance,
            )
          : currentTheme.fg('text', modelLabel),
      );
      if (prefs.pulseModelRoute) {
        const routeBadge = formatModelRouteBadge(state, labels);
        if (routeBadge !== undefined) {
          left.push(
            renderPulseText(routeBadge, 'footer:model-failover', 'glow', appearance),
          );
        }
      }
    }
  }

  if (footerSlotVisible(prefs.background, backgroundBashTaskCount > 0 || backgroundAgentCount > 0)) {
    if (backgroundBashTaskCount > 0) {
      left.push(
        renderPulseText(
          labelBackgroundBash(labels, backgroundBashTaskCount),
          'footer:bash-tasks',
          'primary',
          appearance,
        ),
      );
    }
    if (backgroundAgentCount > 0) {
      left.push(
        renderPulseText(
          labelBackgroundAgent(labels, backgroundAgentCount),
          'footer:agent-tasks',
          'primary',
          appearance,
        ),
      );
    }
  }

  if (footerSlotVisible(prefs.cwd, state.workDir.trim().length > 0)) {
    const cwd = shortenCwd(state.workDir);
    if (cwd) left.push(currentTheme.fg('textDim', cwd));
  }

  if (footerSlotVisible(prefs.git, git !== null) && git !== null) {
    left.push(formatFooterGitBadge(git));
  }

  const leftLine = left.join('  ');
  const leftWidth = visibleWidth(leftLine);

  const showMenu = footerSlotVisible(prefs.menu, true);
  const menuPlain = labelMenu(labels);
  const menuBadge = showMenu
    ? shouldRenderAmbientEffects(appearance)
      ? renderPulseText(menuPlain, 'footer:menu-hub', 'accent', appearance)
      : currentTheme.fg('accent', menuPlain)
    : '';
  const menuGap = showMenu ? '  ' : '';
  const afterLeft = leftWidth + visibleWidth(menuGap) + visibleWidth(showMenu ? menuPlain : '');

  const tipsEnabled = footerSlotVisible(
    prefs.tips,
    true,
    state.streamingPhase === 'idle' && !state.isCompacting && !state.isReplaying,
  );
  let tipText = '';
  if (tipsEnabled) {
    const { primary, pair } = tipsForIndex(footerCurrentTipIndex());
    const tipGap = 2;
    const remaining = Math.max(0, width - afterLeft - tipGap);
    if (pair && visibleWidth(pair) <= remaining) {
      tipText = pair;
    } else if (primary && visibleWidth(primary) <= remaining) {
      tipText = primary;
    }
  }
  if (tipText !== tipState.tipDisplay) {
    tipState.tipDisplay = tipText;
    tipState.tipChangedAtMs = appearanceAnimationNow();
  }
  const ambientTips = shouldRenderAmbientEffects(appearance);
  const tipStyled =
    tipText.length === 0
      ? ''
      : ambientTips
        ? renderTypewriterLine(tipText, tipState.tipChangedAtMs, appearance)
        : currentTheme.fg('textMuted', tipText);

  const menuBlock = leftLine + menuGap + menuBadge;
  if (tipStyled) {
    const slotWidth = visibleWidth(tipText);
    const pad = width - afterLeft - slotWidth;
    const fill = Math.max(0, slotWidth - visibleWidth(tipStyled));
    return menuBlock + ' '.repeat(Math.max(0, pad)) + tipStyled + ' '.repeat(fill);
  }
  if (afterLeft <= width) {
    return menuBlock;
  }
  return truncateToWidth(menuBlock, width, '…');
}
