import type { Kaos } from '@superliora/kaos';
import { describe, expect, it, vi } from 'vitest';

import { LioraExpandTool } from '../../src/tools/builtin/context/liora-expand';
import { LioraReadTool } from '../../src/tools/builtin/context/liora-read';
import { compressShellOutput } from '../../src/tools/builtin/context/context-terse';
import type { ToolStore, ToolStoreData, ToolStoreKey } from '../../src/tools/store';
import type { WorkspaceConfig } from '../../src/tools/support/workspace';
import { createFakeKaos, toolContentString } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;
const workspace: WorkspaceConfig = { workspaceDir: '/workspace', additionalDirs: [] };

function context<Input>(args: Input, toolCallId = 'call_1') {
  return { turnId: '0', toolCallId, args, signal };
}

function makeStore(): { store: ToolStore; data: Partial<ToolStoreData> } {
  const data: Partial<ToolStoreData> = {};
  return {
    data,
    store: {
      get<K extends ToolStoreKey>(key: K): ToolStoreData[K] | undefined {
        return data[key];
      },
      set<K extends ToolStoreKey>(key: K, value: ToolStoreData[K]): void {
        data[key] = value;
      },
    },
  };
}

function makeKaos(files: Readonly<Record<string, string>>): Kaos {
  const paths = Object.keys(files);
  return createFakeKaos({
    iterdir: vi.fn<Kaos['iterdir']>().mockImplementation(async function* iterdir(dir) {
      for (const entry of immediateChildren(paths, dir)) yield entry;
    }),
    stat: vi.fn<Kaos['stat']>().mockImplementation(async (path) => ({
      stMode: directoryExists(paths, path) ? 0o040_755 : 0o100_644,
      stIno: 1,
      stDev: 1,
      stNlink: 1,
      stUid: 1000,
      stGid: 1000,
      stSize: Buffer.byteLength(files[path] ?? '', 'utf8'),
      stAtime: 0,
      stMtime: 0,
      stCtime: 0,
    })),
    readText: vi.fn<Kaos['readText']>().mockImplementation(async (path) => files[path] ?? ''),
  });
}

function immediateChildren(paths: readonly string[], dir: string): string[] {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  const children = new Set<string>();
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const [child] = path.slice(prefix.length).split('/');
    if (child !== undefined && child.length > 0) children.add(child);
  }
  return [...children].toSorted((a, b) => a.localeCompare(b));
}

function directoryExists(paths: readonly string[], dir: string): boolean {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  return paths.some((path) => path.startsWith(prefix));
}

describe('Liora lean context tools', () => {
  it('LioraRead returns signatures instead of full file bodies for large files', async () => {
    const file = [
      'export function targetNeedle() { return 1; }',
      ...Array.from({ length: 200 }, (_, index) => `const filler${index} = ${index};`),
    ].join('\n');
    const { store } = makeStore();
    const tool = new LioraReadTool(
      makeKaos({ '/workspace/src/big.ts': file }),
      workspace,
      store,
    );

    const result = await executeTool(tool, context({ path: 'src/big.ts', mode: 'signatures' }));
    const output = toolContentString(result);

    expect(result.isError).toBeFalsy();
    expect(output).toContain('<liora_read mode="signatures"');
    expect(output).toContain('targetNeedle');
    expect(output).not.toContain('filler150');
  });

  
  it('LioraRead auto mode uses signatures for medium files above 80 lines', async () => {
    const file = [
      'export function targetNeedle() { return 1; }',
      ...Array.from({ length: 100 }, (_, index) => `const filler${index} = ${index};`),
    ].join('\n');
    const { store } = makeStore();
    const tool = new LioraReadTool(
      makeKaos({ '/workspace/src/medium.ts': file }),
      workspace,
      store,
    );

    const result = await executeTool(tool, context({ path: 'src/medium.ts', mode: 'auto' }));
    const output = toolContentString(result);

    expect(result.isError).toBeFalsy();
    expect(output).toContain('<liora_read mode="signatures"');
    expect(output).toContain('targetNeedle');
    expect(output).not.toContain('filler90');
  });

  it('compressShellOutput collapses repetitive passing test lines', () => {
    const stdout = [
      'PASS test/a',
      'PASS test/b',
      'PASS test/c',
      'PASS test/d',
      'FAIL test/e',
      'AssertionError: boom',
    ].join('\n');
    const compressed = compressShellOutput({
      stdout,
      stderr: '',
      command: 'pnpm test',
    });
    expect(compressed.text).toContain('passing tests omitted');
    expect(compressed.text).toContain('FAIL test/e');
    expect(compressed.savedPercent).toBeGreaterThan(0);
  });
});
