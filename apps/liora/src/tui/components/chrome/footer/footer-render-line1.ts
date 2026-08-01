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

import {
  formatExtensionsReloadFooterBadge,
  formatIndexFooterBadge,
  formatMediaFooterBadge,
  formatMcpHealthFooterBadge,
  formatRuntimeDegradedFooterBadge,
  formatSearchCascadeFooterBadge,
  formatCacheHitFooterBadge,
  styleFooterBadge,
} from '#/tui/components/chrome/footer/footer-badges';
import { formatGoalXpPulseFooterBadge } from '#/tui/utils/goal/goal-xp-pulse';
import { formatFleetFlourishFooterBadge } from '#/tui/utils/fleet/fleet-flourish';
import { formatPermissionApproveFooterBadge } from '#/tui/utils/never-halt/permission-approve-flourish';
import { formatGitChurnFooterBadge } from '#/tui/utils/git/git-churn-spark';
import {
  computeOpsComboPulse,
  formatOpsComboFooterBadge,
} from '#/tui/utils/ops/ops-combo-pulse';
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
import {
  footerSlotVisible,
  resolveFooterPreferences,
} from '#/tui/components/chrome/footer/footer-preferences';
import {
  labelBackgroundAgent,
  labelBackgroundBash,
  labelMenu,
  labelModeAuto,
  labelModeMission,
  labelModeOrchestrator,
  labelModePlan,
  labelModePremium,
  labelModeSwarm,
  labelModeYolo,
  labelWorkers,
} from '#/tui/components/chrome/footer/footer-labels';

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

  const prefs = resolveFooterPreferences(state);
  const labels = prefs.labels;
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
    if (state.ultraworkMode) {
      modes.push(
        withModeBeat(
          'mission',
          renderAnimatedGradientText(labelModeMission(labels), 'footer:ultrawork', appearance),
        ),
      );
    } else if (state.planMode) {
      modes.push(
        withModeBeat(
          'plan',
          renderPulseText(labelModePlan(labels), 'plan', 'primary', appearance),
        ),
      );
    }
    if (state.swarmMode) {
      modes.push(
        withModeBeat(
          'swarm',
          renderPulseText(labelModeSwarm(labels), 'footer:swarm', 'accent', appearance),
        ),
      );
    }
    if (state.premiumQualityMode) {
      modes.push(
        renderAnimatedGradientText(labelModePremium(labels), 'footer:premium', appearance),
      );
    }
    if (state.orchestratorMode) {
      modes.push(
        renderPulseText(
          labelModeOrchestrator(labels),
          'footer:orchestrator',
          'accent',
          appearance,
        ),
      );
      const workers = state.orchestratorWorkers;
      if (workers !== undefined && workers.length > 0) {
        const running = workers.filter((w) => w.status === 'running').length;
        const done = workers.filter((w) => w.status === 'completed').length;
        const failed = workers.filter((w) => w.status === 'failed').length;
        const workerLabel = labelWorkers(labels, running, done, failed);
        if (workerLabel.length > 0) {
          modes.push(renderPulseText(workerLabel, 'footer:workers', 'primary', appearance));
        }
      }
    }
  }
  // Compaction already owns a full transcript card — do not paint status-bar compact.
  // Prompt-intel phases (ghost complete / suggest) are already visible in the editor.
  const mediaBadge = formatMediaFooterBadge(process.env, labels);
  if (mediaBadge !== null && footerSlotVisible(prefs.mediaReady, true)) {
    modes.push(
      renderPulseText(mediaBadge.label, `footer:${mediaBadge.label}`, 'accent', appearance),
    );
  }
  if (modes.length > 0) left.push(modes.join(' '));

  const transcriptViewportBadge = formatTranscriptViewportBadge(
    getTranscriptViewport?.(),
    labels,
  );
  if (transcriptViewportBadge !== null) left.push(transcriptViewportBadge);

  if (footerSlotVisible(prefs.goal, state.goal != null)) {
    const goalBadge = formatGoalBadge(state.goal, goalWallClockMs, appearance);
    if (goalBadge !== null) left.push(goalBadge);
  }

  if (prefs.pulseGoalProgress) {
    const goalXpBadge = formatGoalXpPulseFooterBadge(state.goalXpPulse, Date.now(), labels);
    if (goalXpBadge !== null) {
      left.push(renderPulseText(goalXpBadge.text, 'footer:goal-xp', 'accent', appearance));
    }
  }

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

  if (prefs.pulseOpsCombo) {
    const opsCombo = computeOpsComboPulse(state);
    const opsComboBadge = formatOpsComboFooterBadge(opsCombo, Date.now(), labels);
    if (opsComboBadge !== null) {
      left.push(renderPulseText(opsComboBadge.text, 'footer:ops-combo', 'accent', appearance));
    }
  }

  if (footerSlotVisible(prefs.mcp, true)) {
    const mcpBadge = formatMcpHealthFooterBadge(
      state.mcpServersSummary,
      labels,
      prefs.mcp === 'always',
    );
    if (mcpBadge !== null) left.push(styleFooterBadge(mcpBadge, appearance));
  }

  if (prefs.pulseExtensionsReload) {
    const extReloadBadge = formatExtensionsReloadFooterBadge(
      state.extensionsReload,
      Date.now(),
      labels,
    );
    if (extReloadBadge !== null) left.push(styleFooterBadge(extReloadBadge, appearance));
  }

  if (footerSlotVisible(prefs.cache, true)) {
    const cacheBadge = formatCacheHitFooterBadge(state.cacheMeter, labels);
    if (cacheBadge !== null) left.push(styleFooterBadge(cacheBadge, appearance));
  }

  if (footerSlotVisible(prefs.index, true)) {
    const indexBadge = formatIndexFooterBadge(state.workDir, process.env, labels);
    // auto: only cold/warn; always: any
    if (indexBadge !== null) {
      const coldish =
        indexBadge.severity === 'warning' || indexBadge.severity === 'danger';
      if (prefs.index === 'always' || coldish || indexBadge.severity === 'muted') {
        // When always, show all. When auto, skip warm "ready" noise.
        if (prefs.index === 'always' || indexBadge.severity !== 'info') {
          left.push(styleFooterBadge(indexBadge, appearance));
        }
      }
    }
  }

  if (prefs.pulseRuntimeDegraded) {
    const degradedBadge = formatRuntimeDegradedFooterBadge(
      state.runtimeDegraded,
      Date.now(),
      labels,
    );
    if (degradedBadge !== null) left.push(styleFooterBadge(degradedBadge, appearance));
  }

  if (prefs.pulseSearchCascade) {
    const cascadeBadge = formatSearchCascadeFooterBadge(
      state.searchCascade,
      Date.now(),
      labels,
    );
    if (cascadeBadge !== null) left.push(styleFooterBadge(cascadeBadge, appearance));
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
