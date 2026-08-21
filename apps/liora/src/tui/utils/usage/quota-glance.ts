import type { AllProvidersUsageSnapshot, ProviderRouteStatus } from '@superliora/sdk';
import { overlayRouteRateLimits } from '@superliora/sdk';

export async function refreshProviderQuotaOnHost(host: {
  readonly harness: {
    readonly auth: {
      getAllProvidersUsage(options?: { readonly refresh?: boolean }): Promise<AllProvidersUsageSnapshot>;
    };
  };
  setAppState(patch: { providerQuota: AllProvidersUsageSnapshot | null }): void;
}): Promise<void> {
  try {
    const quota = await host.harness.auth.getAllProvidersUsage({ refresh: true });
    host.setAppState({ providerQuota: quota });
  } catch {
    /* ignore — footer hides when unknown */
  }
}

/** Merge last-response rate-limit windows onto the cached quota snapshot. */
export function resolveLiveQuotaSnapshot(
  quota: AllProvidersUsageSnapshot | null | undefined,
  route: ProviderRouteStatus | null | undefined,
): AllProvidersUsageSnapshot | null {
  const candidates = route?.candidates.map((candidate) => ({
    providerName: candidate.providerName,
    ...(candidate.rateLimits !== undefined ? { rateLimits: candidate.rateLimits } : {}),
  }));
  return overlayRouteRateLimits(quota ?? null, candidates);
}

export function activeProviderKeyFromState(state: {
  readonly model?: string;
  readonly availableModels?: Readonly<Record<string, { readonly provider?: string }>>;
}): string | undefined {
  const alias = state.model;
  if (alias === undefined || alias.length === 0) return undefined;
  return state.availableModels?.[alias]?.provider;
}
