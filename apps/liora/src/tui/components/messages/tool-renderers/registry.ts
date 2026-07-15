/**
 * Tool result renderer registry.
 *
 * Each tool name maps to a `ResultRenderer` that turns the tool's
 * `ToolResultBlockData` into renderable Components. Tools without an
 * explicit entry fall through to `renderTruncated` (the original
 * 3-line + ctrl+o behavior).
 *
 * Keep this dispatch flat — tool names live next to the renderer they
 * choose, so adding a new tool means appending one case.
 */

import { readMediaSummary } from './media';
import { goalSummary } from './goal';
import { shellExecutionResultRenderer } from '../shell-execution';
import {
  askUserQuestionSummary,
  context7DocsSummary,
  context7ResolveSummary,
  cronCreateSummary,
  cronDeleteSummary,
  cronListSummary,
  editSummary,
  enterPlanModeSummary,
  exitPlanModeSummary,
  fetchSummary,
  generateMediaSummary,
  getCurrentTimeSummary,
  globSummary,
  grepSummary,
  lioraCallgraphSummary,
  lioraExpandSummary,
  lioraReadSummary,
  lioraReviewSummary,
  lioraSymbolSummary,
  lioraTreeSummary,
  memorySummary,
  nextPhaseSummary,
  readSummary,
  recordInterviewFindingSummary,
  searchExpertSummary,
  searchSkillSummary,
  skillSummary,
  swarmChannelSummary,
  taskListSummary,
  taskOutputSummary,
  taskStopSummary,
  thinkSummary,
  ultraworkGraphSummary,
  webSearchSummary,
  writeSummary,
} from './summary';
import { renderTruncated } from './truncated';
import type { ResultRenderer } from './types';

/**
 * True when a tool has no dedicated renderer and falls back to the generic
 * truncated output (every MCP tool and any tool not listed below). Used to
 * decide whether subagent sub-tool output should be previewed the same way
 * the main agent previews it.
 */
export function isGenericToolResult(toolName: string): boolean {
  return pickResultRenderer(toolName) === renderTruncated;
}

export function pickResultRenderer(toolName: string): ResultRenderer {
  switch (toolName) {
    case 'Read':
      return readSummary;
    case 'LioraRead':
      return lioraReadSummary;
    case 'LioraSymbol':
      return lioraSymbolSummary;
    case 'LioraTree':
      return lioraTreeSummary;
    case 'LioraExpand':
      return lioraExpandSummary;
    case 'LioraCallgraph':
      return lioraCallgraphSummary;
    case 'ReadMediaFile':
      return readMediaSummary;
    case 'Grep':
      return grepSummary;
    case 'Glob':
      return globSummary;
    case 'FetchURL':
      return fetchSummary;
    case 'WebSearch':
      return webSearchSummary;
    case 'Context7Resolve':
      return context7ResolveSummary;
    case 'Context7Docs':
      return context7DocsSummary;
    case 'SearchSkill':
      return searchSkillSummary;
    case 'SearchExpert':
      return searchExpertSummary;
    case 'Skill':
      return skillSummary;
    case 'Memory':
      return memorySummary;
    case 'NextPhase':
      return nextPhaseSummary;
    case 'RecordInterviewFinding':
      return recordInterviewFindingSummary;
    case 'GetCurrentTime':
      return getCurrentTimeSummary;
    case 'EnterPlanMode':
      return enterPlanModeSummary;
    case 'ExitPlanMode':
      return exitPlanModeSummary;
    case 'AskUserQuestion':
      return askUserQuestionSummary;
    case 'LioraReview':
      return lioraReviewSummary;
    case 'TaskList':
      return taskListSummary;
    case 'TaskOutput':
      return taskOutputSummary;
    case 'TaskStop':
      return taskStopSummary;
    case 'CronList':
      return cronListSummary;
    case 'CronCreate':
      return cronCreateSummary;
    case 'CronDelete':
      return cronDeleteSummary;
    case 'UltraworkGraph':
      return ultraworkGraphSummary;
    case 'SwarmChannel':
      return swarmChannelSummary;
    case 'Bash':
      return shellExecutionResultRenderer;
    case 'Think':
      return thinkSummary;
    case 'Edit':
      return editSummary;
    case 'Write':
      return writeSummary;
    case 'GenerateImage':
    case 'GenerateVideo':
      return generateMediaSummary;
    case 'CreateGoal':
    case 'GetGoal':
    case 'SetGoalBudget':
    case 'UpdateGoal':
      return goalSummary;
    default:
      return renderTruncated;
  }
}

export type { ResultRenderer } from './types';
