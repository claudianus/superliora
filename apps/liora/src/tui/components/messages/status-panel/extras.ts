import type { ProviderExtrasStatus } from '@superliora/sdk';

import { ttui } from '#/tui/utils/tui-i18n';

import type { StatusFieldRow } from './provider-route';

const MAX_PROVIDER_ROWS = 6;
const MAX_CASCADE_LABELS = 6;

const CAPABILITY_LABELS: Record<string, string> = {
  web_search: 'search',
  image_gen: 'image',
  video_gen: 'video',
  mcp_servers: 'mcp',
};

function formatCapability(capability: string): string {
  return CAPABILITY_LABELS[capability] ?? capability;
}

/** Shared short capability list (search/image/video/mcp) for extras surfaces. */
export function formatExtrasCapabilities(capabilities: readonly string[]): string {
  return capabilities.map(formatCapability).join('/');
}

function formatCooldownSuffix(cooldownUntil: number | undefined, now: number): string {
  if (cooldownUntil === undefined || cooldownUntil <= now) return '';
  const remainingMs = cooldownUntil - now;
  if (remainingMs < 60_000) return ` (cooling ${String(Math.ceil(remainingMs / 1000))}s)`;
  return ` (cooling ${String(Math.ceil(remainingMs / 60_000))}m)`;
}

function extrasProviderRows(extras: ProviderExtrasStatus): StatusFieldRow[] {
  const rows: StatusFieldRow[] = [];
  const visible = extras.providers.slice(0, MAX_PROVIDER_ROWS);
  for (const provider of visible) {
    const caps = formatExtrasCapabilities(provider.capabilities);
    rows.push({
      label: provider.label,
      value: `${provider.source} · ${caps}${provider.disabled ? ' · off' : ''}`,
      severity: provider.disabled ? 'warning' : undefined,
    });
  }
  const hidden = extras.providers.length - visible.length;
  if (hidden > 0) rows.push({ label: ttui('tui.statusPanel.more'), value: `${String(hidden)} more detected` });
  return rows;
}

function extrasSearchCascadeRow(extras: ProviderExtrasStatus): StatusFieldRow | undefined {
  if (extras.searchCascade.length === 0) return undefined;
  const now = Date.now();
  const labels = extras.searchCascade
    .slice(0, MAX_CASCADE_LABELS)
    .map((slot) => `${slot.label}${slot.ready ? '' : formatCooldownSuffix(slot.cooldownUntil, now) || ' (not ready)'}`);
  const hidden = extras.searchCascade.length - MAX_CASCADE_LABELS;
  if (hidden > 0) labels.push(`+${String(hidden)}`);
  return { label: ttui('tui.statusPanel.searchCascade'), value: labels.join(' → ') };
}

function extrasMediaRow(extras: ProviderExtrasStatus): StatusFieldRow {
  const parts: string[] = [];
  if (extras.media.image.length > 0) parts.push(`image: ${extras.media.image.join(' → ')}`);
  if (extras.media.video.length > 0) parts.push(`video: ${extras.media.video.join(' → ')}`);
  return {
    label: ttui('tui.statusPanel.mediaAuto'),
    value: parts.length > 0 ? parts.join(' · ') : 'no backend detected',
    severity: parts.length === 0 ? 'warning' : undefined,
  };
}

export function extrasStatusRows(extras: ProviderExtrasStatus): readonly StatusFieldRow[] {
  const rows: StatusFieldRow[] = [...extrasProviderRows(extras)];
  const cascade = extrasSearchCascadeRow(extras);
  if (cascade !== undefined) rows.push(cascade);
  rows.push(extrasMediaRow(extras));
  if (extras.autoMcpServers.length > 0) {
    rows.push({ label: ttui('tui.statusPanel.mcpAuto'), value: extras.autoMcpServers.join(', ') });
  }
  return rows;
}
