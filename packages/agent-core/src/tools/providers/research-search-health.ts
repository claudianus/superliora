import type { ResearchSearchProviderStatus, ResearchSearchStatus } from './research-search-types';

export interface SearchChannelHealth {
  readonly degraded: boolean;
  /** When true, no viable search path remains (never-empty wrapper may still soft-fail). */
  readonly hard: boolean;
  readonly reason?: string | undefined;
  readonly hint?: string | undefined;
}

function isPaidProvider(provider: ResearchSearchProviderStatus): boolean {
  return (
    provider.kind !== 'duckduckgo' &&
    provider.kind !== 'duckduckgo_ia' &&
    provider.kind !== 'searxng' &&
    provider.source !== 'local'
  );
}

function isFreeProvider(provider: ResearchSearchProviderStatus): boolean {
  return (
    provider.kind === 'duckduckgo' ||
    provider.kind === 'duckduckgo_ia' ||
    provider.source === 'local'
  );
}

function isMetaProvider(provider: ResearchSearchProviderStatus): boolean {
  return provider.kind === 'searxng';
}

/** Ordered ch1–ch5 ids inferred from a live engine snapshot (for telemetry). */
export function inferSearchChannelsFromStatus(
  status: ResearchSearchStatus,
): readonly string[] {
  const channels: string[] = [];
  const paidReady = status.providers.some(
    (provider) => provider.ready && isPaidProvider(provider),
  );
  const metaReady = status.providers.some(
    (provider) => provider.ready && isMetaProvider(provider),
  );
  const freeReady = status.providers.some(
    (provider) => provider.ready && isFreeProvider(provider),
  );
  if (paidReady) channels.push('ch1');
  if (metaReady) channels.push('ch2');
  if (freeReady && status.freeFallback) channels.push('ch3');
  if (status.browser.ready || status.browser.escalateAttempted === true) {
    channels.push('ch4');
  }
  if (
    
    status.chromeExtension.ready ||
    status.chromeExtension.escalateAttempted === true
  ) {
    channels.push('ch5');
  }
  return channels;
}

/**
 * Classify search channel health from a live engine snapshot.
 * All paid slots cooling + freeFallback on → soft degrade only (not hard).
 * Late channels (browser Ch4, chrome extension Ch5) and meta (Ch2 SearXNG) soften hard failures when ready.
 */
export function assessSearchChannelHealth(status: ResearchSearchStatus): SearchChannelHealth {
  const paid = status.providers.filter(isPaidProvider);
  const meta = status.providers.filter(isMetaProvider);
  const free = status.providers.filter(isFreeProvider);
  const paidReady = paid.some((provider) => provider.ready);
  const metaReady = meta.some((provider) => provider.ready);
  const freeReady = free.some((provider) => provider.ready);
  const allPaidCooling = paid.length > 0 && paid.every((provider) => !provider.ready);
  const lateChannelReady =
    
    status.browser.ready ||  status.chromeExtension.ready;
  const metaOrLateReady = metaReady || lateChannelReady;

  if (paidReady || metaReady || (paid.length === 0 && freeReady)) {
    return { degraded: false, hard: false };
  }

  if (allPaidCooling && status.freeFallback) {
    if (freeReady) {
      return {
        degraded: true,
        hard: false,
        reason: 'paid_channels_cooling',
        hint:
          'Paid search slots are cooling; free fallback (DDG/local) remains available. Retry later or use FetchURL / local repo evidence.',
      };
    }
    if (metaOrLateReady) {
      return {
        degraded: true,
        hard: false,
        reason: metaReady ? 'paid_channels_cooling_meta' : 'paid_channels_cooling_late_channels',
        hint: metaReady
          ? 'Paid slots cooling and free fallback unavailable; Ch2 SearXNG meta search may still yield hits.'
          : 'Paid slots cooling and free fallback unavailable; browser (Ch4) or Chrome extension bridge (Ch5) may still yield authenticated web-app hits.',
      };
    }
    return {
      degraded: true,
      hard: true,
      reason: 'all_channels_cooling',
      hint: 'Paid slots cooling and free fallback unavailable.',
    };
  }

  if (allPaidCooling && !status.freeFallback) {
    if (metaOrLateReady) {
      return {
        degraded: true,
        hard: false,
        reason: metaReady ? 'paid_channels_cooling_meta' : 'paid_channels_cooling_late_channels',
        hint: metaReady
          ? 'Paid search slots are cooling with free fallback disabled; Ch2 SearXNG meta search remains available.'
          : 'Paid search slots are cooling with free fallback disabled; try browser automation (Ch4) or Chrome extension bridge (Ch5).',
      };
    }
    return {
      degraded: true,
      hard: true,
      reason: 'paid_channels_cooling_no_fallback',
      hint: 'Paid search slots are cooling and free fallback is disabled.',
    };
  }

  if (!freeReady && paid.length === 0) {
    if (metaOrLateReady) {
      return {
        degraded: true,
        hard: false,
        reason: metaReady ? 'meta_channel_only' : 'late_channels_only',
        hint: metaReady
          ? 'No paid/free search providers; Ch2 SearXNG meta search is the primary path.'
          : 'No configured paid/free search providers; browser (Ch4) or Chrome extension bridge (Ch5) is the remaining path.',
      };
    }
    return {
      degraded: true,
      hard: true,
      reason: 'no_search_channels',
      hint: 'No search channels configured or ready.',
    };
  }

  if (!freeReady && !paidReady && metaOrLateReady) {
    return {
      degraded: true,
      hard: false,
      reason: metaReady ? 'search_channels_thin_meta' : 'search_channels_thin_late_channels',
      hint: metaReady
        ? 'Search channels are limited; Ch2 SearXNG meta search may help before browser/extension escalation.'
        : 'Search channels are limited; browser (Ch4) or Chrome extension bridge (Ch5) may help for authenticated web-app search.',
    };
  }

  return {
    degraded: true,
    hard: !status.freeFallback && !freeReady && !metaOrLateReady,
    reason: 'search_channels_thin',
    hint: 'Search channels are limited; prefer local repo evidence or FetchURL on a known URL.',
  };
}

/** SSOT never-empty next-step line for WebSearch / DeepResearch soft-fail output. */
export function buildSearchNeverEmptyNextStep(_options?: {
  readonly health?: SearchChannelHealth | undefined;
  readonly channelsTried?: readonly string[] | undefined;
}): string {
  return (
    'simplify the query, retry WebSearch, try or retry browser automation (Ch4) ' +
    'or Chrome extension bridge (Ch5), FetchURL a known URL, or continue from local repo evidence.'
  );
}
