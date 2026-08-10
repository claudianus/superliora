/**
 * Apply virtual session `auto` routing at the start of a main-agent turn.
 */

import type { ContentPart } from '@superliora/kosong';

import type { Agent } from '..';
import { ensureSmartRouteProbed } from './live-probe';
import {
  isSmartAutoSessionAlias,
  resolveSessionSmartRouteAsync,
  type SmartRoute,
} from './smart-router';

function promptTextFromParts(input: readonly ContentPart[]): string {
  const chunks: string[] = [];
  for (const part of input) {
    if (part.type === 'text' && typeof part.text === 'string') {
      chunks.push(part.text);
    }
  }
  return chunks.join('\n').trim();
}

/**
 * When the session model pin is virtual `auto`, resolve a concrete alias for
 * this turn, live-probe it (or the next chain hop), and store it on ConfigState.
 */
export async function applySessionSmartAutoForTurn(
  agent: Agent,
  input: readonly ContentPart[],
  sessionSpendUsd?: number,
): Promise<SmartRoute | undefined> {
  if (!isSmartAutoSessionAlias(agent.config.modelAlias)) return undefined;
  const config = agent.runtimeConfig ?? agent.kimiConfig;
  if (config === undefined) return undefined;

  const route = await resolveSessionSmartRouteAsync({
    config,
    prompt: promptTextFromParts(input),
    sessionSpendUsd,
    profileName: agent.config.profileName,
  });
  if (route === undefined) return undefined;

  const probed = await ensureSmartRouteProbed(agent, route);
  if (probed === undefined) {
    agent.config.setSmartRouteAlias(undefined);
    return undefined;
  }

  // Keep the user's thinking pin; only the concrete model alias is turn-scoped.
  agent.config.setSmartRouteAlias(probed.alias);
  return probed;
}
