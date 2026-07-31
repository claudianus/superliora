/**
 * Status report line builder for `/status`.
 *
 * It mirrors `/usage` visual language but keeps runtime status formatting
 * separate from the TUI orchestration layer.
 */

import { PRODUCT_NAME } from '#/constant/app';
import { renderRendererRatioProgressBar } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { loopModelRoutingRows } from '#/tui/utils/model/loop-model-routing';
import {
  formatTokenCount,
  ratioSeverity,
  safeUsageRatio,
} from '#/utils/usage/usage-format';

import { buildManagedUsageReportLines } from '../usage-panel/index';
import { contextValues } from './context';
import { addStatusFieldRows, createStatusFieldMotionState } from './field-motion';
import {
  formatProviderRouteSummary,
  providerRouteRows,
  type StatusFieldRow,
} from './provider-route';
import { readinessRows } from './readiness';
import {
  contextOSStatusRows,
  formatModelStatus,
  formatPremiumQualityStatus,
  formatUltraworkStatus,
  formatWorktreeStatus,
  microCompactionStatusRows,
  privacyStatusRows,
} from './runtime-rows';
import {
  formatLastRouteNotice,
  formatLastRouteSelection,
  noticeKindLabel,
} from './route-notice';
import type {
  StatusHumanWritingReadiness,
  StatusRecoveryReadiness,
  StatusReportOptions,
} from './types';

export type { StatusFieldMotionState } from './field-motion';
export { createStatusFieldMotionState };
export type { StatusHumanWritingReadiness, StatusRecoveryReadiness, StatusReportOptions };

