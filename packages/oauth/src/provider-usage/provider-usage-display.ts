import type {
  AllProvidersUsageSnapshot,
  ProviderUsageKind,
  ProviderUsageRow,
  ProviderUsageSnapshot,
  ProviderUsageSource,
  ProviderUsageStatus,
} from './provider-usage-types';

const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'managed:kimi-api': 'Kimi (Subscription)',
  'managed:kimi-code': 'Kimi (Subscription)',
  'openai-codex': 'OpenAI Codex',
  'xai-grok': 'xAI Grok',
  'anthropic-oauth': 'Anthropic Claude',
  'cursor-oauth': 'Cursor',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  clinepass: 'ClinePass',
  'qwen-token-plan': 'Alibaba Token Plan',
  'alibaba-token-plan': 'Alibaba Token Plan',
  'alibaba-token-plan-cn': 'Alibaba Token Plan (China)',
  'zai-coding-plan': 'Z.AI (GLM Coding Plan)',
  zai: 'Z.AI',
};

const PROVIDER_SHORT_NAMES: Readonly<Record<string, string>> = {
  'managed:kimi-api': 'Kimi',
  'managed:kimi-code': 'Kimi',
  'openai-codex': 'Codex',
  'xai-grok': 'Grok',
  'anthropic-oauth': 'Claude',
  'cursor-oauth': 'Cursor',
  openrouter: 'OR',
  deepseek: 'DS',
  clinepass: 'Cline',
  'qwen-token-plan': 'Qwen',
  'alibaba-token-plan': 'Qwen',
  'alibaba-token-plan-cn': 'Qwen',
  'zai-coding-plan': 'GLM',
  zai: 'Z.AI',
};

const SUBSCRIPTION_KEYS = new Set([
  'managed:kimi-api',
  'managed:kimi-code',
  'openai-codex',
  'xai-grok',
  'anthropic-oauth',
  'cursor-oauth',
]);

const CREDITS_KEYS = new Set(['openrouter', 'deepseek', 'clinepass', 'zai', 'zai-coding-plan']);

export function providerDisplayName(providerKey: string): string {
  return PROVIDER_DISPLAY_NAMES[providerKey] ?? providerKey;
}

export function providerShortName(providerKey: string): string {
  return PROVIDER_SHORT_NAMES[providerKey] ?? providerKey;
}

export function usageRowRatio(row: ProviderUsageRow): number {
  return row.limit > 0 ? Math.max(0, Math.min(row.used / row.limit, 1)) : 0;
}

export function usageRowRemainingRatio(row: ProviderUsageRow): number | undefined {
  if (!(row.limit > 0)) return undefined;
  return Math.max(0, Math.min(1, (row.limit - row.used) / row.limit));
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

/** Remaining 0–1 for the primary window. Undefined when remaining is unknown. */
export function snapshotRemainingRatio(snapshot: ProviderUsageSnapshot): number | undefined {
  const row = snapshot.summary ?? snapshot.limits[0];
  if (row === undefined) return undefined;
  return usageRowRemainingRatio(row);
}

function inferKind(providerKey: string, source: ProviderUsageSource | undefined): ProviderUsageKind {
  if (source === 'response-headers') return 'rate-limit';
  if (source === 'local-history' || source === 'catalog-pricing') return 'local-estimate';
  if (CREDITS_KEYS.has(providerKey)) return 'api-credits';
  if (SUBSCRIPTION_KEYS.has(providerKey)) return 'subscription';
  return 'rate-limit';
}

function inferStatus(snapshot: Omit<ProviderUsageSnapshot, 'status'>): ProviderUsageStatus {
  const error = snapshot.error?.toLowerCase() ?? '';
  if (error.includes('401') || error.includes('login') || error.includes('expired') || error.includes('unauthorized')) {
    return 'auth-required';
  }
  if (error.includes('429') || error.includes('rate limited')) return 'rate-limited';
  if (snapshot.error !== undefined && snapshot.error.length > 0) return 'error';
  if (!snapshot.available) return 'unavailable';
  return 'ok';
}

function inferSource(providerKey: string, explicit?: ProviderUsageSource): ProviderUsageSource {
  if (explicit !== undefined) return explicit;
  if (
    SUBSCRIPTION_KEYS.has(providerKey) ||
    CREDITS_KEYS.has(providerKey) ||
    providerKey.startsWith('managed:')
  ) {
    return 'oauth-api';
  }
  return 'response-headers';
}

function compactReset(resetHint: string | undefined): string | undefined {
  if (resetHint === undefined) return undefined;
  const match = resetHint.match(/(\d+\s*[dhm](?:\s+\d+\s*[hm])?)/i);
  if (match?.[1] !== undefined) return match[1].replaceAll(/\s+/g, '');
  const after = resetHint.replace(/^resets?\s+in\s+/i, '').trim();
  return after.length > 0 ? after : undefined;
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '';
  return value >= 100 ? value.toFixed(0) : value.toFixed(2);
}

function isCreditsRow(row: ProviderUsageRow, kind: ProviderUsageKind | undefined): boolean {
  if (kind === 'api-credits') return true;
  return /credit|usd|\$/i.test(row.label);
}

/** Compact footer text. Empty when remaining is unknown — never a fake 0%/100%. */
export function formatRemainingDisplay(snapshot: ProviderUsageSnapshot): string {
  if (snapshot.available !== true) return '';
  if (snapshot.error !== undefined && snapshot.error.length > 0) return '';
  const row = snapshot.summary ?? snapshot.limits[0];
  if (row === undefined || !(row.limit > 0)) return '';
  const short = providerShortName(snapshot.providerKey);
  const reset = compactReset(row.resetHint);
  if (isCreditsRow(row, snapshot.kind)) {
    const remaining = row.used === 0 ? row.limit : Math.max(0, row.limit - row.used);
    if (!(remaining > 0) && row.used === 0) return '';
    const amount = `$${formatUsd(remaining)}`;
    return reset !== undefined ? `${short} ${amount} · ${reset}` : `${short} ${amount}`;
  }
  const remainingRatio = usageRowRemainingRatio(row);
  if (remainingRatio === undefined) return '';
  const pct = `${String(Math.round(remainingRatio * 100))}%`;
  return reset !== undefined ? `${short} ${pct} · ${reset}` : `${short} ${pct}`;
}

export function finalizeUsageSnapshot(snapshot: ProviderUsageSnapshot): ProviderUsageSnapshot {
  const source = inferSource(snapshot.providerKey, snapshot.source);
  const kind = snapshot.kind ?? inferKind(snapshot.providerKey, source);
  const status = snapshot.status ?? inferStatus(snapshot);
  const remainingDisplay =
    snapshot.remainingDisplay !== undefined
      ? snapshot.remainingDisplay
      : formatRemainingDisplay({ ...snapshot, kind, status, source });
  return {
    ...snapshot,
    kind,
    status,
    source,
    remainingDisplay,
  };
}

/** Build an aggregate snapshot from individual provider snapshots. */
export function buildAllProvidersUsageSnapshot(
  providers: readonly ProviderUsageSnapshot[],
): AllProvidersUsageSnapshot {
  let worst = 0;
  let primaryProviderKey: string | null = null;
  for (const snap of providers) {
    if (snap.error === undefined && snap.available && primaryProviderKey === null) {
      primaryProviderKey = snap.providerKey;
    }
    worst = Math.max(worst, snapshotWorstRatio(snap));
  }
  return {
    providers,
    primaryProviderKey,
    worstRatio: worst,
    fetchedAtMs: Date.now(),
  };
}
