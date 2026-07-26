import { describe, expect, it, vi } from 'vitest';

import { postprocessLeanToolResult } from '../../src/lean-context/postprocess/tool-result';
import { shouldSkipCompressionForRead } from '../../src/lean-context/gate/bounce';
import type { Agent } from '../../src/agent';
import type { ToolStore } from '../../src/tools/store';

function mockAgent(store: ToolStore, contextUsage = 0.2): Agent {
  return {
    tools: {
      getStore: () => store,
    },
    config: {
      modelCapabilities: { max_context_tokens: 100_000 },
    },
    context: {
      tokenCountWithPending: Math.floor(100_000 * contextUsage),
    },
    telemetry: {
      track: vi.fn(),
    },
  } as unknown as Agent;
}

function memoryStore(): ToolStore {
  const data = new Map<string, unknown>();
  return {
    get: (key: string) => data.get(key),
    set: (key: string, value: unknown) => {
      data.set(key, value);
    },
  } as unknown as ToolStore;
}

describe('shouldSkipCompressionForRead', () => {
  it('skips windowed and already-lean LioraRead modes', () => {
    expect(shouldSkipCompressionForRead({ mode: 'signatures' })).toBe(true);
    expect(shouldSkipCompressionForRead({ mode: 'map' })).toBe(true);
    expect(shouldSkipCompressionForRead({ mode: 'lines', start_line: 1, limit: 40 })).toBe(true);
    expect(shouldSkipCompressionForRead({ line_offset: 10, n_lines: 20 })).toBe(true);
  });

  it('allows compression for full/raw dumps', () => {
    expect(shouldSkipCompressionForRead({ mode: 'full' })).toBe(false);
    expect(shouldSkipCompressionForRead({ raw: true })).toBe(false);
    expect(shouldSkipCompressionForRead({ path: 'src/a.ts' })).toBe(false);
  });
});

describe('postprocessLeanToolResult LioraRead', () => {
  it('leaves compact LioraRead signatures output alone', async () => {
    const store = memoryStore();
    const agent = mockAgent(store);
    const small = 'export function foo(): void {}\n'.repeat(5);
    const result = await postprocessLeanToolResult({
      agent,
      toolName: 'LioraRead',
      args: { path: 'src/a.ts', mode: 'signatures' },
      result: { isError: false, output: small },
    });
    expect(result.output).toBe(small);
  });

  it('compresses large LioraRead full dumps under context pressure', async () => {
    const store = memoryStore();
    const agent = mockAgent(store, 0.95);
    const large = `${'export function alpha(): number { return 1; }\n'.repeat(200)}${'const pad = 1;\n'.repeat(400)}`;
    const result = await postprocessLeanToolResult({
      agent,
      toolName: 'LioraRead',
      args: { path: 'src/big.ts', mode: 'full' },
      result: { isError: false, output: large },
    });
    expect(typeof result.output).toBe('string');
    expect(String(result.output).length).toBeLessThan(large.length);
    expect(String(result.output)).toMatch(/liora-compressed|liora-archived|signatures|map/i);
  });
});
