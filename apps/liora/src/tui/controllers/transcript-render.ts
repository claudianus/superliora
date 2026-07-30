import type { ApprovalRequest, ApprovalResponse } from '@superliora/sdk';
import type { DeviceAuthorization } from '@superliora/oauth';

import { openUrl } from '#/utils/open-url';

import type { Component } from '../renderer';
import { encodeRendererClearInlineImages, Spacer } from '../renderer';
import { DeviceCodeBoxComponent } from '../components/chrome/device-code-box';
import { IdleStageComponent } from '../components/chrome/idle-stage';
import { MoonLoader } from '../components/chrome/moon-loader';
import { SplashComponent, shouldPlaySplash } from '../components/chrome/splash';
import { WelcomeComponent } from '../components/chrome/welcome';
import { CompactionComponent } from '../components/dialogs/compaction';
import { AssistantMessageComponent } from '../components/messages/assistant-message';
import { BackgroundAgentStatusComponent } from '../components/messages/background-agent-status';
import { CronMessageComponent } from '../components/messages/cron-message';
import { buildGoalMarker } from '../components/messages/goal-markers';
import {
  GoalCompletionMessageComponent,
  GoalSetMessageComponent,
} from '../components/messages/goal-panel';
import { PluginCommandComponent } from '../components/messages/plugin-command';
import { SkillActivationComponent } from '../components/messages/skill-activation';
import { StepSummaryComponent } from '../components/messages/step-summary';
import {
  NoticeMessageComponent,
  StatusMessageComponent,
} from '../components/messages/status-message';
import { ThinkingComponent } from '../components/messages/thinking';
import { ToolCallComponent } from '../components/messages/tool-call/index';
import { UserMessageComponent } from '../components/messages/user-message';
import type { ShowNoticeOptions } from '../commands/dispatch';
import { DEFAULT_APPEARANCE_PREFERENCES } from '../config';
import type { AppearanceController } from './appearance';
import type { BtwPanelController } from './btw-panel';
import type { SessionEventHandler } from './session-event/handler';
import type { StreamingUIController } from './streaming-ui/index';
import { currentTheme } from '../theme';
import type { ColorToken } from '../theme';
import type { TUIState } from '../tui-state';
import type { ImageAttachment, ImageAttachmentStore } from '../utils/image/image-attachment-store';
import { resolveImageProtocol } from '../utils/image/image-protocol-detect';
import type {
  LoginProgressSpinnerHandle,
  TranscriptEntry,
} from '../types';
import { buildSplashMorphScene } from '../utils/splash/splash-reveal-preview';
import { hasDispose } from '../utils/component-capabilities';
import { noteErrorFeedback } from '../utils/render/feedback-vfx';
import { requestTUIContentRender, requestTUILayoutRender } from '../utils/render/frame-render';
import {
  getTranscriptComponentEntry,
  markTranscriptComponent,
} from '../features/transcript/transcript-component-metadata';
import { nextTranscriptId } from '../features/transcript/transcript-id';
import {
  TRANSCRIPT_HYSTERESIS,
  TRANSCRIPT_KEEP_RECENT_STEPS,
  TRANSCRIPT_MAX_TURNS,
  TRANSCRIPT_WINDOW_ENABLED,
  groupTurns,
  turnsToTrim,
} from '../features/transcript/transcript-window';

/** Host surface required by transcript rendering, turn management, and the startup splash. */
export interface TranscriptRenderHost {
  state: TUIState;
  splash: SplashComponent | undefined;
  splashSavedChildren: Component[] | undefined;
  splashForcesAmbient: boolean;
  readonly imageStore: ImageAttachmentStore;
  readonly streamingUI: StreamingUIController;
  readonly sessionEventHandler: SessionEventHandler;
  readonly appearanceController: AppearanceController;
  readonly btwPanelController: BtwPanelController;
  syncGoalMonitorPanel(): void;
}

/**
 * Transcript entry -> component mapping, turn window trimming/merging,
 * transcript-level status/notice helpers, and the startup cinematic splash.
 * LioraTUI keeps thin public delegates so call sites stay stable.
 */
