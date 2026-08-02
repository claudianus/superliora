import { afterEach, describe, expect, it, vi } from 'vitest';

import * as sdk from '@superliora/sdk';
import { REPO_INDEX_ENGINE_ENV } from '@superliora/sdk';

import { formatIndexFooterBadge } from '#/tui/utils/index/index-footer-badge';

describe('formatIndexFooterBadge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns null for empty workDir', () => {
    expect(formatIndexFooterBadge('')).toBeNull();
    expect(formatIndexFooterBadge('   ')).toBeNull();
  });

  it('shows idx·stub-off when repo index engine is stub', () => {
    expect(
      formatIndexFooterBadge('/tmp/project', { [REPO_INDEX_ENGINE_ENV]: 'stub' }, 'compact'),
    ).toEqual({
      text: 'idx·stub-off',
      severity: 'muted',
    });
  });

  it('shows idx·warm when codemap is warm', () => {
    vi.spyOn(sdk, 'getCodemapStatus').mockReturnValue({
      warmth: 'warm',
      dbPath: '/tmp/codemap.sqlite',
      gitRepo: true,
      fileCount: 10,
      symbolCount: 40,
      note: null,
    });

    expect(formatIndexFooterBadge('/tmp/project', process.env, 'compact')).toEqual({
      text: 'idx·warm',
      severity: 'info',
    });
  });

  it('shows idx·cold when codemap is cold', () => {
    vi.spyOn(sdk, 'getCodemapStatus').mockReturnValue({
      warmth: 'cold',
      dbPath: '/tmp/codemap.sqlite',
      gitRepo: true,
      fileCount: null,
      symbolCount: null,
      note: null,
    });

    expect(formatIndexFooterBadge('/tmp/project', process.env, 'compact')).toEqual({
      text: 'idx·cold',
      severity: 'warning',
    });
  });

  it('shows idx·off when codemap is unavailable', () => {
    vi.spyOn(sdk, 'getCodemapStatus').mockReturnValue({
      warmth: 'unavailable',
      dbPath: '/tmp/codemap.sqlite',
      gitRepo: false,
      fileCount: null,
      symbolCount: null,
      note: 'not a git repo',
    });

    expect(formatIndexFooterBadge('/tmp/project', process.env, 'compact')).toEqual({
      text: 'idx·off',
      severity: 'muted',
    });
  });
});
