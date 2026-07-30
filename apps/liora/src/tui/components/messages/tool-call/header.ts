/**
 * Pure header-composition helpers for ToolCallComponent. Given an explicit
 * snapshot of the relevant instance state, these render the same header
 * string the class previously built inline — no component instance state,
 * no mutation.
 */

import {
  formatRendererToolHeaderChip,
  projectRendererToolActivityPhase,
  renderRendererToolActivityHeader,
} from '#/tui/renderer';
import { BRAILLE_SPINNER_FRAMES } from '#/tui/constant/rendering';
import { SPINNER_GLYPH, STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';
import type { TokenUsage } from '@superliora/sdk';
import {
  getActiveAppearancePreferences,
  isToneSettleFlashActive,
  renderAnimatedGradientText,
  renderPhaseChip,
  renderPulseText,
  renderToneSettleFlash,
  shouldRenderAmbientEffects,
  type MotionToolPhase,
} from '#/tui/features/appearance/appearance-effects';
import { decodeMcpToolName } from '#/tui/utils/mcp-tool-name';

import { buildGoalToolHeader } from '../tool-renderers/goal';
import { isGenericToolResult } from '../tool-renderers/registry';
import { pickChip } from '../tool-renderers/chip';
import {
  extractKeyArgument,
  formatElapsed,
  formatSubagentLabel,
  formatTokens,
  usageTotal,
  str,
} from './format';
import { interpretExitPlanModeOutcome } from './plan';
import type { SubagentPhase } from './subagent';

/**
 * Explicit snapshot of the ToolCallComponent state needed to compose the
 * header. Built fresh by the class on every header rebuild — cheap field
 * reads, no aliasing hazards since only primitives and readonly refs cross
 * the boundary.
 */
export interface ToolCallHeaderState {
  readonly toolCall: ToolCallBlockData;
  readonly result: ToolResultBlockData | undefined;
  readonly resultSettledAtMs: number | undefined;
  readonly finishedAtMs: number | undefined;
  readonly workspaceDir: string | undefined;
  readonly isSingleSubagentView: boolean;
  readonly subagentAgentName: string | undefined;
  readonly subagentModelAlias: string | undefined;
  readonly derivedSubagentPhase: SubagentPhase | undefined;
  readonly subToolActivityCount: number;
  readonly subagentElapsedSeconds: number | undefined;
  readonly subagentContextTokens: number | undefined;
  readonly subagentUsage: TokenUsage | undefined;
  readonly subagentSpinnerFrame: number;
}

export function renderToolActivityLabel(
  label: string,
  seed: string,
  tone: 'primary' | 'error' | 'text' = 'primary',
): string {
  if (tone === 'error' || !shouldRenderAmbientEffects(getActiveAppearancePreferences())) {
    return currentTheme.boldFg(tone, label);
  }
  return renderAnimatedGradientText(label, seed);
}

function formatToolCallDurationChip(
  toolCall: ToolCallBlockData,
  result: ToolResultBlockData | undefined,
  finishedAtMs: number | undefined,
): string | undefined {
  const startedAtMs = toolCall.streamingStartedAtMs;
  if (startedAtMs === undefined) return undefined;
  const endedAtMs = finishedAtMs ?? (result === undefined ? Date.now() : undefined);
  if (endedAtMs === undefined) return undefined;
  const elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000));
  // Keep sub-second tools quiet; duration noise hurts glanceability.
  if (elapsedSeconds < 1) return undefined;
  return formatElapsed(elapsedSeconds);
}

function buildToolCallHeaderChip(
  toolCall: ToolCallBlockData,
  result: ToolResultBlockData,
  finishedAtMs: number | undefined,
): string {
  const provider = pickChip(toolCall.name);
  const parts: string[] = [];
  if (provider !== undefined) {
    const text = provider(toolCall, result);
    if (text.length > 0) parts.push(text);
  }
  const durationChip = formatToolCallDurationChip(toolCall, result, finishedAtMs);
  if (durationChip !== undefined) parts.push(durationChip);
  if (parts.length === 0) return '';
  const chip = formatRendererToolHeaderChip({ text: parts.join(' · ') });
  if (result.is_error) return currentTheme.fg('error', chip);
  return currentTheme.dim(chip);
}

function buildSingleSubagentMarker(
  phase: SubagentPhase | undefined,
  subagentSpinnerFrame: number,
  toolCallId: string,
): string {
  if (phase === 'failed') return currentTheme.fg('error', '✗ ');
  if (phase === 'done') return currentTheme.fg('success', STATUS_BULLET);
  if (phase === 'backgrounded') return currentTheme.dim('◐ ');
  const frame = BRAILLE_SPINNER_FRAMES[subagentSpinnerFrame % BRAILLE_SPINNER_FRAMES.length] ?? SPINNER_GLYPH;
  // Pulse the spinner color while actively spawning/running (PREMIUM.md
  // §7.3: spinner = braille cycle + pulse color); queued waits quietly.
  const spinner =
    phase === 'running' || phase === 'spawning'
      ? renderPulseText(frame, `tool:${toolCallId}:subagent-spinner`, 'primary')
      : currentTheme.fg('primary', frame);
  return `${spinner} `;
}

