import { describe, expect, it, vi, afterEach } from 'vitest';

import type { Kaos } from '@superliora/kaos';

import { buildBm25Index, searchBm25 } from '../../src/lean-context/index/bm25';
import { chunkFileContent } from '../../src/lean-context/index/chunk';
import { composeRankContext } from '../../src/lean-context/compose/ranker';
import * as builder from '../../src/lean-context/index/builder';
import {
  ensureWorkspaceIndex,
  ensureWorkspaceIndexBudgeted,
  resetBuildFailureCooldownForTests,
} from '../../src/lean-context/index/ensure';
import { clearGraphDatabasesForTests } from '../../src/lean-context/persist/graph-db';
import { getGraphDatabase } from '../../src/lean-context/graph/pipeline';
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
  const persisted = { ...files };
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
      stSize: Buffer.byteLength(persisted[path] ?? '', 'utf8'),
      stAtime: 0,
      stMtime: 100,
      stCtime: 0,
    })),
    readText: vi.fn<Kaos['readText']>().mockImplementation(async (path) => persisted[path] ?? ''),
    mkdir: vi.fn<Kaos['mkdir']>().mockResolvedValue(undefined),
    writeText: vi.fn<Kaos['writeText']>().mockImplementation(async (path, content) => {
      persisted[path] = content;
      return Buffer.byteLength(content, 'utf8');
    }),
    unlink: vi.fn<Kaos['unlink']>().mockImplementation(async (path) => {
      delete persisted[path];
    }),
  });
}

