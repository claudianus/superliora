import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SANDBOX_ENFORCEMENT,
  resolveSandboxEnforcementFromSources,
} from '../../src/config/sandbox-enforcement';
import { resolveProcessSandboxRuntime } from '../../src/tools/policies/process-sandbox-apply';

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

  it('degrades to lexical when docker is missing on linux', async () => {
    const result = await resolveProcessSandboxRuntime({
      desired: 'process',
      profile: 'workspace',
      workspaceDir: '/workspace',
      platform: 'linux',
      probeDocker: async () => false,
    });
    expect(result.status.effective).toBe('lexical');
    expect(result.status.warning).toMatch(/no Docker/);
    expect(result.config).toBeUndefined();
  });

  it('uses job backend on win32 without docker and does not call it an FS jail', async () => {
    const result = await resolveProcessSandboxRuntime({
      desired: 'process',
      profile: 'workspace',
      workspaceDir: 'C:/workspace',
      platform: 'win32',
      probeDocker: async () => false,
    });
    expect(result.status.effective).toBe('process');
    expect(result.status.backend).toBe('job');
    expect(result.status.warning).toMatch(/not a filesystem jail/i);
    expect(result.config?.backend).toBe('job');
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