function formatSingleSubagentStatus(phase: SubagentPhase | undefined, toolCallId: string): string {
  switch (phase) {
    case 'done':
      return currentTheme.fg('success', 'Completed');
    case 'failed':
      return currentTheme.fg('error', 'Failed');
    case 'running':
      return renderPulseText('Running', `tool:${toolCallId}:subagent-status`, 'primary');
    case 'backgrounded':
      return currentTheme.fg('textMuted', 'Backgrounded');
    case 'queued':
      return renderPulseText('Queued', `tool:${toolCallId}:subagent-status`, 'primary', undefined, 'slow');
    case 'spawning':
    case undefined:
      return renderPulseText('Starting', `tool:${toolCallId}:subagent-status`, 'primary');
  }
}

function formatSingleSubagentStatsText(
  subToolActivityCount: number,
  elapsedSeconds: number | undefined,
  subagentContextTokens: number | undefined,
  subagentUsage: TokenUsage | undefined,
): string {
  const parts = [`${String(subToolActivityCount)} tool${subToolActivityCount === 1 ? '' : 's'}`];
  if (elapsedSeconds !== undefined) parts.push(formatElapsed(elapsedSeconds));
  const tokens =
    subagentContextTokens && subagentContextTokens > 0
      ? subagentContextTokens
      : subagentUsage === undefined
        ? 0
        : usageTotal(subagentUsage);
  if (tokens > 0) parts.push(formatTokens(tokens));
  return ` · ${parts.join(' · ')}`;
}

function buildSingleSubagentHeader(state: ToolCallHeaderState): string {
  const phase = state.derivedSubagentPhase;
  const isDone = phase === 'done';
  const marker = buildSingleSubagentMarker(phase, state.subagentSpinnerFrame, state.toolCall.id);
  const labelText = formatSubagentLabel(state.subagentAgentName);
  const label = currentTheme.boldFg('primary', labelText);
  const status = formatSingleSubagentStatus(phase, state.toolCall.id);
  const description = truncateSubagentDescription(str(state.toolCall.args['description']));
  const descriptionPlain = description.length > 0 ? ` (${description})` : '';
  const descriptionText = descriptionPlain.length > 0 ? currentTheme.dim(descriptionPlain) : '';
  const modelPlain =
    state.subagentModelAlias !== undefined && state.subagentModelAlias.length > 0
      ? ` · ${state.subagentModelAlias}`
      : '';
  const modelText = modelPlain.length > 0 ? currentTheme.fg('glow', modelPlain) : '';
  const statsText = formatSingleSubagentStatsText(
    state.subToolActivityCount,
    state.subagentElapsedSeconds,
    state.subagentContextTokens,
    state.subagentUsage,
  );
  if (isDone) {
    return `${marker}${currentTheme.boldFg('success', labelText)} ${currentTheme.fg('success', `Completed${descriptionPlain}${modelPlain}${statsText}`)}`;
  }
  const stats = currentTheme.dim(statsText);
  return `${marker}${label} ${status}${descriptionText}${modelText}${stats}`;
}

// Local copy avoids a cross-import cycle with tool-call-subagent.ts; kept
// byte-identical to MAX_SUBAGENT_DESCRIPTION_LENGTH truncation there.
function truncateSubagentDescription(raw: string, maxLength = 60): string {
  return raw.length > maxLength ? `${raw.slice(0, maxLength - 1)}…` : raw;
}

/**
 * Composes the full header string for a tool call card, mirroring the
 * per-tool branching (plan mode, ask-user, goal tools, single subagent,
 * generic MCP tools, default) previously inlined on the class.
 */
