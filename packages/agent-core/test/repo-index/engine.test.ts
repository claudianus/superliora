import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  REPO_INDEX_CONTENT_STUB_HINT,
  REPO_INDEX_SYNTHETIC_PROBE_TOKEN,
  REPO_INDEX_ZOEKT_STUB_HINT,
  REPO_INDEX_ZOEKT_STUB_NEXT_STEP,
  REPO_INDEX_ZOEKT_URL_ENV,
  getRepoIndexEngineWireStatus,
  probeSqliteDriver,
  probeZoektSidecar,
  queryRepoIndexContent,
  queryRepoIndexContentAsync,
  resetRepoIndexSyntheticFtsForTests,
  resetSqliteDriverProbeOverride,
  resetZoektFetchOverride,
  resetZoektSidecarProbeOverride,
  setSqliteDriverProbeOverrideForTests,
  setZoektFetchOverrideForTests,
  setZoektSidecarProbeOverrideForTests,
} from '#/repo-index/engine';

describe('repo-index engine soft stub', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetSqliteDriverProbeOverride();
    resetZoektSidecarProbeOverride();
    resetZoektFetchOverride();
    resetRepoIndexSyntheticFtsForTests();
  });

  it('probeSqliteDriver prefers node:sqlite on supported Node', () => {
    const probe = probeSqliteDriver();
    expect(probe.available).toBe(true);
    expect(probe.driver).toBe('node:sqlite');
    expect(probe.reason).toBeNull();
  });

  it('getRepoIndexEngineWireStatus is wired for sqlite when driver exists', () => {
    const wire = getRepoIndexEngineWireStatus('sqlite');
    expect(wire.wired).toBe(true);
    expect(wire.driver).toBe('node:sqlite');
    expect(wire.reason).toBeNull();
  });

  it('getRepoIndexEngineWireStatus reports reason for zoekt when sidecar missing', () => {
    setZoektSidecarProbeOverrideForTests(() => ({
      available: false,
      source: null,
      detail: null,
      reason: 'no zoekt sidecar (test)',
    }));
    expect(getRepoIndexEngineWireStatus('zoekt')).toMatchObject({
      wired: false,
      reason: 'no zoekt sidecar (test)',
    });
    expect(getRepoIndexEngineWireStatus('stub').wired).toBe(false);
    expect(getRepoIndexEngineWireStatus('stub').reason).toContain('engine=stub');
  });

  it('getRepoIndexEngineWireStatus is wired for zoekt when sidecar probe succeeds', () => {
    setZoektSidecarProbeOverrideForTests(() => ({
      available: true,
      source: 'url',
      detail: 'http://127.0.0.1:6070',
      reason: null,
    }));
    expect(getRepoIndexEngineWireStatus('zoekt')).toMatchObject({
      wired: true,
      driver: null,
      reason: null,
    });
  });

  it('probeZoektSidecar accepts SUPERLIORA_ZOEKT_URL', () => {
    const probe = probeZoektSidecar({ [REPO_INDEX_ZOEKT_URL_ENV]: 'http://127.0.0.1:6070' });
    expect(probe.available).toBe(true);
    expect(probe.source).toBe('url');
    expect(probe.detail).toBe('http://127.0.0.1:6070');
  });

  it('probeZoektSidecar rejects invalid SUPERLIORA_ZOEKT_URL', () => {
    const probe = probeZoektSidecar({ [REPO_INDEX_ZOEKT_URL_ENV]: 'not-a-url' });
    expect(probe.available).toBe(false);
    expect(probe.reason).toContain(REPO_INDEX_ZOEKT_URL_ENV);
  });

  it('getRepoIndexEngineWireStatus is unwired when sqlite driver probe fails', () => {
    setSqliteDriverProbeOverrideForTests(() => ({
      available: false,
      driver: null,
      reason: 'no sqlite driver (test)',
    }));
    expect(getRepoIndexEngineWireStatus('sqlite')).toMatchObject({
      wired: false,
      reason: 'no sqlite driver (test)',
    });
  });

  it('queryRepoIndexContent returns synthetic FTS hit for probe token', () => {
    const result = queryRepoIndexContent(
      { query: REPO_INDEX_SYNTHETIC_PROBE_TOKEN, path: 'src', limit: 10 },
      'sqlite',
    );
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results[0]).toContain(REPO_INDEX_SYNTHETIC_PROBE_TOKEN);
    expect(result.index_status).toBe('partial');
    expect(result.hint).toContain(REPO_INDEX_CONTENT_STUB_HINT);
    expect(result.next_step.length).toBeGreaterThan(0);
  });

  it('queryRepoIndexContent returns empty for unknown token with Grep fallback hint', () => {
    const result = queryRepoIndexContent({ query: 'zzzz-not-indexed-token-zzzz', limit: 10 }, 'sqlite');
    expect(result.results).toEqual([]);
    expect(result.index_status).toBe('cold');
    expect(result.next_step).toContain('Grep fallback');
  });

  it('queryRepoIndexContent scopes synthetic hits by path prefix', () => {
    const hit = queryRepoIndexContent(
      { query: REPO_INDEX_SYNTHETIC_PROBE_TOKEN, path: 'src/repo-index', limit: 10 },
      'sqlite',
    );
    expect(hit.results.length).toBeGreaterThanOrEqual(1);

    const miss = queryRepoIndexContent(
      { query: REPO_INDEX_SYNTHETIC_PROBE_TOKEN, path: 'apps/liora', limit: 10 },
      'sqlite',
    );
    expect(miss.results).toEqual([]);
  });

  it('queryRepoIndexContent returns guidance for unwired zoekt engines', () => {
    setZoektSidecarProbeOverrideForTests(() => ({
      available: false,
      source: null,
      detail: null,
      reason: 'no zoekt sidecar (test)',
    }));
    const zoekt = queryRepoIndexContent({ query: 'foo' }, 'zoekt');
    expect(zoekt.results).toEqual([]);
    expect(zoekt.index_status).toBe('cold');
    expect(zoekt.hint).toContain('no zoekt sidecar (test)');
    expect(zoekt.next_step).toContain('Grep fallback');
  });

  it('queryRepoIndexContentAsync returns empty zoekt stub with HTTP probe when URL wired', async () => {
    const sidecarUrl = 'http://127.0.0.1:6070';
    setZoektSidecarProbeOverrideForTests(() => ({
      available: true,
      source: 'url',
      detail: sidecarUrl,
      reason: null,
    }));
    const fetchImpl = vi.fn(async () => ({ status: 200 })) as unknown as typeof fetch;
    setZoektFetchOverrideForTests(fetchImpl);

    const result = await queryRepoIndexContentAsync({ query: 'foo', path: 'src', limit: 10 }, 'zoekt');
    expect(result.results).toEqual([]);
    expect(result.index_status).toBe('cold');
    expect(result.hint).toContain(REPO_INDEX_ZOEKT_STUB_HINT);
    expect(result.hint).toContain(sidecarUrl);
    expect(result.hint).toContain('HTTP 200');
    expect(result.next_step).toBe(REPO_INDEX_ZOEKT_STUB_NEXT_STEP);
    expect(fetchImpl).toHaveBeenCalledWith(
      sidecarUrl,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('queryRepoIndexContentAsync zoekt stub skips HTTP when sidecar is binary-only', async () => {
    setZoektSidecarProbeOverrideForTests(() => ({
      available: true,
      source: 'binary',
      detail: 'zoekt-webserver',
      reason: null,
    }));
    const fetchImpl = vi.fn(async () => ({ status: 200 })) as unknown as typeof fetch;
    setZoektFetchOverrideForTests(fetchImpl);

    const result = await queryRepoIndexContentAsync({ query: 'foo' }, 'zoekt');
    expect(result.results).toEqual([]);
    expect(result.hint).toContain('binary=zoekt-webserver');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('queryRepoIndexContentAsync zoekt stub keeps grep fallback when HTTP probe fails', async () => {
    setZoektSidecarProbeOverrideForTests(() => ({
      available: true,
      source: 'url',
      detail: 'http://127.0.0.1:6070',
      reason: null,
    }));
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    setZoektFetchOverrideForTests(fetchImpl);

    const result = await queryRepoIndexContentAsync({ query: 'foo' }, 'zoekt');
    expect(result.results).toEqual([]);
    expect(result.hint).toContain('probe failed (ECONNREFUSED)');
    expect(result.next_step).toContain('Grep fallback');
  });
});
