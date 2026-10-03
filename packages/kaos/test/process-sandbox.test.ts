import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

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

  it('uses case-sensitive POSIX mapping and normalizes traversal', () => {
    expect(mapHostCwdToContainer('/WS/src', '/ws')).toBeUndefined();
    expect(mapHostCwdToContainer('/ws/../outside', '/ws')).toBeUndefined();
    expect(mapHostCwdToContainer('/ws/a/../b', '/ws')).toBe('/workspace/b');
    expect(mapHostCwdToContainer('C:/WS/src', 'c:/ws')).toBe('/workspace/src');
  });

  it.each(['relative', '/ws,readonly=false', '/ws"bad', '/ws\nwrong', '/', 'C:/', homedir(), '/var/run/docker.sock'])(
    'rejects unsafe workspace or additional mounts: %j', path => {
      expect(() => buildDockerSandboxArgs({ workspaceDir: path, cwd: path, command: ['echo'] })).toThrow(/mount/);
      expect(() => buildDockerSandboxArgs({ workspaceDir: '/ws', additionalDirs: [path], cwd: '/ws', command: ['echo'] })).toThrow(/mount/);
    });

  it('does not interpret a colon in a POSIX host path as a volume option', () => {
    const args = buildDockerSandboxArgs({ workspaceDir: '/ws:ro', cwd: '/ws:ro', command: ['echo'] });
    expect(args).toContain('type=bind,source=/ws:ro,target=/workspace');
    expect(args).not.toContain('-v');
  });

  it('rejects unmapped cwd and image option injection', () => {
    expect(() => buildDockerSandboxArgs({ workspaceDir: '/ws', cwd: '/outside', command: ['echo'] })).toThrow(/cwd/);
    expect(() => buildDockerSandboxArgs({ workspaceDir: '/ws', cwd: '/ws', image: '--privileged', command: ['echo'] })).toThrow(/image/);
  });

  it.each([parse(process.cwd()).root, homedir()])('rejects symlink aliases to root or home: %s', target => {
    const temp = mkdtempSync(join(tmpdir(), 'kaos-mount-alias-'));
    const alias = join(temp, 'alias');
    try {
      symlinkSync(target, alias, 'junction');
      expect(() => buildDockerSandboxArgs({ workspaceDir: alias, cwd: alias, command: ['echo'] }))
        .toThrow(/filesystem root.*operator home/);
      expect(() => buildDockerSandboxArgs({ workspaceDir: temp, additionalDirs: [alias], cwd: temp, command: ['echo'] }))
        .toThrow(/filesystem root.*operator home/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('mounts a permitted alias using its canonical source while mapping the logical cwd', () => {
    const temp = mkdtempSync(join(tmpdir(), 'kaos-mount-alias-'));
    const target = join(temp, 'actual');
    const alias = join(temp, 'alias');
    try {
      mkdirSync(target);
      symlinkSync(target, alias, 'junction');
      const args = buildDockerSandboxArgs({ workspaceDir: alias, cwd: alias, command: ['echo'] });
      expect(args).toContain(`type=bind,source=${realpathSync(target)},target=/workspace`);
      expect(args).toContain('/workspace');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('rejects the canonical parent of the operator home and standard socket directory aliases', () => {
    const parent = parse(homedir()).dir;
    expect(() => buildDockerSandboxArgs({ workspaceDir: parent, cwd: parent, command: ['echo'] })).toThrow(/operator home/);
    const temp = mkdtempSync(join(tmpdir(), 'kaos-socket-alias-'));
    const alias = join(temp, 'alias');
    try {
      const socketDir = process.platform === 'win32' ? join(homedir(), '.docker', 'run') : '/var/run';
      if (process.platform !== 'win32') {
        symlinkSync(socketDir, alias, 'junction');
        expect(() => buildDockerSandboxArgs({ workspaceDir: alias, cwd: alias, command: ['echo'] })).toThrow(/socket directory/);
      }
      expect(() => buildDockerSandboxArgs({ workspaceDir: socketDir, cwd: socketDir, command: ['echo'] })).toThrow(/socket directory/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it.each(['/run', '/var/run', '/run/user/1000', '/run/user/1000/docker.sock'])(
    'rejects standard and rootless Docker runtime mounts: %s', source => {
      expect(() => buildDockerSandboxArgs({ workspaceDir: source, cwd: source, command: ['echo'] }))
        .toThrow(/socket/);
    });

  it.each([
    join(homedir(), '.docker', 'desktop'), join(homedir(), '.docker', 'desktop', 'docker.sock'),
    join(homedir(), '.rd'), join(homedir(), '.rd', 'docker.sock'),
  ])('rejects common macOS daemon socket mounts: %s', source => {
    expect(() => buildDockerSandboxArgs({ workspaceDir: source, cwd: source, command: ['echo'] })).toThrow(/socket/);
  });

  it.skipIf(process.platform === 'win32')('rejects custom DOCKER_HOST socket ancestors and canonical aliases even before the socket exists', () => {
    const temp = mkdtempSync(join(tmpdir(), 'kaos-custom-daemon-'));
    const runtime = join(temp, 'runtime');
    const alias = join(temp, 'alias');
    const unrelated = join(temp, 'unrelated');
    try {
      mkdirSync(runtime);
      mkdirSync(unrelated);
      symlinkSync(runtime, alias, 'junction');
      vi.stubEnv('DOCKER_HOST', `unix://${join(alias, 'nested', 'custom.sock')}`);
      for (const source of [temp, runtime, alias, join(runtime, 'nested')]) {
        expect(() => buildDockerSandboxArgs({ workspaceDir: source, cwd: source, command: ['echo'] })).toThrow(/socket/);
        expect(() => buildDockerSandboxArgs({ workspaceDir: unrelated, additionalDirs: [source], cwd: unrelated, command: ['echo'] })).toThrow(/socket/);
      }
      expect(() => buildDockerSandboxArgs({ workspaceDir: unrelated, cwd: unrelated, command: ['echo'] })).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it.each(['unix://remote.example.test/socket', 'unix:///tmp/socket?other', 'unix:///tmp/%00socket'])('rejects ambiguous Unix DOCKER_HOST endpoints: %s', endpoint => {
    try {
      vi.stubEnv('DOCKER_HOST', endpoint);
      expect(() => buildDockerSandboxArgs({ workspaceDir: '/ws', cwd: '/ws', command: ['echo'] })).toThrow(/DOCKER_HOST/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('maps a leading literal subdirectory cd without dropping its requested working directory', () => {
    const args = buildDockerSandboxArgs({ workspaceDir: '/tmp/project', cwd: '/tmp/project', command: ['bash', '-c', "cd '/tmp/project/sub' && pwd"] });
    expect(args.at(-1)).toBe("cd '/workspace/sub' && pwd");
  });

  it.each(['cd "$TARGET" && pwd', 'cd sub && pwd', 'cd /outside && pwd', 'cd "$(pwd)" && pwd'])(
    'preserves unknown cd prefixes: %s', script => {
      const args = buildDockerSandboxArgs({ workspaceDir: '/ws', cwd: '/ws', command: ['bash', '-c', script] });
      expect(args.at(-1)).toBe(script);
    });

  it('maps Bash shellQuote apostrophes and both injected and user leading cd', () => {
    const quote = (path: string): string => `'${path.replaceAll("'", "'\\''")}'`;
    const workspace = "/ws/a'b";
    const script = `cd ${quote(workspace)} && cd ${quote(`${workspace}/sub dir`)} && printf '%s' "$PWD"`;
    const args = buildDockerSandboxArgs({ workspaceDir: workspace, cwd: workspace, command: ['bash', '-c', script] });
    expect(args.at(-1)).toBe(`cd '/workspace' && cd '/workspace/sub dir' && printf '%s' "$PWD"`);
  });

  it.each([
    'cd "$TARGET" && pwd', 'cd "/ws/$TARGET" && pwd', 'cd /ws/${TARGET} && pwd',
    'cd /ws/`pwd` && pwd', 'cd /ws/$(pwd) && pwd', 'cd /ws/* && pwd',
    'cd $\'/ws/sub\' && pwd', 'cd "/ws/\\$TARGET" && pwd',
  ])('leaves dynamic user cd intact after mapping the injected prefix: %s', user => {
    const args = buildDockerSandboxArgs({ workspaceDir: '/ws', cwd: '/ws', command: ['bash', '-c', `cd '/ws' && ${user}`] });
    expect(args.at(-1)).toBe(`cd '/workspace' && ${user}`);
  });

  it('preserves shell mode and positional arguments while mapping cwd', () => {
    const args = buildDockerSandboxArgs({ workspaceDir: '/ws', cwd: '/ws', command: ['bash', '-c', 'cd /ws && printf "%s" "$1"', 'shell-name', 'literal argument'] });
    expect(args.slice(-5)).toEqual(['bash', '-c', 'cd \'/workspace\' && printf "%s" "$1"', 'shell-name', 'literal argument']);
  });

  it('maps canonical cwd aliases and rejects a cwd symlink escaping the mounts', () => {
    const temp = mkdtempSync(join(tmpdir(), 'kaos-cwd-alias-'));
    const workspace = join(temp, 'workspace');
    const alias = join(temp, 'alias');
    const outside = join(temp, 'outside');
    try {
      mkdirSync(workspace);
      mkdirSync(outside);
      symlinkSync(workspace, alias, 'junction');
      symlinkSync(outside, join(workspace, 'escape'), 'junction');
      const args = buildDockerSandboxArgs({ workspaceDir: workspace, cwd: alias, command: ['bash', '-c', `cd '${alias}' && pwd`] });
      expect(args[args.indexOf('-w') + 1]).toBe('/workspace');
      expect(args.at(-1)).toBe("cd '/workspace' && pwd");
      expect(() => buildDockerSandboxArgs({ workspaceDir: workspace, cwd: join(workspace, 'escape'), command: ['echo'] })).toThrow(/cwd/);
      expect(() => buildDockerSandboxArgs({ workspaceDir: join(workspace, 'escape', 'missing'), cwd: workspace, command: ['echo'] })).toThrow(/cwd/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
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
    expect(args).toContain('--mount');
    expect(args).not.toContain('-v');
    expect(args).toContain('type=bind,source=/ws,target=/workspace,readonly');
    expect(args).toContain('type=bind,source=/extra,target=/extra0,readonly');
    expect(args).toContain('-w');
    expect(args).toContain('/workspace/src');
    expect(args.at(-1)).toBe("cd '/workspace' && echo hi");
  });

  it.each([
    ["cd '/ws with spaces' && printf hi", "cd '/workspace' && printf hi", '/ws with spaces'],
    ['cd "/ws with spaces" && printf hi', "cd '/workspace' && printf hi", '/ws with spaces'],
    ['  cd\t/ws\t&&\tprintf hi  ', "cd '/workspace' && printf hi  ", '/ws'],
    ["cd '/ws/joined'path && printf hi", "cd '/workspace' && printf hi", '/ws/joinedpath'],
    ['cd /ws &&', 'cd /ws &&'],
    ['cd /ws ; printf hi', 'cd /ws ; printf hi'],
    ['printf hi', 'printf hi'],
    [`cd\t!\t&&\t${'\t'.repeat(20_000)}`, `cd\t!\t&&\t${'\t'.repeat(20_000)}`],
    [`cd /ws ${'\t'.repeat(20_000)} not-an-operator`, `cd /ws ${'\t'.repeat(20_000)} not-an-operator`],
  ])('maps literal cwd prefixes and preserves incomplete shell commands for case %#', (script, expected, cwd = '/ws') => {
    const args = buildDockerSandboxArgs({ workspaceDir: cwd, cwd, command: ['bash', '-c', script] });
    expect(args.at(-1)).toBe(expected);
  });

  it('resolves docker when probe succeeds', async () => {
    await expect(resolveProcessSandboxBackend({ probeDocker: async () => true }))
      .resolves.toEqual({ backend: 'docker' });
  });

  it.each(['linux', 'darwin', 'win32'] as const)('rejects missing Docker on %s', async (platform) => {
    await expect(resolveProcessSandboxBackend({ platform, probeDocker: async () => false }))
      .rejects.toThrow(/Docker is unavailable/);
  });

  it('rejects probe failures rather than selecting host execution', async () => {
    await expect(resolveProcessSandboxBackend({ probeDocker: async () => { throw new Error('probe failed'); } }))
      .rejects.toThrow(/Docker is unavailable/);
  });

  it('rejects a noProcess conflict without probing', async () => {
    let probed = false;
    await expect(resolveProcessSandboxBackend({ noProcess: true, probeDocker: async () => { probed = true; return true; } }))
      .rejects.toThrow(/conflicts with --no-process-sandbox/);
    expect(probed).toBe(false);
  });

  it('hardens Docker and does not forward environment variables', () => {
    const args = buildDockerSandboxArgs({ workspaceDir: '/ws', cwd: '/ws', command: ['echo', 'hi'] });
    expect(args).toEqual(expect.arrayContaining([
      '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges:true',
      '--read-only', '--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777',
      '--memory=1024m', '--memory-swap=1024m', '--cpus=2', '--pids-limit=256',
    ]));
    const user = args.find(arg => arg.startsWith('--user='));
    expect(user).toMatch(/^--user=[1-9]\d*:[1-9]\d*$/);
    expect(args.some(arg => /^(?:-e$|--env(?:=|$)|--env-file(?:=|$))/.test(arg))).toBe(false);
  });

  it('passes configured resource limits through the wrapper', () => {
    const wrapped = wrapLocalExecForProcessSandbox({
      file: 'echo', args: ['hi'], cwd: '/ws',
      config: { backend: 'docker', workspaceDir: '/ws', resources: { memoryMb: 512, cpus: 0.5, pidsLimit: 64 } },
    });
    expect(wrapped.args).toEqual(expect.arrayContaining([
      '--memory=512m', '--memory-swap=512m', '--cpus=0.5', '--pids-limit=64',
    ]));
  });

  it.each([
    { memoryMb: 0 }, { memoryMb: -1 }, { memoryMb: 1.5 },
    { cpus: Number.NaN }, { cpus: Number.POSITIVE_INFINITY }, { cpus: 0 },
    { pidsLimit: -1 }, { pidsLimit: 1.5 },
  ])('rejects invalid resource limits %j', resources => {
    expect(() => buildDockerSandboxArgs({ workspaceDir: '/ws', cwd: '/ws', command: ['echo'], resources }))
      .toThrow(/Invalid Docker sandbox/);
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
