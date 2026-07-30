import { truncateToWidth, visibleWidth } from '#/tui/renderer';
import type { AppearancePreferences } from '#/tui/config';
import { currentTheme } from '#/tui/theme/theme';
import type { AppState } from '#/tui/types';
import {
  appearanceAnimationNow,
  renderAnimatedGradientText,
  renderPulseText,
  renderShimmerPrefix,
  renderTypewriterLine,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import type { MotionBeatSnapshot } from '#/tui/utils/render/motion-beats';
import type { GitStatus } from '#/utils/git/git-status';

import { formatMediaFooterBadge } from '#/tui/components/chrome/footer/footer-badges';
import {
  formatFooterGitBadge,
  formatTranscriptViewportBadge,
  shortenCwd,
  type FooterTranscriptViewportSnapshot,
} from '#/tui/components/chrome/footer/footer-chrome';
import { formatGoalBadge } from '#/tui/components/chrome/footer/footer-goal';
import {
  effectiveRouteModelLabel,
  formatModelRouteBadge,
  modelDisplayName,
  thinkingLevelLabel,
} from '#/tui/components/chrome/footer/footer-model';
import { footerCurrentTipIndex, tipsForIndex } from '#/tui/components/chrome/footer/footer-tips';

export interface FooterLine1TipState {
  tipDisplay: string;
  tipChangedAtMs: number;
}

export interface RenderFooterLine1Input {
  readonly state: AppState;
  readonly appearance: AppearancePreferences;
  readonly activeBeat: MotionBeatSnapshot | undefined;
  readonly getTranscriptViewport: (() => FooterTranscriptViewportSnapshot) | undefined;
  readonly goalWallClockMs: number | undefined;
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
    goalWallClockMs,
    backgroundBashTaskCount,
    backgroundAgentCount,
    git,
    width,
    tipState,
  } = input;

  const left: string[] = [];
  const modes: string[] = [];
  const modeBeatTitle =
    activeBeat?.name === 'mode_enter' || activeBeat?.name === 'mode_exit'
      ? activeBeat.title
      : activeBeat?.name === 'plan_enter' || activeBeat?.name === 'plan_exit'
        ? 'plan'
        : undefined;
  const withModeBeat = (title: string, body: string): string =>
    modeBeatTitle === title ? renderShimmerPrefix(appearance) + body : body;
  if (state.permissionMode === 'auto') modes.push(currentTheme.boldFg('warning', 'auto'));
  if (state.permissionMode === 'yolo') {
    modes.push(
      withModeBeat(
        'yolo',
        modeBeatTitle === 'yolo'
          ? renderPulseText('yolo', 'footer:yolo', 'warning', appearance)
          : currentTheme.boldFg('warning', 'yolo'),
      ),
    );
  }
  if (state.ultraworkMode) {
    modes.push(
      withModeBeat(
        'ultrawork',
        renderAnimatedGradientText('ultrawork', 'footer:ultrawork', appearance),
      ),
    );
  } else if (state.planMode) {
    modes.push(withModeBeat('plan', renderPulseText('plan', 'plan', 'primary', appearance)));
  }
  if (state.swarmMode) {
    modes.push(
      withModeBeat('swarm', renderPulseText('swarm-armed', 'footer:swarm', 'accent', appearance)),
    );
  }
  if (state.premiumQualityMode) {
    modes.push(renderAnimatedGradientText('premium', 'footer:premium', appearance));
  }
  if (state.orchestratorMode) {
    modes.push(renderPulseText('orchestrator', 'footer:orchestrator', 'accent', appearance));
    const workers = state.orchestratorWorkers;
    if (workers !== undefined && workers.length > 0) {
      const running = workers.filter((w) => w.status === 'running').length;
      const done = workers.filter((w) => w.status === 'completed').length;
      const failed = workers.filter((w) => w.status === 'failed').length;
      const parts: string[] = [];
      if (running > 0) parts.push(`${String(running)}▸`);
      if (done > 0) parts.push(`${String(done)}✓`);
      if (failed > 0) parts.push(`${String(failed)}✗`);
      modes.push(renderPulseText(`w:${parts.join(' ')}`, 'footer:workers', 'primary', appearance));
    }
  }
  if (state.isBackgroundCompacting) {
    modes.push(renderPulseText('compact-bg', 'footer:compact-bg', 'warning', appearance));
  } else if (state.isCompacting) {
    modes.push(renderPulseText('compact', 'footer:compact', 'primary', appearance));
  }
  const piPhase = state.promptIntelligencePhase ?? 'idle';
  if (piPhase === 'inline') {
    modes.push(
      renderPulseText('ghost…', 'footer:prompt-intel-inline', 'accent', appearance),
    );
  } else if (piPhase === 'suggest') {
    modes.push(
      renderPulseText('suggest…', 'footer:prompt-intel-suggest', 'accent', appearance),
    );
  }
  const mediaBadge = formatMediaFooterBadge();
  if (mediaBadge !== null) {
    modes.push(
      renderPulseText(mediaBadge.label, `footer:${mediaBadge.label}`, 'accent', appearance),
    );
  }
  if (modes.length > 0) left.push(modes.join(' '));

  const transcriptViewportBadge = formatTranscriptViewportBadge(getTranscriptViewport?.());
  if (transcriptViewportBadge !== null) left.push(transcriptViewportBadge);

  const goalBadge = formatGoalBadge(state.goal, goalWallClockMs, appearance);
  if (goalBadge !== null) left.push(goalBadge);

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
    const routeBadge = formatModelRouteBadge(state);
    if (routeBadge !== undefined) {
      left.push(
        renderPulseText(routeBadge, 'footer:model-failover', 'glow', appearance),
      );
    }
  }

  if (backgroundBashTaskCount > 0) {
    const noun = backgroundBashTaskCount === 1 ? 'task' : 'tasks';
    left.push(
      renderPulseText(
        `[${String(backgroundBashTaskCount)} ${noun} running]`,
        'footer:bash-tasks',
        'primary',
        appearance,
      ),
    );
  }
  if (backgroundAgentCount > 0) {
    const noun = backgroundAgentCount === 1 ? 'agent' : 'agents';
    left.push(
      renderPulseText(
        `[${String(backgroundAgentCount)} ${noun} running]`,
        'footer:agent-tasks',
        'primary',
        appearance,
      ),
    );
  }

  const cwd = shortenCwd(state.workDir);
  if (cwd) left.push(currentTheme.fg('textDim', cwd));

  if (git !== null) {
    left.push(formatFooterGitBadge(git));
  }

  const leftLine = left.join('  ');
  const leftWidth = visibleWidth(leftLine);

  const menuBadge = shouldRenderAmbientEffects(appearance)
    ? renderPulseText('Menu ?', 'footer:menu-hub', 'accent', appearance)
    : currentTheme.fg('accent', 'Menu ?');
  const menuPlain = 'Menu ?';
  const menuGap = '  ';
  const afterLeft = leftWidth + visibleWidth(menuGap) + visibleWidth(menuPlain);
  const { primary, pair } = tipsForIndex(footerCurrentTipIndex());
  const tipGap = 2;
  const remaining = Math.max(0, width - afterLeft - tipGap);
  let tipText = '';
  if (pair && visibleWidth(pair) <= remaining) {
    tipText = pair;
  } else if (primary && visibleWidth(primary) <= remaining) {
    tipText = primary;
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
