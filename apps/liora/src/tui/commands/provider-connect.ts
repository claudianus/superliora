/**
 * Shared provider-connection logic used by both `/login` and `/provider`.
 *
 * The unified provider picker resolves to a {@link ProviderCatalogSelection};
 * this module owns the side effects for each branch (Kimi OAuth, catalog
 * API-key, custom endpoint, custom registry), so the two entry points stay
 * thin. Catalog loading goes through the disk-cached {@link loadCatalog}.
 */

import type { Catalog } from '@superliora/sdk';

import { DEFAULT_OAUTH_PROVIDER_NAME, PRODUCT_NAME } from '../constant/liora-tui';
import {
  type ProviderCatalogSelection,
} from '#/tui/utils/provider-catalog-options';
import { promptProviderCatalog } from './prompts';
import type { SlashCommandHost } from './dispatch';
import {
  connectCatalogProvider,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  loadCatalogWithSpinner,
} from './provider-connect-catalog';
import { connectCustomEndpoint, connectCustomRegistry } from './provider-connect-custom';
import { connectCloudProvider } from './provider-connect-cloud';
import { connectKimiManaged, connectOAuthProvider, resolveOAuthProviderModels } from './provider-connect-oauth';
import { connectQwenTokenPlan } from './provider-connect-qwen';

export {
  connectCatalogProvider,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  loadCatalogWithSpinner,
  resolveOAuthProviderModels,
};

export { connectCustomEndpoint, connectCustomRegistry };

/**
 * Opens the unified provider picker and dispatches the matching connect flow
 * for the selection. Used by both `/login` and `/provider`'s add action.
 * Returns the resolved selection so callers can decide whether to reopen
 * their management view.
 */
export async function runUnifiedProviderConnect(
  host: SlashCommandHost,
  catalog: Catalog,
): Promise<ProviderCatalogSelection | undefined> {
  const selection = await promptProviderCatalog(host, catalog);
  if (selection === undefined) return undefined;

  switch (selection.kind) {
    case 'oauth':
      if (selection.providerId === DEFAULT_OAUTH_PROVIDER_NAME) {
        await connectKimiManaged(host);
      } else {
        await connectOAuthProvider(host, selection.providerId);
      }
      break;
    case 'cloud':
      await connectCloudProvider(host, selection.providerId);
      break;
    case 'qwen-token-plan':
      await connectQwenTokenPlan(host);
      break;
    case 'catalog':
      await connectCatalogProvider(host, catalog, selection.providerId);
      break;
    case 'custom-endpoint':
      await connectCustomEndpoint(host);
      break;
    case 'custom-registry':
      await connectCustomRegistry(host);
      break;
  }
  return selection;
}

// PRODUCT_NAME is re-exported so command modules can reference the managed
// account label without importing from the constant directly.
export { DEFAULT_OAUTH_PROVIDER_NAME, PRODUCT_NAME };
