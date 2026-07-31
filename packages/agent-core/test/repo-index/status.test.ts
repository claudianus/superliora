import { afterEach, describe, expect, it } from 'vitest';

import {
  REPO_INDEX_ENGINE_ENV,
  REPO_INDEX_FTS_BACKEND_TIP,
  REPO_INDEX_PREFERRED_ENGINE,
  REPO_INDEX_PREFERRED_ENGINE_TIP,
  formatRepoIndexBackendLine,
  formatRepoIndexEngineLine,
  formatRepoIndexWiredLine,
  getRepoIndexStatus,
  isRepoIndexEngineEnvUnset,
  isRepoIndexEngineModulePresent,
  isRepoIndexEngineWired,
  repoIndexPreferredEngineTipLine,
} from '#/repo-index/status';
import { resetSqliteDriverProbeOverride, resetZoektSidecarProbeOverride, setSqliteDriverProbeOverrideForTests, setZoektSidecarProbeOverrideForTests } from '#/repo-index/engine';

describe('getRepoIndexStatus FTS soft wire', () => {
  afterEach(() => {
    resetSqliteDriverProbeOverride();
    resetZoektSidecarProbeOverride();
  });
  it('reads SUPERLIORA_REPO_INDEX_ENGINE and surfaces sqlite vs zoekt FTS tips', () => {
    expect(isRepoIndexEngineModulePresent()).toBe(true);

    const stub = getRepoIndexStatus({});
    expect(stub.engine).toBe('stub');
    expect(stub.backend).toBe('none');
    expect(stub.wired).toBe(false);
    expect(stub.enabled).toBe(false);
    expect(stub.ftsBackendTip).toBe(REPO_INDEX_FTS_BACKEND_TIP);
    expect(formatRepoIndexEngineLine(stub)).toContain('engine=stub');
    expect(formatRepoIndexBackendLine(stub)).toContain('SQLite FTS5');
    expect(formatRepoIndexWiredLine(stub)).toContain('not live');
    expect(formatRepoIndexWiredLine(stub)).toContain('engine=stub');

    const sqlite = getRepoIndexStatus({ [REPO_INDEX_ENGINE_ENV]: 'sqlite' });
    expect(sqlite.engine).toBe('sqlite');
    expect(sqlite.backend).toBe('sqlite-fts5');
    expect(sqlite.wired).toBe(true);
    expect(sqlite.enabled).toBe(true);
    expect(sqlite.driver).toBe('node:sqlite');
    expect(isRepoIndexEngineWired({ [REPO_INDEX_ENGINE_ENV]: 'sqlite' })).toBe(true);
    expect(formatRepoIndexEngineLine(sqlite)).toContain('enabled');
    expect(formatRepoIndexEngineLine(sqlite)).toContain('driver=node:sqlite');
    expect(formatRepoIndexBackendLine(sqlite)).toContain('live stub');
    expect(formatRepoIndexBackendLine(sqlite)).toContain('sqlite-fts5');
    expect(formatRepoIndexWiredLine(sqlite)).toContain('live');
    expect(formatRepoIndexWiredLine(sqlite)).toContain('engine=sqlite');
    expect(formatRepoIndexWiredLine(sqlite)).toContain('driver=node:sqlite');

    setZoektSidecarProbeOverrideForTests(() => ({
      available: false,
      source: null,
      detail: null,
      reason: 'no zoekt sidecar (test)',
    }));
    const zoekt = getRepoIndexStatus({ [REPO_INDEX_ENGINE_ENV]: 'zoekt' });
    expect(zoekt.engine).toBe('zoekt');
    expect(zoekt.backend).toBe('zoekt');
    expect(zoekt.wired).toBe(false);
    expect(zoekt.wireReason).toBe('no zoekt sidecar (test)');
    expect(formatRepoIndexEngineLine(zoekt)).toContain('engine=zoekt');
    expect(formatRepoIndexBackendLine(zoekt)).toContain('zoekt');
    expect(formatRepoIndexWiredLine(zoekt)).toContain('not live');
    expect(formatRepoIndexWiredLine(zoekt)).toContain('no zoekt sidecar (test)');

    setZoektSidecarProbeOverrideForTests(() => ({
      available: true,
      source: 'binary',
      detail: 'zoekt-webserver',
      reason: null,
    }));
    const zoektWired = getRepoIndexStatus({ [REPO_INDEX_ENGINE_ENV]: 'zoekt' });
    expect(zoektWired.wired).toBe(true);
    expect(zoektWired.enabled).toBe(true);
    expect(isRepoIndexEngineWired({ [REPO_INDEX_ENGINE_ENV]: 'zoekt' })).toBe(true);
    expect(formatRepoIndexEngineLine(zoektWired)).toContain('enabled');
    expect(formatRepoIndexEngineLine(zoektWired)).toContain('zoekt');
    expect(formatRepoIndexWiredLine(zoektWired)).toContain('live');
    expect(formatRepoIndexWiredLine(zoektWired)).toContain('engine=zoekt');
  });

  it('reports unwired sqlite when driver probe fails', () => {
    setSqliteDriverProbeOverrideForTests(() => ({
      available: false,
      driver: null,
      reason: 'no sqlite driver (test)',
    }));

    const sqlite = getRepoIndexStatus({ [REPO_INDEX_ENGINE_ENV]: 'sqlite' });
    expect(sqlite.wired).toBe(false);
    expect(sqlite.enabled).toBe(false);
    expect(sqlite.wireReason).toBe('no sqlite driver (test)');
    expect(isRepoIndexEngineWired({ [REPO_INDEX_ENGINE_ENV]: 'sqlite' })).toBe(false);
    expect(formatRepoIndexBackendLine(sqlite)).toContain('no sqlite driver (test)');
    expect(formatRepoIndexWiredLine(sqlite)).toContain('not live');
    expect(formatRepoIndexWiredLine(sqlite)).toContain('no sqlite driver (test)');
  });

  it('repoIndexPreferredEngineTipLine soft-suggests sqlite under SUPERLIORA_SOVEREIGN=1 when engine unset', () => {
    expect(isRepoIndexEngineEnvUnset({})).toBe(true);
    expect(isRepoIndexEngineEnvUnset({ [REPO_INDEX_ENGINE_ENV]: 'sqlite' })).toBe(false);
    expect(isRepoIndexEngineEnvUnset({ [REPO_INDEX_ENGINE_ENV]: '  ' })).toBe(true);

    expect(repoIndexPreferredEngineTipLine({})).toBeNull();
    expect(repoIndexPreferredEngineTipLine({ SUPERLIORA_SOVEREIGN: '1' })).toBe(
      REPO_INDEX_PREFERRED_ENGINE_TIP,
    );
    expect(repoIndexPreferredEngineTipLine({ SUPERLIORA_SOVEREIGN: 'true' })).toBe(
      REPO_INDEX_PREFERRED_ENGINE_TIP,
    );
    expect(
      repoIndexPreferredEngineTipLine({
        SUPERLIORA_SOVEREIGN: '1',
        [REPO_INDEX_ENGINE_ENV]: REPO_INDEX_PREFERRED_ENGINE,
      }),
    ).toBeNull();
    expect(
      repoIndexPreferredEngineTipLine({
        SUPERLIORA_SOVEREIGN_CORE: '1',
      }),
    ).toBeNull();
    expect(REPO_INDEX_PREFERRED_ENGINE_TIP).toContain(`${REPO_INDEX_ENGINE_ENV}=sqlite`);
    expect(REPO_INDEX_PREFERRED_ENGINE_TIP).toContain('not forced');
  });
});
