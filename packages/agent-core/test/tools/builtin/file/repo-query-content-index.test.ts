import { afterEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { Writable } from 'node:stream';

import type { KaosProcess } from '@superliora/kaos';

import {
  REPO_INDEX_CONTENT_STUB_HINT,
  REPO_INDEX_SYNTHETIC_PROBE_TOKEN,
  REPO_INDEX_ZOEKT_STUB_HINT,
  REPO_INDEX_ZOEKT_STUB_NEXT_STEP,
  REPO_INDEX_ZOEKT_URL_ENV,
  resetRepoIndexSyntheticFtsForTests,
  resetZoektFetchOverride,
  resetZoektSidecarProbeOverride,
  setZoektFetchOverrideForTests,
  setZoektSidecarProbeOverrideForTests,
} from '#/repo-index/engine';
import { REPO_INDEX_ENGINE_ENV } from '#/repo-index/status';
import { RepoQueryTool } from '#/tools/builtin/file/repo-query';
import { createFakeKaos, PERMISSIVE_WORKSPACE } from '../../fixtures/fake-kaos';
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
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRepoIndexSyntheticFtsForTests();
    resetZoektSidecarProbeOverride();
    resetZoektFetchOverride();
  });

  it('surfaces synthetic FTS hit before Grep when engine=sqlite', async () => {
    vi.stubEnv(REPO_INDEX_ENGINE_ENV, 'sqlite');
    const exec = vi.fn();
    const tool = new RepoQueryTool(createFakeKaos({ exec }), PERMISSIVE_WORKSPACE);

    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'call_repo_query',
      args: {
        mode: 'content',
        query: REPO_INDEX_SYNTHETIC_PROBE_TOKEN,
        path: 'src',
      },
      signal,
    });

    expect(result.isError).toBeFalsy();
    const output = typeof result.output === 'string' ? result.output : '';
    expect(output).toContain('index_status: partial');
    expect(output).toContain(REPO_INDEX_SYNTHETIC_PROBE_TOKEN);
    expect(output).toContain('src/repo-index/engine.ts');
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

  it('falls through to Grep with zoekt stub hint when engine=zoekt and URL wired', async () => {
    vi.stubEnv(REPO_INDEX_ENGINE_ENV, 'zoekt');
    vi.stubEnv(REPO_INDEX_ZOEKT_URL_ENV, 'http://127.0.0.1:6070');
    setZoektSidecarProbeOverrideForTests(() => ({
      available: true,
      source: 'url',
      detail: 'http://127.0.0.1:6070',
      reason: null,
    }));
    const fetchImpl = vi.fn(async () => ({ status: 200 })) as unknown as typeof fetch;
    setZoektFetchOverrideForTests(fetchImpl);

    const execWithEnv = vi.fn().mockResolvedValue(processWithOutput(''));
    const tool = new RepoQueryTool(createFakeKaos({ execWithEnv }), PERMISSIVE_WORKSPACE);

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
    expect(output).toContain(REPO_INDEX_ZOEKT_STUB_HINT);
    expect(output).toContain('HTTP 200');
    expect(output).toContain(REPO_INDEX_ZOEKT_STUB_NEXT_STEP);
    expect(fetchImpl).toHaveBeenCalled();
    expect(execWithEnv).toHaveBeenCalled();
  });
});
