/**
 * Session startup warnings — extracted from Session class.
 */

import type { SessionWarning } from '@superliora/protocol';
import type { Kaos } from '@superliora/kaos';

import { log } from '#/logging/logger';

import { prepareSystemPromptContext } from '../../profile';

export interface SessionWarningsContext {
  readonly kimiHomeDir: string | undefined;
  readonly additionalDirs: readonly string[];
  readonly systemContextKaos: (cwd: string) => Kaos;
  readonly toolKaosCwd: () => string;
  getAgentsMdWarning: () => string | undefined;
  setAgentsMdWarning: (warning: string | undefined) => void;
}

export async function computeAgentsMdWarning(
  ctx: SessionWarningsContext,
): Promise<string | undefined> {
  const cached = ctx.getAgentsMdWarning();
  if (cached !== undefined) {
    return cached;
  }
  // Resumed sessions skip bootstrap when their system prompt is already set, so
  // the cached value may be missing; recompute on demand so the warning still
  // surfaces for long-lived sessions.
  try {
    const context = await prepareSystemPromptContext(
      ctx.systemContextKaos(ctx.toolKaosCwd()),
      ctx.kimiHomeDir,
      { additionalDirs: ctx.additionalDirs },
    );
    ctx.setAgentsMdWarning(context.agentsMdWarning);
  } catch (error) {
    log.warn('failed to compute AGENTS.md warning', { error });
  }
  return ctx.getAgentsMdWarning();
}

export async function collectSessionWarnings(
  ctx: SessionWarningsContext,
): Promise<readonly SessionWarning[]> {
  const warnings: SessionWarning[] = [];
  const agentsMdWarning = await computeAgentsMdWarning(ctx);
  if (agentsMdWarning !== undefined) {
    warnings.push({
      code: 'agents-md-oversized',
      message: agentsMdWarning,
      severity: 'warning',
    });
  }
  return warnings;
}
