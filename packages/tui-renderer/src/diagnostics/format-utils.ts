import type { RendererDamageScanStrategy } from '../render/damage';
import type { RendererDiagnosticsIssue } from './types';

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 100) return String(Math.round(value));
  if (Math.abs(value) >= 10) return value.toFixed(1).replace(/\.0$/, '');
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${formatNumber(value / (1024 * 1024))} MiB`;
  if (value >= 1024) return `${formatNumber(value / 1024)} KiB`;
  return `${formatNumber(value)} B`;
}

export function formatPercent(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

export function formatScanStrategy(strategy: RendererDamageScanStrategy): string {
  switch (strategy) {
    case 'none':
      return 'none';
    case 'dirty-rows':
      return 'dirty';
    case 'damage-rect':
      return 'rect';
    case 'full-frame':
      return 'full';
  }
}

export function formatIssueValue(issue: RendererDiagnosticsIssue, value: number | string): string {
  if (typeof value === 'string') return value;
  if (
    issue.code === 'frame-budget' ||
    issue.code === 'phase' ||
    issue.code === 'output-backpressure' ||
    issue.code === 'composition-cache' ||
    issue.code === 'line-cache' ||
    (issue.code === 'output-volume' && value <= 1)
  ) {
    return formatPercent(value);
  }
  if (Math.abs(value) >= 1000) return formatNumber(value);
  return formatNumber(value);
}

export function normalizeMaxIssues(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 3;
  return Math.max(0, Math.floor(value));
}
