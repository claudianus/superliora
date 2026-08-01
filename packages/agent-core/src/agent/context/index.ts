import type { ContentPart, Message } from '@superliora/kosong';

import type { Agent } from '..';
import type { LoopRecordedEvent, LoopToolIntendEvent } from '../../loop';
import { estimateTokensForMessages } from '../../utils/tokens';
import { buildContextComposition } from './composition';
import { applyContextCompaction } from './context-memory-compaction';
import type { ContextMemoryHost } from './context-memory-host';
import {
  closePendingToolResults,
  handleContextLoopEvent,
} from './context-memory-loop-events';
import {
  COMPACTION_PROJECTION_OPTIONS,
  reportContextProjectionRepairs,
} from './context-memory-projection';
import {
  reclaimEphemeralUserMessagesFromContext,
  undoContextMessages,
} from './context-memory-undo';
import {
  appendBashInputToContext,
  appendBashOutputToContext,
  appendLocalCommandStdoutToContext,
  appendSystemReminderToContext,
  appendUserMessageToContext,
} from './context-memory-user-messages';
import {
  CONTEXT_ARCHIVE_MAX_ENTRIES,
  contextArchiveEntryCount,
} from '../../tools/builtin/context/context-archive';
import type { CompactionInput, CompactionResult } from '../compaction';
import {
  project,
  type ProjectionAnomaly,
  type ProjectOptions,
  trimTrailingOpenToolExchange,
} from './projector';
import {
  USER_PROMPT_ORIGIN,
  type AgentContextData,
  type ContextComposition,
  type ContextMessage,
  type PromptOrigin,
} from './types';

export * from './types';
export { COMPACTION_PROJECTION_OPTIONS } from './context-memory-projection';

// Invariant: _history must not contain an unresolved tool call exchange except
// at the tail. When the tail is unresolved, pendingToolResultIds is exactly the
// set of missing tool result ids for that tail exchange; appendMessage keeps
// later messages in deferredMessages until those ids are resolved.
export class ContextMemory {
  private _history: ContextMessage[] = [];
  private _tokenCount = 0;
  tokenCountCoveredMessageCount = 0;
  openSteps: Map<string, ContextMessage> = new Map();
  pendingToolResultIds = new Set<string>();
  /**
   * Tool-call ids whose results may still arrive after a compaction raced
   * ahead of them. Maps each id to the `_history.length` at the time it was
   * registered so {@link applyCompaction} can expire entries that belong to a
   * prefix that has since been summarized away and can never produce a
   * meaningful late result.
   */
  lateAcceptedToolCallIds = new Map<string, number>();
  /**
   * Side-effecting tool calls that logged a `tool.intend` but have not yet been
   * acknowledged (`tool.ack`). On resume, an intend without an ack means
   * execution may or may not have completed — the close-pending path reconciles
   * it (e.g. idempotently verifying a file write landed) instead of treating it
   * as never-started.
   */
  intendedToolCalls = new Map<string, LoopToolIntendEvent>();
  deferredMessages: ContextMessage[] = [];
  lastProjectionRepairSignature: string | null = null;
  lastAssistantAt: number | null = null;

  constructor(protected readonly agent: Agent) {}

  private get host(): ContextMemoryHost {
    return this as unknown as ContextMemoryHost;
  }

  get history(): ContextMessage[] {
    return this._history;
  }

  set history(value: ContextMessage[]) {
    this._history = value;
  }

  get tokenCount(): number {
    return this._tokenCount;
  }

  set tokenCount(value: number) {
    this._tokenCount = value;
  }

  appendUserMessage(
    content: readonly ContentPart[],
    origin: PromptOrigin = USER_PROMPT_ORIGIN,
  ): void {
    appendUserMessageToContext(
      content,
      origin,
      (message) =>{  this.appendMessage(message); },
      (text, reminderOrigin) =>{  this.appendSystemReminder(text, reminderOrigin); },
    );
  }

