import { currentTheme } from '#/tui/theme';

import { buildManagedUsageReportLines } from './managed';
import { buildProviderQuotaSection } from './provider-quota';
import {
  buildCacheEfficiencySection,
  buildSessionUsageSection,
} from './session';
import {
  buildContextWindowSection,
  buildWorkingSetUsageLines,
} from './context';
import { severityColor } from './helpers';
import type { UsageReportOptions } from './types';

export function buildUsageReportLines(options: UsageReportOptions): string[] {
  const accent = (text: string) => currentTheme.boldFg('primary', text);
  const value = (text: string) => currentTheme.fg('text', text);
  const muted = (text: string) => currentTheme.fg('textDim', text);
  const errorStyle = (text: string) => currentTheme.fg('error', text);

  if (options.providerQuotaOnly) {
    return buildProviderQuotaSection(
      options.providerQuota,
      accent,
      value,
      muted,
      errorStyle,
    );
  }

  const lines: string[] = [
    accent('Session usage'),
    ...buildSessionUsageSection(
      options.sessionUsage,
      options.sessionUsageError,
      value,
      muted,
      errorStyle,
    ),
  ];

  lines.push('');
  lines.push(
    ...buildCacheEfficiencySection(
      options.sessionUsage,
      options.contextUsage,
      accent,
      value,
      muted,
    ),
  );

  const contextWindow = buildContextWindowSection({
    contextUsage: options.contextUsage,
    contextTokens: options.contextTokens,
    maxContextTokens: options.maxContextTokens,
    accent,
    value,
    muted,
  });
  if (contextWindow.length > 0) {
    lines.push('');
    lines.push(...contextWindow);
  }

  const workingSetLines = buildWorkingSetUsageLines({
    contextTokens: options.contextTokens,
    maxContextTokens: options.maxContextTokens,
    workingSet: options.workingSet,
    accent,
    value,
    muted,
    severityColor,
  });
  if (workingSetLines.length > 0) {
    lines.push('');
    lines.push(...workingSetLines);
  }

  const managedSection = buildManagedUsageReportLines({
    managedUsage: options.managedUsage,
    managedUsageError: options.managedUsageError,
    managedUsageFillProgress: options.managedUsageFillProgress,
  });
  if (managedSection.length > 0) {
    lines.push('');
    lines.push(...managedSection);
  }

  const quotaSection = buildProviderQuotaSection(
    options.providerQuota,
    accent,
    value,
    muted,
    errorStyle,
  );
  if (quotaSection.length > 0) {
    lines.push('');
    lines.push(...quotaSection);
  }

  return lines;
}
