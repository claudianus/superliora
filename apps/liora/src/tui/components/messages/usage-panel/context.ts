import { renderRendererRatioProgressBar } from '#/tui/renderer';
import type { ContextComposition } from '@superliora/sdk';
import { currentTheme } from '#/tui/theme';
import {
  effectiveSoftWorkingSetTokens,
  workingSetUsageRatio,
} from '#/tui/utils/agent/context-working-set';

import { formatTokenCount, ratioSeverity, safeUsageRatio } from '#/utils/usage/usage-format';

import {
  CONTEXT_COMPACT_RATIO,
  CONTEXT_WRAP_UP_RATIO,
  type Colorize,
  severityColor,
} from './helpers';
import type { UsageReportOptions } from './types';

export function buildContextWindowSection(input: {
  readonly contextUsage: number;
  readonly contextTokens: number;
  readonly maxContextTokens: number;
  readonly accent: Colorize;
  readonly value: Colorize;
  readonly muted: Colorize;
}): string[] {
  if (input.maxContextTokens <= 0) return [];

  const ratio = safeUsageRatio(input.contextUsage);
  const pct = `${(ratio * 100).toFixed(1)}%`;
  const barColor = severityColor(ratioSeverity(ratio));
  const barColoured = renderRendererRatioProgressBar({
    ratio,
    width: 20,
    filledStyle: (text) => currentTheme.fg(barColor, text),
    emptyStyle: (text) => currentTheme.fg(barColor, text),
  });
  const remaining = Math.max(0, input.maxContextTokens - input.contextTokens);
  const next =
    ratio >= CONTEXT_COMPACT_RATIO
      ? 'Run /compact before long work.'
      : ratio >= CONTEXT_WRAP_UP_RATIO
        ? 'Finish the current step, then /compact.'
        : 'Continue; plenty of room for long work.';
  return [
    input.accent('Context window'),
    `  ${barColoured}  ${input.value(pct.padStart(6, ' '))}  ` +
      input.muted(
        `(${formatTokenCount(input.contextTokens)} / ${formatTokenCount(
          input.maxContextTokens,
        )})`,
      ),
    `  ${input.muted('Remaining')}  ${input.value(`${formatTokenCount(remaining)} tokens`)}`,
    `  ${input.muted('Next')}       ${input.value(next)}`,
  ];
}

export function buildWorkingSetUsageLines(input: {
  readonly contextTokens: number;
  readonly maxContextTokens: number;
  readonly workingSet?: UsageReportOptions['workingSet'];
  readonly accent: Colorize;
  readonly value: Colorize;
  readonly muted: Colorize;
  readonly severityColor: (sev: 'ok' | 'warn' | 'danger') => 'success' | 'warning' | 'error';
}): string[] {
  const ws = input.workingSet;
  if (ws === undefined || ws === null) return [];

  const soft = effectiveSoftWorkingSetTokens({
    maxContextTokens: input.maxContextTokens,
    maxWorkingSetTokens: ws.maxWorkingSetTokens,
  });
  const lines: string[] = [input.accent('Working set')];
  const preset =
    ws.presetId !== undefined && ws.presetId.length > 0 ? ws.presetId : 'custom';

  if (ws.maxWorkingSetTokens <= 0) {
    lines.push(
      `  ${input.muted('Policy')}    ${input.value('full model window')}  ${input.muted(`(${preset})`)}`,
    );
    lines.push(
      `  ${input.muted('Next')}       ${input.value('Auto-compact follows ratio only; long 1M sessions can get expensive.')}`,
    );
    return lines;
  }

  const ratio =
    workingSetUsageRatio({
      contextTokens: input.contextTokens,
      maxContextTokens: input.maxContextTokens,
      maxWorkingSetTokens: ws.maxWorkingSetTokens,
    }) ?? 0;
  const pct = `${(ratio * 100).toFixed(1)}%`;
  const sev: 'ok' | 'warn' | 'danger' =
    ratio >= 0.95 ? 'danger' : ratio >= 0.8 ? 'warn' : 'ok';
  const barColor = input.severityColor(sev);
  const barColoured = renderRendererRatioProgressBar({
    ratio,
    width: 20,
    filledStyle: (text) => currentTheme.fg(barColor, text),
    emptyStyle: (text) => currentTheme.fg(barColor, text),
  });
  const remaining = Math.max(0, soft - input.contextTokens);
  const next =
    ratio >= 0.95
      ? 'Soft compact should fire soon (or run /compact).'
      : ratio >= 0.8
        ? 'Approaching working-set cap; wrap up or /compact.'
        : 'Live history is within the working-set budget.';

  lines.push(
    `  ${barColoured}  ${input.value(pct.padStart(6, ' '))}  ` +
      input.muted(
        `(${formatTokenCount(input.contextTokens)} / ${formatTokenCount(soft)} soft)`,
      ),
  );
  lines.push(
    `  ${input.muted('Policy')}    ${input.value(
      `cap ${formatTokenCount(ws.maxWorkingSetTokens)} · async ${formatTokenCount(ws.asyncWorkingSetTokens)}`,
    )}  ${input.muted(`(${preset})`)}`,
  );
  lines.push(
    `  ${input.muted('Headroom')}  ${input.value(`${formatTokenCount(remaining)} tokens`)}`,
  );
  lines.push(`  ${input.muted('Next')}       ${input.value(next)}`);
  lines.push(
    `  ${input.muted('Tip')}        ${input.value('Change with /context or Settings → Context')}`,
  );
  return lines;
}

export function buildContextCompositionLines(composition: ContextComposition): string[] {
  const accent = (text: string) => currentTheme.boldFg('primary', text);
  const value = (text: string) => currentTheme.fg('text', text);
  const muted = (text: string) => currentTheme.fg('textDim', text);

  const total = composition.totalTokens;
  const max = composition.maxContextTokens;
  const header =
    max > 0
      ? accent(`Context composition`) +
        muted(`  (${formatTokenCount(total)} / ${formatTokenCount(max)})`)
      : accent(`Context composition`) + muted(`  (${formatTokenCount(total)} tokens)`);

  const lines: string[] = [header];

  const allLabels: string[] = [];
  for (const seg of composition.segments) {
    allLabels.push(seg.label);
    if (seg.children !== undefined) {
      for (const child of seg.children) allLabels.push(child.label);
    }
  }
  const labelWidth = Math.max(16, ...allLabels.map((l) => l.length));

  for (const seg of composition.segments) {
    const pct = total > 0 ? ((seg.tokens / total) * 100).toFixed(1) : '0.0';
    const ratio = total > 0 ? seg.tokens / total : 0;
    const bar = renderRendererRatioProgressBar({
      ratio,
      width: 14,
      filledStyle: (text) => currentTheme.fg('primary', text),
      emptyStyle: (text) => currentTheme.fg('textDim', text),
    });
    lines.push(
      `  ${muted(seg.label.padEnd(labelWidth, ' '))}  ${bar}  ${value(
        formatTokenCount(seg.tokens).padStart(7, ' '),
      )}  ${muted(`${pct}%`)}`,
    );
    if (seg.children !== undefined) {
      for (const child of seg.children) {
        lines.push(
          `    ${muted(child.label.padEnd(labelWidth - 2, ' '))}  ${value(
            formatTokenCount(child.tokens).padStart(7, ' '),
          )}`,
        );
      }
    }
  }

  return lines;
}
