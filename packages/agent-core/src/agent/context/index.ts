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
import { undoContextMessages } from './context-memory-undo';
import {
  appendBashInputToContext,
  appendBashOutputToContext,
  appendLocalCommandStdoutToContext,
  appendSystemReminderToContext,
  appendUserMessageToContext,
} from './context-memory-user-messages';
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
  private _historyRevision = 0;
  tokenCountCoveredMessageCount = 0;
  openSteps: Map<string, ContextMessage> = new Map();
  compactedOpenSteps = new Set<string>();
  pendingToolResultIds = new Set<string>();
  toolCallNames = new Map<string, string>();
  /** Unacknowledged executions stay factual on resume; they are never replayed. */
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
    this.markContextChanged();
  }

  get historyRevision(): number {
    return this._historyRevision;
  }

  markContextChanged(): void {
    this._historyRevision += 1;
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
    this.markContextChanged();
    return true;
  }

  clear(): void {
    this.agent.records.logRecord({ type: 'context.clear' });
    this.markContextChanged();
    this._history = [];
    this._tokenCount = 0;
    this.tokenCountCoveredMessageCount = 0;
    this.openSteps.clear();
    this.pendingToolResultIds.clear();
    this.toolCallNames.clear();
    this.compactedOpenSteps.clear();
    this.intendedToolCalls.clear();
    this.deferredMessages = [];
    this.lastAssistantAt = null;
    this.agent.emitStatusUpdated();
  }

  undo(count: number): void {
    undoContextMessages(this.host, count);
  }


  applyCompaction(input: CompactionInput): CompactionResult {
    return applyContextCompaction(this.host, input);
  }

  data(): AgentContextData {
    return { history: this.history, tokenCount: this.tokenCount };
  }

  /** Compute a full context-window composition breakdown. */
  composition(): ContextComposition {
    return buildContextComposition(this.agent, this._history);
  }

  get tokenCountWithPending(): number {
    const pendingMessages = this._history.slice(this.tokenCountCoveredMessageCount);
    return this._tokenCount + estimateTokensForMessages(pendingMessages);
  }

  completedHistorySnapshot(): readonly ContextMessage[] {
    const pending = new Set<string>();
    let count = 0;
    let available = this._history.length;
    for (const open of this.openSteps.values()) {
      const index = this._history.indexOf(open);
      if (index >= 0 && index < available) available = index;
    }
    for (let index = 0; index < available; index++) {
      const message = this._history[index]!;
      if (message.role === 'assistant') for (const call of message.toolCalls) pending.add(call.id);
      if (message.role === 'tool' && message.toolCallId !== undefined) pending.delete(message.toolCallId);
      if (pending.size === 0) count = index + 1;
    }
    return this._history.slice(0, count);
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
    return this.project(this._history);
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
      this.markContextChanged();
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
    this._history.push(...messages);
    this.markContextChanged();
    for (const message of messages) {
      if (message.role === 'assistant') {
        this.lastAssistantAt = this.agent.records.restoring?.time ?? Date.now();
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
