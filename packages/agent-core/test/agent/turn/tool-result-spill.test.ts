import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  maybeDualWriteLargeToolResult,
  TOOL_RESULT_SPILL_THRESHOLD_CHARS,
} from '../../../src/agent/turn/tool-result-spill';

describe('maybeDualWriteLargeToolResult', () => {
  let homedir: string;

  beforeEach(async () => {
    homedir = await mkdtemp(join(tmpdir(), 'tool-spill-'));
  });

  afterEach(async () => {
    await rm(homedir, { recursive: true, force: true });
  });

  it('returns the original result when under the spill threshold', async () => {
    const result = { isError: false as const, output: 'small' };
    const out = await maybeDualWriteLargeToolResult({
      homedir,
      toolName: 'Bash',
      toolCallId: 'c1',
      result,
    });
    expect(out).toBe(result);
  });

  it('keeps the full body and appends a dual-write footer for huge outputs', async () => {
    const body = 'z'.repeat(TOOL_RESULT_SPILL_THRESHOLD_CHARS);
    const result = { isError: false as const, output: body };
    const out = await maybeDualWriteLargeToolResult({
      homedir,
      toolName: 'Bash',
      toolCallId: 'c-spill',
      result,
    });
    expect(typeof out.output).toBe('string');
    const text = out.output as string;
    expect(text.startsWith(body)).toBe(true);
    expect(text).toContain('Large tool output dual-write');
    expect(text).toContain('output_path:');
    const path = /^output_path: (.+)$/m.exec(text)?.[1];
    expect(path).toBeDefined();
    expect(await readFile(path as string, 'utf8')).toBe(body);
  });
});
