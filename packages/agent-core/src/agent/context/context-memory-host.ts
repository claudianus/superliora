import type { Agent } from '..';
import type { LoopRecordedEvent, LoopToolIntendEvent } from '../../loop';
import type { ContextMessage } from './types';

/** Mutable state shared by ContextMemory helper modules. */
export interface ContextMemoryHost {
  readonly agent: Agent;
  history: ContextMessage[];
  readonly historyRevision: number;
  tokenCount: number;
  tokenCountCoveredMessageCount: number;
  openSteps: Map<string, ContextMessage>;
  pendingToolResultIds: Set<string>;
  /**
   * toolCallId → tool name for calls whose results have not landed yet.
   * Lets the append path detect swarm results without re-scanning history.
   */
  toolCallNames: Map<string, string>;
  lateAcceptedToolCallIds: Map<string, number>;
  intendedToolCalls: Map<string, LoopToolIntendEvent>;
  deferredMessages: ContextMessage[];
  lastAssistantAt: number | null;
  lastProjectionRepairSignature: string | null;
  markContextChanged(): void;
  appendLoopEvent(event: LoopRecordedEvent): void;
  pushHistory(...messages: ContextMessage[]): void;
  flushDeferredMessagesIfToolExchangeClosed(): void;
  resyncPendingToolResultIdsFromHistory(): void;
}
