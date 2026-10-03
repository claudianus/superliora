import {
  formatCacheMissReasonGlance,
  type UsageCacheMissLike,
} from '#/tui/utils/cache/cache-diagnostics';
import { resolveThinkingDisplay } from '#/tui/utils/model/thinking-effort';
import { modelRouteDisplayName } from '#/tui/utils/model/model-route-notice';
import { ttui } from '#/tui/utils/tui-i18n';
import { formatGitBadgeBase, type GitStatus } from '#/utils/git/git-status';

import type { StatusFieldRow } from './provider-route';
import type { StatusReportOptions } from './types';

export function formatModelStatus(options: StatusReportOptions): string {
  const model = options.status?.model ?? options.model;
  if (model.trim().length === 0) return ttui('tui.statusPanel.notSet');

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
  return `${modelRouteDisplayName(model, options.availableModels)} (thinking ${thinkingLabel})`;
}

export function formatWorktreeStatus(status: GitStatus): string {
  return `${formatGitBadgeBase(status)} ${status.dirty ? 'dirty' : 'clean'}`;
}


export function privacyStatusRows(options: StatusReportOptions): readonly StatusFieldRow[] {
  if (options.privacyTelemetryEnabled === undefined) return [];
  if (options.privacyTelemetryEnabled) {
    return [
      {
        label: ttui('tui.statusPanel.privacy'),
        value: ttui('tui.statusPanel.privacyTelemetryOn'),
        severity: 'warning',
      },
    ];
  }
  return [
    {
      label: ttui('tui.statusPanel.privacy'),
      value: ttui('tui.statusPanel.privacyTelemetryOff'),
    },
  ];
}



const CACHE_MISS_REASON_LINE_PREFIX = 'Miss reasons: ';

/** Cache miss-reason histogram when usage.cacheDiagnostics.missReasons has counts. */
export function cacheMissReasonStatusRows(options: StatusReportOptions): readonly StatusFieldRow[] {
  const usage = options.status?.usage as UsageCacheMissLike | undefined;
  const glance = formatCacheMissReasonGlance(usage);
  if (glance === null) return [];
  const value = glance.line.startsWith(CACHE_MISS_REASON_LINE_PREFIX)
    ? glance.line.slice(CACHE_MISS_REASON_LINE_PREFIX.length)
    : glance.line;
  return [
    {
      label: ttui('tui.statusPanel.missReasons'),
      value,
      severity: glance.warn ? 'warning' : undefined,
    },
  ];
}

