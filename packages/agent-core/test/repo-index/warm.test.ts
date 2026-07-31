import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  REPO_INDEX_WARM_ENV,
  isRepoIndexWarmEnabled,
  maybeWarmCodemapAtSessionStart,
  repoIndexWarmEnableReason,
  repoIndexWarmStatusLine,
} from '#/repo-index/warm';
import { REPO_INDEX_ENGINE_ENV } from '#/repo-index/status';
import { SOVEREIGN_UMBRELLA_ENV } from '#/profile/main-profile';

vi.mock('#/codemap/code-map', () => ({
  getCodeMapForWorkspace: vi.fn(() => ({
    ensureReady: vi.fn(() => true),
  })),
}));

vi.mock('#/codemap/status', () => ({
  isCodemapGitWorkspace: vi.fn(() => true),
}));

vi.mock('#/repo-index/content-indexer', () => ({
  getContentIndexForWorkspace: vi.fn(() => ({
    ensureReady: vi.fn(() => true),
  })),
}));

describe('repo index warm env gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('isRepoIndexWarmEnabled is ON by default and opt-out via WARM=0 or false', () => {
    expect(isRepoIndexWarmEnabled({})).toBe(true);
    expect(repoIndexWarmEnableReason({})).toBe('default');
    expect(isRepoIndexWarmEnabled({ [REPO_INDEX_WARM_ENV]: '0' })).toBe(false);
    expect(isRepoIndexWarmEnabled({ [REPO_INDEX_WARM_ENV]: 'false' })).toBe(false);
    expect(isRepoIndexWarmEnabled({ [REPO_INDEX_WARM_ENV]: 'true' })).toBe(true);
    expect(isRepoIndexWarmEnabled({ [REPO_INDEX_WARM_ENV]: '1' })).toBe(true);
    expect(isRepoIndexWarmEnabled({ [SOVEREIGN_UMBRELLA_ENV]: '1' })).toBe(true);
    expect(isRepoIndexWarmEnabled({ [SOVEREIGN_UMBRELLA_ENV]: 'true' })).toBe(true);
  });

  it('repoIndexWarmStatusLine reflects env gate', () => {
    expect(repoIndexWarmStatusLine({})).toContain('ON');
    expect(repoIndexWarmStatusLine({})).toContain('default');
    expect(repoIndexWarmStatusLine({})).toContain('sqlite FTS content index warm');
    expect(repoIndexWarmStatusLine({ [REPO_INDEX_WARM_ENV]: '0' })).toContain('OFF');
    expect(repoIndexWarmStatusLine({ [REPO_INDEX_WARM_ENV]: '0' })).toContain(`${REPO_INDEX_WARM_ENV}=0`);
    expect(repoIndexWarmStatusLine({ [REPO_INDEX_WARM_ENV]: '1' })).toContain('ON');
    expect(repoIndexWarmStatusLine({ [REPO_INDEX_WARM_ENV]: '1' })).toContain('ensureReady');
    expect(repoIndexWarmStatusLine({ [SOVEREIGN_UMBRELLA_ENV]: '1' })).toContain('ON');
    expect(repoIndexWarmStatusLine({ [SOVEREIGN_UMBRELLA_ENV]: '1' })).toContain(
      `${SOVEREIGN_UMBRELLA_ENV}=1`,
    );
  });

  it('repoIndexWarmEnableReason prefers explicit warm env over sovereign umbrella', () => {
    expect(
      repoIndexWarmEnableReason({
        [REPO_INDEX_WARM_ENV]: '1',
        [SOVEREIGN_UMBRELLA_ENV]: '1',
      }),
    ).toBe(`${REPO_INDEX_WARM_ENV}=1`);
  });

  it('repoIndexWarmEnableReason returns null when explicitly opted out', () => {
    expect(repoIndexWarmEnableReason({ [REPO_INDEX_WARM_ENV]: '0' })).toBeNull();
    expect(
      repoIndexWarmEnableReason({
        [REPO_INDEX_WARM_ENV]: '0',
        [SOVEREIGN_UMBRELLA_ENV]: '1',
      }),
    ).toBeNull();
  });

  it('repoIndexWarmStatusLine mentions sqlite FTS when engine=sqlite and warm is on', () => {
    expect(repoIndexWarmStatusLine({})).toContain('sqlite FTS content index warm');
    expect(
      repoIndexWarmStatusLine({
        [REPO_INDEX_WARM_ENV]: '1',
        [REPO_INDEX_ENGINE_ENV]: 'sqlite',
      }),
    ).toContain('sqlite FTS content index warm');
  });

  it('maybeWarmCodemapAtSessionStart warms content FTS by default when engine defaults to sqlite', async () => {
    const { getContentIndexForWorkspace } = await import('#/repo-index/content-indexer');
    maybeWarmCodemapAtSessionStart('/workspace/demo', {});
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(getContentIndexForWorkspace).toHaveBeenCalledWith('/workspace/demo');
    const contentIndex = vi.mocked(getContentIndexForWorkspace).mock.results[0]?.value as {
      ensureReady: ReturnType<typeof vi.fn>;
    };
    expect(contentIndex.ensureReady).toHaveBeenCalled();
  });

  it('maybeWarmCodemapAtSessionStart warms content FTS when engine=sqlite', async () => {
    const { getContentIndexForWorkspace } = await import('#/repo-index/content-indexer');
    maybeWarmCodemapAtSessionStart('/workspace/demo', {
      [REPO_INDEX_WARM_ENV]: '1',
      [REPO_INDEX_ENGINE_ENV]: 'sqlite',
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(getContentIndexForWorkspace).toHaveBeenCalledWith('/workspace/demo');
    const contentIndex = vi.mocked(getContentIndexForWorkspace).mock.results[0]?.value as {
      ensureReady: ReturnType<typeof vi.fn>;
    };
    expect(contentIndex.ensureReady).toHaveBeenCalled();
  });

  it('maybeWarmCodemapAtSessionStart skips content FTS warm when engine is stub', async () => {
    const { getContentIndexForWorkspace } = await import('#/repo-index/content-indexer');
    maybeWarmCodemapAtSessionStart('/workspace/demo', {
      [REPO_INDEX_ENGINE_ENV]: 'stub',
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(getContentIndexForWorkspace).not.toHaveBeenCalled();
  });

  it('maybeWarmCodemapAtSessionStart no-ops when env is opted out', async () => {
    const { getCodeMapForWorkspace } = await import('#/codemap/code-map');
    maybeWarmCodemapAtSessionStart('/workspace/demo', { [REPO_INDEX_WARM_ENV]: '0' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(getCodeMapForWorkspace).not.toHaveBeenCalled();
  });

  it('maybeWarmCodemapAtSessionStart fire-and-forgets ensureReady when sovereign umbrella is on', async () => {
    const { getCodeMapForWorkspace } = await import('#/codemap/code-map');
    maybeWarmCodemapAtSessionStart('/workspace/demo', { [SOVEREIGN_UMBRELLA_ENV]: '1' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(getCodeMapForWorkspace).toHaveBeenCalledWith('/workspace/demo');
  });

  it('maybeWarmCodemapAtSessionStart fire-and-forgets ensureReady by default', async () => {
    const { getCodeMapForWorkspace } = await import('#/codemap/code-map');
    maybeWarmCodemapAtSessionStart('/workspace/demo', {});
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(getCodeMapForWorkspace).toHaveBeenCalledWith('/workspace/demo');
    const codemap = vi.mocked(getCodeMapForWorkspace).mock.results[0]?.value as {
      ensureReady: ReturnType<typeof vi.fn>;
    };
    expect(codemap.ensureReady).toHaveBeenCalled();
  });

  it('maybeWarmCodemapAtSessionStart fire-and-forgets ensureReady when env is on', async () => {
    const { getCodeMapForWorkspace } = await import('#/codemap/code-map');
    maybeWarmCodemapAtSessionStart('/workspace/demo', { [REPO_INDEX_WARM_ENV]: '1' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(getCodeMapForWorkspace).toHaveBeenCalledWith('/workspace/demo');
    const codemap = vi.mocked(getCodeMapForWorkspace).mock.results[0]?.value as {
      ensureReady: ReturnType<typeof vi.fn>;
    };
    expect(codemap.ensureReady).toHaveBeenCalled();
  });

  it('maybeWarmCodemapAtSessionStart skips non-git workspaces', async () => {
    const { isCodemapGitWorkspace } = await import('#/codemap/status');
    vi.mocked(isCodemapGitWorkspace).mockReturnValueOnce(false);
    const { getCodeMapForWorkspace } = await import('#/codemap/code-map');
    maybeWarmCodemapAtSessionStart('/workspace/demo', { [REPO_INDEX_WARM_ENV]: '1' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(getCodeMapForWorkspace).not.toHaveBeenCalled();
  });
});
