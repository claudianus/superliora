/**
 * Pure component builders for the subagent tail block of a ToolCallComponent
 * card — both the multi-subagent chip/row list (AgentSwarm/UltraSwarm-style
 * parents with several children) and the single-subagent (`Agent` tool)
 * activity list. Given an explicit state snapshot, these return the
 * `Component[]` to append; the class still owns `addChild` ordering and the
 * shared render cache.
 */

import {
  projectRendererLineWindow,
  renderRendererToolActivityHeader,
  RendererPrefixedWrappedLine,
  Text,
  type Component,
} from '#/tui/renderer';
import {
  BRAILLE_SPINNER_FRAMES,
  RESULT_PREVIEW_LINES,
  THINKING_PREVIEW_LINES,
} from '#/tui/constant/rendering';
import { BACKGROUND_GLYPH, PENDING_GLYPH, SPINNER_GLYPH } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import type { TokenUsage } from '@superliora/sdk';
import { renderPulseText } from '#/tui/features/appearance/appearance-effects';
import { applyToolHeaderEntrance } from '#/tui/features/transcript/transcript-entrance';
import {
  getActiveNeatMode,
  getActiveTranscriptDetail,
} from '#/tui/features/transcript/transcript-density';

import { extractKeyArgument, formatSubagentContextTokens, formatSubagentTokens } from './format';
import {
  formatSubagentAgentId,
  recentSubToolActivities,
  tailNonEmptyLines,
  SUBAGENT_SUBTOOL_OUTPUT_INDENT,
  type FinishedSubCall,
  type OngoingSubCall,
  type SubagentPhase,
  type SubToolActivity,
} from './subagent';
import { renderNeatCard } from '../tool-renderers/neat-card';
import { isGenericToolResult } from '../tool-renderers/registry';
import { TruncatedOutputComponent } from '../tool-renderers/truncated';

function renderSubagentPhaseSpinner(
  label: string,
  kind: string,
  subagentSpinnerFrame: number,
  toolCallId: string,
): string {
  const frame =
    BRAILLE_SPINNER_FRAMES[subagentSpinnerFrame % BRAILLE_SPINNER_FRAMES.length] ?? SPINNER_GLYPH;
  return renderPulseText(`${frame} ${label}`, `tool:${toolCallId}:phase:${kind}`, 'primary');
}

function formatPhaseChip(
  subagentPhase: SubagentPhase | undefined,
  toolCallId: string,
  subagentSpinnerFrame: number,
  finishedSubCallCount: number,
  subagentContextTokens: number | undefined,
  subagentUsage: TokenUsage | undefined,
): string {
  if (subagentPhase === undefined) return '';
  const parts: string[] = [];
  switch (subagentPhase) {
    case 'queued':
      parts.push(`${PENDING_GLYPH} queued`);
      break;
    case 'spawning':
      parts.push(renderSubagentPhaseSpinner('starting…', 'spawning', subagentSpinnerFrame, toolCallId));
      break;
    case 'running':
      parts.push(renderSubagentPhaseSpinner('running', 'running', subagentSpinnerFrame, toolCallId));
      break;
    case 'done': {
      parts.push(currentTheme.fg('success', '✓ done'));
      if (finishedSubCallCount > 0) {
        parts.push(`${String(finishedSubCallCount)} tool${finishedSubCallCount > 1 ? 's' : ''}`);
      }
      const tokens =
        formatSubagentContextTokens(subagentContextTokens) ?? formatSubagentTokens(subagentUsage);
      if (tokens !== undefined) parts.push(tokens);
      break;
    }
    case 'failed':
      parts.push(currentTheme.fg('error', '✗ failed'));
      break;
    case 'backgrounded':
      parts.push(`${BACKGROUND_GLYPH} backgrounded`);
      break;
  }
  return parts.length > 0 ? currentTheme.dim(` · ${parts.join(' · ')}`) : '';
}

export interface MultiSubagentBlockState {
  readonly toolCallId: string;
  readonly workspaceDir: string | undefined;
  readonly subagentAgentName: string | undefined;
  readonly subagentAgentId: string | undefined;
  readonly subagentPhase: SubagentPhase | undefined;
  readonly subagentSpinnerFrame: number;
  readonly subagentContextTokens: number | undefined;
  readonly subagentUsage: TokenUsage | undefined;
  readonly hiddenSubCallCount: number;
  readonly finishedSubCalls: readonly FinishedSubCall[];
  readonly ongoingSubCalls: ReadonlyMap<string, OngoingSubCall>;
  readonly subagentText: string;
  readonly subagentResultSummary: string | undefined;
  readonly subagentError: string | undefined;
  readonly spawnEntranceAtMs: number | undefined;
}

