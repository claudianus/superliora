import { describe, expect, it, vi } from 'vitest';

import { postprocessLeanToolResult } from '../../src/lean-context/postprocess/tool-result';
import { recordReadAccess, shouldSkipCompressionForRead } from '../../src/lean-context/gate/bounce';
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

  it('skips re-compression when bounce rate is high for the same path', async () => {
    const store = memoryStore();
    const agent = mockAgent(store, 0.2);
    const large = `${'export function alpha(): number { return 1; }\n'.repeat(200)}${'const pad = 1;\n'.repeat(400)}`;
    // Seed compressed→full bounce history so bounceRate > 0.35
    recordReadAccess(store, 'src/bouncy.ts', 'compressed');
    recordReadAccess(store, 'src/bouncy.ts', 'full');
    recordReadAccess(store, 'src/bouncy.ts', 'compressed');
    recordReadAccess(store, 'src/bouncy.ts', 'full');

    const result = await postprocessLeanToolResult({
      agent,
      toolName: 'LioraRead',
      args: { path: 'src/bouncy.ts', mode: 'full' },
      result: { isError: false, output: large },
    });
    // High bounce → leave full dump and attach a bounce hint instead of compressing.
    expect(String(result.output)).toContain(large.slice(0, 40));
    expect(String(result.output)).toMatch(/bounce|LioraRead/i);
  });
});

describe('postprocessLeanToolResult Bash', () => {
  it('compresses go test command output the same way as pnpm/vitest', async () => {
    const store = memoryStore();
    const agent = mockAgent(store);
    const noisy = Array.from({ length: 80 }, (_, i) => `--- PASS: TestFoo${i} (0.00s)`).join('\n');
    const result = await postprocessLeanToolResult({
      agent,
      toolName: 'Bash',
      args: { command: 'go test ./...' },
      result: { isError: false, output: noisy },
    });
    expect(String(result.output).length).toBeLessThan(noisy.length);
    expect(String(result.output)).toMatch(/liora-compressed/i);
  });

  it('leaves non-build shell output alone unless compress_output is true', async () => {
    const store = memoryStore();
    const agent = mockAgent(store);
    const output = 'hello from echo\n'.repeat(40);
    const result = await postprocessLeanToolResult({
      agent,
      toolName: 'Bash',
      args: { command: 'echo hello' },
      result: { isError: false, output },
    });
    expect(result.output).toBe(output);
  });

  it('compresses cargo test and tsc dumps under lean postprocess', async () => {
    const store = memoryStore();
    const agent = mockAgent(store);
    const cargoOut = [
      ...Array.from({ length: 20 }, (_, i) => `test foo::bar${String(i)} ... ok`),
      'test result: ok. 20 passed; 0 failed',
    ].join('\n');
    const cargo = await postprocessLeanToolResult({
      agent,
      toolName: 'Bash',
      args: { command: 'cargo test' },
      result: { isError: false, output: cargoOut },
    });
    expect(String(cargo.output).length).toBeLessThan(cargoOut.length);
    expect(String(cargo.output)).toMatch(/passing tests omitted|liora-compressed/i);

    const tscOut = Array.from(
      { length: 100 },
      (_, i) => `src/a${String(i)}.ts(${String(i)},1): error TS2304: Cannot find name 'x'.`,
    ).join('\n');
    const tsc = await postprocessLeanToolResult({
      agent,
      toolName: 'Bash',
      args: { command: 'tsc -p .' },
      result: { isError: false, output: tscOut },
    });
    expect(String(tsc.output).length).toBeLessThan(tscOut.length);
    expect(String(tsc.output)).toMatch(/compiler\/linter lines omitted|liora-compressed/i);
  });
});

