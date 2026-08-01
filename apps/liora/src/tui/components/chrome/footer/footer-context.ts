import type { FooterLabels } from '#/tui/config';
import { formatTokenCount, safeUsageRatio } from '#/utils/usage/usage-format';
import { labelContextPrefix } from '#/tui/components/chrome/footer/footer-labels';

export function safeContextUsage(usage: number): number {
  return safeUsageRatio(usage);
}

export function formatContextStatus(
  usage: number,
  tokens?: number,
  maxTokens?: number,
  labels: FooterLabels = 'plain',
): string {
  const ratio = safeContextUsage(usage);
  const pct = `${(ratio * 100).toFixed(1)}%`;
  const bar = renderContextUsageBar(ratio);
  const prefix = labelContextPrefix(labels);
  if (maxTokens && maxTokens > 0 && tokens !== undefined) {
    return `${prefix} ${bar} ${pct} (${formatTokenCount(tokens)}/${formatTokenCount(maxTokens)})`;
  }
  return `${prefix} ${bar} ${pct}`;
}

function renderContextUsageBar(ratio: number): string {
  // 10-cell high-res bar with eighths partial fill for demo-grade pressure glance.
  const width = 10;
  const totalEighths = Math.max(0, Math.min(width * 8, Math.round(ratio * width * 8)));
  const fullCells = Math.floor(totalEighths / 8);
  const rem = totalEighths % 8;
  const PARTIAL = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'] as const;
  const partial = PARTIAL[rem] ?? '';
  const usedCells = fullCells + (partial.length > 0 ? 1 : 0);
  return `${'█'.repeat(fullCells)}${partial}${'░'.repeat(Math.max(0, width - usedCells))}`;
}