/**
 * Builds the AgentSwarm/UltraSwarm-style multi-subagent tail: a chip row
 * plus finished/ongoing sub-call rows, tail text, and result/error lines.
 * Mirrors the previous inline `buildSubagentBlock` body verbatim.
 */
export function buildMultiSubagentBlockComponents(state: MultiSubagentBlockState): Component[] {
  const items: Component[] = [];
  const finishedSubCallCount = state.finishedSubCalls.length + state.hiddenSubCallCount;
  const phaseChip = formatPhaseChip(
    state.subagentPhase,
    state.toolCallId,
    state.subagentSpinnerFrame,
    finishedSubCallCount,
    state.subagentContextTokens,
    state.subagentUsage,
  );
  const agentId = formatSubagentAgentId(state.subagentAgentId);
  const headerLabel =
    state.subagentAgentName !== undefined
      ? `subagent ${state.subagentAgentName} (${agentId})`
      : `subagent (${agentId})`;
  // Spawn entrance settle on the freshly mounted chip row (multi-subagent
  // cards). The timestamp is first-seen guarded, so clock-driven rebuilds
  // decay the highlight in place; replay leaves it undefined → no motion.
  const chipRow = `  ${currentTheme.dim(`↳ ${headerLabel}`)}${phaseChip}`;
  const spawnAtMs = state.spawnEntranceAtMs;
  items.push(
    new Text(spawnAtMs === undefined ? chipRow : applyToolHeaderEntrance(chipRow, spawnAtMs), 0, 0),
  );

  if (state.hiddenSubCallCount > 0) {
    const suffix = state.hiddenSubCallCount > 1 ? 's' : '';
    items.push(
      new Text(
        currentTheme.italic(currentTheme.dim(`    ${String(state.hiddenSubCallCount)} more tool call${suffix} ...`)),
        0,
        0,
      ),
    );
  }

  for (const sub of state.finishedSubCalls) {
    const mark = sub.isError ? currentTheme.fg('error', '✗') : currentTheme.fg('success', '•');
    const keyArg = extractKeyArgument(sub.name, sub.args, state.workspaceDir);
    const nameCol = currentTheme.fg('primary', sub.name);
    const argCol = keyArg ? currentTheme.dim(` (${keyArg})`) : '';
    items.push(
      new Text(
        renderRendererToolActivityHeader({
          marker: `    ${mark} `,
          action: 'Used',
          label: nameCol,
          detail: argCol,
        }),
        0,
        0,
      ),
    );
  }

  for (const [id, call] of state.ongoingSubCalls) {
    const keyArg = extractKeyArgument(call.name, call.args, state.workspaceDir);
    const nameCol = currentTheme.fg('primary', call.name);
    const argCol = keyArg ? currentTheme.dim(` (${keyArg})`) : '';
    const mark = renderPulseText('…', `tool:${state.toolCallId}:subcall:${id}`, 'primary');
    const verb = renderPulseText('Using', `tool:${state.toolCallId}:subcall-verb:${id}`, 'text');
    items.push(
      new Text(
        renderRendererToolActivityHeader({
          marker: `    ${mark} `,
          action: verb,
          label: nameCol,
          detail: argCol,
        }),
        0,
        0,
      ),
    );
  }

  if (state.subagentText.length > 0) {
    const tailLines = projectRendererLineWindow({
      lines: state.subagentText.split('\n'),
      maxLines: 3,
      tail: true,
    }).lines;
    for (const line of tailLines) {
      items.push(new Text(`    ${currentTheme.dim(line)}`, 0, 0));
    }
  }

  // Result summary from subagent.completed.
  if (state.subagentPhase === 'done' && state.subagentResultSummary !== undefined) {
    const summaryLines = projectRendererLineWindow({
      lines: state.subagentResultSummary.split('\n'),
      maxLines: 2,
    }).lines;
    for (const line of summaryLines) {
      items.push(new Text(`    ${currentTheme.dim('└')} ${line}`, 0, 0));
    }
  }

  // Full error text from subagent.failed; do not collapse it.
  if (state.subagentPhase === 'failed' && state.subagentError !== undefined) {
    const errLines = state.subagentError.split('\n');
    for (const line of errLines) {
      items.push(new Text(`    ${currentTheme.fg('error', '└')} ${line}`, 0, 0));
    }
  }

  return items;
}

export interface SingleSubagentBlockState {
  readonly toolCallId: string;
  readonly workspaceDir: string | undefined;
  readonly activities: readonly SubToolActivity[];
  readonly derivedSubagentPhase: SubagentPhase | undefined;
  readonly subagentError: string | undefined;
  readonly subagentText: string;
  readonly subagentThinkingText: string;
}

