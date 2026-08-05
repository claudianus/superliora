import type { BackgroundTaskInfo, Session } from '@superliora/sdk';
import chalk from 'chalk';

import type { Component } from '../../renderer';
import { ActivityPaneComponent, type ActivityPaneMode } from '../../components/panes/activity-pane';
import {
  QueuePaneComponent,
  queuePaneSelectionIdentity,
  resolveHostOwnedQueueSettleStartedAtMs,
} from '../../components/panes/queue-pane';
import { MoonLoader, type SpinnerStyle } from '../../components/chrome/moon-loader';
import { pickRandomWorkingTip, tipText } from '../../components/chrome/working-tips';
import { ShellRunComponent } from '../../components/messages/shell/shell-run';
import { ToolCallComponent } from '../../components/messages/tool-call/index';
import { NO_ACTIVE_SESSION_MESSAGE } from '../../constant/liora-tui';
import type { AppearanceController } from '../appearance/index';
import type { SessionEventHandler } from '../session-event/handler';
import { currentTheme, getBuiltInPalette, getColorPalette, isBuiltInTheme } from '../../theme';
import type { ResolvedTheme, ThemeName } from '../../theme';
import { refreshShikiPalette } from '../../components/media/shiki-ansi';
import type { TUIState } from '../../tui-state';
import type { AppState, TranscriptDetailLevel, TranscriptEntry } from '../../types';
import { appearanceAnimationNow, resolveUltraworkBorderGlowHex } from '../../features/appearance/appearance-effects';
import { isExpandable } from '../../utils/component-capabilities';
import { formatErrorMessage } from '../../utils/event-payload';
import { pickForegroundTasks } from '../../utils/foreground-task';
import { requestTUIContentRender, requestTUILayoutRender } from '../../utils/render/frame-render';
import { isMotionTheatreActive, type MotionBeatController } from '../../utils/render/motion-beats';
import { installTerminalThemeTracking } from '../../utils/terminal/terminal-theme';
import {
  formatTranscriptDetailCycleLabel,
  getActiveNeatMode,
  nextTranscriptDetailLevel,
  setActiveNeatMode,
  setActiveTranscriptDetail,
} from '../../features/transcript/transcript-density';
import { TRANSCRIPT_EXPAND_TURNS } from '../../features/transcript/transcript-window';
import { ttui } from '../../utils/tui-i18n';

/** How long the one-shot "moved to background" footer hint stays visible. */
const DETACH_HINT_DISPLAY_MS = 4_000;

type EffectiveActivityPaneMode = ActivityPaneMode | 'idle' | 'session';
type LoadingTipKind = 'moon' | 'composing';

function loadingTipKind(mode: EffectiveActivityPaneMode): LoadingTipKind | undefined {
  if (mode === 'waiting' || mode === 'tool') return 'moon';
  if (mode === 'composing') return 'composing';
  return undefined;
}

/** Host surface required by pane presentation (activity, queue, transcript density, theme). */
export interface PanesHost {
  state: TUIState;
  session: Session | undefined;
  deferUserMessages: boolean;
  detachHintClearTimer: ReturnType<typeof setTimeout> | undefined;
  readonly shellOutputStreams: Map<
    string,
    { entry: TranscriptEntry; component: ShellRunComponent; taskId?: string }
  >;
  readonly motionBeats: MotionBeatController;
  readonly appearanceController: AppearanceController;
  readonly sessionEventHandler: SessionEventHandler;
  /** Turn-boundary lookup owned by transcript rendering; reused for the Ctrl+O expansion cutoff. */
  readonly transcriptRender: { isTurnBoundaryComponent(child: Component): boolean };
  setAppState(patch: Partial<AppState>): void;
  showError(msg: string): void;
}

/**
 * Activity / queue pane presentation, editor border highlight, theme apply,
 * and background-task detach hints.
 * LioraTUI keeps thin public delegates so call sites stay stable.
 */
export class PanesController {
  private lastActivityMode: string | undefined;
  private currentLoadingTip:
    | { kind: LoadingTipKind; tip: string | undefined; tipKey?: string; pinned: boolean }
    | undefined = undefined;
  private queueSettleSelectionIdentity: string | undefined;
  private queueSettleStartedAtMs: number | undefined;
  private terminalThemeTrackingDispose: (() => void) | undefined;

