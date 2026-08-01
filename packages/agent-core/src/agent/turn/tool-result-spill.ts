/**
 * Append-only dual-write for extremely large tool results.
 *
 * Does NOT truncate or rewrite history: the full model-visible output stays
 * intact. A short footer points at a disk copy so resume after full compaction
 * (or manual Read) can re-acquire the log without re-running the tool.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'pathe';

import type { ContentPart } from '@superliora/kosong';

import type { ExecutableToolResult } from '../../loop';

/** Spill only for truly huge results; below this the body alone is fine. */
export const TOOL_RESULT_SPILL_THRESHOLD_CHARS = 100_000;

export async function maybeDualWriteLargeToolResult(options: {
  readonly homedir?: string | undefined;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly result: ExecutableToolResult;
}): Promise<ExecutableToolResult> {
  if (options.homedir === undefined) return options.result;
  const text = toolResultText(options.result.output);
  if (text === undefined || text.length < TOOL_RESULT_SPILL_THRESHOLD_CHARS) {
    return options.result;
  }

  const path = await writeSpillFile(
    options.homedir,
    options.toolName,
    options.toolCallId,
    text,
  );
  if (path === undefined) return options.result;

  const sha256 = createHash('sha256').update(text).digest('hex');
  const footer = [
    '',
    '[Large tool output dual-write — full body above is intact]',
    `tool_name: ${options.toolName}`,
    `tool_call_id: ${options.toolCallId}`,
    `output_path: ${path}`,
    `output_size_chars: ${String(text.length)}`,
    `sha256: ${sha256}`,
    'next_step: After compaction, re-acquire ranges with Read(output_path); do not re-run the tool for the same log.',
  ].join('\n');

  const output =
    typeof options.result.output === 'string'
      ? `${options.result.output}${footer}`
      : options.result.output;

  return options.result.isError === true
    ? { ...options.result, output, isError: true }
    : { ...options.result, output };
}

function toolResultText(output: ExecutableToolResult['output']): string | undefined {
  if (typeof output === 'string') return output;
  if (!output.every((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')) {
    return undefined;
  }
  return output.map((part) => part.text).join('');
}

async function writeSpillFile(
  homedir: string,
  toolName: string,
  toolCallId: string,
  text: string,
): Promise<string | undefined> {
  try {
    const dir = join(homedir, 'tool-results');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const stem = `${toolName}-${toolCallId}`
      .replaceAll(/[^a-zA-Z0-9._-]+/g, '_')
      .replaceAll(/^_+|_+$/g, '')
      .slice(0, 80);
    const path = join(dir, `spill-${stem || 'tool'}-${randomUUID()}.txt`);
    await writeFile(path, text, { encoding: 'utf8', flag: 'wx' });
    return path;
  } catch {
    return undefined;
  }
}
