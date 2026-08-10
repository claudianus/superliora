/**
 * Shared media-provider env resolution for GenerateImage / GenerateVideo
 * registration and Conductor media_readiness injection.
 */

import { nonEmptyEnv } from '../../../agent/tool/env';
import type { LioraConfig } from '../../../config';
import { isProviderExtrasEnabled } from '../../providers/extras/index';
import type { ToolServices } from '../../support/services';
import type { GenerateImageProviderEnv } from './generate-image';
import type { GenerateVideoProviderEnv } from './generate-video';

export type MediaProviderEnv = GenerateImageProviderEnv & GenerateVideoProviderEnv;

export interface MediaProviderEnvSource {
  readonly toolServices?: ToolServices;
  readonly kimiConfig?: Pick<LioraConfig, 'extras'>;
}

/** Resolve provider keys/services the same way builtin registration does. */
export function resolveMediaProviderEnv(source: MediaProviderEnvSource): MediaProviderEnv {
  const services = source.toolServices;
  const config = source.kimiConfig;
  const xaiOn = isProviderExtrasEnabled(config, 'xai-grok');
  const qwenOn = isProviderExtrasEnabled(config, 'qwen-token-plan');
  return {
    xaiGrokBuild: services?.xaiGrokBuild,
    xaiApiKey: xaiOn ? nonEmptyEnv('XAI_API_KEY') : undefined,
    openaiApiKey: nonEmptyEnv('OPENAI_API_KEY'),
    googleApiKey: nonEmptyEnv('GOOGLE_API_KEY') ?? nonEmptyEnv('GEMINI_API_KEY'),
    qwenTokenPlanApiKey:
      services?.qwenTokenPlanApiKey ??
      (qwenOn
        ? nonEmptyEnv('QWEN_TOKEN_PLAN_API_KEY') ?? nonEmptyEnv('ALIBABA_TOKEN_PLAN_API_KEY')
        : undefined),
    qwenTokenPlanBaseUrl:
      services?.qwenTokenPlanBaseUrl ?? (qwenOn ? nonEmptyEnv('QWEN_TOKEN_PLAN_BASE_URL') : undefined),
    codex: services?.codex,
    extrasDisabled: config?.extras?.disabledProviders ?? [],
  };
}
