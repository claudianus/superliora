import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { Writable } from 'node:stream';

import type { KaosProcess } from '@superliora/kaos';

import {
  REPO_INDEX_CONTENT_STUB_HINT,
  REPO_INDEX_ZOEKT_URL_ENV,
  resetContentIndexForTests,
  resetRepoIndexSyntheticFtsForTests,
  resetZoektFetchOverride,
  resetZoektSidecarProbeOverride,
  setContentIndexDbPathOverrideForTests,
  setZoektFetchOverrideForTests,
  setZoektSidecarProbeOverrideForTests,
} from '#/repo-index/engine';
import { REPO_INDEX_ENGINE_ENV } from '#/repo-index/status';
import { RepoQueryTool } from '#/tools/builtin/file/repo-query';
import type { WorkspaceConfig } from '#/tools/support/workspace';
import { createFakeKaos } from '../../fixtures/fake-kaos';
import { executeTool } from '../../fixtures/execute-tool';

const signal = new AbortController().signal;

function processWithOutput(stdout: string, stderr = '', exitCode = 0): KaosProcess {
  const stdoutStream = Readable.from([stdout]);
  const stderrStream = Readable.from([stderr]);
  return {
    stdin: { end: vi.fn(), write: vi.fn() } as unknown as Writable,
    stdout: stdoutStream,
    stderr: stderrStream,
    pid: 123,
    exitCode,
    wait: vi.fn().mockResolvedValue(exitCode),
    kill: vi.fn(async () => {}),
    dispose: vi.fn(async () => {
      stdoutStream.destroy();
      stderrStream.destroy();
    }),
  };
}

describe('RepoQuery content mode — sqlite FTS preview', () => {
  let dir: string;
  let workspace: WorkspaceConfig;
  const probeToken = 'RepoQueryContentProbeToken';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'repo-query-content-'));
    writeFileSync(join(dir, 'indexed.ts'), `export const token = '${probeToken}';\n`);
    workspace = { workspaceDir: dir, additionalDirs: [] };
    setContentIndexDbPathOverrideForTests(() => ':memory:');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    resetRepoIndexSyntheticFtsForTests();
    resetZoektSidecarProbeOverride();
    resetZoektFetchOverride();
    setContentIndexDbPathOverrideForTests(null);
    resetContentIndexForTests();
  });

  it('surfaces real FTS hit before Grep when engine=sqlite', async () => {
    vi.stubEnv(REPO_INDEX_ENGINE_ENV, 'sqlite');
    const exec = vi.fn();
    const tool = new RepoQueryTool(createFakeKaos({ exec }), workspace);

    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'call_repo_query',
      args: {
        mode: 'content',
        query: probeToken,
        path: 'indexed',
      },
      signal,
    });

    expect(result.isError).toBeFalsy();
    const output = typeof result.output === 'string' ? result.output : '';
    expect(output).toContain('index_status: partial');
    expect(output).toContain(probeToken);
    expect(output).toContain('indexed.ts');
    expect(output).toContain(REPO_INDEX_CONTENT_STUB_HINT);
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('RepoQuery content mode — zoekt sidecar soft stub', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetZoektSidecarProbeOverride();
    resetZoektFetchOverride();
  });

  it('falls through to Grep when engine=zoekt and zoekt HTTP has no hits', async () => {
    vi.stubEnv(REPO_INDEX_ENGINE_ENV, 'zoekt');
    vi.stubEnv(REPO_INDEX_ZOEKT_URL_ENV, 'http://127.0.0.1:6070');
    setZoektSidecarProbeOverrideForTests(() => ({
      available: true,
      source: 'url',
      detail: 'http://127.0.0.1:6070',
      reason: null,
    }));
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: { FileMatches: [] } }),
    })) as unknown as typeof fetch;
    setZoektFetchOverrideForTests(fetchImpl);

    const exec = vi.fn().mockResolvedValue(processWithOutput(''));
    const tool = new RepoQueryTool(createFakeKaos({ exec }), {
      workspaceDir: '/',
      additionalDirs: [],
    });

    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'call_repo_query_zoekt',
      args: {
        mode: 'content',
        query: 'matched',
        path: 'src',
      },
      signal,
    });

    expect(result.isError).toBeFalsy();
    const output = typeof result.output === 'string' ? result.output : '';
    expect(output).toContain('index_status: cold');
    expect(fetchImpl).toHaveBeenCalled();
    expect(exec).toHaveBeenCalled();
  });
});