  appendSystemReminder(content: string, origin: PromptOrigin): void {
    appendSystemReminderToContext(content, origin, (message) =>{  this.appendMessage(message); });
  }

  /**
   * Inject a user-invisible message and immediately send it to the model by
   * launching/steering a turn. The content is used as-is (no wrapper tag), so
   * callers can pass raw tool-result-style text or wrap it themselves. The
   * message is skipped on replay / transcript (so the user never sees it) but
   * is included in the context sent to the model. Use this for events the
   * model must react to right away without surfacing a user-visible message.
   */
  injectAndNotify(content: string, origin?: PromptOrigin): void {
    this.agent.turn.steer(
      [{ type: 'text', text: content }],
      origin ?? { kind: 'injection', variant: 'system_reminder' },
    );
  }

  appendLocalCommandStdout(content: string): void {
    appendLocalCommandStdoutToContext(content, (message) =>{  this.appendMessage(message); });
  }

  appendBashInput(command: string): void {
    appendBashInputToContext(command, (message) =>{  this.appendMessage(message); });
  }

  appendBashOutput(stdout: string, stderr: string, isError?: boolean): void {
    appendBashOutputToContext(stdout, stderr, isError, (message) =>{  this.appendMessage(message); });
  }

  popMatchedMessage(matcher: (origin: PromptOrigin | undefined) => boolean): boolean {
    const lastDeferred = this.deferredMessages.at(-1);
    const last = lastDeferred ?? this._history.at(-1);
    if (last === undefined) return false;
    if (!matcher(last.origin)) return false;
    if (lastDeferred !== undefined) {
      this.deferredMessages.pop();
    } else {
      this._history.pop();
    }
    return true;
  }

  clear(): void {
    this.agent.records.logRecord({ type: 'context.clear' });
    this._history = [];
    this._tokenCount = 0;
    this.tokenCountCoveredMessageCount = 0;
    this.openSteps.clear();
    this.pendingToolResultIds.clear();
    this.deferredMessages = [];
    this.lastAssistantAt = null;
    this.agent.contextOS.clear();
    this.agent.injection.onContextClear();
    this.agent.emitStatusUpdated();
  }

  undo(count: number): void {
    undoContextMessages(this.host, count);
  }

  reclaimEphemeralUserMessages(): number {
    return reclaimEphemeralUserMessagesFromContext(this.host);
  }

  applyCompaction(input: CompactionInput): CompactionResult {
    return applyContextCompaction(this.host, input);
  }

  data(): AgentContextData {
    const health = this.agent.contextOS.health();
    const archiveEntryCount = contextArchiveEntryCount(this.agent.tools.getStore());
    return {
      history: this.history,
      tokenCount: this.tokenCount,
      contextArchive:
        archiveEntryCount === 0
          ? undefined
          : {
              entryCount: archiveEntryCount,
              maxEntries: CONTEXT_ARCHIVE_MAX_ENTRIES,
            },
      contextOS:
        health.pageCount === 0
          ? undefined
          : {
              pageCount: health.pageCount,
              readyPageCount: health.readyPageCount,
              needsRehydrationPageCount: health.needsRehydrationPageCount,
              atRiskPageCount: health.atRiskPageCount,
              missingEvidencePageCount: health.missingEvidencePageCount,
              evidenceIdRecallScore: health.evidenceIdRecallScore,
              latestContinuityStatus: health.latestContinuityStatus,
            },
      autoDream: this.agent.dream === null ? undefined : this.agent.dream.snapshot(),
    };
  }

  /** Compute a full context-window composition breakdown. */
  composition(): ContextComposition {
    return buildContextComposition(this.agent, this._history);
  }

  get tokenCountWithPending(): number {
    const pendingMessages = this._history.slice(this.tokenCountCoveredMessageCount);
    return this._tokenCount + estimateTokensForMessages(pendingMessages);
  }

