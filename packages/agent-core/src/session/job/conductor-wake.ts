/**
 * Conductor meta-loop kick (wake). Terminal job notices used to sit in the
 * inbox until the user's next prompt ran the desk injector; this module
 * closes the last edge of the event graph by starting a bounded routing turn
 * on an idle main lane. Lane safety is inherited, not re-implemented here:
 * the direct-work guard rejects real work on the lane, the conductor
 * wall-clock budget force-stops overruns, and user steer/cancel preempts.
 */

import type { Agent } from '../../agent';
import type { PromptOrigin } from '../../agent/context';
import { listUnreadJobInbox } from '../../tools/builtin/job/job-inbox';
import type { ToolStore } from '../../tools/store';

export const CONDUCTOR_WAKE_ORIGIN: PromptOrigin = {
  kind: 'system_trigger',
  name: 'job_desk_wake',
};

/**
 * ACK-shaped by construction: one routing pass, then the turn ends. The desk
 * injector supplies the notices and marks them read in the same turn, so a
 * wake turn never re-fires itself.
 */
export const CONDUCTOR_WAKE_PROMPT = [
  '[job desk wake] Terminal job notices landed — the <conductor_job_desk> injection this turn lists them.',
  'Do exactly one routing pass per the playbook: relay needs_user (AskUserQuestion), verify done-claims against briefs with ledger reads only, chain follow-ups with JobCreate. Then end the turn.',
  'Never run builds/tests/verification loops on this lane — delegate them as Jobs.',
].join('\n');

export function requestConductorWake(input: {
  readonly agent: Agent;
  readonly store: ToolStore;
}): void {
  const { agent, store } = input;
  if (agent.type !== 'main') return;
  try {
    if (listUnreadJobInbox(store).length === 0) return;
    if (agent.turn.hasActiveTurn) {
      // Coalescing: the running turn's per-step inject cycle surfaces the
      // notice. ponytail: a notice landing between the final inject and turn
      // end waits for the next event/user prompt (pre-wake latency); the
      // upgrade path is a one-shot turn.ended re-check armed here.
      return;
    }
    agent.turn.prompt([{ type: 'text', text: CONDUCTOR_WAKE_PROMPT }], CONDUCTOR_WAKE_ORIGIN);
  } catch {
    // Wake is best-effort: never throw into ledger/inbox/completion paths.
  }
}
