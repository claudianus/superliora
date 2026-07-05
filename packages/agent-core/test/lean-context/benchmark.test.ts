import { describe, expect, it, vi } from 'vitest';

import type { Kaos } from '@superliora/kaos';

import { buildBm25Index, searchBm25 } from '../../src/lean-context/index/bm25';
import { chunkFileContent } from '../../src/lean-context/index/chunk';
import { composeRankContext } from '../../src/lean-context/compose/ranker';
import { buildWorkspaceIndex } from '../../src/lean-context/index/builder';
import { tokenize } from '../../src/lean-context/index/tokenize';
import { createFakeKaos } from '../tools/fixtures/fake-kaos';
import type { WorkspaceConfig } from '../../src/tools/support/workspace';

const workspace: WorkspaceConfig = { workspaceDir: '/workspace', additionalDirs: [] };

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
      stMtime: 100,
      stCtime: 0,
    })),
    readText: vi.fn<Kaos['readText']>().mockImplementation(async (path) => files[path] ?? ''),
    mkdir: vi.fn<Kaos['mkdir']>().mockResolvedValue(undefined),
    writeText: vi.fn<Kaos['writeText']>().mockResolvedValue(0),
  });
}

describe('lean context benchmark harness', () => {
  it('tokenizes and ranks BM25 chunks for fixture files', () => {
    const content = [
      'export function UltraworkGraphTool() {',
      '  return "ultrawork graph";',
      '}',
      'export class MicroCompaction {',
      '  compact() {}',
      '}',
    ].join('\n');
    const chunks = chunkFileContent(
      '/workspace/packages/agent-core/src/foo.ts',
      'packages/agent-core/src/foo.ts',
      content,
    );
    const index = buildBm25Index(chunks);
    const hits = searchBm25(index, 'UltraworkGraphTool', 5);
    expect(tokenize('UltraworkGraphTool')).toContain('ultraworkgraphtool');
    expect(hits[0]?.chunk.displayPath).toContain('packages/agent-core/src/foo.ts');
  });

  it('builds workspace index artifacts under .superliora/index', async () => {
    const files = {
      '/workspace/packages/agent-core/src/tools/builtin/context/liora-context.ts': [
        'export class LioraContextTool {',
        '  readonly name = "LioraContext";',
        '}',
      ].join('\n'),
    };
    const kaos = makeKaos(files);
    const stats = await buildWorkspaceIndex({ kaos, workspace, incremental: false });
    expect(stats.filesIndexed).toBe(1);
    expect(stats.chunksIndexed).toBeGreaterThan(0);
    expect(kaos.writeText).toHaveBeenCalled();
  });

  it('compose ranking prefers query-relevant fixture file', async () => {
    const files = {
      '/workspace/packages/agent-core/src/tools/builtin/context/liora-context.ts':
        'export class LioraContextTool { readonly name = "LioraContext"; }',
      '/workspace/packages/agent-core/src/tools/builtin/state/todo-list.ts':
        'export class TodoListTool { readonly name = "TodoList"; }',
    };
    const kaos = makeKaos(files);
    await buildWorkspaceIndex({ kaos, workspace, incremental: false });
    const composed = await composeRankContext({
      kaos,
      workspace,
      query: 'LioraContext',
      maxFiles: 1,
    });
    expect(composed.ranked[0]?.file.displayPath).toContain('liora-context.ts');
  });
});