  constructor(private readonly host: PanesHost) {}

  updateActivityPane(): void {
    const { host } = this;
    const effectiveMode = this.resolveActivityPaneMode();
    const tipKind = loadingTipKind(effectiveMode);
    // Pick a fresh loading tip when the loading kind changes. The same kind
    // covers waiting/tool (both moon spinners) and any intermediate thinking
    // phase, so a continuous burst of tool calls does not flip tips. Clear the
    // cache only when there is no loading UI at all.
    if (effectiveMode === 'idle' || effectiveMode === 'session' || effectiveMode === 'hidden') {
      this.currentLoadingTip = undefined;
    } else if (tipKind !== undefined) {
      const pinnedTip = host.state.appState.activityTip ?? undefined;
      if (pinnedTip !== undefined) {
        if (
          this.currentLoadingTip === undefined ||
          this.currentLoadingTip.kind !== tipKind ||
          this.currentLoadingTip.tip !== pinnedTip ||
          !this.currentLoadingTip.pinned
        ) {
          this.currentLoadingTip = { kind: tipKind, tip: pinnedTip, pinned: true };
        }
      } else if (
        this.currentLoadingTip === undefined ||
        this.currentLoadingTip.kind !== tipKind ||
        this.currentLoadingTip.pinned
      ) {
        const previousKey = this.currentLoadingTip?.tipKey;
        const picked = pickRandomWorkingTip(previousKey);
        this.currentLoadingTip = {
          kind: tipKind,
          tip: picked === undefined ? undefined : tipText(picked),
          tipKey: picked?.key,
          pinned: false,
        };
      }
    }
    this.syncTerminalProgress(this.shouldShowTerminalProgress(effectiveMode));
    const placeSpinnerInAgentSwarm = this.shouldPlaceActivitySpinnerInAgentSwarm(effectiveMode);
    const activityModeKey = `${effectiveMode}:${placeSpinnerInAgentSwarm ? 'swarm' : 'pane'}`;

    if (
      activityModeKey === this.lastActivityMode &&
      (effectiveMode === 'waiting' || effectiveMode === 'thinking' || effectiveMode === 'tool')
    ) {
      if (placeSpinnerInAgentSwarm) {
        this.syncAgentSwarmActivitySpinner(host.state.activitySpinner?.instance);
      }
      return;
    }

    this.lastActivityMode = activityModeKey;
    host.state.activityContainer.clear();

    switch (effectiveMode) {
      case 'hidden':
        this.stopActivitySpinner();
        this.syncAgentSwarmActivitySpinner(undefined);
        requestTUILayoutRender(host.state);
        return;
      case 'waiting': {
        const spinner = this.ensureActivitySpinner('moon');
        // First-token wait can hang on open/handshake — surface stall after 30s.
        spinner.setStallAfterMs(30_000);
        this.syncAgentSwarmActivitySpinner(placeSpinnerInAgentSwarm ? spinner : undefined);
        if (placeSpinnerInAgentSwarm) break;
        host.state.activityContainer.addChild(
          new ActivityPaneComponent({
            mode: 'waiting',
            spinner,
            tip: this.currentLoadingTip?.tip,
          }),
        );
        break;
      }
      case 'thinking': {
        this.stopActivitySpinner();
        this.syncAgentSwarmActivitySpinner(undefined);
        host.state.activityContainer.addChild(
          new ActivityPaneComponent({
            mode: 'thinking',
          }),
        );
        host.motionBeats.play({
          name: 'thinking_enter',
          seed: 'thinking',
          title: 'Thinking',
          nowMs: appearanceAnimationNow(),
          theatreActive: isMotionTheatreActive(host.state.appState),
        });
        break;
      }
      case 'composing': {
        const spinner = this.ensureActivitySpinner('comet', 'working...', (s) =>
          currentTheme.fg('primary', s),
        );
        // Long healthy composes must not look "stalled".
        spinner.setStallAfterMs(undefined);
        this.syncAgentSwarmActivitySpinner(undefined);
        host.state.activityContainer.addChild(
          new ActivityPaneComponent({
            mode: 'composing',
            spinner,
            tip: this.currentLoadingTip?.tip,
          }),
        );
        break;
      }
      case 'tool': {
        const spinner = this.ensureActivitySpinner('moon');
        spinner.setStallAfterMs(undefined);
        this.syncAgentSwarmActivitySpinner(placeSpinnerInAgentSwarm ? spinner : undefined);
        if (placeSpinnerInAgentSwarm) break;
        host.state.activityContainer.addChild(
          new ActivityPaneComponent({
            mode: 'tool',
            spinner,
            tip: this.currentLoadingTip?.tip,
          }),
        );
        break;
      }
      case 'idle':
      case 'session': {
        this.stopActivitySpinner();
        this.syncAgentSwarmActivitySpinner(undefined);
        break;
      }
    }
    requestTUIContentRender(host.state);
  }

