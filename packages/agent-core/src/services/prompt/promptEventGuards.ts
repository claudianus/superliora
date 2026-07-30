import type { Event } from '@superliora/protocol';

import type { PermissionMode } from '../../agent/permission';

/**
 * Type guard for `turn.started` agent-core events.
 */
export function isTurnStarted(e: Event): e is Event & { type: 'turn.started'; turnId: number } {
  return (e as { type?: string }).type === 'turn.started';
}

/**
 * Type guard for `turn.ended` agent-core events.
 */
export function isTurnEnded(e: Event): e is Event & {
  type: 'turn.ended';
  turnId: number;
  reason: 'completed' | 'cancelled' | 'failed' | 'filtered';
} {
  return (e as { type?: string }).type === 'turn.ended';
}

/**
 * Type guard for `agent.status.updated` agent-core events. Carries the
 * subset of fields we mirror into the per-session shadow on every live
 * change (model / permission / planMode). `thinkingLevel` is NOT on this
 * event — bootstrap seeds it from `getConfig` and per-request diff dispatch
 * keeps it in sync from there.
 */
export function isAgentStatusUpdated(e: Event): e is Event & {
  type: 'agent.status.updated';
  model?: string;
  permission?: PermissionMode;
  planMode?: boolean;
} {
  return (e as { type?: string }).type === 'agent.status.updated';
}
