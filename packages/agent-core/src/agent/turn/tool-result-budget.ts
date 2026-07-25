import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

import type { ContentPart } from '@superliora/kosong';
import { join } from 'pathe';

import type { ExecutableToolResult } from '../../loop';

const TOOL_RESULT_MAX_CHARS = 4_000;
const TOOL_RESULT_LARGE_WINDOW_MAX_CHARS = 12_000;
const TOOL_RESULT_PREVIEW_CHARS = 80;

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
  const lines = [
    `Tool output exceeded ${String(maxChars)} characters; showing a preview only.`,
    `tool_name: ${toolName}`,
    `tool_call_id: ${toolCallId}`,
    `output_size_chars: ${String(text.length)}`,
    `output_size_bytes: ${String(Buffer.byteLength(text, 'utf8'))}`,
    `output_path: ${outputPath}`,
    'next_step: Use Read with output_path to page through the full output.',
  ];
  lines.push('', '[preview]', text.slice(0, TOOL_RESULT_PREVIEW_CHARS));
  return lines.join('\n');
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
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return label || 'tool-result';
}
