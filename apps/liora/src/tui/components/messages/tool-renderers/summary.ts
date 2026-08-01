/**
 * Summary-style renderers — produce optional inline-glance content for
 * tools whose raw output is high-volume but low-information (Grep,
 * Glob). The numeric summary (line counts, exit codes, sizes) lives in
 * the header chip (see chip.ts), so most tools intentionally render an
 * empty body and only expose details when the global expand toggle is
 * on.
 *
 * Errors always fall through to the truncated renderer so the user
 * sees the actual error message, not a synthetic summary.
 */

import type { Component } from '#/tui/renderer';
import { Text } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import { formatTranscriptOutput } from '#/tui/utils/transcript/transcript-output-format';
import { renderTruncated } from './truncated';
import type { ResultRenderer } from './types';

import {
  agentGlance,
  agentSwarmGlance,
  askUserQuestionGlance,
  browserObserveGlance,
  browserStatusGlance,
  computerCaptureGlance,
  context7DocsGlance,
  context7ResolveGlance,
  cronCreateGlance,
  cronListGlance,
  fetchGlance,
  generateMediaGlance,
  getCurrentTimeGlance,
  globGlance,
  grepGlance,
  lioraCallgraphGlance,
  lioraExpandGlance,
  lioraReadGlance,
  lioraReviewGlance,
  lioraSymbolGlance,
  lioraTreeGlance,
  memoryGlance,
  nextPhaseGlance,
  recordInterviewFindingGlance,
  runProjectChecksGlance,
  searchExpertGlance,
  searchSkillGlance,
  skillGlance,
  swarmChannelGlance,
  taskListGlance,
  taskOutputGlance,
  todoListGlance,
  ultraSwarmGlance,
  ultraworkGraphGlance,
  verifySurfaceGlance,
  visualDiffGlance,
  webSearchGlance,
  type GlanceFn,
} from './summary-glances';

function withGlance(glance: GlanceFn | null): ResultRenderer {
  return (toolCall, result, ctx) => {
    if (result.is_error) return renderTruncated(toolCall, result, ctx);

    const out: Component[] = [];
    if (glance !== null) {
      const line = glance(toolCall, result);
      if (line.length > 0) {
        out.push(new Text(`  ${currentTheme.dim(line)}`, 0, 0));
      }
    }
    if (ctx.expanded && result.output.length > 0) {
      // Pretty-print / highlight expanded body (JSON, logs, stack, URLs…).
      out.push(
        new Text(
          formatTranscriptOutput(result.output, {
            isError: false,
            mode: 'tool',
          }),
          4,
          0,
        ),
      );
    }
    return out;
  };
}
// ── Exports ──────────────────────────────────────────────────────────

// Tools whose chip already conveys everything — the body is empty in
// the collapsed state and only the raw output appears when expanded.
export const readSummary: ResultRenderer = withGlance(null);
export const fetchSummary: ResultRenderer = withGlance(fetchGlance);
export const webSearchSummary: ResultRenderer = withGlance(webSearchGlance);
export const thinkSummary: ResultRenderer = withGlance(null);
export const editSummary: ResultRenderer = withGlance(null);

export const generateMediaSummary: ResultRenderer = withGlance(generateMediaGlance);
export const writeSummary: ResultRenderer = withGlance(null);

// Tools that benefit from inline path samples below the chip.
export const grepSummary: ResultRenderer = withGlance(grepGlance);
export const globSummary: ResultRenderer = withGlance(globGlance);
export const lioraReadSummary: ResultRenderer = withGlance(lioraReadGlance);
export const lioraSymbolSummary: ResultRenderer = withGlance(lioraSymbolGlance);
export const lioraTreeSummary: ResultRenderer = withGlance(lioraTreeGlance);
export const lioraExpandSummary: ResultRenderer = withGlance(lioraExpandGlance);
export const lioraCallgraphSummary: ResultRenderer = withGlance(lioraCallgraphGlance);
export const context7ResolveSummary: ResultRenderer = withGlance(context7ResolveGlance);
export const context7DocsSummary: ResultRenderer = withGlance(context7DocsGlance);
export const searchSkillSummary: ResultRenderer = withGlance(searchSkillGlance);
export const searchExpertSummary: ResultRenderer = withGlance(searchExpertGlance);
export const skillSummary: ResultRenderer = withGlance(skillGlance);
export const memorySummary: ResultRenderer = withGlance(memoryGlance);
export const nextPhaseSummary: ResultRenderer = withGlance(nextPhaseGlance);
export const recordInterviewFindingSummary: ResultRenderer = withGlance(recordInterviewFindingGlance);
export const getCurrentTimeSummary: ResultRenderer = withGlance(getCurrentTimeGlance);
export const enterPlanModeSummary: ResultRenderer = withGlance(null);
export const exitPlanModeSummary: ResultRenderer = withGlance(null);
export const askUserQuestionSummary: ResultRenderer = withGlance(askUserQuestionGlance);
export const lioraReviewSummary: ResultRenderer = withGlance(lioraReviewGlance);
export const taskListSummary: ResultRenderer = withGlance(taskListGlance);
export const taskOutputSummary: ResultRenderer = withGlance(taskOutputGlance);
export const taskStopSummary: ResultRenderer = withGlance(null);
export const cronListSummary: ResultRenderer = withGlance(cronListGlance);
export const cronCreateSummary: ResultRenderer = withGlance(cronCreateGlance);
export const cronDeleteSummary: ResultRenderer = withGlance(null);
export const ultraworkGraphSummary: ResultRenderer = withGlance(ultraworkGraphGlance);
export const swarmChannelSummary: ResultRenderer = withGlance(swarmChannelGlance);
export const agentSummary: ResultRenderer = withGlance(agentGlance);
export const agentSwarmSummary: ResultRenderer = withGlance(agentSwarmGlance);
export const ultraSwarmSummary: ResultRenderer = withGlance(ultraSwarmGlance);
export const runProjectChecksSummary: ResultRenderer = withGlance(runProjectChecksGlance);
export const verifySurfaceSummary: ResultRenderer = withGlance(verifySurfaceGlance);
export const visualDiffSummary: ResultRenderer = withGlance(visualDiffGlance);
export const browserStatusSummary: ResultRenderer = withGlance(browserStatusGlance);
export const browserObserveSummary: ResultRenderer = withGlance(browserObserveGlance);
export const browserScreenshotSummary: ResultRenderer = withGlance(null);
export const browserActSummary: ResultRenderer = withGlance(null);
export const browserConsoleSummary: ResultRenderer = withGlance(null);
export const computerCaptureSummary: ResultRenderer = withGlance(computerCaptureGlance);
export const computerActSummary: ResultRenderer = withGlance(null);
export const computerStatusSummary: ResultRenderer = withGlance(null);
export const todoListSummary: ResultRenderer = withGlance(todoListGlance);
