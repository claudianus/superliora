import { renderRendererRatioProgressBar } from '#/tui/renderer';
import type { SessionUsage, TokenUsage } from '@superliora/sdk';
import { currentTheme } from '#/tui/theme';

import { formatTokenCount, safeUsageRatio } from '#/utils/usage/usage-format';

import {
  CACHE_READY_RATIO,
  CONTEXT_COMPACT_RATIO,
  type Colorize,
  usageNumber,
} from './helpers';

function usageByModel(usage: SessionUsage | undefined): Record<string, TokenUsage> {
  return (usage as { readonly byModel?: Record<string, TokenUsage> } | undefined)?.byModel ?? {};
}

function usageInputTotal(usage: TokenUsage): number {
  return (
    usageNumber(usage.inputOther) +
    usageNumber(usage.inputCacheRead) +
    usageNumber(usage.inputCacheCreation)
  );
}

function formatCacheShare(cacheRead: number, cacheWrite: number, input: number): string {
  if (input <= 0) return '0%';
  return `${Math.round(((cacheRead + cacheWrite) / input) * 100)}%`;
}

export function cacheEfficiencyValues(usage: SessionUsage | undefined): {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly ratio: number;
} {
  const entries = Object.values(usageByModel(usage));
  if (entries.length === 0) {
    return {
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      ratio: 0,
    };
  }

  let input = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  for (const row of entries) {
    input += usageInputTotal(row);
    cacheRead += usageNumber(row.inputCacheRead);
    cacheWrite += usageNumber(row.inputCacheCreation);
  }
  if (input <= 0) {
    return {
      input,
      cacheRead,
      cacheWrite,
      ratio: 0,
    };
  }
  return {
    input,
    cacheRead,
    cacheWrite,
    ratio: Math.max(0, Math.min((cacheRead + cacheWrite) / input, 1)),
  };
}

export function cacheEfficiencyNext(ratio: number, cacheRead: number, contextUsage: number): string {
  if (safeUsageRatio(contextUsage) >= CONTEXT_COMPACT_RATIO) return 'Run /compact before long work.';
  if (ratio >= CACHE_READY_RATIO && cacheRead > 0) return 'Continue; cache is ready for long work.';
  if (ratio > 0) return 'Continue; cache is still warming.';
  return 'Continue; cache warms after repeated context.';
}

export function buildSessionUsageSection(
  usage: SessionUsage | undefined,
  error: string | undefined,
  value: Colorize,
  muted: Colorize,
  errorStyle: Colorize,
): string[] {
  if (error !== undefined) return [errorStyle(`  ${error}`)];
  const entries = Object.entries(usageByModel(usage));
  if (entries.length === 0) {
    return [
      muted('  No token usage recorded yet. Send a message to start tracking.'),
      `  ${muted('session')}  input ${value(formatTokenCount(0))}  output ${value(
        formatTokenCount(0),
      )}  total ${value(formatTokenCount(0))}`,
      `  ${muted('session cache')}  read ${value(formatTokenCount(0))}  write ${value(
        formatTokenCount(0),
      )}  share ${value(formatCacheShare(0, 0, 0))}`,
    ];
  }

  const lines: string[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  for (const [model, row] of entries) {
    const input = usageInputTotal(row);
    const cacheRead = usageNumber(row.inputCacheRead);
    const cacheWrite = usageNumber(row.inputCacheCreation);
    const output = usageNumber(row.output);
    totalInput += input;
    totalOutput += output;
    lines.push(
      `  ${muted(model)}  input ${value(formatTokenCount(input))}  output ${value(
        formatTokenCount(output),
      )}  total ${value(formatTokenCount(input + output))}`,
    );
    lines.push(
      `  ${muted(`${model} cache`)}  read ${value(formatTokenCount(cacheRead))}  write ${value(
        formatTokenCount(cacheWrite),
      )}  share ${value(formatCacheShare(cacheRead, cacheWrite, input))}`,
    );
  }
  if (entries.length > 1) {
    lines.push(
      `  ${muted('total')}  input ${value(formatTokenCount(totalInput))}  output ${value(
        formatTokenCount(totalOutput),
      )}  total ${value(formatTokenCount(totalInput + totalOutput))}`,
    );
  }
  return lines;
}

export function buildCacheEfficiencySection(
  sessionUsage: SessionUsage | undefined,
  contextUsage: number,
  accent: Colorize,
  value: Colorize,
  muted: Colorize,
): string[] {
  const cacheEfficiency = cacheEfficiencyValues(sessionUsage);
  const cacheRatio = safeUsageRatio(cacheEfficiency.ratio);
  const cachePct = `${Math.round(cacheRatio * 100)}% cached input`;
  const cacheColor =
    cacheRatio >= CACHE_READY_RATIO ? 'success' : cacheRatio > 0 ? 'warning' : 'error';
  const cacheBarColoured = renderRendererRatioProgressBar({
    ratio: cacheRatio,
    width: 20,
    filledStyle: (text) => currentTheme.fg(cacheColor, text),
    emptyStyle: (text) => currentTheme.fg(cacheColor, text),
  });
  return [
    accent('Cache efficiency'),
    `  ${cacheBarColoured}  ${value(cachePct)}  ` +
      muted(
        `r ${formatTokenCount(cacheEfficiency.cacheRead)} · w ${formatTokenCount(cacheEfficiency.cacheWrite)}`,
      ),
    `  ${muted('Next')}       ${value(
      cacheEfficiencyNext(cacheRatio, cacheEfficiency.cacheRead, contextUsage),
    )}`,
  ];
}