function formatSubToolActivityRow(
  marker: string,
  verb: string,
  activity: SubToolActivity,
  workspaceDir: string | undefined,
): string {
  const keyArg = extractKeyArgument(activity.name, activity.args, workspaceDir);
  const nameCol = currentTheme.fg('primary', activity.name);
  const argCol = keyArg ? currentTheme.dim(` (${keyArg})`) : '';
  return renderRendererToolActivityHeader({
    marker,
    action: verb,
    label: nameCol,
    detail: argCol,
  });
}

function subToolOutputPreview(activity: SubToolActivity): Component[] {
  // Worker activity gets the same neat treatment as the main agent: a
  // structured card wins over the raw tail whenever the harness attached one.
  if (getActiveNeatMode() && activity.display !== undefined) {
    const card = renderNeatCard(activity.display, { seed: activity.id });
    if (card !== undefined) return card;
  }
  const output = activity.output;
  if (output === undefined || output.trim().length === 0) return [];
  // Mirror the main agent: Bash and any tool without a dedicated renderer
  // (every MCP tool included) get a truncated output preview. Recognized
  // tools keep their compact activity row only.
  if (activity.name !== 'Bash' && !isGenericToolResult(activity.name)) return [];
  return [
    new TruncatedOutputComponent(output, {
      // Subagent output is always fixed-truncated; it does not take part in
      // the ctrl+o expand toggle, so don't advertise it either.
      expanded: false,
      expandHint: false,
      isError: activity.phase === 'failed',
      maxLines: RESULT_PREVIEW_LINES,
      indent: SUBAGENT_SUBTOOL_OUTPUT_INDENT,
      tail: activity.phase === 'ongoing',
    }),
  ];
}

/**
 * Builds the single-`Agent`-tool-call activity tail: recent sub-tool rows
 * (with truncated output previews for Bash/generic tools), then either the
 * full failure text or a two-line thinking/output tail. Mirrors the
 * previous inline `buildSingleSubagentBlock` body verbatim.
 */
export function buildSingleSubagentBlockComponents(state: SingleSubagentBlockState): Component[] {
  const items: Component[] = [];
  for (const activity of recentSubToolActivities(state.activities)) {
    const mark =
      activity.phase === 'failed'
        ? currentTheme.fg('error', '✗')
        : activity.phase === 'done'
          ? currentTheme.fg('success', '•')
          : renderPulseText('•', `tool:${state.toolCallId}:subtool:${activity.orderSeq}`, 'primary');
    const verb =
      activity.phase === 'ongoing'
        ? renderPulseText('Using', `tool:${state.toolCallId}:subtool-verb:${activity.orderSeq}`, 'text')
        : 'Used';
    items.push(
      new Text(formatSubToolActivityRow(`  ${mark} `, verb, activity, state.workspaceDir), 0, 0),
    );
    items.push(...subToolOutputPreview(activity));
  }

  if (state.derivedSubagentPhase === 'failed' && state.subagentError !== undefined) {
    const errorLine = tailNonEmptyLines(state.subagentError, 1).at(-1);
    if (errorLine !== undefined) {
      items.push(
        new RendererPrefixedWrappedLine({
          firstPrefix: `  ${currentTheme.fg('error', '└')} `,
          continuationPrefix: '    ',
          text: currentTheme.fg('error', errorLine),
        }),
      );
    }
    return items;
  }

  const outputLine = tailNonEmptyLines(state.subagentText, 1).at(-1);
  if (state.derivedSubagentPhase !== 'done' && state.subagentThinkingText.trim().length > 0) {
    const detail = getActiveTranscriptDetail();
    // Match main-agent thinking density: minimal hides body; full shows all;
    // compact/standard keep a short tail window.
    if (detail !== 'minimal') {
      const thinkingText = state.subagentThinkingText.trimEnd();
      items.push(
        new RendererPrefixedWrappedLine({
          firstPrefix: `  ${currentTheme.dim('◌')} `,
          continuationPrefix: '    ',
          text: currentTheme.dim(thinkingText),
          ...(detail === 'full'
            ? {}
            : {
                tailLines:
                  detail === 'compact'
                    ? Math.min(2, THINKING_PREVIEW_LINES)
                    : THINKING_PREVIEW_LINES,
              }),
        }),
      );
    }
  }
  if (outputLine !== undefined) {
    items.push(
      new RendererPrefixedWrappedLine({
        firstPrefix: `  ${currentTheme.fg('text', '└')} `,
        continuationPrefix: '    ',
        text: currentTheme.fg('text', outputLine),
      }),
    );
  }

  return items;
}
