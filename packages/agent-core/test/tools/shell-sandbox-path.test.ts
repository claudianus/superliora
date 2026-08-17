import { describe, expect, it } from 'vitest';

import {
  detectSandboxCwd,
  detectShellSandboxPath,
  formatShellSandboxPathError,
} from '../../src/tools/policies/shell-sandbox-path';
import type { WorkspaceConfig } from '../../src/tools/support/workspace';

const posix = { pathClass: () => 'posix' as const };

const WORKSPACE: WorkspaceConfig = {
  workspaceDir: '/workspace',
  additionalDirs: ['/extra'],
  sandboxProfile: 'workspace',
};

const READ_ONLY: WorkspaceConfig = {
  ...WORKSPACE,
  sandboxProfile: 'read-only',
};

describe('shell sandbox path ceiling', () => {
  it('denies cwd outside workspace roots', () => {
    const hit = detectSandboxCwd('/tmp', WORKSPACE, posix);
    expect(hit?.code).toBe('PATH_OUTSIDE_WORKSPACE');
    expect(formatShellSandboxPathError(hit!)).toContain('code=PATH_OUTSIDE_WORKSPACE');
  });

  it('allows cwd inside workspace or extra roots', () => {
    expect(detectSandboxCwd('/workspace/src', WORKSPACE, posix)).toBeUndefined();
    expect(detectSandboxCwd('/extra/notes', WORKSPACE, posix)).toBeUndefined();
  });

  it('denies absolute path tokens outside roots in workspace profile', () => {
    const hit = detectShellSandboxPath('cat /etc/hosts', {
      cwd: '/workspace',
      workspace: WORKSPACE,
      pathClass: 'posix',
    });
    expect(hit?.code).toBe('PATH_OUTSIDE_WORKSPACE');
    expect(hit?.path).toBe('/etc/hosts');
  });

  it('allows in-workspace tokens and device sinks', () => {
    expect(
      detectShellSandboxPath('cat ./src/a.ts 2>/dev/null', {
        cwd: '/workspace',
        workspace: WORKSPACE,
        pathClass: 'posix',
      }),
    ).toBeUndefined();
  });

  it('blocks write redirects and mutating commands in read-only', () => {
    const redirect = detectShellSandboxPath('echo hi > /workspace/out.txt', {
      cwd: '/workspace',
      workspace: READ_ONLY,
      pathClass: 'posix',
    });
    expect(redirect?.code).toBe('PATH_READ_ONLY');

    const rm = detectShellSandboxPath('rm /workspace/src/a.ts', {
      cwd: '/workspace',
      workspace: READ_ONLY,
      pathClass: 'posix',
    });
    expect(rm?.code).toBe('PATH_READ_ONLY');
  });

  it('does nothing when profile is off', () => {
    expect(
      detectShellSandboxPath('cat /etc/hosts', {
        cwd: '/workspace',
        workspace: { ...WORKSPACE, sandboxProfile: 'off' },
        pathClass: 'posix',
      }),
    ).toBeUndefined();
  });
});
