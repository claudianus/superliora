import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  REPO_INDEX_WARM_ENV,
  isRepoIndexWarmEnabled,
  maybeWarmCodemapAtSessionStart,
  repoIndexWarmEnableReason,
  repoIndexWarmStatusLine,
} from '#/repo-index/warm';
import { SOVEREIGN_UMBRELLA_ENV } from '#/profile/main-profile';

vi.mock('#/codemap/code-map', () => ({
  getCodeMapForWorkspace: vi.fn(() => ({
    ensureReady: vi.fn(() => true),
  })),
}));

vi.mock('#/codemap/status', () => ({
  isCodemapGitWorkspace: vi.fn(() => true),
}));

describe('repo index warm env gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('isRepoIndexWarmEnabled is false unless env is exactly 1 or sovereign opt-in', () => {
    expect(isRepoIndexWarmEnabled({})).toBe(false);
    expect(isRepoIndexWarmEnabled({ [REPO_INDEX_WARM_ENV]: 'true' })).toBe(false);
    expect(isRepoIndexWarmEnabled({ [REPO_INDEX_WARM_ENV]: '1' })).toBe(true);
    expect(isRepoIndexWarmEnabled({ [SOVEREIGN_UMBRELLA_ENV]: '1' })).toBe(true);
    expect(isRepoIndexWarmEnabled({ [SOVEREIGN_UMBRELLA_ENV]: 'true' })).toBe(true);
  });

  it('repoIndexWarmStatusLine reflects env gate', () => {
    expect(repoIndexWarmStatusLine({})).toContain('OFF');
    expect(repoIndexWarmStatusLine({})).toContain(SOVEREIGN_UMBRELLA_ENV);
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

  it('maybeWarmCodemapAtSessionStart no-ops when env is off', async () => {
    const { getCodeMapForWorkspace } = await import('#/codemap/code-map');
    maybeWarmCodemapAtSessionStart('/workspace/demo', {});
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(getCodeMapForWorkspace).not.toHaveBeenCalled();
  });

  it('maybeWarmCodemapAtSessionStart fire-and-forgets ensureReady when sovereign umbrella is on', async () => {
    const { getCodeMapForWorkspace } = await import('#/codemap/code-map');
    maybeWarmCodemapAtSessionStart('/workspace/demo', { [SOVEREIGN_UMBRELLA_ENV]: '1' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(getCodeMapForWorkspace).toHaveBeenCalledWith('/workspace/demo');
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
