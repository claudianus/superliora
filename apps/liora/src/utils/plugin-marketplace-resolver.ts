import {
  findMarketplacePlugin,
  loadPluginMarketplace,
  type PluginMarketplace,
} from '#/utils/plugin-marketplace';

/**
 * Cached marketplace lookup used by PluginManager dependency auto-install.
 */
export function createMarketplaceSourceResolver(workDir: string): (
  pluginId: string,
) => Promise<string | undefined> {
  let marketplacePromise: Promise<PluginMarketplace> | undefined;
  const load = (): Promise<PluginMarketplace> => {
    marketplacePromise ??= loadPluginMarketplace({ workDir }).catch((error) => {
      marketplacePromise = undefined;
      throw error;
    });
    return marketplacePromise;
  };

  return async (pluginId: string): Promise<string | undefined> => {
    try {
      const marketplace = await load();
      return findMarketplacePlugin(marketplace, pluginId)?.source;
    } catch {
      return undefined;
    }
  };
}