export function composeToolCallHeader(state: ToolCallHeaderState): string {
  const { toolCall, result } = state;
  const isFinished = result !== undefined;
  const isError = result?.is_error ?? false;
  const isTruncated = toolCall.truncated === true && !isFinished;
  const phase = projectRendererToolActivityPhase({
    finished: isFinished,
    error: isError,
    truncated: isTruncated,
  });

  let bullet: string;
  if (phase === 'succeeded' || phase === 'failed') {
    const settledAt = state.resultSettledAtMs;
    if (settledAt !== undefined && isToneSettleFlashActive(settledAt)) {
      // Completion cue: the status mark flashes, then settles to the
      // success/error tone (theme colors reused, no new tokens).
      const mark = isError ? '✗' : STATUS_BULLET.trimEnd();
      const tone = isError ? 'error' : 'success';
      bullet = `${renderToneSettleFlash(mark, `tool:${toolCall.id}:result-mark`, settledAt, tone)} `;
    } else {
      bullet = isError ? currentTheme.fg('error', '✗ ') : currentTheme.fg('success', STATUS_BULLET);
    }
  } else if (phase === 'truncated') {
    bullet = currentTheme.fg('error', '✗ ');
  } else {
    // Live tools: spectacular/pulse bullet keeps work visibly in motion
    // without the old marker ↔ blank flicker.
    const appearance = getActiveAppearancePreferences();
    bullet = shouldRenderAmbientEffects(appearance)
      ? renderAnimatedGradientText(STATUS_BULLET.trimEnd(), `tool:${toolCall.id}:bullet`) + ' '
      : renderPulseText(STATUS_BULLET, `tool:${toolCall.id}:bullet`, 'text');
  }

  if (toolCall.name === 'ExitPlanMode') {
    const label = currentTheme.boldFg('primary', 'Current plan');
    if (!isFinished || result === undefined || result.is_error === true) {
      return label;
    }
    const outcome = interpretExitPlanModeOutcome(result.output);
    if (outcome.kind === 'approved') {
      const chipText =
        outcome.chosen !== undefined && outcome.chosen.length > 0
          ? `Approved: ${outcome.chosen}`
          : 'Approved';
      return `${label}${currentTheme.fg('success', ` · ${chipText}`)}`;
    }
    return label;
  }

  if (toolCall.name === 'AskUserQuestion') {
    const isBackgroundAsk = toolCall.args['background'] === true;
    const label = isFinished
      ? isError
        ? 'Could not collect your input'
        : isBackgroundAsk
          ? 'Started background question'
        : 'Collected your answers'
      : isBackgroundAsk
        ? 'Starting background question'
        : 'Waiting for your input';
    const tone = isError ? 'error' : 'primary';
    const labelStyled = renderToolActivityLabel(label, `tool:${toolCall.id}:ask`, tone);
    return renderRendererToolActivityHeader({
      marker: bullet,
      label: labelStyled,
    });
  }

  const goalHeader = buildGoalToolHeader({
    toolCall,
    result,
    bullet,
    chip: isFinished && result !== undefined ? buildToolCallHeaderChip(toolCall, result, state.finishedAtMs) : '',
  });
  if (goalHeader !== undefined) return goalHeader;

  if (state.isSingleSubagentView) {
    return buildSingleSubagentHeader(state);
  }

  const verb = phase === 'succeeded' || phase === 'failed'
    ? 'Used'
    : phase === 'truncated'
      ? 'Truncated'
      : 'Using';
  const keyArg = extractKeyArgument(toolCall.name, toolCall.args, state.workspaceDir);
  const decoded = decodeMcpToolName(toolCall.name);
  const verbStyled = isTruncated
    ? currentTheme.fg('error', verb)
    : isFinished
      ? verb
      : renderPulseText(verb, `tool:${toolCall.id}:verb`, 'text');
  const toolNameLabel =
    decoded === null
      ? toolCall.name
      : decoded.toolName;
  const argStr = keyArg ? currentTheme.dim(` (${keyArg})`) : '';
  let chipStr = '';
  if (isFinished && result) {
    chipStr = buildToolCallHeaderChip(toolCall, result, state.finishedAtMs);
  } else {
    // Live duration for long-running tools makes work transparent without expand.
    const liveDuration = formatToolCallDurationChip(toolCall, result, state.finishedAtMs);
    if (liveDuration !== undefined) {
      chipStr = currentTheme.dim(formatRendererToolHeaderChip({ text: liveDuration }));
    }
  }

  if (isGenericToolResult(toolCall.name)) {
    const appearance = getActiveAppearancePreferences();
    const motionPhase: MotionToolPhase = isError
      ? 'error'
      : isFinished
        ? 'done'
        : toolCall.streamingArguments !== undefined
          ? 'streaming'
          : 'running';
    const phaseChip = renderPhaseChip(
      toolNameLabel,
      motionPhase,
      `tool:${toolCall.id}`,
      appearance,
    );
    const mcpSuffix =
      decoded === null ? '' : currentTheme.dim(` · MCP/${decoded.serverName}`);
    return renderRendererToolActivityHeader({
      marker: bullet,
      action: verbStyled,
      label: `${phaseChip}${mcpSuffix}`,
      detail: argStr,
      chip: chipStr,
    });
  }

  const toolNameStyled = isFinished
    ? renderToolActivityLabel(toolNameLabel, `tool:${toolCall.id}:label`)
    : renderAnimatedGradientText(toolNameLabel, `tool:${toolCall.id}:label`);
  const toolLabel =
    decoded === null
      ? toolNameStyled
      : `${toolNameStyled}${currentTheme.dim(` · MCP/${decoded.serverName}`)}`;
  return renderRendererToolActivityHeader({
    marker: bullet,
    action: verbStyled,
    label: toolLabel,
    detail: argStr,
    chip: chipStr,
  });
}
