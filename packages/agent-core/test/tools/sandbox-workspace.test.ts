import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORKSPACE_ACCESS_POLICY,
  PathSecurityError,
  assertSandboxResolvedPath,
  policyForSandboxProfile,
  resolvePathAccess,
  resolvePathAccessPath,
} from '../../src/tools/policies/path-access';
import type { WorkspaceConfig } from '../../src/tools/support/workspace';

const WORKSPACE: WorkspaceConfig = {
  workspaceDir: '/workspace',
  additionalDirs: ['/extra'],
};

describe('sandbox profile mapping (unit-sandbox-workspace)', () => {

  it('workspace mode denies absolute write outside roots', () => {
    const policy = policyForSandboxProfile('workspace');
    expect(() =>
      resolvePathAccess('/tmp/evil.txt', '/workspace', WORKSPACE, {
        operation: 'write',
        policy,
      }),
    ).toThrow(PathSecurityError);

    try {
      resolvePathAccess('/tmp/evil.txt', '/workspace', WORKSPACE, {
        operation: 'write',
        policy,
      });
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PathSecurityError);
      expect((error as PathSecurityError).code).toBe('PATH_OUTSIDE_WORKSPACE');
    }
  });

  it('workspace mode allows write inside workspace and additionalDirs', () => {
    const policy = policyForSandboxProfile('workspace');
    expect(
      resolvePathAccess('/workspace/src/a.ts', '/workspace', WORKSPACE, {
        operation: 'write',
        policy,
      }),
    ).toEqual({ path: '/workspace/src/a.ts', outsideWorkspace: false });

    expect(
      resolvePathAccess('/extra/note.md', '/workspace', WORKSPACE, {
        operation: 'write',
        policy,
      }),
    ).toEqual({ path: '/extra/note.md', outsideWorkspace: false });
  });

  it('workspace mode denies absolute read and search outside roots', () => {
    const policy = policyForSandboxProfile('workspace');
    expect(() =>
      resolvePathAccess('/etc/hosts', '/workspace', WORKSPACE, {
        operation: 'read',
        policy,
      }),
    ).toThrow(/outside the workspace/);

    expect(() =>
      resolvePathAccess('/etc/hosts', '/workspace', WORKSPACE, {
        operation: 'search',
        policy,
      }),
    ).toThrow(/outside the workspace/);
  });

  it('read-only mode denies all writes including inside workspace', () => {
    const policy = policyForSandboxProfile('read-only');
    expect(() =>
      resolvePathAccess('/workspace/src/a.ts', '/workspace', WORKSPACE, {
        operation: 'write',
        policy,
      }),
    ).toThrow(PathSecurityError);

    try {
      resolvePathAccess('/workspace/src/a.ts', '/workspace', WORKSPACE, {
        operation: 'write',
        policy,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(PathSecurityError);
      expect((error as PathSecurityError).code).toBe('PATH_READ_ONLY');
    }
  });

  it('read-only mode allows reads inside workspace', () => {
    const policy = policyForSandboxProfile('read-only');
    expect(
      resolvePathAccess('/workspace/README.md', '/workspace', WORKSPACE, {
        operation: 'read',
        policy,
      }),
    ).toEqual({ path: '/workspace/README.md', outsideWorkspace: false });
  });

  it('off/legacy default still allows absolute outside read', () => {
    const result = resolvePathAccess('/etc/hosts', '/workspace', WORKSPACE, {
      operation: 'read',
      policy: DEFAULT_WORKSPACE_ACCESS_POLICY,
    });
    expect(result).toEqual({ path: '/etc/hosts', outsideWorkspace: true });

    const off = policyForSandboxProfile('off');
    expect(
      resolvePathAccess('/tmp/x', '/workspace', WORKSPACE, {
        operation: 'write',
        policy: off,
      }),
    ).toEqual({ path: '/tmp/x', outsideWorkspace: true });
  });

  it('off still blocks sensitive paths via checkSensitive', () => {
    const off = policyForSandboxProfile('off', true);
    expect(() =>
      resolvePathAccess('/workspace/.env', '/workspace', WORKSPACE, {
        operation: 'read',
        policy: off,
      }),
    ).toThrow(PathSecurityError);
    try {
      resolvePathAccess('/workspace/.env', '/workspace', WORKSPACE, {
        operation: 'read',
        policy: off,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(PathSecurityError);
      expect((error as PathSecurityError).code).toBe('PATH_SENSITIVE');
    }
  });


  it('resolvePathAccessPath uses workspace.sandboxProfile when policy is omitted', () => {
    const kaos = {
      pathClass: () => 'posix' as const,
      gethome: () => '/home/user',
    };
    const workspace: WorkspaceConfig = {
      workspaceDir: '/workspace',
      additionalDirs: ['/extra'],
      sandboxProfile: 'workspace',
    };
    expect(
      resolvePathAccessPath('/workspace/src/a.ts', {
        kaos,
        workspace,
        operation: 'read',
      }),
    ).toBe('/workspace/src/a.ts');
    expect(() =>
      resolvePathAccessPath('/etc/hosts', {
        kaos,
        workspace,
        operation: 'read',
      }),
    ).toThrow(PathSecurityError);
  });

  it('assertSandboxResolvedPath denies a realpath target outside workspace', async () => {
    const kaos = {
      pathClass: () => 'posix' as const,
      realpath: async () => '/etc/passwd',
    };
    const workspace: WorkspaceConfig = {
      workspaceDir: '/workspace',
      additionalDirs: [],
      sandboxProfile: 'workspace',
    };
    await expect(
      assertSandboxResolvedPath('/workspace/link', { kaos, workspace, rawPath: 'link' }),
    ).rejects.toMatchObject({ code: 'PATH_SYMLINK_OUTSIDE' });
  });

  it('assertSandboxResolvedPath skips follow when profile is off', async () => {
    const kaos = {
      pathClass: () => 'posix' as const,
      realpath: async () => '/etc/passwd',
    };
    await expect(
      assertSandboxResolvedPath('/workspace/link', {
        kaos,
        workspace: { workspaceDir: '/workspace', additionalDirs: [], sandboxProfile: 'off' },
      }),
    ).resolves.toBe('/workspace/link');
  });
});
