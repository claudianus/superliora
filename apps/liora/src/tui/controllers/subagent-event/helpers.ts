import type { Event } from '@superliora/sdk';

export type SubagentLifecycleEvent = Event & { type: `subagent.${string}` };
export type SubagentLifecycleEventOf<Type extends SubagentLifecycleEvent['type']> =
  SubagentLifecycleEvent & { type: Type };

export function isSubagentLifecycleEvent(event: Event): event is SubagentLifecycleEvent {
  return (
    event.type === 'subagent.spawned' ||
    event.type === 'subagent.started' ||
    event.type === 'subagent.suspended' ||
    event.type === 'subagent.completed' ||
    event.type === 'subagent.failed'
  );
}
