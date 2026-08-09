/**
 * Status report line builder for `/status`.
 *
 * It mirrors `/usage` visual language but keeps runtime status formatting
 * separate from the TUI orchestration layer.
 */

import { PRODUCT_NAME } from '#/constant/app';
import { renderRendererRatioProgressBar } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { ttui } from '#/tui/utils/tui-i18n';
import { loopModelRoutingRows } from '#/tui/utils/model/loop-model-routing';
import {
  formatTokenCount,
  ratioSeverity,
  safeUsageRatio,
} from '#/utils/usage/usage-format';

import { buildManagedUsageReportLines } from '../usage-panel/index';
import { contextValues } from './context';
import { extrasStatusRows } from './extras';
import { addStatusFieldRows, createStatusFieldMotionState } from './field-motion';
import {
  formatProviderRouteSummary,
  providerRouteRows,
  type StatusFieldRow,
} from './provider-route';
import { readinessRows } from './readiness';
import {
  cacheMissReasonStatusRows,
  contextOSStatusRows,
  formatModelStatus,
  formatPremiumQualityStatus,
  formatWorktreeStatus,
  privacyStatusRows,
} from './runtime-rows';
import {
  formatLastRouteNotice,
  formatLastRouteSelection,
  noticeKindLabel,
} from './route-notice';
import type { StatusHumanWritingReadiness, StatusReportOptions } from './types';

export type { StatusFieldMotionState } from './field-motion';
export { createStatusFieldMotionState };
export type { StatusHumanWritingReadiness, StatusReportOptions };

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
    { label: ttui('tui.statusPanel.model'), value: formatModelStatus(options) },
    { label: ttui('tui.statusPanel.directory'), value: options.workDir },
    { label: ttui('tui.statusPanel.permissions'), value: permission },
    { label: ttui('tui.statusPanel.visualQuality'), value: formatPremiumQualityStatus(options) },
    ...contextOSStatusRows(options),
    ...privacyStatusRows(options),
    { label: ttui('tui.statusPanel.session'), value: sessionId },
  ];
  if (options.sessionLogPath !== undefined && options.sessionLogPath.length > 0) {
    rows.push({ label: ttui('tui.statusPanel.sessionLog'), value: options.sessionLogPath });
  }
  if (options.globalLogPath !== undefined && options.globalLogPath.length > 0) {
    rows.push({ label: ttui('tui.statusPanel.globalLog'), value: options.globalLogPath });
  }
  if (options.providerRouteStatus !== undefined && options.providerRouteStatus !== null) {
    rows.splice(1, 0, {
      label: ttui('tui.statusPanel.route'),
      value: formatProviderRouteSummary(options.providerRouteStatus),
    });
  }
  if (options.gitStatus !== undefined && options.gitStatus !== null) {
    rows.splice(2, 0, { label: ttui('tui.statusPanel.worktree'), value: formatWorktreeStatus(options.gitStatus) });
  }
  const title = options.sessionTitle?.trim();
  if (title !== undefined && title.length > 0) rows.push({ label: ttui('tui.statusPanel.title'), value: title });
  if (options.statusError !== undefined) {
    rows.push({ label: ttui('tui.statusPanel.warning'), value: options.statusError, severity: 'error' });
  }

  const lines: string[] = [
    `${accent(`>_ ${PRODUCT_NAME}`)} ${muted(`(v${options.version})`)}`,
  ];
  if (options.upstreamBaseline !== undefined && options.upstreamBaseline.length > 0) {
    lines.push(`${muted(ttui('tui.statusPanel.upstream'))}  ${value(options.upstreamBaseline)}`);
  }
  lines.push('');
  addStatusFieldRows(lines, rows, muted, value, errorStyle, warningStyle, options.fieldMotion);

  const { ratio, tokens, maxTokens } = contextValues(options);
  lines.push('');
  lines.push(accent(ttui('tui.statusPanel.contextWindow')));
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
    lines.push(`  ${muted(ttui('tui.statusPanel.noContextData'))}`);
  }

  const cacheHitRate = options.status?.cacheHitRate;
  if (cacheHitRate !== undefined && Number.isFinite(cacheHitRate)) {
    const streak = options.status?.cacheWarmStreak;
    const streakSuffix =
      streak !== undefined && streak > 0 ? ` · streak×${String(streak)}` : '';
    addStatusFieldRows(
      lines,
      [{ label: ttui('tui.statusPanel.cacheHit'), value: `${(cacheHitRate * 100).toFixed(0)}%${streakSuffix}` }],
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
          label: ttui('tui.statusPanel.cacheFreeze'),
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

  const missReasonRows = cacheMissReasonStatusRows(options);
  if (missReasonRows.length > 0) {
    addStatusFieldRows(
      lines,
      missReasonRows,
      muted,
      value,
      errorStyle,
      warningStyle,
      options.fieldMotion,
    );
  }

  const roleModelRows = buildRoleModelStatusRows(options);
  if (roleModelRows !== undefined) {
    lines.push('');
    lines.push(accent(ttui('tui.statusPanel.roleModels')));
    if (options.loopModelRoutingError !== undefined && options.loopModelRouting === undefined) {
      addStatusFieldRows(
        lines,
        [{ label: ttui('tui.statusPanel.overrides'), value: options.loopModelRoutingError, severity: 'error' }],
        muted,
        value,
        errorStyle,
        warningStyle,
        options.fieldMotion,
      );
    } else {
      addStatusFieldRows(
        lines,
        roleModelRows,
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
    lines.push(accent(ttui('tui.statusPanel.providerRoute')));
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

  const extras = options.status?.extras;
  if (extras !== undefined && extras.providers.length > 0) {
    lines.push('');
    lines.push(accent(ttui('tui.statusPanel.extras')));
    addStatusFieldRows(
      lines,
      extrasStatusRows(extras),
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
    lines.push(accent(ttui('tui.statusPanel.lastModelRoute')));
    const routeRows: StatusFieldRow[] = [];
    if (lastSelection !== undefined && lastSelection !== null) {
      routeRows.push({
        label: ttui('tui.statusPanel.effective'),
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
  lines.push(accent(ttui('tui.statusPanel.readiness')));
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

function buildRoleModelStatusRows(
  options: StatusReportOptions,
): readonly StatusFieldRow[] | undefined {
  if (options.loopModelRouting !== undefined) {
    return loopModelRoutingRows(
      options.loopModelRouting,
      options.availableModels,
      options.availableProviders,
    ).map((role) => ({
      label: role.label,
      value: role.state,
    }));
  }

  const roleModels = options.status?.roleModels;
  if (roleModels === undefined && options.loopModelRoutingError === undefined) return undefined;

  // Fall back to session status overrides when harness config is unavailable.
  return loopModelRoutingRows(
    {
      loopControl: {
        compactionModel: roleModels?.compaction,
        completionModel: roleModels?.completion,
        explorationModel: roleModels?.exploration,
        codingModel: roleModels?.coding,
        planningModel: roleModels?.planning,
        debuggingModel: roleModels?.debugging,
      },
    },
    options.availableModels,
    options.availableProviders,
  ).map((role) => ({
    label: role.label,
    value: role.state,
  }));
}
