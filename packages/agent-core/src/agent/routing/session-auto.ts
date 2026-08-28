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

  let route = await resolveSessionSmartRouteAsync({
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
      // Avoid leaving `auto` as effective model (which would throw
      // `Model "auto" is not configured`). Try any free alias even if
      // unhealthy as last resort, so the turn at least has a concrete model
      // and can surface a provider error instead of a config error.
      const anyFree = Object.entries(config.models ?? {}).find(([alias, m]) =>
        isFreeConfigAlias(alias, config.models),
      );
      if (anyFree !== undefined) {
        const fallbackAlias = anyFree[0];
        agent.log.warn('FREE mode: falling back to any free alias as last resort', {
          alias: fallbackAlias,
        });
        agent.config.setSmartRouteAlias(fallbackAlias);
        return {
          role: 'completion' as const,
          intensity: 'balanced' as const,
          alias: fallbackAlias,
          chain: [fallbackAlias],
          thinkingLevel: 'medium' as const,
          source: 'auto' as const,
          reason: 'FREE fallback — no healthy free model',
        };
      }
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
      // Avoid leaving `auto` as effective model when probe fails for all free.
      // Fall back to any free alias as last resort (even if unhealthy) so the
      // turn can at least try a concrete model and surface a provider error
      // instead of `Model "auto" is not configured`.
      const anyFree = Object.entries(config.models ?? {}).find(([alias]) =>
        isFreeConfigAlias(alias, config.models),
      );
      if (anyFree !== undefined) {
        const fallbackAlias = anyFree[0];
        agent.config.setSmartRouteAlias(fallbackAlias);
        return {
          role: route.role,
          intensity: route.intensity,
          alias: fallbackAlias,
          chain: [fallbackAlias],
          thinkingLevel: route.thinkingLevel,
          source: 'auto' as const,
          reason: 'FREE probe fallback — no healthy free model',
        };
      }
    }
    return undefined;
  }

  // Keep the user's thinking pin; only the concrete model alias is turn-scoped.
  agent.config.setSmartRouteAlias(probed.alias);
  return probed;
}