export class TranscriptRenderController {
  constructor(private readonly host: TranscriptRenderHost) {}

  private createTranscriptComponent(entry: TranscriptEntry): Component | null {
    const { host } = this;
    if (entry.compactionData !== undefined) {
      const data = entry.compactionData;
      const block = new CompactionComponent(host.state.ui, data.instruction);
      if (data.result === 'cancelled') {
        block.markCanceled();
      } else {
        block.markDone(data.tokensBefore, data.tokensAfter);
      }
      return block;
    }

    switch (entry.kind) {
      case 'user': {
        const images = entry.imageAttachmentIds
          ?.map((id) => host.imageStore.get(id))
          .filter((a): a is ImageAttachment => a?.kind === 'image');
        return new UserMessageComponent(entry.content, images, entry.bullet, entry.timestamp);
      }
      case 'skill_activation':
        return new SkillActivationComponent(
          entry.skillName ?? entry.content,
          entry.skillArgs,
          entry.skillTrigger,
        );
      case 'plugin_command':
        return new PluginCommandComponent(
          entry.pluginId ?? '',
          entry.pluginCommandName ?? entry.content,
          entry.pluginCommandArgs,
          entry.pluginCommandTrigger,
        );
      case 'cron':
        return new CronMessageComponent(entry.content, entry.cronData ?? {});
      case 'goal':
        if (entry.goalData?.kind === 'created') {
          return new GoalSetMessageComponent();
        }
        if (entry.goalData?.kind === 'lifecycle') {
          return buildGoalMarker(entry.goalData.change, host.state.toolOutputExpanded);
        }
        return null;
      case 'assistant': {
        if (entry.content.trimStart().startsWith('✓ Goal complete')) {
          return new GoalCompletionMessageComponent(entry.content);
        }
        const component = new AssistantMessageComponent();
        component.updateContent(entry.content);
        return component;
      }
      case 'thinking': {
        const thinking = new ThinkingComponent(entry.content, true);
        if (host.state.toolOutputExpanded) thinking.setExpanded(true);
        return thinking;
      }
      case 'tool_call':
        if (entry.toolCallData) {
          const tc = new ToolCallComponent(
            entry.toolCallData,
            entry.toolCallData.result,
            host.state.ui,
            host.state.appState.workDir,
            host.state.toolOutputViewports,
          );
          if (host.state.toolOutputExpanded) tc.setExpanded(true);
          tc.setDetail(host.state.transcriptDetail);
          return tc;
        }
        if (entry.backgroundAgentStatus !== undefined) {
          return new BackgroundAgentStatusComponent(entry.backgroundAgentStatus);
        }
        return entry.renderMode === 'notice'
          ? new NoticeMessageComponent(entry.content, entry.detail)
          : new StatusMessageComponent(entry.content, entry.color);
      case 'status':
        if (entry.backgroundAgentStatus !== undefined) {
          return new BackgroundAgentStatusComponent(entry.backgroundAgentStatus);
        }
        return entry.renderMode === 'notice'
          ? new NoticeMessageComponent(entry.content, entry.detail)
          : new StatusMessageComponent(entry.content, entry.color);
      case 'welcome':
        return null;
      default:
        return null;
    }
  }

  appendTranscriptEntry(entry: TranscriptEntry): void {
    const { host } = this;
    host.state.transcriptEntries.push(entry);
    const component = this.createTranscriptComponent(entry);
    if (component) {
      markTranscriptComponent(component, entry);
      host.state.transcriptContainer.addChild(component);
    }
    // Session hydrate: frames are suppressed and merge uses a high water-mark
    // so we only collapse when a turn is far over the keep window (not every entry).
    if (host.state.appState.isReplaying) {
      this.mergeCurrentTurnSteps();
      return;
    }
    const trimmed = this.trimTranscriptWindow();
    const merged = this.mergeCurrentTurnSteps();
    if (component || trimmed || merged) {
      requestTUIContentRender(host.state);
    }
  }