  private resolveActivityPaneMode(): EffectiveActivityPaneMode {
    const { host } = this;
    if (host.state.activeDialog === 'session-picker') return 'hidden';
    if (host.state.activeDialog === 'extensions') return 'hidden';
    if (host.state.livePane.pendingApproval !== null) return 'hidden';
    if (host.state.appState.isCompacting) return 'hidden';
    if (host.state.livePane.pendingQuestion !== null) return 'hidden';

    const streamingPhase = host.state.appState.streamingPhase;

    // A running `!` shell command shows the moon spinner (same as `waiting`)
    // until it finishes, signalling that input is busy / queued.
    if (streamingPhase === 'shell') return 'waiting';

    if (host.state.livePane.mode === 'idle') {
      if (streamingPhase === 'thinking' || streamingPhase === 'composing') {
        return streamingPhase;
      }
    }

    return host.state.livePane.mode;
  }

  updateQueueDisplay(): void {
    const { host } = this;
    host.state.queueContainer.clear();
    const queued = host.state.queuedMessages;
    if (queued.length === 0) {
      this.queueSettleSelectionIdentity = undefined;
      this.queueSettleStartedAtMs = undefined;
      return;
    }

    const selectedIndex = Math.max(0, queued.length - 1);
    const settle = resolveHostOwnedQueueSettleStartedAtMs({
      selectionIdentity: queuePaneSelectionIdentity(queued, selectedIndex),
      previousSelectionIdentity: this.queueSettleSelectionIdentity,
      previousSettleStartedAtMs: this.queueSettleStartedAtMs,
      nowMs: appearanceAnimationNow(),
    });
    this.queueSettleSelectionIdentity = settle.selectionIdentity;
    this.queueSettleStartedAtMs = settle.settleStartedAtMs;

    host.state.queueContainer.addChild(
      new QueuePaneComponent({
        messages: queued,
        isCompacting: host.state.appState.isCompacting,
        isStreaming: host.state.appState.streamingPhase !== 'idle',
        canSteerImmediately: !host.deferUserMessages,
        selectedIndex,
        settleStartedAtMs: settle.settleStartedAtMs,
      }),
    );
  }

  /**
   * Ctrl+O — cycle the 4-level transcript density model
   * (minimal → compact → standard → full → …).
   *
   * `full` also expands recent-turn tool/thinking bodies; other levels
   * collapse them. Replaces the old boolean expand/collapse toggle.
   */
  toggleToolOutputExpansion(): void {
    const { host } = this;
    const next = nextTranscriptDetailLevel(host.state.transcriptDetail);
    this.applyTranscriptDetail(next, { toast: true });
  }

