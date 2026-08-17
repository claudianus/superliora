import { describe, expect, it } from 'vitest';

import {
  buildDockerSandboxArgs,
  mapHostCwdToContainer,
  resolveProcessSandboxBackend,
  wrapLocalExecForProcessSandbox,
} from '#/process-sandbox';

describe('process sandbox helpers', () => {
  it('maps host cwd under workspace and extra dirs', () => {
    expect(mapHostCwdToContainer('/ws/src', '/ws', [])).toBe('/workspace/src');
    expect(mapHostCwdToContainer('/extra/a', '/ws', ['/extra'])).toBe('/extra0/a');
    expect(mapHostCwdToContainer('/elsewhere', '/ws', [])).toBeUndefined();
  });

  it('builds docker args with read-only mounts', () => {
    const args = buildDockerSandboxArgs({
      workspaceDir: '/ws',
      additionalDirs: ['/extra'],
      cwd: '/ws/src',
      readOnly: true,
      command: ['bash', '-c', "cd '/ws' && echo hi"],
    });
    expect(args[0]).toBe('docker');
    expect(args).toContain('-v');
    expect(args).toContain('/ws:/workspace:ro');
    expect(args).toContain('/extra:/extra0:ro');
    expect(args).toContain('-w');
    expect(args).toContain('/workspace/src');
    expect(args.at(-1)).toBe('echo hi');
  });

  it('resolves docker when probe succeeds and degrades without it on linux', async () => {
    await expect(
      resolveProcessSandboxBackend({ probeDocker: async () => true }),
    ).resolves.toEqual({ backend: 'docker' });

    const missing = await resolveProcessSandboxBackend({
      platform: 'linux',
      probeDocker: async () => false,
    });
    expect(missing.backend).toBeUndefined();
    expect(missing.warning).toMatch(/no Docker/);
  });

  it('uses job on win32 without docker and labels it as not an FS jail', async () => {
    const result = await resolveProcessSandboxBackend({
      platform: 'win32',
      probeDocker: async () => false,
    });
    expect(result.backend).toBe('job');
    expect(result.warning).toMatch(/not a filesystem jail/i);
  });

  it('skips process wrap when noProcess is set', async () => {
    const result = await resolveProcessSandboxBackend({
      noProcess: true,
      probeDocker: async () => true,
    });
    expect(result.backend).toBeUndefined();
    expect(result.warning).toMatch(/--no-process-sandbox/);
  });

  it('wraps local exec for docker and leaves host argv for job', () => {
    const docker = wrapLocalExecForProcessSandbox({
      file: 'bash',
      args: ['-c', 'echo hi'],
      cwd: '/ws',
      config: { backend: 'docker', workspaceDir: '/ws' },
    });
    expect(docker.file).toBe('docker');
    expect(docker.args[0]).toBe('run');

    const job = wrapLocalExecForProcessSandbox({
      file: 'bash',
      args: ['-c', 'echo hi'],
      cwd: 'C:/ws',
      config: { backend: 'job', workspaceDir: 'C:/ws' },
    });
    expect(job.file).toBe('bash');
    expect(job.afterSpawn).toBeTypeOf('function');
  });
});
