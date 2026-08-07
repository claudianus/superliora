import type {
  AssistantDeltaEvent,
  GoalChange,
  ThinkingDeltaEvent,
  TokenUsage,
  TurnEndedEvent,
  TurnStartedEvent,
  TurnStepCompletedEvent,
  TurnStepInterruptedEvent,
  TurnStepRetryingEvent,
  TurnStepStartedEvent,
} from '@superliora/sdk';

import { buildGoalMarker } from '../../components/messages/goal/goal-markers';
import type { AppState, LivePaneState, QueuedMessage, TranscriptEntry } from '../../types';
import type { TUIState } from '../../tui-state';
import type { ColorToken } from '#/tui/theme';
import { formatStepDebugTiming } from '#/utils/usage/debug-timing';
import { formatTokenCount } from '#/utils/usage/usage-format';
import {
  decideModelRouteSurface,
  modelRouteDisplayName,
} from '../../utils/model/model-route-notice';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { nextTranscriptId } from '../../features/transcript/transcript-id';
import { notifyTurnComplete } from '../../utils/notification/desktop-notification';
import { appendHostTtftMsSample } from '../../utils/host/host-glance';
import type { StreamingUIController } from '../streaming-ui/index';

/** Host surface required by turn / step / assistant / thinking event handling. */
export interface TurnEventHost {
  state: TUIState;
  readonly streamingUI: StreamingUIController;
  setAppState(patch: Partial<AppState>): void;
  patchLivePane(patch: Partial<LivePaneState>): void;
  showError(msg: string): void;
  showStatus(msg: string, color?: ColorToken): void;
  showNotice(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  appendTranscriptEntry(entry: TranscriptEntry): void;
  setLastTurnFailed(failed: boolean): void;
}

/**
 * Coordination owned by SessionEventHandler because goal-queue / hook.result
 * also read/write the shared flags, and goal promotion lives on a sibling
 * delegate. Injected so turn end promotion stays coordinated.
 */
export interface TurnEventCoordination {
  scheduleQueuedGoalPromotion(): void;
  setCurrentTurnHasAssistantText(value: boolean): void;
  setGoalCompletionTurnEnded(value: boolean): void;
  getPendingModelBlockedFallback(): GoalChange | undefined;
  setPendingModelBlockedFallback(value: GoalChange | undefined): void;
}

export class SessionEventTurn {
  private currentTurnUsage: TokenUsage | undefined;

  constructor(
    private readonly host: TurnEventHost,
    private readonly coordination: TurnEventCoordination,
  ) {}

  resetRuntimeState(): void {
    this.currentTurnUsage = undefined;
  }

  handleTurnBegin(_event: TurnStartedEvent): void {
    void _event;
    this.coordination.setCurrentTurnHasAssistantText(false);
    this.currentTurnUsage = undefined;
    this.host.streamingUI.resetToolUi();
    this.host.streamingUI.setStep(0);
    this.host.patchLivePane({
      mode: 'waiting',
      pendingApproval: null,
      pendingQuestion: null,
    });
    this.host.setAppState({
      streamingPhase: 'waiting',
      streamingStartTime: Date.now(),
    });
  }

  handleTurnEnd(event: TurnEndedEvent, sendQueued: (item: QueuedMessage) => void): void {
    this.host.streamingUI.flushNow();
    if (event.reason === 'filtered') {
      // Loop37a: status alone is easy to miss; named notice + goal-pause implication.
      this.host.showNotice(
        'Provider safety filter',
        'The provider blocked this response (turn reason=filtered). The active Goal is paused for safety policy — change approach, switch model, or resume after reviewing the prompt.',
        { coalesceKey: 'provider-filtered' },
      );
      this.host.showStatus(
        'Turn stopped: provider safety policy blocked the response (goal paused).',
        'error',
      );
    }
    // A cleanly-ended turn clears the retry flag (only errors set it).
    this.host.setLastTurnFailed(false);
    const todos = this.host.state.todoPanel.getTodos();
    if (todos.length > 0 && todos.every((t) => t.status === 'done')) {
      this.host.streamingUI.setTodoList([]);
    }
    this.host.streamingUI.resetToolUi();
    this.host.streamingUI.finalizeTurn(sendQueued);
    this.appendTurnSummary(event);
    this.renderPendingModelBlockedFallback();
    this.coordination.setCurrentTurnHasAssistantText(false);
    this.currentTurnUsage = undefined;
    this.coordination.setGoalCompletionTurnEnded(true);
    this.coordination.scheduleQueuedGoalPromotion();
    // Desktop notification on successful turn completion
    if (event.reason !== 'cancelled' && event.reason !== 'filtered') {
      notifyTurnComplete();
    }
  }

