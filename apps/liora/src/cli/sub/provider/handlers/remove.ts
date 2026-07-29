/**
 * `liora provider remove` — drop a configured provider.
 */

import { writeProviderErr, writeProviderOut } from '../shared';
import type { ProviderDeps } from '../types';

export async function handleProviderRemove(
  deps: ProviderDeps,
  providerId: string,
): Promise<void> {
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  if (config.providers[providerId] === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.notFound', { providerId });
    deps.exit(1);
  }
  await harness.removeProvider(providerId);
  writeProviderOut(deps, 'cli.runtime.provider.removed', { providerId });
}
