import type {
  AssistantDeltaEvent,
  ThinkingDeltaEvent,
  TokenUsage,
  TurnEndedEvent,
  TurnStartedEvent,
  TurnStepCompletedEvent,
  TurnStepInterruptedEvent,
  TurnStepStartedEvent,
} from '@superliora/sdk';

import type { AppState, LivePaneState, QueuedMessage, TranscriptEntry } from '../../types';
import type { TUIState } from '../../tui-state';
import type { ColorToken } from '#/tui/theme';
import { isDebugSession } from '#/utils/debug-session';
import { formatStepDebugTiming } from '#/utils/usage/debug-timing';
import { formatTokenCount } from '#/utils/usage/usage-format';
import {
  decideModelRouteSurface,
  modelRouteDisplayName,
} from '../../utils/model/model-route-notice';
import { nextTranscriptId } from '../../features/transcript/transcript-id';
import { notifyTurnComplete } from '../../utils/notification/desktop-notification';
import { appendHostTtftMsSample } from '../../utils/host/host-glance';
import type { StreamingUIController } from '../streaming-ui/index';
import { ttui } from '../../utils/tui-i18n';

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

export class SessionEventTurn {
  private currentTurnUsage: TokenUsage | undefined;

  constructor(private readonly host: TurnEventHost) {}

  resetRuntimeState(): void {
    this.currentTurnUsage = undefined;
  }

  handleTurnBegin(_event: TurnStartedEvent): void {
    void _event;
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
      // Keep provider filtering visible even when no assistant text was returned.
      this.host.showNotice(
        ttui('tui.step.providerFiltered.title'),
        ttui('tui.step.providerFiltered.detail'),
        { coalesceKey: 'provider-filtered' },
      );
      this.host.showStatus(ttui('tui.step.providerFiltered.status'), 'error');
    }
    if (event.stopReason === 'max_tokens') {
      // The provider cut the output at its token budget; the turn otherwise
      // looks completed. Tell the user the reply may be incomplete so they
      // can ask the agent to continue instead of trusting a truncated answer.
      this.host.showNotice(
        ttui('tui.step.outputTruncated.title'),
        ttui('tui.step.outputTruncated.detail'),
        { coalesceKey: 'output-truncated' },
      );
    }
    // A cleanly-ended turn clears the retry flag (only errors set it).
    this.host.setLastTurnFailed(false);
    this.host.streamingUI.resetToolUi();
    this.host.streamingUI.finalizeTurn(sendQueued);
    this.appendTurnSummary(event);
    this.currentTurnUsage = undefined;
    // Desktop notification on successful turn completion
    if (event.reason !== 'cancelled' && event.reason !== 'filtered') {
      notifyTurnComplete(this.host.state, undefined, { key: `turn-complete:${event.turnId}` });
    }
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
        ttui('tui.step.providerFilteredStep.title'),
        ttui('tui.step.providerFilteredStep.detail', {
          reason: event.rawFinishReason ?? 'content_filter',
        }),
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
        ? ttui('tui.step.maxTokens.truncated')
        : ttui('tui.step.maxTokens.noTool');
    const detail = this.isAnthropicSessionActive()
      ? ttui('tui.step.maxTokens.anthropicHint')
      : undefined;
    this.host.showNotice(title, detail);
  }

  handleStepInterrupted(event: TurnStepInterruptedEvent): void {
    this.host.streamingUI.flushNow();
    this.host.streamingUI.resetToolUi();
    this.host.streamingUI.finalizeLiveTextBuffers('idle');
    const reason = event.reason;
    if (reason === 'error') {
      // A paired `error` event normally carries the message; when it is
      // missing or filtered, the stream would just die mid-tool with the
      // phase stuck non-idle and zero feedback. Show a fallback cue.
      this.host.showStatus(ttui('tui.step.interruptedByError'), 'error');
      return;
    }
    if (reason === 'aborted' || reason === undefined || reason === '') {
      const userCancelled = event.cancelledByUser === true;
      const programmaticAbort = event.cancelledByUser === false;
      this.host.showStatus(
        userCancelled
          ? ttui('tui.step.interruptedByUser')
          : programmaticAbort
            ? ttui('tui.step.turnAborted')
            : ttui('tui.step.turnStopped'),
        'error',
      );
      return;
    }
    this.host.showError(ttui('tui.step.interrupted', { reason }));
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
        this.host.showNotice(ttui('tui.notice.modelFailover.title'), detailParts.join(' · '), {
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
        reason:
          sessionModel.trim().toLowerCase() === 'auto'
            ? 'smart-auto'
            : isFailover
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
    if (!isDebugSession()) return;
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

function addTokenUsage(a: TokenUsage | undefined, b: TokenUsage): TokenUsage {
  if (a === undefined) return b;
  return {
    inputOther: a.inputOther + b.inputOther,
    output: a.output + b.output,
    inputCacheRead: a.inputCacheRead + b.inputCacheRead,
    inputCacheCreation: a.inputCacheCreation + b.inputCacheCreation,
  };
}
