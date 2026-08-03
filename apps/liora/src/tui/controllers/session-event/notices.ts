import type {
  AgentStatusUpdatedEvent,
  CronFiredEvent,
  ErrorEvent,
  GoalChange,
  HookResultEvent,
  PluginCommandActivatedEvent,
  SessionMetaUpdatedEvent,
  SkillActivatedEvent,
  WarningEvent,
} from '@superliora/sdk';

import {
  SwarmModeMarkerComponent,
  type SwarmModeMarkerState,
} from '../../components/messages/swarm-markers';
import {
  OAUTH_LOGIN_REQUIRED_CODE,
  OAUTH_LOGIN_REQUIRED_STARTUP_NOTICE,
} from '../../constant/liora-tui';
import { errorReportHintLine } from '../../constant/feedback';
import type { AppState, LivePaneState, TranscriptEntry } from '../../types';
import type { TUIState } from '../../tui-state';
import type { ColorToken } from '#/tui/theme';
import { computeSessionCostUsd } from '#/tui/utils/session/session-cost';
import { cacheMeterFromHitRate } from '#/tui/utils/cache/cache-glance';
import {
  formatErrorPayload,
  stringValue,
} from '../../utils/event-payload';
import { formatHookResultMarkdown } from '../../utils/hook-result-format';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { ttui } from '../../utils/tui-i18n';
import { nextTranscriptId } from '../../features/transcript/transcript-id';
import { notifyError } from '../../utils/notification/desktop-notification';
import { INTERVENTION_NEVER_HALT_TIP } from '../../utils/never-halt/intervention-glance';
import { staleRuntimeDegradedClearPatch } from '../../utils/never-halt/runtime-degraded';
import { staleSearchCascadeClearPatch } from '../../utils/search/search-cascade';

import { formatNamedSessionErrorNotice } from '../../utils/session/named-error-notice';
import type { StreamingUIController } from '../streaming-ui/index';

/** Host surface required by session notice / transcript side-effect handlers. */
export interface NoticeEventHost {
  state: TUIState;
  readonly streamingUI: StreamingUIController;
  setAppState(patch: Partial<AppState>): void;
  patchLivePane(patch: Partial<LivePaneState>): void;
  showError(msg: string): void;
  showStatus(msg: string, color?: ColorToken): void;
  /** Optional — named recovery notices for terminal error codes (Loop28a). */
  showNotice?(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  appendTranscriptEntry(entry: TranscriptEntry): void;
  updateTerminalTitle(): void;
  setLastTurnFailed(failed: boolean): void;
}

/**
 * Turn-owned flags shared with hook.result handling.
 * Injected so notices stay coordinated without relocating turn-owned state.
 */
export interface NoticeSharedFlags {
  setCurrentTurnHasAssistantText(value: boolean): void;
  setPendingModelBlockedFallback(value: GoalChange | undefined): void;
}

export class SessionEventNotices {
  renderedSkillActivationIds: Set<string> = new Set();
  renderedPluginCommandActivationIds: Set<string> = new Set();

  constructor(
    private readonly host: NoticeEventHost,
    private readonly flags: NoticeSharedFlags,
  ) {}

  resetRuntimeState(): void {
    this.renderedSkillActivationIds.clear();
    this.renderedPluginCommandActivationIds.clear();
  }

