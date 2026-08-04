import type { Catalog } from '@superliora/sdk';

import {
  ALIBABA_TOKEN_PLAN_CATALOG_ID,
  ALIBABA_TOKEN_PLAN_CN_CATALOG_ID,
  applyQwenTokenPlanProvider,
  QWEN_TOKEN_PLAN_BASE_URL,
  QWEN_TOKEN_PLAN_CN_BASE_URL,
  QWEN_TOKEN_PLAN_PROVIDER_ID,
  QWEN_TOKEN_PLAN_TEXT_MODELS,
  TOKEN_PLAN_ENV_KEYS,
  tokenPlanTextModelsFromCatalog,
  validateQwenTokenPlanKeyFormat,
} from '#/tui/utils/model/qwen-token-plan';
import { type ProviderCatalogOption } from '#/tui/utils/model/provider-catalog-options';
import { loadCatalog } from '#/utils/catalog-cache';
import { promptApiKeyForCatalogProvider } from '../auth/prompts';
import type { SlashCommandHost } from '../hub/dispatch';
import { openModelPickerForProvider } from './model-picker';

/**
 * Connects Alibaba Token Plan (Qwen Cloud) — a first-class multimodal
 * subscription supporting text generation, image generation (wan2.7-image,
 * qwen-image-2.0), video generation (happyhorse-1.1), server-side harness
 * tools (web_search, code_interpreter, …), and visual understanding. The
 * user only needs to provide their dedicated API key (sk-sp-xxxxx format).
 *
 * Model names and metadata resolve live from the models.dev catalog
 * (`alibaba-token-plan` / `alibaba-token-plan-cn`); the built-in presets are
 * the offline fallback. `catalogId` selects the region entry.
 */
export async function connectQwenTokenPlan(
  host: SlashCommandHost,
  catalogId: string = ALIBABA_TOKEN_PLAN_CATALOG_ID,
): Promise<void> {
  // Resolve the live model list from models.dev (best-effort, cached on disk).
  let catalog: Catalog | undefined;
  try {
    catalog = await loadCatalog();
  } catch {
    catalog = undefined;
  }
  const liveModels = catalog === undefined
    ? undefined
    : tokenPlanTextModelsFromCatalog(catalog, catalogId);
  const usingLiveModels = liveModels !== undefined;

  const catalogEntry = catalog?.[catalogId];
  const fallbackBaseUrl =
    catalogId === ALIBABA_TOKEN_PLAN_CN_CATALOG_ID
      ? QWEN_TOKEN_PLAN_CN_BASE_URL
      : QWEN_TOKEN_PLAN_BASE_URL;
  const baseUrl =
    typeof catalogEntry?.api === 'string' && catalogEntry.api.length > 0
      ? catalogEntry.api
      : fallbackBaseUrl;

  const option: ProviderCatalogOption = {
    value: 'qwen-token-plan',
    label:
      typeof catalogEntry?.name === 'string' && catalogEntry.name.length > 0
        ? catalogEntry.name
        : 'Qwen Cloud (Token Plan)',
    authKind: 'api-key',
    modelCount: liveModels?.length ?? QWEN_TOKEN_PLAN_TEXT_MODELS.length,
    baseUrl,
    envVars: [...TOKEN_PLAN_ENV_KEYS],
    docUrl:
      typeof catalogEntry?.doc === 'string' && catalogEntry.doc.length > 0
        ? catalogEntry.doc
        : 'https://docs.qwencloud.com/token-plan/overview',
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
  const result = applyQwenTokenPlanProvider(freshConfig, apiKey, {
    ...(liveModels !== undefined ? { models: liveModels } : {}),
    baseUrl,
  });

  await host.harness.setConfig({
    providers: freshConfig.providers,
    models: freshConfig.models,
    defaultModel: freshConfig.defaultModel,
    defaultThinking: freshConfig.defaultThinking,
  });

  await host.authFlow.refreshConfigAfterLogin();
  host.track('connect', { provider: QWEN_TOKEN_PLAN_PROVIDER_ID, method: 'qwen_token_plan' });
  const modelSource = usingLiveModels ? 'live models.dev catalog' : 'built-in presets';
  host.showStatus(
    `Alibaba Token Plan (Qwen Cloud) connected: ${String(result.modelCount)} models from ${modelSource}. ` +
    'Image/video generation, harness tools, and visual understanding enabled.',
    'success',
  );

  await openModelPickerForProvider(host, QWEN_TOKEN_PLAN_PROVIDER_ID);
}
