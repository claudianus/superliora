import type { Agent } from '..';

/**
 * Single turn-end entry for auto dream / refine / skillify.
 *
 * Lanes keep their own flags, cooldowns, and cheap-LLM gates. Call this once
 * so a completed turn does not grow a third independent hook site.
 */
export function scheduleTurnEndLearning(agent: Agent): void {
  if (agent.type !== 'main') return;
  agent.dream?.maybeSchedule();
  agent.refine?.maybeAutoRefine('turn');
  agent.skillify?.maybeSchedule();
}
