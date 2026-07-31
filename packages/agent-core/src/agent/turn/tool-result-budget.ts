import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

import type { ContentPart } from '@superliora/kosong';
import { join } from 'pathe';

import type { ExecutableToolResult } from '../../loop';

const TOOL_RESULT_MAX_CHARS = 4_000;
const TOOL_RESULT_LARGE_WINDOW_MAX_CHARS = 12_000;
/** Max length of the one-line summary carried by a tool-output receipt. */
const TOOL_OUTPUT_SUMMARY1_LIMIT = 120;

interface BudgetToolResultOptions {
  readonly homedir?: string;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly result: ExecutableToolResult;
  /**
   * Maximum context window in tokens. When provided, the budget threshold is
   * scaled up so that large windows (e.g. 131k) don't archive aggressively.
   * Falls back to the static {@link TOOL_RESULT_MAX_CHARS} when omitted.
   */
  readonly contextWindowTokens?: number;
}

export async function budgetToolResultForModel(
  options: BudgetToolResultOptions,
): Promise<ExecutableToolResult> {
  const maxChars = resolveMaxChars(options.contextWindowTokens);
  const text = persistableToolResultText(options.result.output);
  if (text === undefined || text.length <= maxChars) return options.result;
  if (options.result.truncated === true) return options.result;
  if (options.homedir === undefined) return options.result;

  const outputPath = await saveToolResult(
    { homedir: options.homedir, toolName: options.toolName, toolCallId: options.toolCallId },
    text,
  );
  if (outputPath === undefined) return options.result;
  const output = renderPersistedToolResult(options.toolName, options.toolCallId, text, outputPath, maxChars);
  return options.result.isError === true
    ? { ...options.result, output, isError: true }
    : { ...options.result, output };
}

function persistableToolResultText(output: ExecutableToolResult['output']): string | undefined {
  if (typeof output === 'string') return output;
  if (
    !output.every((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
  ) {
    return undefined;
  }
  return output.map((part) => part.text).join('');
}

async function saveToolResult(
  options: { readonly homedir: string; readonly toolName: string; readonly toolCallId: string },
  text: string,
): Promise<string | undefined> {
  try {
    const dir = join(options.homedir, 'tool-results');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const outputPath = join(
      dir,
      `${safeToolResultFileStem(options.toolName, options.toolCallId)}-${randomUUID()}.txt`,
    );
    await writeFile(outputPath, text, { encoding: 'utf8', flag: 'wx' });
    return outputPath;
  } catch {
    return undefined;
  }
}

function renderPersistedToolResult(
  toolName: string,
  toolCallId: string,
  text: string,
  outputPath: string,
  maxChars: number,
): string {
  const receipt = buildToolOutputReceipt({ tool: toolName, path: outputPath, text });
  const lines = [
    `Tool output exceeded ${String(maxChars)} characters; full output persisted to disk.`,
    `tool_name: ${toolName}`,
    `tool_call_id: ${toolCallId}`,
    'receipt: true',
    `sha256: ${receipt.sha256}`,
    `output_size_chars: ${String(text.length)}`,
    `output_size_bytes: ${String(receipt.bytes)}`,
    `output_lines: ${String(receipt.lines)}`,
    `captured_at: ${receipt.captured_at}`,
    `output_path: ${outputPath}`,
    `summary1: ${receipt.summary1}`,
    'next_step: Re-acquire precisely with Read(output_path, line_offset, n_lines) — the full output is on disk; do not re-run the tool.',
  ];
  return lines.join('\n');
}

/**
 * Structured receipt for a persisted tool output. The context carries only
 * the receipt; the model re-acquires exact ranges from `path` via Read.
 * `sha256`/`captured_at` let downstream consumers (stale-replay detection,
 * LRU demotion) verify freshness without re-reading the payload.
 */
export interface ToolOutputReceipt {
  tool: string;
  path: string;
  sha256: string;
  bytes: number;
  lines: number;
  summary1: string;
  captured_at: string;
}

export function buildToolOutputReceipt(options: {
  tool: string;
  path: string;
  text: string;
}): ToolOutputReceipt {
  const { tool, path, text } = options;
  const textLines = text.split('\n');
  const firstLine = textLines.find((line) => line.trim().length > 0)?.trim() ?? '';
  const summary1 =
    firstLine.length > TOOL_OUTPUT_SUMMARY1_LIMIT
      ? `${firstLine.slice(0, TOOL_OUTPUT_SUMMARY1_LIMIT)}…`
      : firstLine;
  return {
    tool,
    path,
    sha256: createHash('sha256').update(text).digest('hex'),
    bytes: Buffer.byteLength(text, 'utf8'),
    lines: text.length === 0 ? 0 : textLines.length,
    summary1,
    captured_at: new Date().toISOString(),
  };
}

/**
 * Resolve the character budget for tool results based on the context window.
 * Large windows (>= 100k tokens) get a 3x larger budget to reduce
 * unnecessary archiving of useful output.
 */
function resolveMaxChars(contextWindowTokens?: number): number {
  if (contextWindowTokens === undefined || contextWindowTokens < 100_000) {
    return TOOL_RESULT_MAX_CHARS;
  }
  return TOOL_RESULT_LARGE_WINDOW_MAX_CHARS;
}

function safeToolResultFileStem(toolName: string, toolCallId: string): string {
  const label = `${toolName}-${toolCallId}`
    .replaceAll(/[^a-zA-Z0-9._-]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .slice(0, 80);
  return label || 'tool-result';
}
