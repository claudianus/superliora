/**
 * Apply virtual session `auto` routing at the start of a main-agent turn.
 */

import type { ContentPart } from '@superliora/kosong';

import type { Agent } from '..';
import {
  isSmartAutoSessionAlias,
  resolveSessionSmartRoute,
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
 * this turn and store it on ConfigState for provider resolution.
 */
export function applySessionSmartAutoForTurn(
  agent: Agent,
  input: readonly ContentPart[],
  sessionSpendUsd?: number,
): SmartRoute | undefined {
  if (!isSmartAutoSessionAlias(agent.config.modelAlias)) return undefined;
  const config = agent.runtimeConfig ?? agent.kimiConfig;
  if (config === undefined) return undefined;

  const route = resolveSessionSmartRoute({
    config,
    prompt: promptTextFromParts(input),
    sessionSpendUsd,
  });
  if (route === undefined) return undefined;

  // Keep the user's thinking pin; only the concrete model alias is turn-scoped.
  agent.config.setSmartRouteAlias(route.alias);
  return route;
}
