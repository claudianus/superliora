import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  REPO_INDEX_ENGINE_ENV,
  REPO_INDEX_FTS_BACKEND_TIP,
  REPO_INDEX_PREFERRED_ENGINE_TIP,
  REPO_INDEX_WARM_ENV,
  formatRepoIndexWiredLine,
  getRepoIndexStatus,
  repoIndexPreferredEngineTipLine,
  repoIndexWarmStatusLine,
} from '@superliora/sdk';

import {
  buildIndexSessionLiveLines,
  buildIndexSettingsLines,
} from '#/tui/utils/index/index-glance';

const codemapWarm = {
  warmth: 'warm' as const,
  dbPath: '/tmp/codemap.sqlite',
  gitRepo: true,
  fileCount: 42,
  symbolCount: 128,
  note: null,
};

describe('index glance', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('surfaces live engine/driver/wired lines in Status by default (sqlite)', () => {
    const repoIndex = getRepoIndexStatus({});
    const lines = buildIndexSettingsLines({
      repoQueryActive: true,
      codemap: codemapWarm,
      repoIndex,
    });
    const text = lines.join('\n');
    const statusBlock = text.split('── Today ────────────────────────────────────')[0] ?? text;

    expect(statusBlock).toContain(formatRepoIndexWiredLine(repoIndex));
    expect(statusBlock).toContain('RepoIndex engine: enabled');
    expect(statusBlock).toContain('engine=sqlite');
    expect(statusBlock).toContain('FTS backend: sqlite-fts5 (live');
    expect(statusBlock).not.toContain(REPO_INDEX_FTS_BACKEND_TIP);
    expect(text).toContain(REPO_INDEX_FTS_BACKEND_TIP);
  });

  it('shows stub lines when engine is explicitly opted out', () => {
    const repoIndex = getRepoIndexStatus({ [REPO_INDEX_ENGINE_ENV]: 'stub' });
    const lines = buildIndexSettingsLines({
      repoQueryActive: true,
      codemap: codemapWarm,
      repoIndex,
    });
    const statusBlock =
      lines.join('\n').split('── Today ────────────────────────────────────')[0] ?? '';

    expect(statusBlock).toContain('RepoIndex engine: disabled (stub');
    expect(statusBlock).toContain('engine=stub');
    expect(statusBlock).toContain('FTS backend: not wired yet');
  });

  it('shows wired live line when sqlite engine probes', () => {
    const repoIndex = getRepoIndexStatus({ SUPERLIORA_REPO_INDEX_ENGINE: 'sqlite' });
    const lines = buildIndexSettingsLines({
      repoQueryActive: false,
      codemap: codemapWarm,
      repoIndex,
    });
    const statusBlock =
      lines.join('\n').split('── Today ────────────────────────────────────')[0] ?? '';

    expect(statusBlock).toContain('RepoIndex wire: live');
    expect(statusBlock).toContain('driver=node:sqlite');
    expect(statusBlock).toContain('RepoQuery: not active');
  });

  it('buildIndexSettingsLines puts Session (live) warm status before Status', () => {
    const repoIndex = getRepoIndexStatus({});
    const lines = buildIndexSettingsLines({
      repoQueryActive: true,
      codemap: codemapWarm,
      repoIndex,
      env: {},
    });
    const text = lines.join('\n');
    const liveIdx = text.indexOf('── Session (live)');
    const statusIdx = text.indexOf('── Status ──');
    expect(liveIdx).toBeGreaterThan(-1);
    expect(statusIdx).toBeGreaterThan(liveIdx);
    expect(text).toContain(repoIndexWarmStatusLine({}));
    expect(text).toContain('Codemap warm: ON (default)');
  });

  it('buildIndexSessionLiveLines shows default engine tip when env unset', () => {
    const env = {};
    const lines = buildIndexSessionLiveLines({ env });
    const text = lines.join('\n');
    expect(text).toContain(repoIndexWarmStatusLine(env));
    expect(text).toContain(REPO_INDEX_PREFERRED_ENGINE_TIP);
    expect(text).toContain('stub|off|none');
  });

  it('buildIndexSessionLiveLines reflects sovereign umbrella env for warm reason', () => {
    const env = { SUPERLIORA_SOVEREIGN: '1' };
    const lines = buildIndexSessionLiveLines({ env });
    const text = lines.join('\n');
    expect(text).toContain(repoIndexWarmStatusLine(env));
    expect(text).toContain('SUPERLIORA_SOVEREIGN=1');
  });

  it('buildIndexSessionLiveLines omits preferred engine tip when engine is set', () => {
    const env = { SUPERLIORA_SOVEREIGN: '1', [REPO_INDEX_ENGINE_ENV]: 'sqlite' };
    const text = buildIndexSessionLiveLines({ env }).join('\n');
    expect(text).not.toContain(REPO_INDEX_PREFERRED_ENGINE_TIP);
    expect(repoIndexPreferredEngineTipLine(env)).toBeNull();
  });

  it('buildIndexSessionLiveLines omits preferred engine tip when stub opt-out is set', () => {
    const env = { [REPO_INDEX_ENGINE_ENV]: 'stub' };
    const text = buildIndexSessionLiveLines({ env }).join('\n');
    expect(text).not.toContain(REPO_INDEX_PREFERRED_ENGINE_TIP);
  });

  it('buildIndexSessionLiveLines surfaces zoekt wire probe when engine=zoekt', () => {
    vi.stubEnv(REPO_INDEX_ENGINE_ENV, 'zoekt');
    vi.stubEnv('SUPERLIORA_ZOEKT_URL', 'http://127.0.0.1:6070');

    const repoIndex = getRepoIndexStatus();
    const lines = buildIndexSessionLiveLines({ repoIndex });
    const text = lines.join('\n');

    expect(repoIndex.engine).toBe('zoekt');
    expect(text).toContain(formatRepoIndexWiredLine(repoIndex));
    expect(text).toContain('RepoIndex wire: live');
    expect(text).toContain('engine=zoekt');
  });

  it('buildIndexSessionLiveLines shows zoekt probe reason when sidecar missing', () => {
    vi.stubEnv(REPO_INDEX_ENGINE_ENV, 'zoekt');
    vi.stubEnv('SUPERLIORA_ZOEKT_URL', '');

    const repoIndex = getRepoIndexStatus();
    const text = buildIndexSessionLiveLines({ repoIndex }).join('\n');

    expect(text).toContain(formatRepoIndexWiredLine(repoIndex));
    expect(text).toContain('RepoIndex wire: not live');
    expect(text).toContain('engine=zoekt');
  });

  it('buildIndexSessionLiveLines omits zoekt probe when engine is not zoekt', () => {
    const env = { [REPO_INDEX_ENGINE_ENV]: 'sqlite' };
    const repoIndex = getRepoIndexStatus(env);
    const text = buildIndexSessionLiveLines({ env, repoIndex }).join('\n');

    expect(text).not.toContain('RepoIndex wire:');
  });

  it('buildIndexSettingsLines puts zoekt probe in Session (live) before Status', () => {
    vi.stubEnv(REPO_INDEX_ENGINE_ENV, 'zoekt');

    const repoIndex = getRepoIndexStatus();
    const lines = buildIndexSettingsLines({
      repoQueryActive: true,
      codemap: codemapWarm,
      repoIndex,
    });
    const text = lines.join('\n');
    const liveIdx = text.indexOf('── Session (live)');
    const statusIdx = text.indexOf('── Status ──');
    const wiredInLive = text
      .slice(liveIdx, statusIdx)
      .includes(formatRepoIndexWiredLine(repoIndex));

    expect(liveIdx).toBeGreaterThan(-1);
    expect(statusIdx).toBeGreaterThan(liveIdx);
    expect(wiredInLive).toBe(true);
  });
});
