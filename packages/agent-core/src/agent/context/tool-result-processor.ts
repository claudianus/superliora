/**
 * Tool result processing for progressive disclosure and token optimization.
 *
 * Large tool outputs are processed through a gateway that:
 * 1. Inline: Small results (<= maxInlineTokens) are returned as-is
 * 2. Truncated: Medium results are truncated with ellipsis
 * 3. Archived: Large results are archived with a summary reference
 */

import { estimateTokens } from '../../utils/tokens';

export interface ToolResultOptions {
  /** Maximum tokens for inline results (default: 2000) */
  maxInlineTokens?: number;
  /** Threshold for archiving (default: 5000) */
  archiveThreshold?: number;
  /** Whether to summarize long output (default: true) */
  summarizeLongOutput?: boolean;
}

export type ProcessedResultType = 'inline' | 'truncated' | 'archived';

export interface ProcessedResult {
  type: ProcessedResultType;
  content: string;
  archiveId?: string;
  originalTokens?: number;
  processedTokens?: number;
}

const DEFAULT_MAX_INLINE_TOKENS = 2000;
const DEFAULT_ARCHIVE_THRESHOLD = 5000;

/**
 * Process a tool result through the progressive disclosure gateway.
 */
export function processToolResult(
  result: string,
  options: ToolResultOptions = {},
): ProcessedResult {
  const maxInlineTokens = options.maxInlineTokens ?? DEFAULT_MAX_INLINE_TOKENS;
  const archiveThreshold = options.archiveThreshold ?? DEFAULT_ARCHIVE_THRESHOLD;
  const summarizeLongOutput = options.summarizeLongOutput ?? true;

  const tokens = estimateTokens(result);

  // Small result: return as-is
  if (tokens <= maxInlineTokens) {
    return {
      type: 'inline',
      content: result,
      originalTokens: tokens,
      processedTokens: tokens,
    };
  }

  // Medium result: truncate with ellipsis
  if (tokens <= archiveThreshold) {
    const truncated = truncateWithEllipsis(result, maxInlineTokens);
    return {
      type: 'truncated',
      content: truncated,
      originalTokens: tokens,
      processedTokens: estimateTokens(truncated),
    };
  }

  // Large result: archive + summary
  if (summarizeLongOutput) {
    const summary = summarizeToolOutput(result);
    const archiveId = generateArchiveId();
    const content = `${summary}\n\n[Full output archived: ${archiveId}. Use ContextArchive to retrieve specific sections.]`;
    return {
      type: 'archived',
      content,
      archiveId,
      originalTokens: tokens,
      processedTokens: estimateTokens(content),
    };
  }

  // Fallback: truncate even large results
  const truncated = truncateWithEllipsis(result, maxInlineTokens);
  return {
    type: 'truncated',
    content: truncated,
    originalTokens: tokens,
    processedTokens: estimateTokens(truncated),
  };
}

/**
 * Truncate text to approximately maxTokens, adding ellipsis.
 */
export function truncateWithEllipsis(text: string, maxTokens: number): string {
  // Rough estimate: 4 chars per token for ASCII
  const maxChars = maxTokens * 4;

  if (text.length <= maxChars) {
    return text;
  }

  // Keep first 70% and last 20% for context
  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = Math.floor(maxChars * 0.2);

  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  const omittedChars = text.length - headChars - tailChars;

  return `${head}\n\n... [${omittedChars} characters omitted] ...\n\n${tail}`;
}

/**
 * Summarize tool output by extracting key information.
 */
export function summarizeToolOutput(output: string): string {
  const lines = output.split('\n');
  const totalLines = lines.length;

  // Extract metrics (numbers with context)
  const metrics: string[] = [];
  const metricPattern = /(\w+):\s*([\d.,]+)/g;
  let match;
  while ((match = metricPattern.exec(output)) !== null) {
    if (metrics.length < 10) {
      metrics.push(`${match[1]}: ${match[2]}`);
    }
  }

  // Extract key findings (lines with important keywords)
  const keywords = ['result', 'found', 'total', 'success', 'error', 'warning', 'failed', 'passed'];
  const findings: string[] = [];
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (keywords.some((kw) => lowerLine.includes(kw))) {
      if (findings.length < 5) {
        findings.push(line.trim());
      }
    }
  }

  // Build summary
  const parts: string[] = [];
  parts.push(`[Output: ${totalLines} lines, ~${estimateTokens(output)} tokens]`);

  if (metrics.length > 0) {
    parts.push(`Key metrics: ${metrics.join(', ')}`);
  }

  if (findings.length > 0) {
    parts.push(`Key findings:\n${findings.map((f) => `  - ${f}`).join('\n')}`);
  }

  // Include first few lines for context
  const previewLines = lines.slice(0, 5).join('\n');
  if (previewLines) {
    parts.push(`Preview:\n${previewLines}`);
  }

  return parts.join('\n\n');
}

let archiveCounter = 0;

function generateArchiveId(): string {
  archiveCounter += 1;
  return `archive-${Date.now()}-${archiveCounter}`;
}

/**
 * Process file read result with special handling for large files.
 */
export function processFileReadResult(
  content: string,
  filePath: string,
  lineCount: number,
): ProcessedResult {
  const tokens = estimateTokens(content);

  // Small file: return as-is
  if (lineCount <= 500 && tokens <= DEFAULT_MAX_INLINE_TOKENS) {
    return {
      type: 'inline',
      content,
      originalTokens: tokens,
      processedTokens: tokens,
    };
  }

  // Large file: return excerpt with reference
  const lines = content.split('\n');
  const first100 = lines.slice(0, 100).join('\n');
  const last50 = lines.slice(-50).join('\n');

  const excerpt = `${first100}\n\n... [${lineCount - 150} lines omitted] ...\n\n${last50}`;
  const summary = `File: ${filePath} (${lineCount} lines, ~${tokens} tokens)\n\n${excerpt}\n\nUse Read with start_line/end_line for specific sections.`;

  return {
    type: 'truncated',
    content: summary,
    originalTokens: tokens,
    processedTokens: estimateTokens(summary),
  };
}

/**
 * Rank and limit search results for token efficiency.
 */
export function rankAndLimitResults<T>(
  results: T[],
  options: {
    maxResults?: number;
    scoreFn?: (item: T) => number;
  } = {},
): T[] {
  const maxResults = options.maxResults ?? 50;
  const scoreFn = options.scoreFn;

  if (results.length <= maxResults) {
    return results;
  }

  if (scoreFn) {
    return results
      .map((item) => ({ item, score: scoreFn(item) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(({ item }) => item);
  }

  return results.slice(0, maxResults);
}
