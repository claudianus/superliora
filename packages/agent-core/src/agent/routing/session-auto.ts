/**
 * Apply virtual session `auto` routing at the start of a main-agent turn.
 */

import type { ContentPart } from '@superliora/kosong';

import type { Agent } from '..';
import { isFreeConfigAlias } from '../../utils/free-model';
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
  const config = agent.runtimeConfig ?? agent.kimiConfig;
  if (config === undefined) return undefined;
  if (!isSmartAutoSessionAlias(agent.config.modelAlias)) {
    if (
      config.freeMode === true &&
      agent.config.modelAlias !== undefined &&
      !isFreeConfigAlias(agent.config.modelAlias, config.models)
    ) {
      agent.log.warn('FREE mode: main model is paid but FREE is on — switch to /model auto or /free off', {
        model: agent.config.modelAlias,
      });
      agent.emitEvent({
        type: 'warning',
        message:
          'FREE mode is on but the current model is not free — run /model auto to route the main turn to a free model, or /free off to restore paid routing.',
        code: 'free-paid-model',
        details: { model: agent.config.modelAlias },
      });
    }
    return undefined;
  }

  const route = await resolveSessionSmartRouteAsync({
    config,
    prompt: promptTextFromParts(input),
    sessionSpendUsd,
    profileName: agent.config.profileName,
  });
  if (route === undefined) {
    if (config.freeMode === true) {
      agent.log.warn('FREE mode: no healthy free model found for this turn', {
        profile: agent.config.profileName,
      });
      agent.emitEvent({
        type: 'warning',
        message:
          'FREE mode is on but no healthy free model is available — add a free model (e.g. /login → OpenCode Zen) or run /free off to restore paid routing.',
        code: 'free-no-model',
        details: { profile: agent.config.profileName },
      });
    }
    return undefined;
  }

  const probed = await ensureSmartRouteProbed(agent, route);
  if (probed === undefined) {
    agent.config.setSmartRouteAlias(undefined);
    if (config.freeMode === true) {
      agent.log.warn('FREE mode: live probe failed for free chain', {
        chain: route.chain.join(' -> '),
      });
      agent.emitEvent({
        type: 'warning',
        message:
          'FREE mode: all free candidates failed live probe — check API keys / quota or run /free off.',
        code: 'free-probe-failed',
        details: { chain: route.chain.join(' -> ') },
      });
    }
    return undefined;
  }

  // Keep the user's thinking pin; only the concrete model alias is turn-scoped.
  agent.config.setSmartRouteAlias(probed.alias);
  return probed;
}