  appendApprovalTranscriptEntry(request: ApprovalRequest, response: ApprovalResponse): void {
    if (
      request.toolName === 'ExitPlanMode' ||
      request.display.kind === 'plan_review' ||
      request.display.kind === 'goal_start'
    )
      return;
    const parts: string[] = [];
    switch (response.decision) {
      case 'approved':
        parts.push(response.scope === 'session' ? 'Approved for session' : 'Approved');
        break;
      case 'rejected':
        parts.push('Rejected');
        break;
      case 'cancelled':
        parts.push('Cancelled');
        break;
    }
    parts.push(`: ${request.action}`);
    if (response.feedback !== undefined && response.feedback.length > 0) {
      parts.push(` — "${response.feedback}"`);
    }
    this.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'status',
      turnId: request.turnId === undefined ? undefined : String(request.turnId),
      renderMode: 'notice',
      content: parts.join(''),
    });
  }

  renderWelcome(): void {
    const { host } = this;
    if (
      !host.state.transcriptContainer.children.some((child) => child instanceof WelcomeComponent)
    ) {
      host.state.transcriptContainer.addChild(new WelcomeComponent(host.state.appState));
    }
    // Ambient empty-stage under welcome: vanishes on first real transcript child.
    // preferredRows tracks the live transcript region so the night sky fills
    // the empty pane (no hard 14-row cap). Suppress while session history replays.
    if (host.state.appState.isReplaying) {
      host.state.transcriptContainer.dismissIdleStage();
      return;
    }
    if (
      !host.state.transcriptContainer.children.some((child) => child instanceof IdleStageComponent)
    ) {
      host.state.transcriptContainer.addChild(
        new IdleStageComponent({
          state: host.state.appState,
          getPreferredRows: (width) => host.state.transcriptContainer.idleTargetRows(width),
        }),
      );
    }
  }

  /**
   * Take over the full UI for a cinematic splash, then restore chrome.
   * Skips immediately when shouldAnimate / motionEffectsAllowed is false.
   */
  async playStartupSplash(): Promise<void> {
    const { host } = this;
    this.disposeStartupSplash();
    const splash = new SplashComponent({
      appearance: host.state.appState.appearance ?? DEFAULT_APPEARANCE_PREFERENCES,
      getRows: () => Math.max(8, host.state.terminal.rows),
      requestRender: () => {
        // Layout invalidation so the native frame path repaints the takeover.
        requestTUILayoutRender(host.state);
      },
      getMorphScene: (width, rows) => {
        const stageWidth = Math.max(1, width);
        return buildSplashMorphScene({
          width,
          rows,
          appState: host.state.appState,
          headerLines: host.state.headerContainer.render(stageWidth),
          footerLines: host.state.footerContainer.render(stageWidth),
          editorLines: host.state.editorContainer.render(stageWidth),
        });
      },
      onSplashActiveChange: (active) => {
        host.splashForcesAmbient = active;
        host.appearanceController.apply();
      },
    });
    // Fast path: do not steal the UI tree when motion is off.
    if (!shouldPlaySplash(host.state.appState.appearance ?? DEFAULT_APPEARANCE_PREFERENCES)) {
      splash.dispose();
      return;
    }

    host.splash = splash;
    const savedChildren = [...host.state.ui.children];
    host.splashSavedChildren = savedChildren;
    host.state.ui.clear();
    host.state.ui.addChild(splash);
    requestTUILayoutRender(host.state);
    try {
      await splash.play();
    } finally {
      this.disposeStartupSplash();
    }
  }

  disposeStartupSplash(): void {
    const { host } = this;
    const splash = host.splash;
    const saved = host.splashSavedChildren;
    host.splash = undefined;
    host.splashSavedChildren = undefined;
    splash?.dispose();
    if (host.splashForcesAmbient) {
      host.splashForcesAmbient = false;
      host.appearanceController.apply();
    }
    if (saved !== undefined) {
      // Flag: the next native frame must not full-clear — the last morph frame
      // is still on screen and the real UI paints over it without a black flash.
      host.state.splashJustDisposed = true;
      host.state.ui.clear();
      for (const child of saved) {
        host.state.ui.addChild(child);
      }
      host.state.ui.setFocus(host.state.editor);
      requestTUILayoutRender(host.state);
      return;
    }
    // Splash never stole the tree (skip path) — nothing to restore.
  }

  private clearTerminalInlineImages(): void {
    const { host } = this;
    const sequence = encodeRendererClearInlineImages(resolveImageProtocol());
    if (sequence.length > 0) host.state.terminal.write(sequence);
  }

  clearTranscriptAndRedraw(): void {
    const { host } = this;
    host.streamingUI.discardPending();
    host.state.transcriptEntries = [];
    host.streamingUI.disposeActiveCompactionBlock();
    host.streamingUI.resetLiveText();
    host.streamingUI.resetToolUi();
    host.sessionEventHandler.stopAllMcpServerStatusSpinners();
    // Dispose disposable children (e.g. ShellRunComponent's 1s timer) before
    // dropping them, so a /clear or session switch can't leak intervals that
    // keep firing requestRender on a removed component.
    for (const child of host.state.transcriptContainer.children) {
      if (hasDispose(child)) child.dispose();
    }
    host.state.transcriptContainer.clear();
    host.state.transcriptContainer.invalidate();
    host.btwPanelController.clear();
    this.clearTerminalInlineImages();
    // Drop todo cards, then re-bind any live goal from appState so session
    // switches (goal already hydrated) and mid-session redraws keep the
    // monitor chrome. New sessions null goal before/after this via setAppState.
    host.state.todoPanel.clear();
    host.state.todoPanelContainer.clear();
    host.syncGoalMonitorPanel();
    host.imageStore.clear();
    this.renderWelcome();
    requestTUILayoutRender(host.state);
  }

  isTurnBoundaryComponent(child: Component): boolean {
    if (!(child instanceof UserMessageComponent) && !(child instanceof PluginCommandComponent)) {
      return false;
    }
    const entry = getTranscriptComponentEntry(child);
    if (entry === undefined) return false;
    // Live user messages have an undefined turnId; replayed user messages get a
    // `replay:N` turnId. Both start a new turn. Steer messages carry a defined
    // non-replay turnId and are not boundaries.
    return entry.turnId === undefined || entry.turnId.startsWith('replay:');
  }

  private trimTranscriptWindow(): boolean {
    const { host } = this;
    if (!TRANSCRIPT_WINDOW_ENABLED || TRANSCRIPT_MAX_TURNS <= 0) return false;
    // Session replay already caps history to its own turn limit; trimming during
    // replay would shrink it further and fight that limit.
    if (host.state.appState.isReplaying) return false;

    const children = host.state.transcriptContainer.children;

    // Trim whole turns by *position* in the child list rather than by entry
    // lookup — otherwise only the (registered) user message would be removed and
    // the rest of the turn would be left behind.
    const boundaries: number[] = [];
    for (let i = 0; i < children.length; i++) {
      if (this.isTurnBoundaryComponent(children[i]!)) boundaries.push(i);
    }

    const turns = groupTurns(host.state.transcriptEntries);

    const toRemove = turnsToTrim(turns, TRANSCRIPT_MAX_TURNS, TRANSCRIPT_HYSTERESIS);
    if (toRemove.size === 0) return false;

    let boundariesToRemove = 0;
    for (const entry of toRemove) {
      if (entry.kind === 'user' && entry.turnId === undefined) boundariesToRemove++;
    }
    if (boundariesToRemove === 0) {
      host.state.transcriptEntries = host.state.transcriptEntries.filter((e) => !toRemove.has(e));
      return true;
    }

    let boundariesSeen = 0;
    let cutoff = 0;
    for (let i = 0; i < children.length; i++) {
      if (this.isTurnBoundaryComponent(children[i]!)) {
        if (boundariesSeen === boundariesToRemove) {
          cutoff = i;
          break;
        }
        boundariesSeen++;
      }
    }

    const componentsToRemove: Component[] = [];
    for (let i = 0; i < cutoff; i++) {
      const child = children[i]!;
      if (child instanceof WelcomeComponent) continue;
      componentsToRemove.push(child);
    }
    for (const child of componentsToRemove) {
      // pi-tui Container.removeChild (not a DOM node); `child.remove()` does not exist.
      // oxlint-disable-next-line unicorn/prefer-dom-node-remove
      host.state.transcriptContainer.removeChild(child);
      if (hasDispose(child)) child.dispose();
    }

    host.state.transcriptEntries = host.state.transcriptEntries.filter((e) => !toRemove.has(e));
    return true;
  }

  mergeCurrentTurnSteps(): boolean {
    const { host } = this;
    if (TRANSCRIPT_KEEP_RECENT_STEPS <= 0) return false;
    const children = host.state.transcriptContainer.children;

    // Find the start of the current turn (last turn-starting user message).
    let turnStart = -1;
    for (let i = children.length - 1; i >= 0; i--) {
      if (this.isTurnBoundaryComponent(children[i]!)) {
        turnStart = i;
        break;
      }
    }
    if (turnStart < 0) return false;

    // Locate an existing summary, the assistant message, and the mergeable steps.
    let summaryIndex = -1;
    const stepIndices: number[] = [];
    for (let i = turnStart + 1; i < children.length; i++) {
      const child = children[i]!;
      if (child instanceof StepSummaryComponent) {
        summaryIndex = i;
        continue;
      }
      if (child instanceof AssistantMessageComponent) continue;
      stepIndices.push(i);
    }

    // Live: merge as soon as we exceed the keep window.
    // Hydrate: wait until well over the window so we do not rebuild the turn
    // on every tool result (O(n²)), while still bounding component count.
    const mergeThreshold = host.state.appState.isReplaying
      ? TRANSCRIPT_KEEP_RECENT_STEPS + Math.max(TRANSCRIPT_KEEP_RECENT_STEPS, 20)
      : TRANSCRIPT_KEEP_RECENT_STEPS;
    if (stepIndices.length <= mergeThreshold) return false;
    const mergeCount = stepIndices.length - TRANSCRIPT_KEEP_RECENT_STEPS;
    const toMergeIndices = stepIndices.slice(0, mergeCount);

    let thinkingCount = 0;
    let toolCount = 0;
    for (const idx of toMergeIndices) {
      const child = children[idx]!;
      if (child instanceof ThinkingComponent) thinkingCount++;
      else if (child instanceof ToolCallComponent) toolCount++;
    }
    if (thinkingCount === 0 && toolCount === 0) return false;

    let summary: StepSummaryComponent;
    if (summaryIndex >= 0) {
      summary = children[summaryIndex] as StepSummaryComponent;
      summary.addCounts(thinkingCount, toolCount);
    } else {
      summary = new StepSummaryComponent();
      summary.addCounts(thinkingCount, toolCount);
    }

    // Rebuild children: keep everything except the merged steps, with the summary
    // sitting right after the user message.
    const toMergeSet = new Set(toMergeIndices);
    const newChildren: Component[] = [];
    for (let i = 0; i <= turnStart; i++) newChildren.push(children[i]!);
    newChildren.push(summary);
    for (let i = turnStart + 1; i < children.length; i++) {
      if (i === summaryIndex) continue;
      if (toMergeSet.has(i)) continue;
      newChildren.push(children[i]!);
    }

    for (const idx of toMergeIndices) {
      const child = children[idx]!;
      if (hasDispose(child)) child.dispose();
    }

    children.splice(0, children.length, ...newChildren);
    return true;
  }

  mergeAllTurnSteps(): void {
    const { host } = this;
    if (TRANSCRIPT_KEEP_RECENT_STEPS <= 0) return;
    const children = host.state.transcriptContainer.children;

    const boundaries: number[] = [];
    for (let i = 0; i < children.length; i++) {
      if (this.isTurnBoundaryComponent(children[i]!)) boundaries.push(i);
    }
    if (boundaries.length === 0) return;

    const newChildren: Component[] = [];
    const toDispose: Component[] = [];
    for (let i = 0; i < boundaries[0]!; i++) newChildren.push(children[i]!);

    for (let t = 0; t < boundaries.length; t++) {
      const turnStart = boundaries[t]!;
      const turnEnd = t + 1 < boundaries.length ? boundaries[t + 1]! : children.length;
      newChildren.push(children[turnStart]!);

      let summaryIndex = -1;
      const stepIndices: number[] = [];
      for (let i = turnStart + 1; i < turnEnd; i++) {
        const child = children[i]!;
        if (child instanceof StepSummaryComponent) summaryIndex = i;
        else if (child instanceof AssistantMessageComponent) continue;
        else stepIndices.push(i);
      }

      if (stepIndices.length > TRANSCRIPT_KEEP_RECENT_STEPS) {
        const mergeCount = stepIndices.length - TRANSCRIPT_KEEP_RECENT_STEPS;
        const toMergeIndices = stepIndices.slice(0, mergeCount);
        let thinkingCount = 0;
        let toolCount = 0;
        for (const idx of toMergeIndices) {
          const child = children[idx]!;
          if (child instanceof ThinkingComponent) thinkingCount++;
          else if (child instanceof ToolCallComponent) toolCount++;
        }
        let summary: StepSummaryComponent;
        if (summaryIndex >= 0) {
          summary = children[summaryIndex] as StepSummaryComponent;
          summary.addCounts(thinkingCount, toolCount);
        } else {
          summary = new StepSummaryComponent();
          summary.addCounts(thinkingCount, toolCount);
        }
        newChildren.push(summary);
        for (const idx of toMergeIndices) toDispose.push(children[idx]!);
        const toMergeSet = new Set(toMergeIndices);
        for (let i = turnStart + 1; i < turnEnd; i++) {
          if (i === summaryIndex) continue;
          if (toMergeSet.has(i)) continue;
          newChildren.push(children[i]!);
        }
      } else {
        for (let i = turnStart + 1; i < turnEnd; i++) newChildren.push(children[i]!);
      }
    }

    for (const child of toDispose) {
      if (hasDispose(child)) child.dispose();
    }
    children.splice(0, children.length, ...newChildren);
  }

  showStatus(message: string, color?: ColorToken): void {
    const { host } = this;
    host.state.transcriptContainer.addChild(new StatusMessageComponent(message, color));
    requestTUILayoutRender(host.state);
  }

  showNotice(title: string, detail?: string, options?: ShowNoticeOptions): void {
    const { host } = this;
    const coalesceKey = options?.coalesceKey;
    if (coalesceKey !== undefined) {
      const { children } = host.state.transcriptContainer;
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child instanceof NoticeMessageComponent && child.coalesceKey === coalesceKey) {
          children.splice(index, 1);
        }
      }
    }
    host.state.transcriptContainer.addChild(
      new NoticeMessageComponent(title, detail, coalesceKey),
    );
    requestTUILayoutRender(host.state);
  }

  showError(message: string): void {
    noteErrorFeedback();
    this.showStatus(`Error: ${message}`, 'error');
  }

  showLoginProgressSpinner(label: string): LoginProgressSpinnerHandle {
    return this.showProgressSpinner(label);
  }

  showProgressSpinner(label: string): LoginProgressSpinnerHandle {
    const { host } = this;
    const tint = (s: string): string => currentTheme.fg('primary', s);
    const spinner = new MoonLoader(host.state.ui, 'braille', tint, label);
    host.state.transcriptContainer.addChild(new Spacer(1));
    host.state.transcriptContainer.addChild(spinner);
    requestTUIContentRender(host.state);
    return {
      stop: ({ ok, label: finalLabel }) => {
        spinner.stop();
        const tone = ok ? 'success' : 'error';
        const symbol = ok ? '✓' : '✗';
        spinner.setText(currentTheme.fg(tone, `${symbol} ${finalLabel}`));
        requestTUILayoutRender(host.state);
      },
      setLabel: (nextLabel) => {
        spinner.setLabel(nextLabel);
      },
    };
  }

  showLoginAuthorizationPrompt(auth: DeviceAuthorization): LoginProgressSpinnerHandle {
    const { host } = this;
    openUrl(auth.verificationUriComplete);
    host.state.transcriptContainer.addChild(
      new DeviceCodeBoxComponent({
        title: 'Sign in to SuperLiora',
        url: auth.verificationUriComplete,
        code: auth.userCode,
        hint: 'Press Ctrl-C to cancel',
      }),
    );
    requestTUIContentRender(host.state);
    return this.showLoginProgressSpinner('Waiting for authorization…');
  }
}