  handleStepRetrying(event: TurnStepRetryingEvent): void {
    // The payload carries no model/route info — build the cue from the error
    // identity, attempt counts, and backoff delay only (no invented fields).
    const name = event.errorName.trim();
    const detail = event.errorMessage.trim().replaceAll(/\s+/g, ' ');
    const shortDetail = detail.length > 90 ? `${detail.slice(0, 89)}…` : detail;
    const reason =
      name.length > 0
        ? shortDetail.length > 0
          ? `${name}: ${shortDetail}`
          : name
        : shortDetail.length > 0
          ? shortDetail
          : 'a transient error';
    const delay =
      event.delayMs > 0 ? ` — next attempt in ${formatRetryDelay(event.delayMs)}` : '';
    this.host.showStatus(
      `Retrying step ${String(event.step)} (attempt ${String(event.nextAttempt)}/${String(event.maxAttempts)}) after ${reason}${delay}`,
      'warning',
    );
  }

  handleStepBegin(event: TurnStepStartedEvent): void {
    this.host.streamingUI.flushNow();
    this.host.streamingUI.setStep(event.step);
    this.host.streamingUI.resetToolUi();
    this.host.streamingUI.finalizeLiveTextBuffers('waiting');
    this.host.patchLivePane({
      mode: 'waiting',
      pendingApproval: null,
      pendingQuestion: null,
    });
    this.host.setAppState({
      streamingPhase: 'waiting',
      streamingStartTime: Date.now(),
    });
  }

  handleStepCompleted(event: TurnStepCompletedEvent): void {
    this.host.streamingUI.flushNow();
    if (event.usage !== undefined) {
      this.currentTurnUsage = addTokenUsage(this.currentTurnUsage, event.usage);
    }
    this.maybeCaptureHostTtftSample(event);
    this.maybeShowDebugTiming(event);
    this.maybeSurfaceProviderRouteSelection(event);

    if (event.providerFinishReason === 'filtered') {
      this.host.showNotice(
        'Provider safety policy blocked the response.',
        `The model output was filtered (${event.rawFinishReason ?? 'content_filter'}).`,
      );
      return;
    }

    if (event.finishReason !== 'max_tokens') return;

    const truncatedCount = this.host.streamingUI.markStepTruncated(
      String(event.turnId),
      event.step,
    );

    const title =
      truncatedCount > 0
        ? 'Model hit max_tokens — tool call was truncated before it could run.'
        : 'Model hit max_tokens — no tool call was emitted.';
    const detail = this.isAnthropicSessionActive()
      ? 'If this limit is wrong for your model, set `max_output_size` on the model alias in your kimi-code config.'
      : undefined;
    this.host.showNotice(title, detail);
  }

  handleStepInterrupted(event: TurnStepInterruptedEvent): void {
    this.host.streamingUI.flushNow();
    this.host.streamingUI.resetToolUi();
    this.host.streamingUI.finalizeLiveTextBuffers('idle');
    const reason = event.reason;
    if (reason === 'error') return;
    if (reason === 'aborted' || reason === undefined || reason === '') {
      const userCancelled = event.cancelledByUser === true;
      const programmaticAbort = event.cancelledByUser === false;
      this.host.showStatus(
        userCancelled
          ? 'Interrupted by user'
          : programmaticAbort
            ? 'Turn aborted'
            : 'Turn stopped',
        'error',
      );
      return;
    }
    // Loop23b: max_steps is a named terminal budget state (exhausted), not a
    // generic error — surface recovery guidance (pairs with STEP_BUDGET soft tip).
    if (reason === 'max_steps') {
      const notice = formatMaxStepsExhaustedNotice();
      this.host.showNotice(notice.title, notice.detail, { coalesceKey: 'step-budget-exhausted' });
      this.host.showStatus(notice.status, 'warning');
      return;
    }
    this.host.showError(`step interrupted (${reason})`);
  }