export function buildStatusReportLines(options: StatusReportOptions): string[] {
  const accent = (text: string) => currentTheme.boldFg('primary', text);
  const value = (text: string) => currentTheme.fg('text', text);
  const muted = (text: string) => currentTheme.fg('textDim', text);
  const errorStyle = (text: string) => currentTheme.fg('error', text);
  const warningStyle = (text: string) => currentTheme.fg('warning', text);
  const severityToken = (sev: 'ok' | 'warn' | 'danger'): 'error' | 'warning' | 'success' =>
    sev === 'danger' ? 'error' : sev === 'warn' ? 'warning' : 'success';

  const permission = options.status?.permission ?? options.permissionMode;
  const sessionId = options.sessionId.trim().length > 0 ? options.sessionId : 'none';
  const rows: StatusFieldRow[] = [
    { label: 'Model', value: formatModelStatus(options) },
    { label: 'Directory', value: options.workDir },
    { label: 'Permissions', value: permission },
    { label: 'Mission', value: formatUltraworkStatus(options) },
    { label: 'Visual Quality', value: formatPremiumQualityStatus(options) },
    ...contextOSStatusRows(options),
    ...microCompactionStatusRows(options),
    ...privacyStatusRows(options),
    { label: 'Session', value: sessionId },
  ];
  if (options.providerRouteStatus !== undefined && options.providerRouteStatus !== null) {
    rows.splice(1, 0, {
      label: 'Route',
      value: formatProviderRouteSummary(options.providerRouteStatus),
    });
  }
  if (options.gitStatus !== undefined && options.gitStatus !== null) {
    rows.splice(2, 0, { label: 'Worktree', value: formatWorktreeStatus(options.gitStatus) });
  }
  const title = options.sessionTitle?.trim();
  if (title !== undefined && title.length > 0) rows.push({ label: 'Title', value: title });
  if (options.statusError !== undefined) {
    rows.push({ label: 'Warning', value: options.statusError, severity: 'error' });
  }

  const lines: string[] = [
    `${accent(`>_ ${PRODUCT_NAME}`)} ${muted(`(v${options.version})`)}`,
  ];
  if (options.upstreamBaseline !== undefined && options.upstreamBaseline.length > 0) {
    lines.push(`${muted('Upstream')}  ${value(options.upstreamBaseline)}`);
  }
  lines.push('');
  addStatusFieldRows(lines, rows, muted, value, errorStyle, warningStyle, options.fieldMotion);

  const { ratio, tokens, maxTokens } = contextValues(options);
  lines.push('');
  lines.push(accent('Context window'));
  if (maxTokens > 0) {
    const safeRatio = safeUsageRatio(ratio);
    const barColor = severityToken(ratioSeverity(safeRatio));
    const barColoured = renderRendererRatioProgressBar({
      ratio: safeRatio,
      width: 20,
      filledStyle: (text) => currentTheme.fg(barColor, text),
      emptyStyle: (text) => currentTheme.fg(barColor, text),
    });
    lines.push(
      `  ${barColoured}  ${value(`${(safeRatio * 100).toFixed(1)}%`.padStart(6, ' '))}  ` +
        muted(`(${formatTokenCount(tokens)} / ${formatTokenCount(maxTokens)})`),
    );
  } else {
    lines.push(`  ${muted('No context window data available.')}`);
  }

  const cacheHitRate = options.status?.cacheHitRate;
  if (cacheHitRate !== undefined && Number.isFinite(cacheHitRate)) {
    const streak = options.status?.cacheWarmStreak;
    const streakSuffix =
      streak !== undefined && streak > 0 ? ` · streak×${String(streak)}` : '';
    addStatusFieldRows(
      lines,
      [{ label: 'Cache hit', value: `${(cacheHitRate * 100).toFixed(0)}%${streakSuffix}` }],
      muted,
      value,
      errorStyle,
      warningStyle,
      options.fieldMotion,
    );
  }

  const cacheFrozen = options.status?.cacheFrozen;
  if (cacheFrozen !== undefined) {
    addStatusFieldRows(
      lines,
      [
        {
          label: 'Cache freeze',
          value: cacheFrozen ? 'active (mid-turn)' : 'idle',
          severity: cacheFrozen ? 'warning' : undefined,
        },
      ],
      muted,
      value,
      errorStyle,
      warningStyle,
      options.fieldMotion,
    );
  }

  const roleModels = options.status?.roleModels;
  if (roleModels !== undefined) {
    lines.push('');
    lines.push(accent('Role models'));
    addStatusFieldRows(
      lines,
      [
        { label: 'Compaction', value: roleModels.compaction ?? 'auto' },
        { label: 'Completion', value: roleModels.completion ?? 'auto' },
        { label: 'Exploration', value: roleModels.exploration ?? 'auto' },
      ],
      muted,
      value,
      errorStyle,
      warningStyle,
      options.fieldMotion,
    );
  }

  if (options.loopModelRouting !== undefined || options.loopModelRoutingError !== undefined) {
    lines.push('');
    lines.push(accent('Loop model routing'));
    if (options.loopModelRouting !== undefined) {
      addStatusFieldRows(
        lines,
        loopModelRoutingRows(options.loopModelRouting).map((role) => ({
          label: role.label,
          value: role.state,
        })),
        muted,
        value,
        errorStyle,
        warningStyle,
        options.fieldMotion,
      );
    } else {
      addStatusFieldRows(
        lines,
        [{ label: 'Overrides', value: options.loopModelRoutingError!, severity: 'error' }],
        muted,
        value,
        errorStyle,
        warningStyle,
        options.fieldMotion,
      );
    }
  }

  if (options.providerRouteStatus !== undefined && options.providerRouteStatus !== null) {
    lines.push('');
    lines.push(accent('Provider route'));
    addStatusFieldRows(
      lines,
      providerRouteRows(options.providerRouteStatus),
      muted,
      value,
      errorStyle,
      warningStyle,
      options.fieldMotion,
    );
  }

  const lastSelection = options.lastProviderRouteSelection;
  const lastNotice = options.lastModelRouteNotice;
  if (
    (lastSelection !== undefined && lastSelection !== null) ||
    (lastNotice !== undefined && lastNotice !== null)
  ) {
    lines.push('');
    lines.push(accent('Last model route'));
    const routeRows: StatusFieldRow[] = [];
    if (lastSelection !== undefined && lastSelection !== null) {
      routeRows.push({
        label: 'Effective',
        value: formatLastRouteSelection(lastSelection, options.availableModels),
      });
    }
    if (lastNotice !== undefined && lastNotice !== null) {
      routeRows.push({
        label: noticeKindLabel(lastNotice.kind),
        value: formatLastRouteNotice(lastNotice, options.availableModels),
      });
    }
    addStatusFieldRows(lines, routeRows, muted, value, errorStyle, warningStyle, options.fieldMotion);
  }

  lines.push('');
  lines.push(accent('Readiness'));
  addStatusFieldRows(
    lines,
    readinessRows(options),
    muted,
    value,
    errorStyle,
    warningStyle,
    options.fieldMotion,
  );

  const managedSection = buildManagedUsageReportLines({
    managedUsage: options.managedUsage,
    managedUsageError: options.managedUsageError,
  });
  if (managedSection.length > 0) {
    lines.push('');
    lines.push(...managedSection);
  }

  return lines;
}
