import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildToolOutputReceipt, budgetToolResultForModel } from '#/agent/turn/tool-result-budget';
import type { ExecutableToolResult } from '#/loop';

const text = (s: string): ExecutableToolResult => ({
  isError: false,
  output: s,
});

const outputString = (result: ExecutableToolResult): string =>
  typeof result.output === 'string' ? result.output : '';

describe('turn/tool-result-budget — buildToolOutputReceipt', () => {
  it('captures sha256, bytes, lines, summary1, and captured_at', () => {
    const body = `FAIL packages/foo.test.ts\n${'x'.repeat(200)}\nlast line`;
    const receipt = buildToolOutputReceipt({ tool: 'Bash', path: '/tmp/out.txt', text: body });
    expect(receipt.sha256).toBe(createHash('sha256').update(body).digest('hex'));
    expect(receipt.bytes).toBe(Buffer.byteLength(body, 'utf8'));
    expect(receipt.lines).toBe(3);
    expect(receipt.summary1).toBe('FAIL packages/foo.test.ts');
    expect(Number.isNaN(Date.parse(receipt.captured_at))).toBe(false);
  });

  it('truncates summary1 to 120 chars with an ellipsis', () => {
    const body = `${'y'.repeat(200)}\nrest`;
    const receipt = buildToolOutputReceipt({ tool: 'Read', path: '/tmp/out.txt', text: body });
    expect(receipt.summary1).toBe(`${'y'.repeat(120)}…`);
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

describe('turn/tool-result-budget — budgetToolResultForModel (receipt archive)', () => {
  let homedir: string;

  beforeEach(async () => {
    homedir = await mkdtemp(join(tmpdir(), 'tool-result-receipt-'));
  });

  afterEach(async () => {
    await rm(homedir, { recursive: true, force: true });
  });

  it('replaces overflowing output with a receipt whose hash matches the byte-identical persisted file', async () => {
    const big = `first summary line\n${'z'.repeat(5000)}`;
    const out = await budgetToolResultForModel({
      toolName: 'Bash',
      toolCallId: 'call-receipt',
      result: text(big),
      homedir,
    });
    const rendered = outputString(out);
    expect(rendered).toContain('receipt: true');
    expect(rendered).toContain(`sha256: ${createHash('sha256').update(big).digest('hex')}`);
    expect(rendered).toContain(`output_size_bytes: ${String(Buffer.byteLength(big, 'utf8'))}`);
    expect(rendered).toContain('output_lines: 2');
    expect(rendered).toContain('summary1: first summary line');
    expect(rendered).not.toContain('z'.repeat(100));

    const persistedPath = /^output_path: (.+)$/m.exec(rendered)?.[1];
    expect(persistedPath).toBeDefined();
    // Re-acquisition yields byte-identical content.
    expect(await readFile(persistedPath as string, 'utf8')).toBe(big);
    const capturedAt = /^captured_at: (.+)$/m.exec(rendered)?.[1];
    expect(Number.isNaN(Date.parse(capturedAt as string))).toBe(false);
  });

  it('preserves isError while archiving', async () => {
    const big = `error head\n${'e'.repeat(5000)}`;
    const out = await budgetToolResultForModel({
      toolName: 'Bash',
      toolCallId: 'call-err',
      result: { isError: true, output: big },
      homedir,
    });
    expect(out.isError).toBe(true);
    expect(outputString(out)).toContain('receipt: true');
  });
});
