import type { AgentContextData } from '#/agent/context';

import type { JsonObject } from './json';

export type SessionTraceSource = 'records' | 'context_fallback';

export interface VerificationArtifact {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly status?: 'pass' | 'fail' | 'blocked' | 'unknown';
  readonly path?: string;
  readonly hash?: string;
  readonly metadata?: JsonObject;
}

export interface BaseSessionTraceEvent {
  readonly id: string;
  readonly index: number;
  readonly time?: number;
  readonly type: string;
  readonly title: string;
  readonly summary?: string;
  readonly data?: JsonObject;
  readonly evidenceIds?: readonly string[];
}

export interface UltraworkTraceEvent extends BaseSessionTraceEvent {
  readonly type: `ultrawork.${string}`;
  readonly runId?: string;
  readonly stage?: string;
}

export interface SubagentLifecycleTraceEvent extends BaseSessionTraceEvent {
  readonly type: `subagent.${string}`;
  readonly subagentId?: string;
  readonly coverageLane?: string;
  readonly verdict?: 'PASS' | 'BLOCKED' | 'FAIL' | 'UNKNOWN';
}

export type SessionTraceEvent =
  | UltraworkTraceEvent
  | SubagentLifecycleTraceEvent
  | BaseSessionTraceEvent;

export interface SessionTraceCompleteness {
  readonly source: SessionTraceSource;
  readonly recordCount: number;
  readonly traceEventCount: number;
  readonly messageCount: number;
  readonly filteredInternalMessageCount: number;
  readonly toolCallCount: number;
  readonly toolResultCount: number;
  readonly subagentLifecycleCount: number;
  readonly ultraworkEventCount: number;
  readonly redactedCount: number;
  readonly warnings: readonly string[];
}

export interface SessionTrace {
  readonly sessionId: string;
  readonly agentId: string;
  readonly generatedAt: string;
  readonly context: AgentContextData;
  readonly completeness: SessionTraceCompleteness;
  readonly events: readonly SessionTraceEvent[];
  readonly verificationArtifacts: readonly VerificationArtifact[];
}
