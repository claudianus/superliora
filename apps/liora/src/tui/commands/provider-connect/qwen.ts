import {
  applyQwenTokenPlanProvider,
  QWEN_TOKEN_PLAN_PROVIDER_ID,
  QWEN_TOKEN_PLAN_TEXT_MODELS,
  validateQwenTokenPlanKeyFormat,
} from '#/tui/utils/qwen-token-plan';
import { type ProviderCatalogOption } from '#/tui/utils/provider-catalog-options';
import { promptApiKeyForCatalogProvider } from '../prompts';
import type { SlashCommandHost } from '../dispatch';
import { openModelPickerForProvider } from './model-picker';

/**
 * Connects Qwen Cloud Token Plan — a first-class multimodal subscription
 * supporting text generation, image generation (wan2.7-image), video
 * generation (happyhorse-1.1), server-side harness tools (web_search,
 * code_interpreter, …), and visual understanding. The user only needs to
 * provide their dedicated API key (sk-sp-xxxxx format).
 */
export async function connectQwenTokenPlan(host: SlashCommandHost): Promise<void> {
  const option: ProviderCatalogOption = {
    value: 'qwen-token-plan',
    label: 'Qwen Cloud (Token Plan)',
    authKind: 'api-key',
    modelCount: QWEN_TOKEN_PLAN_TEXT_MODELS.length,
    baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    envVars: ['QWEN_TOKEN_PLAN_API_KEY'],
    docUrl: 'https://docs.qwencloud.com/token-plan/overview',
  };

  const apiKey = await promptApiKeyForCatalogProvider(host, option);
  if (apiKey === undefined) return;

  // Warn if the key doesn't look like a Token Plan dedicated key.
  const warning = validateQwenTokenPlanKeyFormat(apiKey);
  if (warning !== undefined) {
    host.showStatus(warning);
  }

  const config = await host.harness.getConfig();
  if (config.providers[QWEN_TOKEN_PLAN_PROVIDER_ID] !== undefined) {
    await host.harness.removeProvider(QWEN_TOKEN_PLAN_PROVIDER_ID);
  }

  const freshConfig = await host.harness.getConfig();
  const result = applyQwenTokenPlanProvider(freshConfig, apiKey);

  await host.harness.setConfig({
    providers: freshConfig.providers,
    models: freshConfig.models,
    defaultModel: freshConfig.defaultModel,
    defaultThinking: freshConfig.defaultThinking,
  });

  await host.authFlow.refreshConfigAfterLogin();
  host.track('connect', { provider: QWEN_TOKEN_PLAN_PROVIDER_ID, method: 'qwen_token_plan' });
  host.showStatus(
    `Qwen Cloud (Token Plan) connected: ${String(result.modelCount)} models. ` +
    'Image/video generation, harness tools, and visual understanding enabled.',
    'success',
  );

  await openModelPickerForProvider(host, QWEN_TOKEN_PLAN_PROVIDER_ID);
}
