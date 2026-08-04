import type { ProviderUsageRow, ProviderUsageSnapshot } from './provider-usage-types';

const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'managed:kimi-api': 'Kimi (Subscription)',
  'managed:kimi-code': 'Kimi (Subscription)',
  'openai-codex': 'OpenAI Codex',
  'xai-grok': 'xAI Grok',
  'anthropic-oauth': 'Anthropic Claude',
  'clinepass': 'ClinePass',
  'qwen-token-plan': 'Alibaba Token Plan',
  'alibaba-token-plan': 'Alibaba Token Plan',
  'alibaba-token-plan-cn': 'Alibaba Token Plan (China)',
};

export function providerDisplayName(providerKey: string): string {
  return PROVIDER_DISPLAY_NAMES[providerKey] ?? providerKey;
}

export function usageRowRatio(row: ProviderUsageRow): number {
  return row.limit > 0 ? Math.max(0, Math.min(row.used / row.limit, 1)) : 0;
}

export function snapshotWorstRatio(snapshot: ProviderUsageSnapshot): number {
  let worst = 0;
  if (snapshot.summary !== null) {
    worst = Math.max(worst, usageRowRatio(snapshot.summary));
  }
  for (const row of snapshot.limits) {
    worst = Math.max(worst, usageRowRatio(row));
  }
  return worst;
}