  handleCronFired(event: CronFiredEvent): void {
    this.host.streamingUI.flushNow();
    this.host.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'cron',
      turnId: this.host.streamingUI.getTurnContext().turnId,
      renderMode: 'plain',
      content: event.prompt,
      cronData: {
        jobId: event.origin.jobId,
        cron: event.origin.cron,
        recurring: event.origin.recurring,
        coalescedCount: event.origin.coalescedCount,
        stale: event.origin.stale,
      },
    });
  }

  handleHookResult(event: HookResultEvent): void {
    this.host.streamingUI.flushNow();
    if (this.host.streamingUI.hasThinkingDraft()) {
      this.host.streamingUI.flushThinkingToTranscript('idle');
    }
    this.host.streamingUI.finalizeAssistantStream();
    if (event.content.trim().length > 0) {
      this.flags.setCurrentTurnHasAssistantText(true);
      this.flags.setPendingModelBlockedFallback(undefined);
    }
    this.host.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'assistant',
      turnId: String(event.turnId),
      renderMode: 'markdown',
      content: formatHookResultMarkdown(event),
    });
    this.host.patchLivePane({
      mode: 'idle',
      pendingApproval: null,
      pendingQuestion: null,
    });
  }

  handleStatusUpdate(event: AgentStatusUpdatedEvent): void {
    const shouldRenderSwarmEnded =
      event.swarmMode === false &&
      this.host.state.appState.swarmMode &&
      this.host.state.swarmModeEntry === 'task';
    const patch: Partial<AppState> = {};
    if (event.contextUsage !== undefined) patch.contextUsage = event.contextUsage;
    if (event.contextTokens !== undefined) patch.contextTokens = event.contextTokens;
    if (event.maxContextTokens !== undefined) patch.maxContextTokens = event.maxContextTokens;
    if (event.usage?.total !== undefined) {
      const modelId = event.model ?? this.host.state.appState.model;
      const pricing = this.host.state.appState.availableModels[modelId]?.cost;
      const costUsd = computeSessionCostUsd(event.usage.total, pricing);
      if (costUsd !== undefined) patch.sessionCostUsd = costUsd;
    }
    const cacheMeter = cacheMeterFromHitRate(
      event.usage?.cacheHitRate,
      event.usage?.cacheWarmStreak,
    );
    if (cacheMeter !== undefined) patch.cacheMeter = cacheMeter;
    if (event.circuitBreakers !== undefined) {
      patch.circuitBreakers = event.circuitBreakers;
    } else if (
      'circuitBreakers' in event ||
      event.model !== undefined ||
      event.contextTokens !== undefined ||
      event.permission !== undefined
    ) {
      patch.circuitBreakers = null;
    }
    if ('contextOS' in event) patch.contextOS = event.contextOS ?? null;
    if ('autoDream' in event) patch.autoDream = event.autoDream ?? null;
    if (event.planMode !== undefined) {
      patch.planMode = event.planMode;
    }
    if (event.swarmMode !== undefined) patch.swarmMode = event.swarmMode;
    if (event.premiumQualityMode !== undefined) {
      patch.premiumQualityMode = event.premiumQualityMode;
    }
    if (event.permission !== undefined) {
      patch.permissionMode = event.permission;
    }
    if (event.model !== undefined) patch.model = event.model;
    if ('providerRoute' in event) patch.providerRouteStatus = event.providerRoute ?? null;
    if (typeof event.pendingInterventions === 'number') {
      const prev = this.host.state.appState.interventionCount ?? 0;
      patch.interventionCount = event.pendingInterventions;
      if (event.pendingInterventions > prev) {
        this.host.showStatus(INTERVENTION_NEVER_HALT_TIP, 'textMuted');
      }
    } else if (
      'pendingInterventions' in event ||
      event.model !== undefined ||
      event.contextTokens !== undefined ||
      event.permission !== undefined
    ) {
      // Full snapshots omit pendingInterventions when the queue is empty.
      patch.interventionCount = 0;
    }
    if (typeof event.staleInterventions === 'number') {
      patch.staleInterventionCount = event.staleInterventions;
    } else if (
      'staleInterventions' in event ||
      event.model !== undefined ||
      event.contextTokens !== undefined ||
      event.permission !== undefined
    ) {
      patch.staleInterventionCount = 0;
    }
    if (typeof event.oldestInterventionAgeMs === 'number') {
      patch.oldestInterventionAgeMs = event.oldestInterventionAgeMs;
    } else if (
      'oldestInterventionAgeMs' in event ||
      event.model !== undefined ||
      event.contextTokens !== undefined ||
      event.permission !== undefined
    ) {
      patch.oldestInterventionAgeMs = undefined;
    }
    const staleDegraded = staleRuntimeDegradedClearPatch(this.host.state.appState.runtimeDegraded);
    if (staleDegraded !== null) Object.assign(patch, staleDegraded);
    const staleCascade = staleSearchCascadeClearPatch(this.host.state.appState.searchCascade);
    if (staleCascade !== null) Object.assign(patch, staleCascade);
    if (Object.keys(patch).length > 0) this.host.setAppState(patch);
    if (event.swarmMode === false) {
      this.host.state.swarmModeEntry = undefined;
      if (shouldRenderSwarmEnded) {
        this.renderSwarmModeMarker('ended');
      }
    }
  }

  renderSwarmModeMarker(state: SwarmModeMarkerState): void {
    this.host.state.transcriptContainer.addChild(
      new SwarmModeMarkerComponent(state),
    );
    requestTUILayoutRender(this.host.state);
  }

  handleSessionMetaChanged(event: SessionMetaUpdatedEvent): void {
    const title = event.title ?? stringValue(event.patch?.['title']);
    if (title !== undefined) {
      this.host.setAppState({ sessionTitle: title });
      this.host.updateTerminalTitle();
    }
  }

  handleSessionError(event: ErrorEvent): void {
    this.host.streamingUI.flushNow();
    this.host.streamingUI.resetToolUi();
    this.host.streamingUI.finalizeLiveTextBuffers('idle');
    // Desktop notification on error
    notifyError(event.message ?? '세션 오류 발생');
    // Mark the last turn as failed so the user can re-send it with Hub Retry
    // or `/retry`.
    this.host.setLastTurnFailed(true);
    if (event.code === OAUTH_LOGIN_REQUIRED_CODE) {
      this.host.showError(OAUTH_LOGIN_REQUIRED_STARTUP_NOTICE);
      return;
    }
    // Loop28a: named recovery for terminal context/compaction failures.
    const named = formatNamedSessionErrorNotice(event.code, event.message);
    if (named !== undefined && this.host.showNotice !== undefined) {
      this.host.showNotice(named.title, named.detail, {
        coalesceKey: named.coalesceKey,
      });
      this.host.showStatus(named.status, 'error');
    } else {
      this.host.showError(formatErrorPayload(event));
    }
    const sessionId = this.host.state.appState.sessionId;
    if (sessionId.length > 0) {
      this.host.showStatus(errorReportHintLine());
      this.host.appendTranscriptEntry({
        id: `retry-hint-${Date.now()}`,
        kind: 'status',
        turnId: undefined,
        renderMode: 'plain',
        content: ttui('tui.retry.hint'),
        color: 'warning',
        bullet: '',
      });
    }
  }

  handleSessionWarning(event: WarningEvent): void {
    if (event.code === 'vision_analyzer.analyzed') {
      const details = event.details ?? {};
      const analyzerModel = details['analyzerModel'];
      const kind = details['kind'];
      const model =
        typeof analyzerModel === 'string' && analyzerModel.length > 0
          ? analyzerModel
          : undefined;
      const noun =
        kind === 'video'
          ? '비디오를'
          : kind === 'image'
            ? '이미지를'
            : '첨부 미디어를';
      this.host.showStatus(
        model !== undefined
          ? `${noun} ${model}로 분석했습니다.`
          : '첨부 미디어를 비전 모델로 분석했습니다.',
        'success',
      );
      return;
    }
    // Loop28b: step-budget soft tip is a named notice, not a generic "Warning:".
    if (event.code === 'step-budget-sensor' || event.message.startsWith('STEP_BUDGET:')) {
      if (this.host.showNotice !== undefined) {
        this.host.showNotice('Step budget low', event.message, {
          coalesceKey: 'step-budget-soft-warn',
        });
      }
      this.host.showStatus('Step budget low — finish user-visible progress', 'warning');
      return;
    }
    // Loop31a: goal no-progress (named terminal: stalled) — injection alone is model-only.
    if (
      event.code === 'goal-no-progress-sensor' ||
      event.message.startsWith('GOAL_NO_PROGRESS:')
    ) {
      if (this.host.showNotice !== undefined) {
        this.host.showNotice('Goal stalled (no progress)', event.message, {
          coalesceKey: 'goal-no-progress',
        });
      }
      this.host.showStatus('Goal stalled — change approach or UpdateGoal(blocked)', 'warning');
      return;
    }
    // Loop32a: mid-turn CacheFreezeGuard tool-list drift (prompt-cache prefix risk).
    if (
      event.code === 'cache-freeze-drift-sensor' ||
      event.message.startsWith('CACHE_FREEZE_DRIFT:')
    ) {
      if (this.host.showNotice !== undefined) {
        this.host.showNotice('Cache freeze drift', event.message, {
          coalesceKey: 'cache-freeze-drift',
        });
      }
      this.host.showStatus('Cache freeze: mid-turn tool list drifted', 'warning');
      return;
    }
    // Loop34a: built-in Stop sensor forced one repair continuation (false-done guard).
    if (event.code === 'stop-sensor' || event.message.startsWith('STOP_SENSOR:')) {
      if (this.host.showNotice !== undefined) {
        this.host.showNotice('Stop sensor: verify before done', event.message, {
          coalesceKey: 'stop-sensor',
        });
      }
      this.host.showStatus('Stop sensor — one repair continuation', 'warning');
      return;
    }
    // Loop35a: unresolved tool exchanges closed at turn end (cancel/fail/max_steps).
    if (
      event.code === 'abandoned-tool-sensor' ||
      event.message.startsWith('ABANDONED_TOOL:')
    ) {
      if (this.host.showNotice !== undefined) {
        this.host.showNotice('Unresolved tool calls closed', event.message, {
          coalesceKey: 'abandoned-tool',
        });
      }
      this.host.showStatus('Unresolved tools closed — do not assume success', 'warning');
      return;
    }
    // Loop40a: SUPERLIORA_AUTO_CHECK_SPAWN threw or RunProjectChecks missing.
    if (
      event.code === 'auto-check-spawn-error' ||
      event.message.startsWith('AUTO_CHECK_SPAWN: ERROR:')
    ) {
      if (this.host.showNotice !== undefined) {
        this.host.showNotice('Auto-check spawn error', event.message, {
          coalesceKey: 'auto-check-spawn-error',
        });
      }
      this.host.showStatus('Auto-check spawn failed — run checks manually', 'warning');
      return;
    }
    // Loop41a: UserPromptSubmit hook blocked the turn before the agent loop.
    if (
      event.code === 'user-prompt-submit-block' ||
      event.message.startsWith('USER_PROMPT_SUBMIT_BLOCK:')
    ) {
      if (this.host.showNotice !== undefined) {
        this.host.showNotice('Prompt blocked by hook', event.message, {
          coalesceKey: 'user-prompt-submit-block',
        });
      }
      this.host.showStatus('Turn blocked — UserPromptSubmit hook', 'warning');
      return;
    }
    // Loop46a: oversized AGENTS.md soft/hard budget — was generic "Warning:" only.
    if (
      event.code === 'agents-md-oversized' ||
      (event.message.includes('AGENTS.md') &&
        (event.message.includes('exceeds the recommended') ||
          event.message.includes('hard injection cap')))
    ) {
      if (this.host.showNotice !== undefined) {
        this.host.showNotice('AGENTS.md oversized', event.message, {
          coalesceKey: 'agents-md-oversized',
        });
      }
      this.host.showStatus(
        event.message.includes('hard injection cap')
          ? 'AGENTS.md hard-capped — trim project instructions'
          : 'AGENTS.md oversized — consider trimming',
        'warning',
      );
      return;
    }
    this.host.showStatus(`Warning: ${event.message}`, 'warning');
  }

  handleSkillActivated(event: SkillActivatedEvent): void {
    if (this.renderedSkillActivationIds.has(event.activationId)) return;
    this.renderedSkillActivationIds.add(event.activationId);
    this.host.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'skill_activation',
      turnId: undefined,
      renderMode: 'plain',
      content: `Activated skill: ${event.skillName}`,
      skillActivationId: event.activationId,
      skillName: event.skillName,
      skillArgs: event.skillArgs,
      skillTrigger: event.trigger,
    });
  }

  handlePluginCommandActivated(event: PluginCommandActivatedEvent): void {
    if (this.renderedPluginCommandActivationIds.has(event.activationId)) return;
    this.renderedPluginCommandActivationIds.add(event.activationId);
    this.host.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'plugin_command',
      turnId: undefined,
      renderMode: 'plain',
      content: `Ran command: ${event.pluginId}:${event.commandName}`,
      pluginCommandActivationId: event.activationId,
      pluginId: event.pluginId,
      pluginCommandName: event.commandName,
      pluginCommandArgs: event.commandArgs,
      pluginCommandTrigger: event.trigger,
    });
  }
}