  handleThinkingDelta(event: ThinkingDeltaEvent): void {
    const { state, streamingUI } = this.host;
    const wasThinking = state.appState.streamingPhase === 'thinking';
    streamingUI.appendThinkingDelta(event.delta);
    this.host.patchLivePane({ mode: 'idle' });
    if (!wasThinking) {
      this.host.setAppState({ streamingPhase: 'thinking', streamingStartTime: Date.now() });
    }
    streamingUI.scheduleFlush();
  }

  handleAssistantDelta(event: AssistantDeltaEvent): void {
    const { state, streamingUI } = this.host;
    if (streamingUI.hasThinkingDraft()) {
      streamingUI.flushThinkingToTranscript('idle');
    }

    if (event.delta.trim().length > 0) {
      this.coordination.setCurrentTurnHasAssistantText(true);
      this.coordination.setPendingModelBlockedFallback(undefined);
    }
    streamingUI.appendAssistantDelta(event.delta);

    this.host.patchLivePane({
      mode: 'idle',
      pendingApproval: null,
      pendingQuestion: null,
    });
    if (state.appState.streamingPhase !== 'composing') {
      this.host.setAppState({ streamingPhase: 'composing', streamingStartTime: Date.now() });
    }
    streamingUI.scheduleFlush();
  }

  private appendTurnSummary(event: TurnEndedEvent): void {
    const text = formatTurnSummary(event.durationMs, this.currentTurnUsage);
    if (text === undefined) return;
    this.host.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'status',
      turnId: String(event.turnId),
      renderMode: 'plain',
      content: text,
      color: 'textDim',
      bullet: '',
    });
  }

  /**
   * Surface the effective model/credential for this step when it meaningfully
   * differs from the previous step route — real failover & credential rotation
   * become visible in the transcript + footer instead of only /status.
   *
   * Alias/display renames of the *same* underlying model (e.g. "Grok 4.5" vs
   * "grok-4.5") are suppressed so every step does not spam "Model failover".
   */
  private maybeSurfaceProviderRouteSelection(event: TurnStepCompletedEvent): void {
    const selection = event.providerRouteSelection;
    if (selection === undefined) return;

    const prev = this.host.state.appState.lastProviderRouteSelection ?? null;
    const sessionModel = this.host.state.appState.model;
    const availableModels = this.host.state.appState.availableModels;
    const decision = decideModelRouteSurface({
      selection,
      previous: prev,
      sessionModel,
      availableModels,
    });

    const patch: Partial<AppState> = {
      lastProviderRouteSelection: selection,
    };

    if (decision.kind !== 'none') {
      const toAlias = decision.toAlias;
      const fromAlias = decision.fromAlias;
      const toLabel = modelRouteDisplayName(toAlias, availableModels);
      const fromLabel =
        fromAlias !== undefined ? modelRouteDisplayName(fromAlias, availableModels) : undefined;
      const cred =
        selection.credentialLabel !== undefined && selection.credentialLabel.length > 0
          ? selection.credentialLabel
          : selection.providerName;
      const detailParts: string[] = [];
      if (fromLabel !== undefined && fromLabel !== toLabel) {
        detailParts.push(`${fromLabel} → ${toLabel}`);
      } else {
        detailParts.push(toLabel);
      }
      // Append wire model id only when it adds information beyond the alias/label.
      if (
        selection.providerModel.length > 0 &&
        selection.providerModel !== toAlias &&
        selection.providerModel !== toLabel
      ) {
        detailParts.push(selection.providerModel);
      }
      if (cred !== undefined && cred.length > 0) {
        detailParts.push(cred);
      }
      const isFailover = decision.kind === 'failover';
      // Failover is the only route change worth a transcript notice.
      if (isFailover) {
        this.host.showNotice('Model failover', detailParts.join(' · '), {
          coalesceKey: 'model-route:step',
        });
      }
      patch.lastModelRouteNotice = {
        kind: isFailover ? 'failover' : 'selection',
        fromAlias,
        toAlias,
        providerName: selection.providerName,
        credentialLabel: selection.credentialLabel,
        providerModel: selection.providerModel,
        reason: isFailover
          ? 'provider-failover'
          : decision.credentialChanged
            ? 'provider-credential'
            : 'provider-route',
        atMs: Date.now(),
      };
    }

    this.host.setAppState(patch);
  }

  private maybeCaptureHostTtftSample(event: TurnStepCompletedEvent): void {
    const ms = event.llmFirstTokenLatencyMs;
    if (ms === undefined) return;
    const priorWindow = this.host.state.appState.lastStepTtftMsWindow;
    this.host.setAppState({
      lastStepTtft: {
        ms,
        turnId: event.turnId,
        step: event.step,
        atMs: Date.now(),
        ...(event.llmRequestBuildMs !== undefined
          ? { requestBuildMs: event.llmRequestBuildMs }
          : {}),
        ...(event.llmServerFirstTokenMs !== undefined
          ? { serverFirstTokenMs: event.llmServerFirstTokenMs }
          : {}),
      },
      lastStepTtftMsWindow: appendHostTtftMsSample(priorWindow, ms),
    });
  }

  private maybeShowDebugTiming(event: TurnStepCompletedEvent): void {
    if (process.env['SUPERLIORA_DEBUG'] !== '1') return;
    const text = formatStepDebugTiming(event);
    if (text === undefined) return;
    this.host.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'status',
      turnId: String(event.turnId),
      renderMode: 'plain',
      content: text,
    });
  }

  private isAnthropicSessionActive(): boolean {
    const { state } = this.host;
    const providerKey = state.appState.availableModels[state.appState.model]?.provider;
    if (providerKey === undefined) return false;
    return state.appState.availableProviders[providerKey]?.type === 'anthropic';
  }

  private renderPendingModelBlockedFallback(): void {
    const change = this.coordination.getPendingModelBlockedFallback();
    if (change === undefined) return;
    this.coordination.setPendingModelBlockedFallback(undefined);
    const { state } = this.host;
    const marker = buildGoalMarker(change, state.toolOutputExpanded, 'model');
    if (marker !== null) {
      state.transcriptContainer.addChild(marker);
      requestTUILayoutRender(state);
    }
  }
}

