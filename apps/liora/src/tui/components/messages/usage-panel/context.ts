import { renderRendererRatioProgressBar } from '#/tui/renderer';
import type { ContextComposition } from '@superliora/sdk';
import { currentTheme } from '#/tui/theme';

import { formatTokenCount, ratioSeverity, safeUsageRatio } from '#/utils/usage/usage-format';

import {
  CONTEXT_COMPACT_RATIO,
  CONTEXT_WRAP_UP_RATIO,
  type Colorize,
  severityColor,
} from './helpers';

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
