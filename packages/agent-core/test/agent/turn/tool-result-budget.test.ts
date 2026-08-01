import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildToolResultPreview,
  budgetToolResultForModel,
  TOOL_RESULT_MAX_CHARS,
} from '../../../src/agent/turn/tool-result-budget';
import type { ExecutableToolResult } from '../../../src/loop';

const text = (s: string): ExecutableToolResult => ({
  isError: false,
  output: s,
});

describe('turn/tool-result-budget — buildToolResultPreview', () => {
  it('returns the input verbatim when shorter than the head+tail+20 threshold', () => {
    const body = 'short text';
    expect(buildToolResultPreview(body)).toBe(body);
  });

  it('returns the input verbatim when at exactly the head+tail+20 threshold', () => {
    const body = 'x'.repeat(2400 + 800 + 20);
    expect(buildToolResultPreview(body)).toBe(body);
  });

  it('keeps head + "..." + tail when longer than the threshold', () => {
    const body = 'A'.repeat(2400) + 'B'.repeat(300) + 'C'.repeat(800);
    const preview = buildToolResultPreview(body);
    expect(preview.startsWith('A'.repeat(2400))).toBe(true);
    expect(preview).toContain('...');
    expect(preview.endsWith('C'.repeat(800))).toBe(true);
  });
});

describe('turn/tool-result-budget — budgetToolResultForModel', () => {
  let homedir: string;

  beforeEach(async () => {
    homedir = await mkdtemp(join(tmpdir(), 'tool-budget-'));
  });

  afterEach(async () => {
    await rm(homedir, { recursive: true, force: true });
  });

  it('returns the original result when the text fits the default budget', async () => {
    const result = text('hello world');
    const out = await budgetToolResultForModel({
      toolName: 'read',
      toolCallId: 't1',
      result,
    });
    expect(out).toBe(result);
  });

  it('bounds in-memory when no homedir is supplied and the text overflows', async () => {
    const big = 'x'.repeat(TOOL_RESULT_MAX_CHARS + 1);
    const result = text(big);
    const out = await budgetToolResultForModel({
      toolName: 'read',
      toolCallId: 't1',
      result,
    });
    expect(out).not.toBe(result);
    expect(typeof out.output).toBe('string');
    expect((out.output as string).length).toBeLessThan(big.length);
    expect(out.truncated).toBe(true);
  });

  it('returns the original result when the result is already truncated', async () => {
    const big = 'x'.repeat(TOOL_RESULT_MAX_CHARS + 1);
    const result: ExecutableToolResult = { isError: false, output: big, truncated: true };
    const out = await budgetToolResultForModel({
      toolName: 'read',
      toolCallId: 't1',
      result,
      homedir,
    });
    expect(out).toBe(result);
  });

  it('returns the original result when the output is a non-text content-part array', async () => {
    const result: ExecutableToolResult = {
      isError: false,
      output: [{ type: 'image', image: 'binary-data' } as never],
    };
    const out = await budgetToolResultForModel({
      toolName: 'read',
      toolCallId: 't1',
      result,
      homedir,
    });
    expect(out).toBe(result);
  });

  it('uses the large-window budget when contextWindowTokens >= 100_000', async () => {
    const big = 'x'.repeat(20_000);
    const result = text(big);
    const out = await budgetToolResultForModel({
      toolName: 'read',
      toolCallId: 't1',
      result,
      homedir,
      contextWindowTokens: 200_000,
    });
    // 20_000 <= 24_000 large-window budget → not archived
    expect(out).toBe(result);
  });

  it('spills full body to disk and keeps a receipt + preview in context', async () => {
    const big = 'H'.repeat(1000) + 'M'.repeat(TOOL_RESULT_MAX_CHARS) + 'T'.repeat(1000);
    const result = text(big);
    const out = await budgetToolResultForModel({
      toolName: 'Bash',
      toolCallId: 'c-spill',
      result,
      homedir,
    });
    expect(out).not.toBe(result);
    expect(out.truncated).toBe(true);
    const body = out.output as string;
    expect(body).toContain('receipt: true');
    expect(body).toContain('output_path:');
    expect(body).toContain('### Preview (head/tail)');
    expect(body.length).toBeLessThan(big.length);
    const path = /^output_path: (.+)$/m.exec(body)?.[1];
    expect(path).toBeDefined();
    expect(await readFile(path as string, 'utf8')).toBe(big);
  });
});
