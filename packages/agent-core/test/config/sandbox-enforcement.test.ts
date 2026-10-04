import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SANDBOX_ENFORCEMENT,
  resolveSandboxEnforcementFromSources,
} from '../../src/config/sandbox-enforcement';
import { applyProcessSandboxToKaos, resolveProcessSandboxRuntime } from '../../src/tools/policies/process-sandbox-apply';

describe('sandbox enforcement resolve', () => {
  it('defaults to lexical', () => {
    const resolved = resolveSandboxEnforcementFromSources({});
    expect(resolved.enforcement).toBe(DEFAULT_SANDBOX_ENFORCEMENT);
    expect(resolved.source).toBe('default');
  });

  it('honors CLI over env over local.toml over user config', () => {
    expect(
      resolveSandboxEnforcementFromSources({
        cli: 'process',
        env: { SUPERLIORA_SANDBOX_ENFORCEMENT: 'lexical' },
        localToml: 'lexical',
        userConfig: 'lexical',
      }).enforcement,
    ).toBe('process');

    expect(
      resolveSandboxEnforcementFromSources({
        env: { SUPERLIORA_SANDBOX_ENFORCEMENT: 'process' },
        localToml: 'lexical',
      }).enforcement,
    ).toBe('process');
  });

  it.each([
    { cli: 'process', noProcessCli: true },
    { env: { SUPERLIORA_SANDBOX_ENFORCEMENT: 'process', SUPERLIORA_NO_PROCESS_SANDBOX: 'true' } },
    { userConfig: 'process', noProcessCli: true },
    { localToml: 'process', noProcessCli: true },
    { sessionMetadata: 'process', noProcessCli: true },
  ])('rejects process and noProcess conflicts from sources %j', sources => {
    expect(() => resolveSandboxEnforcementFromSources(sources)).toThrow(/conflicts/);
  });

  it('permits an explicit lexical choice despite a lower-priority process setting', () => {
    expect(resolveSandboxEnforcementFromSources({
      cli: 'lexical', userConfig: 'process', noProcessCli: true,
    })).toMatchObject({ enforcement: 'lexical', source: 'cli', noProcess: true });
  });

  it('ignores invalid env and falls through', () => {
    const resolved = resolveSandboxEnforcementFromSources({
      env: { SUPERLIORA_SANDBOX_ENFORCEMENT: 'bubblewrap' },
      userConfig: 'process',
    });
    expect(resolved.enforcement).toBe('process');
    expect(resolved.warning).toMatch(/SUPERLIORA_SANDBOX_ENFORCEMENT/);
  });
});

describe('process sandbox runtime', () => {
  it('stays lexical when desired is lexical', async () => {
    const result = await resolveProcessSandboxRuntime({
      desired: 'lexical',
      profile: 'workspace',
      workspaceDir: '/workspace',
      probeDocker: async () => true,
    });
    expect(result.status.effective).toBe('lexical');
    expect(result.config).toBeUndefined();
  });

  it('uses docker when probe succeeds', async () => {
    const result = await resolveProcessSandboxRuntime({
      desired: 'process',
      profile: 'read-only',
      workspaceDir: '/workspace',
      additionalDirs: ['/extra'],
      probeDocker: async () => true,
    });
    expect(result.status.effective).toBe('process');
    expect(result.status.backend).toBe('docker');
    expect(result.config).toMatchObject({
      backend: 'docker',
      workspaceDir: '/workspace',
      readOnly: true,
    });
  });

  it.each(['linux', 'darwin', 'win32'] as const)('rejects missing confinement on %s', async platform => {
    await expect(resolveProcessSandboxRuntime({
      desired: 'process', profile: 'workspace', workspaceDir: '/workspace', platform,
      probeDocker: async () => false,
    })).rejects.toThrow(/Docker is unavailable/);
  });

  it('rejects noProcess with explicit process enforcement', async () => {
    await expect(resolveProcessSandboxRuntime({
      desired: 'process', profile: 'workspace', workspaceDir: '/workspace', noProcess: true,
      probeDocker: async () => true,
    })).rejects.toThrow(/conflicts/);
  });

  it('leaves lexical users unaffected by noProcess', async () => {
    const result = await resolveProcessSandboxRuntime({
      desired: 'lexical', profile: 'off', workspaceDir: '/workspace', noProcess: true,
      probeDocker: async () => { throw new Error('must not probe'); },
    });
    expect(result.status.effective).toBe('lexical');
    expect(result.config).toBeUndefined();
    expect(result.coercedProfile).toBeUndefined();
  });

  it('rejects a host that cannot apply requested confinement', () => {
    expect(() => { applyProcessSandboxToKaos({}, { backend: 'docker', workspaceDir: '/workspace' }); })
      .toThrow(/cannot apply confinement/);
    expect(() => { applyProcessSandboxToKaos({}, undefined); }).not.toThrow();
  });

  it('coerces process + off to workspace', async () => {
    const result = await resolveProcessSandboxRuntime({
      desired: 'process',
      profile: 'off',
      workspaceDir: '/workspace',
      probeDocker: async () => true,
    });
    expect(result.coercedProfile).toBe('workspace');
    expect(result.config?.readOnly).toBe(false);
  });
});
