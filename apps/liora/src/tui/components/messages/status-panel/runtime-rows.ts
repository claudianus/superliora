import type { ModelAlias } from '@superliora/sdk';

import { resolveThinkingDisplay } from '#/tui/utils/model/thinking-effort';
import { formatGitBadgeBase, type GitStatus } from '#/utils/git/git-status';
import { safeUsageRatio } from '#/utils/usage/usage-format';

import { contextValues } from './context';
import type { StatusFieldRow } from './provider-route';
import type { StatusReportOptions } from './types';

function displayModelName(alias: string, models: Record<string, ModelAlias>): string {
  const model = models[alias];
  return model?.displayName ?? model?.model ?? alias;
}

export function formatModelStatus(options: StatusReportOptions): string {
  const model = options.status?.model ?? options.model;
  if (model.trim().length === 0) return 'not set';

  const thinkingRaw = options.status?.thinkingLevel ?? (options.thinking ? 'on' : 'off');
  const alias = options.availableModels[model];
  const display = resolveThinkingDisplay(thinkingRaw, {
    thinking: options.thinking,
    model: alias,
  });
  const thinkingLabel =
    display.label === 'off'
      ? 'off'
      : display.requested === display.effective
        ? display.requested
        : `${display.requested}→${display.effective}`;
  return `${displayModelName(model, options.availableModels)} (thinking ${thinkingLabel})`;
}

export function formatWorktreeStatus(status: GitStatus): string {
  return `${formatGitBadgeBase(status)} ${status.dirty ? 'dirty' : 'clean'}`;
}

function humanWritingBlocked(options: StatusReportOptions): boolean {
  const humanWriting = options.humanWriting;
  return humanWriting !== undefined && (!humanWriting.ready || !humanWriting.advisoryOnly);
}

export function verifyBlockedByReadiness(options: StatusReportOptions): boolean {
  const model = (options.status?.model ?? options.model).trim();
  const { ratio, maxTokens } = contextValues(options);
  return (
    model.length === 0 ||
    (maxTokens > 0 && safeUsageRatio(ratio) >= 0.70) ||
    options.gitStatus?.dirty === true ||
    options.goalStatus === 'blocked' ||
    humanWritingBlocked(options)
  );
}

export function formatUltraworkStatus(options: StatusReportOptions): string {
  const blocked = verifyBlockedByReadiness(options);
  if (blocked && options.goalStatus !== 'blocked') return 'needs readiness';
  if (options.ultraworkMode === true) return 'mode on';

  switch (options.goalStatus) {
    case 'active':
      return 'goal active';
    case 'paused':
      return 'goal paused';
    case 'blocked':
      return 'goal blocked';
    case 'complete':
      return 'verified';
    case undefined:
      return 'mode off';
  }
}

export function formatPremiumQualityStatus(options: StatusReportOptions): string {
  const enabled =
    options.status?.premiumQualityMode ?? options.premiumQualityMode === true;
  return enabled ? 'mode on' : 'mode off';
}

function formatContextOSStatus(options: StatusReportOptions): string | undefined {
  const health = options.contextOS ?? options.status?.contextOS;
  if (health === undefined || health.pageCount <= 0) return undefined;
  const evidence =
    health.missingEvidencePageCount > 0
      ? `evidence ${health.evidenceIdRecallScore.toFixed(2)} (missing ${String(health.missingEvidencePageCount)})`
      : `evidence ${health.evidenceIdRecallScore.toFixed(2)}`;
  return `${health.latestContinuityStatus} · pages ${String(health.readyPageCount)}/${String(health.pageCount)} ready · ${evidence}`;
}

export function privacyStatusRows(options: StatusReportOptions): readonly StatusFieldRow[] {
  if (options.privacyTelemetryEnabled === undefined) return [];
  if (options.privacyTelemetryEnabled) {
    return [
      {
        label: 'Privacy',
        value: 'Telemetry ON (opt-in) · omit/false for ZDR-friendly local',
        severity: 'warning',
      },
    ];
  }
  return [
    {
      label: 'Privacy',
      value: 'Telemetry OFF (default) · ZDR-friendly local',
    },
  ];
}

export function contextOSStatusRows(options: StatusReportOptions): readonly StatusFieldRow[] {
  const value = formatContextOSStatus(options);
  if (value === undefined) return [];
  const health = options.contextOS ?? options.status?.contextOS;
  const severity: StatusFieldRow['severity'] =
    health !== undefined && health.missingEvidencePageCount > 0
      ? 'error'
      : health !== undefined && health.latestContinuityStatus !== 'ready'
        ? 'warning'
        : undefined;
  return [{ label: 'Context OS', value, severity }];
}

function formatMicroCompactionStatus(options: StatusReportOptions): string | undefined {
  const micro = options.microCompaction ?? options.status?.microCompaction;
  if (micro === undefined || micro.total <= 0) return undefined;
  const last = micro.lastTrigger ?? 'unknown';
  const usage =
    micro.lastContextUsageRatio === null || micro.lastContextUsageRatio === undefined
      ? ''
      : ` @${(micro.lastContextUsageRatio * 100).toFixed(0)}%`;
  const top = Object.entries(micro.byTrigger)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `${name}:${String(count)}`)
    .join(',');
  return `${String(micro.total)} clears · last ${last}${usage}${top.length > 0 ? ` · ${top}` : ''}`;
}

export function microCompactionStatusRows(options: StatusReportOptions): readonly StatusFieldRow[] {
  const value = formatMicroCompactionStatus(options);
  if (value === undefined) return [];
  const micro = options.microCompaction ?? options.status?.microCompaction;
  const last = micro?.lastTrigger;
  const severity: StatusFieldRow['severity'] =
    last === 'swarm_pressure' || last === 'usage_and_cache_miss' ? 'warning' : undefined;
  return [{ label: 'Micro clear', value, severity }];
}

export { humanWritingBlocked };