  project(messages: readonly ContextMessage[], options?: ProjectOptions): Message[] {
    const anomalies: ProjectionAnomaly[] = [];
    const result = project(messages, {
      ...options,
      onAnomaly: (anomaly) => {
        anomalies.push(anomaly);
        options?.onAnomaly?.(anomaly);
      },
    });
    reportContextProjectionRepairs(this.host, anomalies);
    return result;
  }

  get messages(): Message[] {
    const source =
      this.deferredMessages.length > 0
        ? [...this._history, ...this.deferredMessages]
        : this._history;
    return this.project(source);
  }

  get strictMessages(): Message[] {
    return this.project(this.history, COMPACTION_PROJECTION_OPTIONS);
  }

  projectForCompaction(messages: readonly ContextMessage[]): Message[] {
    return this.project(messages, COMPACTION_PROJECTION_OPTIONS);
  }

  useProjectedHistoryFrom(source: ContextMemory): void {
    this.clear();
    this.pushHistory(...trimTrailingOpenToolExchange(source.project(source.history)));
  }

  finishResume(): void {
    this.openSteps.clear();
    const closed = closePendingToolResults(this.host);
    if (closed.length > 0) {
      this.agent.log.info('closed interrupted tool calls at end of resume', {
        closed: closed.length,
        toolCallIds: closed.slice(0, 5),
      });
    }
  }

  closeAbandonedToolExchange(output: string): number {
    return closePendingToolResults(this.host, output).length;
  }

  prepareManualCompactionWithOpenToolExchange(): boolean {
    if (this.pendingToolResultIds.size === 0) return false;
    const historyLength = this._history.length;
    for (const toolCallId of this.pendingToolResultIds) {
      this.lateAcceptedToolCallIds.set(toolCallId, historyLength);
    }
    return closePendingToolResults(this.host).length > 0;
  }

  appendLoopEvent(event: LoopRecordedEvent): void {
    handleContextLoopEvent(this.host, event);
  }

  appendMessage(message: ContextMessage): void {
    this.agent.records.logRecord({
      type: 'context.append_message',
      message,
    });
    if (this.hasOpenToolExchange()) {
      this.deferredMessages.push(message);
      return;
    }
    this.pushHistory(message);
  }

  resyncPendingToolResultIdsFromHistory(): void {
    this.pendingToolResultIds.clear();
    for (const message of this._history) {
      if (message.role === 'assistant') {
        for (const toolCall of message.toolCalls) {
          this.pendingToolResultIds.add(toolCall.id);
        }
      }
      if (message.role === 'tool' && message.toolCallId !== undefined) {
        this.pendingToolResultIds.delete(message.toolCallId);
      }
    }
  }

  flushDeferredMessagesIfToolExchangeClosed(): void {
    if (this.pendingToolResultIds.size > 0 || this.deferredMessages.length === 0) {
      return;
    }
    this.pushHistory(...this.deferredMessages);
    this.deferredMessages = [];
  }

  pushHistory(...messages: ContextMessage[]): void {
    if (messages.length === 0) return;
    const postCompactionInjections =
      this.tokenCountCoveredMessageCount >= this._history.length &&
      messages.every((message) => message.origin?.kind === 'injection');
    if (postCompactionInjections) {
      this._tokenCount += estimateTokensForMessages(messages);
      this.tokenCountCoveredMessageCount = this._history.length + messages.length;
    }
    this._history.push(...messages);
    for (const message of messages) {
      if (message.role === 'assistant') {
        this.lastAssistantAt = this.agent.records.restoring?.time ?? Date.now();
      }
      if (message.origin?.kind === 'background_task') {
        this.agent.background.markDeliveredNotification(message.origin);
      }
      this.agent.replayBuilder.push({
        type: 'message',
        message,
      });
    }
  }

  private hasOpenToolExchange(): boolean {
    return this.pendingToolResultIds.size > 0;
  }
}