/** User-facing copy when a turn hits the hard per-turn step ceiling. */
export function formatMaxStepsExhaustedNotice(): {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
} {
  return {
    title: 'Step budget exhausted',
    detail:
      'This turn hit max_steps (named terminal: exhausted). Summarize progress, tighten the next action, or raise maxStepsPerTurn in loop_control. Soft STEP_BUDGET tips fire when ≤3 steps remain.',
    status: 'Turn stopped: per-turn step budget exhausted (max_steps)',
  };
}

function formatTurnSummary(durationMs: number | undefined, usage: TokenUsage | undefined): string | undefined {
  const hasDuration = durationMs !== undefined && durationMs >= 0;
  const hasUsage = usage !== undefined;
  if (!hasDuration && !hasUsage) return undefined;

  const parts: string[] = [];
  if (hasDuration) parts.push(`⏱ ${formatTurnDuration(durationMs)}`);
  if (hasUsage) {
    const total =
      usage.inputOther + usage.inputCacheRead + usage.inputCacheCreation + usage.output;
    parts.push(`${formatTokenCount(total)} tokens`);
  }
  return parts.join(' · ');
}

function formatTurnDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60 * 1000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
}

function formatRetryDelay(delayMs: number): string {
  if (delayMs >= 1000) return `${(delayMs / 1000).toFixed(1)}s`;
  return `${String(Math.max(0, Math.round(delayMs)))}ms`;
}

function addTokenUsage(a: TokenUsage | undefined, b: TokenUsage): TokenUsage {
  if (a === undefined) return b;
  return {
    inputOther: a.inputOther + b.inputOther,
    output: a.output + b.output,
    inputCacheRead: a.inputCacheRead + b.inputCacheRead,
    inputCacheCreation: a.inputCacheCreation + b.inputCacheCreation,
  };
}
