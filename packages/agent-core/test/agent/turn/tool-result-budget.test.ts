import { describe, expect, it } from 'vitest';

import { buildToolResultPreview, budgetToolResultForModel } from '#/agent/turn/tool-result-budget';
import type { ExecutableToolResult } from '#/loop';

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
    const body = 'x'.repeat(160 + 160 + 20);
    expect(buildToolResultPreview(body)).toBe(body);
  });

  it('keeps head + "..." + tail when longer than the threshold', () => {
    const body = 'A'.repeat(160) + 'B'.repeat(300) + 'C'.repeat(160);
    const preview = buildToolResultPreview(body);
    expect(preview.startsWith('A'.repeat(160))).toBe(true);
    expect(preview).toContain('...');
    expect(preview.endsWith('C'.repeat(160))).toBe(true);
  });
});

describe('turn/tool-result-budget — budgetToolResultForModel (no-archive paths)', () => {
  it('returns the original result when the text fits the default budget', async () => {
    const result = text('hello world');
    const out = await budgetToolResultForModel({
      toolName: 'read',
      toolCallId: 't1',
      result,
    });
    expect(out).toBe(result);
  });

  it('returns the original result when no homedir is supplied and the text overflows', async () => {
    const big = 'x'.repeat(5000);
    const result = text(big);
    const out = await budgetToolResultForModel({
      toolName: 'read',
      toolCallId: 't1',
      result,
    });
    expect(out).toBe(result);
  });

  it('returns the original result when the result is already truncated', async () => {
    const big = 'x'.repeat(5000);
    const result: ExecutableToolResult = { isError: false, output: big, truncated: true };
    const out = await budgetToolResultForModel({
      toolName: 'read',
      toolCallId: 't1',
      result,
      homedir: '/tmp',
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
      homedir: '/tmp',
    });
    expect(out).toBe(result);
  });

  it('uses the large-window budget (12_000) when contextWindowTokens >= 100_000', async () => {
    const big = 'x'.repeat(5000);
    const result = text(big);
    const out = await budgetToolResultForModel({
      toolName: 'read',
      toolCallId: 't1',
      result,
      homedir: '/tmp',
      contextWindowTokens: 200_000,
    });
    // 5000 <= 12000, so it should not archive.
    expect(out).toBe(result);
  });
});