  /** Apply the full-density expansion state to the most recent transcript turns. */
  private syncTranscriptExpansion(): void {
    const { host } = this;
    const children = host.state.transcriptContainer.children;
    const expandCutoff = this.resolveExpansionCutoff(children);
    const expanded = host.state.toolOutputExpanded;
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (!isExpandable(child)) continue;
      child.setExpanded(expanded && i >= expandCutoff);
    }
  }

  /**
   * Switch transcript density live (PREMIUM.md §7.9). Re-projects every
   * mounted tool card — including replayed history — and re-renders.
   * `/transcript` and the Settings appearance selector call this.
   */
  setTranscriptDetail(level: TranscriptDetailLevel): void {
    this.applyTranscriptDetail(level, { toast: false });
  }

  private applyTranscriptDetail(
    level: TranscriptDetailLevel,
    options: { readonly toast: boolean },
  ): void {
    const { host } = this;
    const changed = host.state.transcriptDetail !== level;
    if (!changed) {
      // Still re-assert expansion for the current level (e.g. after hydrate).
      host.state.toolOutputExpanded = level === 'full';
      this.syncTranscriptExpansion();
      if (options.toast) {
        host.state.toast.show(formatTranscriptDetailCycleLabel(level), 1600);
      }
      requestTUIContentRender(host.state);
      return;
    }
    host.state.transcriptDetail = level;
    setActiveTranscriptDetail(level);
    // `full` drives the legacy toolOutputExpanded flag used by thinking /
    // goal markers and the recent-turn expand cutoff.
    host.state.toolOutputExpanded = level === 'full';
    this.reprojectTranscriptChildren(level);
    this.syncTranscriptExpansion();
    if (options.toast) {
      host.state.toast.show(formatTranscriptDetailCycleLabel(level), 1600);
    }
    // Geometry may change (minimal hides tool rows) — layout, not paint-only.
    requestTUILayoutRender(host.state);
  }

  /**
   * Toggle neat mode live. Structured cards and raw bodies swap in place using
   * the same re-projection density uses, so `/neat` needs no reload.
   */
  setNeatMode(enabled: boolean): void {
    if (getActiveNeatMode() === enabled) return;
    setActiveNeatMode(enabled);
    // `setDetail` short-circuits on an unchanged level, so tool cards need the
    // explicit rebuild that `invalidate` performs.
    this.reprojectTranscriptChildren(undefined);
    requestTUILayoutRender(this.host.state);
  }

  private reprojectTranscriptChildren(level: TranscriptDetailLevel | undefined): void {
    for (const child of this.host.state.transcriptContainer.children) {
      if (child instanceof ToolCallComponent) {
        if (level === undefined) child.invalidate();
        else child.setDetail(level);
        continue;
      }
      // Thinking / answer / chain bar re-read active density on next paint.
      const soft = child as { softDropPaintCaches?: () => void; invalidate?: () => void };
      if (typeof soft.softDropPaintCaches === 'function') {
        soft.softDropPaintCaches();
      } else if (typeof soft.invalidate === 'function') {
        soft.invalidate();
      }
    }
  }

  /**
   * Index of the first component belonging to one of the most recent
   * `TRANSCRIPT_EXPAND_TURNS` turns. Position-based so it also covers
   * streaming components that have no entry in the metadata map.
   */
  private resolveExpansionCutoff(children: readonly Component[]): number {
    if (TRANSCRIPT_EXPAND_TURNS <= 0) return children.length;
    const boundaries: number[] = [];
    for (let i = 0; i < children.length; i++) {
      if (this.host.transcriptRender.isTurnBoundaryComponent(children[i]!)) boundaries.push(i);
    }
    return boundaries.length > TRANSCRIPT_EXPAND_TURNS
      ? boundaries[boundaries.length - TRANSCRIPT_EXPAND_TURNS]!
      : 0;
  }

  toggleTodoPanelExpansion(): void {
    const { host } = this;
    host.state.todoPanel.toggleExpanded();
    requestTUIContentRender(host.state);
  }

  private async detachRunningShellCommand(): Promise<void> {
    const { host } = this;
    // Only one `!` command runs at a time (input is queued while busy).
    const next = host.shellOutputStreams.entries().next();
    if (next.done) {
      this.showDetachHint('No shell command running.');
      return;
    }
    const [commandId, stream] = next.value;
    if (stream.taskId === undefined) {
      this.showDetachHint('Command is still starting — try again.');
      return;
    }
    const session = host.session;
    if (session === undefined) return;
    try {
      const info = await session.detachBackgroundTask(stream.taskId);
      if (info === undefined) {
        this.showDetachHint('Command already finished.');
        return;
      }
    } catch (error) {
      host.showError(`Failed to move to background: ${formatErrorMessage(error)}`);
      return;
    }
    // Finalize the card as backgrounded and drop the stream so the eventual
    // runShellCommand resolution (which carries background metadata) is a no-op
    // instead of overwriting this view.
    stream.component.finishBackgrounded();
    stream.entry.content = 'Moved to background.';
    host.shellOutputStreams.delete(commandId);
    // The backgrounded command's notification turn (started by agent-core via
    // appendSystemReminderAndNotify) owns the streaming phase and drains the
    // queue when it completes, so we intentionally leave both untouched here.
    this.showDetachHint(ttui('tui.footer.detachHint'));
  }

  async detachCurrentForegroundTask(): Promise<void> {
    const { host } = this;
    // A running `!` shell command takes priority over agent foreground tasks.
    if (host.shellOutputStreams.size > 0) {
      await this.detachRunningShellCommand();
      return;
    }

    const session = host.session;
    if (session === undefined) {
      host.showError(NO_ACTIVE_SESSION_MESSAGE);
      return;
    }

    let tasks: readonly BackgroundTaskInfo[];
    try {
      // activeOnly defaults to true; foreground running tasks are non-terminal
      // and therefore included. We filter to `detached === false` ourselves.
      tasks = await session.listBackgroundTasks();
    } catch (error) {
      host.showError(`Failed to list tasks: ${formatErrorMessage(error)}`);
      return;
    }

    const targets = pickForegroundTasks(tasks);
    if (targets.length === 0) {
      this.showDetachHint('No foreground task running.');
      return;
    }

    let detached = 0;
    let alreadyFinished = 0;
    for (const target of targets) {
      try {
        const info = await session.detachBackgroundTask(target.taskId);
        if (info === undefined) alreadyFinished++;
        else detached++;
      } catch (error) {
        host.showError(`Failed to detach ${target.taskId}: ${formatErrorMessage(error)}`);
      }
    }

    let hint: string;
    if (detached === 0 && alreadyFinished > 0) {
      hint = alreadyFinished === 1 ? 'Task already finished.' : 'Tasks already finished.';
    } else if (detached === targets.length) {
      hint = detached === 1 ? 'Moved 1 task to background.' : `Moved ${detached} tasks to background.`;
    } else {
      hint = `Moved ${detached} of ${targets.length} tasks to background.`;
    }
    if (detached > 0) hint = `${hint} /tasks to view.`;
    this.showDetachHint(hint);
  }

  /** Show a one-shot footer hint that auto-clears after DETACH_HINT_DISPLAY_MS. */
  private showDetachHint(hint: string): void {
    const { host } = this;
    if (host.detachHintClearTimer !== undefined) {
      clearTimeout(host.detachHintClearTimer);
      host.detachHintClearTimer = undefined;
    }
    host.state.footer.setTransientHint(hint);
    const timer = setTimeout(() => {
      host.detachHintClearTimer = undefined;
      // Don't clobber a newer transient hint (e.g. the exit-confirmation
      // prompt) that took over while this timer was pending.
      if (host.state.footer.getTransientHint() !== hint) return;
      host.state.footer.setTransientHint(null);
      requestTUIContentRender(host.state);
    }, DETACH_HINT_DISPLAY_MS);
    timer.unref?.();
    host.detachHintClearTimer = timer;
    requestTUIContentRender(host.state);
  }

  updateEditorBorderHighlight(text?: string): void {
    const { host } = this;
    const trimmed = (text ?? host.state.editor.getText()).trimStart();
    const isBash = host.state.appState.inputMode === 'bash';
    const ultrawork = host.state.appState.ultraworkMode === true;
    const highlighted =
      host.state.appState.planMode || ultrawork || isBash || trimmed.startsWith('/');
    const prevHighlighted = host.state.editor.borderHighlighted;
    host.state.editor.borderHighlighted = highlighted;
    // Shell mode: fixed hue. Ultrawork: live multi-hue glow. Plan/slash: primary.
    if (isBash) {
      host.state.editor.borderColor = (s: string) => currentTheme.fg('shellMode', s);
    } else if (ultrawork) {
      // Native layout resolves the live glow hex on animation frames. Do not
      // re-bind chalk + force a second full paint on every keystroke.
      const hex = resolveUltraworkBorderGlowHex(appearanceAnimationNow());
      host.state.editor.borderColor = (s: string) => chalk.hex(hex).bold(s);
    } else if (highlighted) {
      host.state.editor.borderColor = (s: string) => currentTheme.fg('primary', s);
    } else {
      host.state.editor.borderColor = (s: string) => currentTheme.fg('border', s);
    }
    // Only repaint when the highlight *state* flips (plan/slash/bash/ultrawork).
    // Ultrawork chase is driven by the animation scheduler, not onChange.
    if (prevHighlighted === highlighted) return;
    requestTUIContentRender(host.state);
  }

  async applyTheme(themeName: ThemeName, resolved?: ResolvedTheme): Promise<void> {
    const { host } = this;
    const palette = await getColorPalette(themeName === 'auto' ? (resolved ?? 'dark') : themeName);
    currentTheme.setPalette(palette);
    refreshShikiPalette(palette);
    host.setAppState({ theme: themeName });
    host.appearanceController.apply();
    this.updateEditorBorderHighlight();
    // Force every historical message to re-render so Markdown/Text caches
    // (which hold old ANSI colour codes) are cleared.
    host.state.transcriptContainer.invalidate();
    requestTUILayoutRender(host.state);
  }

  refreshTerminalThemeTracking(): void {
    const { host } = this;
    this.stopTerminalThemeTracking();
    if (!isBuiltInTheme(host.state.appState.theme) || host.state.appState.theme !== 'auto') return;

    this.terminalThemeTrackingDispose = installTerminalThemeTracking(host.state, (resolved) => {
      void this.applyResolvedAutoTheme(resolved);
    });
  }

  stopTerminalThemeTracking(): void {
    this.terminalThemeTrackingDispose?.();
    this.terminalThemeTrackingDispose = undefined;
  }

  private async applyResolvedAutoTheme(resolved: ResolvedTheme): Promise<void> {
    const { host } = this;
    if (host.state.appState.theme !== 'auto') return;
    const palette = getBuiltInPalette(resolved);
    if (currentTheme.palette === palette) return;
    currentTheme.setPalette(palette);
    refreshShikiPalette(palette);
    host.appearanceController.apply();
    this.updateEditorBorderHighlight();
    // Repaint already-rendered transcript entries (status/markdown caches hold
    // old ANSI codes), matching applyTheme()'s behaviour.
    host.state.transcriptContainer.invalidate();
    requestTUILayoutRender(host.state);
  }

  private shouldShowTerminalProgress(effectiveMode: EffectiveActivityPaneMode): boolean {
    const { host } = this;
    if (host.state.appState.isCompacting) return true;
    return (
      effectiveMode === 'waiting' ||
      effectiveMode === 'thinking' ||
      effectiveMode === 'composing' ||
      effectiveMode === 'tool'
    );
  }

  private shouldPlaceActivitySpinnerInAgentSwarm(
    effectiveMode: EffectiveActivityPaneMode,
  ): boolean {
    return (
      this.host.sessionEventHandler.hasActiveAgentSwarmToolCall() &&
      (effectiveMode === 'waiting' || effectiveMode === 'tool')
    );
  }

  private syncAgentSwarmActivitySpinner(spinner: MoonLoader | undefined): void {
    this.host.sessionEventHandler.syncAgentSwarmActivitySpinner(spinner);
  }

  private syncTerminalProgress(active: boolean): void {
    const { host } = this;
    if (!host.state.terminalState.supportsProgress) return;
    if (host.state.terminalState.progressActive === active) return;
    host.state.terminal.setProgress?.(active);
    host.state.terminalState.progressActive = active;
  }

  private ensureActivitySpinner(
    style: SpinnerStyle,
    label = '',
    colorFn?: (s: string) => string,
  ): MoonLoader {
    const { host } = this;
    if (host.state.activitySpinner?.style !== style) {
      this.stopActivitySpinner();
    }

    if (host.state.activitySpinner === null) {
      const instance = new MoonLoader(host.state.ui, style, colorFn, label);
      host.state.activitySpinner = { instance, style };
      return instance;
    }

    host.state.activitySpinner.instance.setLabel(label);
    if (colorFn !== undefined) {
      host.state.activitySpinner.instance.setColorFn(colorFn);
    }
    return host.state.activitySpinner.instance;
  }

  private stopActivitySpinner(): void {
    const { host } = this;
    if (host.state.activitySpinner !== null) {
      host.state.activitySpinner.instance.stop();
      host.state.activitySpinner = null;
    }
  }
}