describe('lean context benchmark harness', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetBuildFailureCooldownForTests();
    clearGraphDatabasesForTests();
    builder.clearWorkspaceIndexMemoryCacheForTests();
  });

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

  it('indexes TypeScript constructor tokens without prototype collisions', () => {
    const chunks = chunkFileContent(
      '/workspace/apps/liora/src/widget.ts',
      'apps/liora/src/widget.ts',
      'export class Widget { constructor(private readonly id: string) {} }',
    );
    const index = buildBm25Index(chunks);
    expect(index.chunkCount).toBeGreaterThan(0);
    expect(searchBm25(index, 'constructor', 5).length).toBeGreaterThan(0);
  });

  it('builds workspace graph index for fixture files', async () => {
    const files = {
      '/workspace/packages/agent-core/src/tools/builtin/context/liora-context.ts': [
        'export class LioraContextTool {',
        '  readonly name = "LioraContext";',
        '}',
      ].join('\n'),
    };
    const kaos = makeKaos(files);
    const stats = await builder.buildWorkspaceIndex({ kaos, workspace, incremental: false });
    expect(stats.filesIndexed).toBe(1);
    expect(stats.chunksIndexed).toBeGreaterThan(0);
  });

  it('compose ranking prefers query-relevant fixture file', async () => {
    const files = {
      '/workspace/packages/agent-core/src/tools/builtin/context/liora-context.ts':
        'export class LioraContextTool { readonly name = "LioraContext"; }',
      '/workspace/packages/agent-core/src/tools/builtin/state/todo-list.ts':
        'export class TodoListTool { readonly name = "TodoList"; }',
    };
    const kaos = makeKaos(files);
    await builder.buildWorkspaceIndex({ kaos, workspace, incremental: false });
    const composed = await composeRankContext({
      kaos,
      workspace,
      query: 'LioraContext',
      maxFiles: 1,
    });
    expect(composed.ranked[0]?.file.displayPath).toContain('liora-context.ts');
    expect(composed.strategy).toBe('lean-codegraph-v2');
  });

  it('compose auto-builds the workspace index when it is missing', async () => {
    const files = {
      '/workspace/packages/agent-core/src/tools/builtin/context/liora-context.ts':
        'export class LioraContextTool { readonly name = "LioraContext"; }',
      '/workspace/packages/agent-core/src/tools/builtin/state/todo-list.ts':
        'export class TodoListTool { readonly name = "TodoList"; }',
    };
    const kaos = makeKaos(files);
    const composed = await composeRankContext({
      kaos,
      workspace,
      query: 'LioraContext',
      maxFiles: 1,
    });
    expect(composed.indexStaleHint).toBe('index_auto_built');
    expect(composed.ranked[0]?.file.displayPath).toContain('liora-context.ts');
  });

  it('incremental graph rebuild is a no-op when files are unchanged', async () => {
    const files = {
      '/workspace/packages/agent-core/src/tools/builtin/context/liora-context.ts':
        'export class LioraContextTool { readonly name = "LioraContext"; }',
    };
    const kaos = makeKaos(files);
    await builder.buildWorkspaceIndex({ kaos, workspace, incremental: false });
    const started = Date.now();
    const second = await builder.buildWorkspaceIndex({ kaos, workspace, incremental: true });
    expect(second.incremental).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('ensureWorkspaceIndex dedupes concurrent builds for the same workspace', async () => {
    const files = {
      '/workspace/packages/agent-core/src/tools/builtin/context/liora-context.ts':
        'export class LioraContextTool { readonly name = "LioraContext"; }',
    };
    const kaos = makeKaos(files);
    const [first, second] = await Promise.all([
      ensureWorkspaceIndex(kaos, workspace),
      ensureWorkspaceIndex(kaos, workspace),
    ]);
    expect(first.ready).toBe(true);
    expect(second.ready).toBe(true);
  });

  it('ensureWorkspaceIndex backs off after a failed build for the same workspace', async () => {
    vi.useFakeTimers();
    const kaos = makeKaos({
      '/workspace/packages/agent-core/src/tools/builtin/context/liora-context.ts':
        'export class LioraContextTool { readonly name = "LioraContext"; }',
    });
    const buildSpy = vi.spyOn(builder, 'buildWorkspaceIndex');
    buildSpy.mockRejectedValue(new Error('index build failed'));

    const first = await ensureWorkspaceIndex(kaos, workspace);
    expect(first.ready).toBe(false);
    expect(buildSpy).toHaveBeenCalledTimes(1);

    buildSpy.mockClear();
    const second = await ensureWorkspaceIndex(kaos, workspace);
    expect(second.ready).toBe(false);
    expect(buildSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    const third = await ensureWorkspaceIndex(kaos, workspace);
    expect(third.ready).toBe(false);
    expect(buildSpy).toHaveBeenCalledTimes(1);

    buildSpy.mockRestore();
  });

  it('finishBuild does not refresh built_at when the index is empty', async () => {
    const kaos = makeKaos({
      '/workspace/packages/agent-core/src/tools/builtin/context/liora-context.ts':
        'export class LioraContextTool { readonly name = "LioraContext"; }',
    });
    await builder.buildWorkspaceIndex({ kaos, workspace, incremental: false });
    const db = getGraphDatabase(workspace);
    const populatedBuiltAt = db.getBuiltAt();
    expect(populatedBuiltAt).toBeGreaterThan(0);

    // Simulate the "interrupted full rebuild" state: wipe rows then run a
    // build against an empty fixture set. finishBuild must NOT refresh
    // built_at on a 0-row result, otherwise the empty index would masquerade
    // as fresh and skip the next build.
    const emptyKaos = makeKaos({});
    await builder.buildWorkspaceIndex({ kaos: emptyKaos, workspace, incremental: false });
    expect(db.getStats().files).toBe(0);
    expect(db.getBuiltAt()).toBe(populatedBuiltAt);
  });

  it('composeRankContext falls back to direct discovery when the build budget times out', async () => {
    vi.useFakeTimers();
    const kaos = makeKaos({
      '/workspace/packages/agent-core/src/tools/builtin/context/liora-context.ts':
        'export class LioraContextTool { readonly name = "LioraContext"; }',
    });
    // Make the first build hang so the budget elapses; subsequent readiness
    // checks still see a missing index, which is what we want to exercise.
    const buildSpy = vi.spyOn(builder, 'buildWorkspaceIndex');
    let resolveHanging: ((v: Awaited<ReturnType<typeof builder.buildWorkspaceIndex>>) => void) | undefined;
    buildSpy.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHanging = resolve;
        }),
    );

    const composedPromise = composeRankContext({
      kaos,
      workspace,
      query: 'LioraContext',
      maxFiles: 1,
      buildBudgetMs: 50,
    });
    await vi.advanceTimersByTimeAsync(60);
    const composed = await composedPromise;
    // The agent must still get a usable packet instead of blocking.
    expect(composed.strategy).toBe('direct-discovery-fallback');
    expect(composed.ranked[0]?.file.displayPath).toContain('liora-context.ts');

    if (resolveHanging !== undefined) {
      buildSpy.mockRestore();
    }
  });

  it('a failed build leaves the previously committed index intact', async () => {
    const kaos = makeKaos({
      '/workspace/packages/agent-core/src/tools/builtin/context/liora-context.ts':
        'export class LioraContextTool { readonly name = "LioraContext"; }',
    });
    await builder.buildWorkspaceIndex({ kaos, workspace, incremental: false });
    const db = getGraphDatabase(workspace);
    const beforeFail = db.getStats();

    // Corrupt the next build by making readText throw mid-pipeline. Because
    // all writes are wrapped in a single transaction, the partially applied
    // changes roll back and the prior index survives.
    const readSpy = vi.spyOn(kaos, 'readText');
    readSpy.mockRejectedValueOnce(new Error('disk read failed'));
    await expect(
      builder.buildWorkspaceIndex({ kaos, workspace, incremental: false }),
    ).rejects.toThrow('disk read failed');

    expect(db.getStats()).toEqual(beforeFail);
    readSpy.mockRestore();
  });
});
