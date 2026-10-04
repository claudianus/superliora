import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { lstatSync, readdirSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildDockerSandboxArgs,
  mapHostCwdToContainer,
  preflightProcessSandboxMounts,
  resolveProcessSandboxBackend,
  wrapLocalExecForProcessSandbox,
} from '#/process-sandbox';

// setup.ts imports LocalKaos (and this module) before the test's mocks.
vi.hoisted(() => vi.resetModules());

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFileSync: vi.fn(),
}));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readdirSync: vi.fn(actual.readdirSync), lstatSync: vi.fn(actual.lstatSync) };
});
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readdir: vi.fn(actual.readdir) };
});

/** Minimal Dirent stand-in for mocked listings. */
function dirent(name: string, kind: 'file' | 'unknown' = 'file') {
  const no = () => false;
  return { name, isFile: () => kind === 'file', isDirectory: no, isSymbolicLink: no, isSocket: no, isFIFO: no, isCharacterDevice: no, isBlockDevice: no };
}

// kaos shares its module graph between files; do not leak mocked builtins.
afterAll(() => {
  vi.doUnmock('node:child_process');
  vi.doUnmock('node:fs');
  vi.doUnmock('node:fs/promises');
  vi.resetModules();
});

function contextOutput(endpoint = 'unix:///outside-sandbox/daemon.sock'): string {
  return JSON.stringify([{ Endpoints: { docker: { Host: endpoint } } }]);
}

beforeEach(() => {
  vi.stubEnv('DOCKER_HOST', '');
  vi.stubEnv('DOCKER_CONTEXT', '');
  vi.mocked(execFileSync).mockReturnValue(contextOutput());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

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

  it.skipIf(process.platform === 'win32')('rejects nested custom sockets from the current context with DOCKER_HOST unset, including extra mounts and aliases', () => {
    vi.stubEnv('DOCKER_HOST', undefined);
    const temp = mkdtempSync(join(tmpdir(), 'kaos-context-'));
    const runtime = join(temp, 'runtime');
    const unrelated = join(temp, 'unrelated');
    const alias = join(temp, 'alias');
    try {
      mkdirSync(runtime);
      mkdirSync(unrelated);
      symlinkSync(runtime, alias, 'junction');
      vi.mocked(execFileSync).mockReturnValue(contextOutput(`unix://${join(alias, 'deep', 'custom.sock')}`));
      for (const source of [temp, runtime, alias, join(runtime, 'deep')]) {
        expect(() => buildDockerSandboxArgs({ workspaceDir: source, cwd: source, command: ['echo'] })).toThrow(/socket/);
        expect(() => buildDockerSandboxArgs({ workspaceDir: unrelated, additionalDirs: [source], cwd: unrelated, readOnly: true, command: ['echo'] })).toThrow(/socket/);
      }
      expect(buildDockerSandboxArgs({ workspaceDir: unrelated, cwd: unrelated, command: ['echo'] }).slice(0, 4))
        .toEqual(['docker', '--host', `unix://${join(realpathSync(runtime), 'deep', 'custom.sock')}`, 'run']);
      expect(execFileSync).toHaveBeenCalledWith('docker', ['context', 'inspect'], expect.objectContaining({ timeout: 2500, maxBuffer: 65536 }));
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('honors DOCKER_CONTEXT over DOCKER_HOST and inspects with the configured binary', () => {
    vi.stubEnv('DOCKER_CONTEXT', 'custom');
    vi.stubEnv('DOCKER_HOST', 'unix:///ws/nested/host.sock');
    const args = buildDockerSandboxArgs({ workspaceDir: '/ws', cwd: '/ws', command: ['echo'], dockerBin: 'custom-docker' });
    expect(args.slice(0, 4)).toEqual(['custom-docker', '--host', 'unix:///outside-sandbox/daemon.sock', 'run']);
    expect(execFileSync).toHaveBeenCalledWith('custom-docker', ['context', 'inspect', 'custom'], expect.any(Object));
    vi.mocked(execFileSync).mockReturnValue(contextOutput('unix:///ws/deep/context.sock'));
    expect(() => buildDockerSandboxArgs({ workspaceDir: '/ws', cwd: '/ws', command: ['echo'] })).toThrow(/socket/);
  });

  it('uses explicit DOCKER_HOST without context inspection and does not cache current context', () => {
    vi.stubEnv('DOCKER_HOST', 'unix:///elsewhere/custom.sock');
    expect(buildDockerSandboxArgs({ workspaceDir: '/ws', cwd: '/ws', command: ['echo'] }).slice(0, 3))
      .toEqual(['docker', '--host', 'unix:///elsewhere/custom.sock']);
    expect(execFileSync).not.toHaveBeenCalled();
    vi.stubEnv('DOCKER_HOST', undefined);
    buildDockerSandboxArgs({ workspaceDir: '/ws', cwd: '/ws', command: ['echo'] });
    vi.mocked(execFileSync).mockReturnValue(contextOutput('unix:///ws/new.sock'));
    expect(() => buildDockerSandboxArgs({ workspaceDir: '/ws', cwd: '/ws', command: ['echo'] })).toThrow(/socket/);
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  it('validates the effective invocation host, not a safe ambient host', () => {
    vi.stubEnv('DOCKER_HOST', 'unix:///outside-sandbox/ambient.sock');
    expect(() => buildDockerSandboxArgs({
      workspaceDir: '/ws', cwd: '/ws', command: ['echo'],
      env: { DOCKER_HOST: 'unix:///ws/deep/invocation.sock' },
    })).toThrow(/socket/);
    expect(() => wrapLocalExecForProcessSandbox({
      file: 'echo', args: [], cwd: '/ws', config: { backend: 'docker', workspaceDir: '/ws' },
      env: { DOCKER_HOST: 'unix:///ws/deep/invocation.sock' },
    })).toThrow(/socket/);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('inspects the effective context/config env then strips context only from Docker run env', () => {
    vi.stubEnv('DOCKER_CONTEXT', 'wrong-ambient-context');
    vi.stubEnv('DOCKER_HOST', 'unix:///ws/ambient.sock');
    const env = {
      DOCKER_CONTEXT: 'invocation-context', DOCKER_HOST: 'unix:///ws/ignored-host.sock',
      DOCKER_CONFIG: '/custom/config', PATH: '/custom/path', KEEP: 'unchanged',
    };
    const wrapped = wrapLocalExecForProcessSandbox({
      file: 'echo', args: [], cwd: '/ws', config: { backend: 'docker', workspaceDir: '/ws' }, env,
    });
    expect(execFileSync).toHaveBeenCalledWith('docker', ['context', 'inspect', 'invocation-context'], expect.objectContaining({ env }));
    expect(wrapped.args.slice(0, 3)).toEqual(['--host', 'unix:///outside-sandbox/daemon.sock', 'run']);
    expect(wrapped.env).toEqual({
      DOCKER_HOST: env.DOCKER_HOST, DOCKER_CONFIG: env.DOCKER_CONFIG, PATH: env.PATH, KEEP: env.KEEP,
    });
    expect(env.DOCKER_CONTEXT).toBe('invocation-context');
    expect(process.env['DOCKER_CONTEXT']).toBe('wrong-ambient-context');
    vi.mocked(execFileSync).mockReturnValue(contextOutput('unix:///ws/deep/context.sock'));
    expect(() => wrapLocalExecForProcessSandbox({
      file: 'echo', args: [], cwd: '/ws', config: { backend: 'docker', workspaceDir: '/ws' }, env,
    })).toThrow(/socket/);
  });

  it('preserves literal context names for inspection rather than silently trimming them', () => {
    buildDockerSandboxArgs({ workspaceDir: '/ws', cwd: '/ws', command: ['echo'], env: { DOCKER_CONTEXT: ' custom ' } });
    expect(execFileSync).toHaveBeenCalledWith('docker', ['context', 'inspect', ' custom '], expect.objectContaining({ env: { DOCKER_CONTEXT: ' custom ' } }));
  });

  it('treats an explicit empty environment as complete, rather than inheriting ambient Docker selection', () => {
    vi.stubEnv('DOCKER_HOST', 'unix:///ws/ambient.sock');
    vi.stubEnv('DOCKER_CONTEXT', 'ambient-context');
    const wrapped = wrapLocalExecForProcessSandbox({
      file: 'echo', args: [], cwd: '/ws', config: { backend: 'docker', workspaceDir: '/ws' }, env: {},
    });
    expect(execFileSync).toHaveBeenCalledWith('docker', ['context', 'inspect'], expect.objectContaining({ env: {} }));
    expect(wrapped.env).toEqual({});
    expect(wrapped.args.slice(0, 3)).toEqual(['--host', 'unix:///outside-sandbox/daemon.sock', 'run']);
  });

  it('does not change job or unsandboxed environment handling', () => {
    const env = { DOCKER_CONTEXT: 'keep', KEEP: 'unchanged' };
    for (const config of [undefined, { backend: 'job' as const, workspaceDir: '/ws' }]) {
      const wrapped = wrapLocalExecForProcessSandbox({ file: 'echo', args: ['hello'], cwd: '/ws', config, env });
      expect(wrapped.file).toBe('echo');
      expect(wrapped.args).toEqual(['hello']);
      expect(wrapped.env).toBeUndefined();
    }
    expect(env).toEqual({ DOCKER_CONTEXT: 'keep', KEEP: 'unchanged' });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it.each(['not JSON', '[]', '[{}, {}]', '{}', '[{}]', contextOutput(''), contextOutput('tcp://example.test:2375'),
    contextOutput('ssh://example.test'), contextOutput('unix://example.test/socket'), contextOutput('unix:///tmp/socket?query'),
    contextOutput('unix:///tmp/%00socket'), contextOutput('unix:///tmp/%3Fsocket')])('fails closed on unusable context output: %s', output => {
    vi.mocked(execFileSync).mockReturnValue(output);
    expect(() => wrapLocalExecForProcessSandbox({ file: 'echo', args: [], cwd: '/ws', config: { backend: 'docker', workspaceDir: '/ws' } }))
      .toThrow(/Docker sandbox cannot/);
  });

  it.each(['ENOENT', 'ETIMEDOUT', 'ENOBUFS', 'EACCES'])('fails closed on context inspection errors: %s', code => {
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw Object.assign(new Error('inspection failed'), { code }); });
    expect(() => buildDockerSandboxArgs({ workspaceDir: '/ws', cwd: '/ws', command: ['echo'] })).toThrow(/cannot inspect the effective Docker context/);
  });

  it.skipIf(process.platform === 'win32')('rejects actual nested Unix sockets and socket symlinks even in read-only mounts', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'kaos-scan-'));
    const workspace = join(temp, 'project');
    const nested = join(workspace, 'deep');
    const aliasDir = join(temp, 'aliases');
    mkdirSync(nested, { recursive: true });
    mkdirSync(aliasDir);
    const socket = join(nested, 'not-docker.sock');
    const server = createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socket, resolve);
      });
      symlinkSync(socket, join(aliasDir, 'innocent-name'));
      for (const source of [workspace, aliasDir]) {
        expect(() => buildDockerSandboxArgs({ workspaceDir: source, cwd: source, readOnly: true, command: ['echo'] })).toThrow(/socket/);
        expect(() => buildDockerSandboxArgs({ workspaceDir: '/ws', additionalDirs: [source], cwd: '/ws', command: ['echo'] })).toThrow(/socket/);
      }
    } finally {
      if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('accepts a socket-free nested tree, dangling links and directory symlink loops', () => {
    const temp = mkdtempSync(join(tmpdir(), 'kaos-safe-tree-'));
    try {
      mkdirSync(join(temp, 'nested', 'deep'), { recursive: true });
      symlinkSync(temp, join(temp, 'nested', 'loop'), 'junction');
      symlinkSync(join(temp, 'missing'), join(temp, 'dangling'), 'junction');
      expect(buildDockerSandboxArgs({ workspaceDir: temp, cwd: join(temp, 'nested'), readOnly: true, command: ['echo'] }))
        .toContain(`type=bind,source=${realpathSync(temp)},target=/workspace,readonly`);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('fails closed on unreadable trees, disappearing entries and the scan entry budget', () => {
    const temp = mkdtempSync(join(tmpdir(), 'kaos-scan-error-'));
    try {
      for (const code of ['EACCES', 'EIO', 'ENOENT']) {
        vi.mocked(readdirSync).mockImplementationOnce(() => { throw Object.assign(new Error('cannot scan'), { code }); });
        expect(() => buildDockerSandboxArgs({ workspaceDir: temp, cwd: temp, command: ['echo'] })).toThrow(/socket scan failure/);
      }
      // An entry readdir cannot type is lstat'ed; one that vanished fails closed.
      vi.mocked(readdirSync).mockReturnValueOnce([dirent('disappeared', 'unknown')] as never);
      expect(() => buildDockerSandboxArgs({ workspaceDir: temp, cwd: temp, command: ['echo'] })).toThrow(/socket scan failure/);
      // Repeated existing file names exercise the budget without a huge disk fixture.
      vi.mocked(readdirSync).mockReturnValueOnce(Array.from({ length: 100_001 }, () => dirent('entry')) as never);
      expect(() => buildDockerSandboxArgs({ workspaceDir: temp, cwd: temp, command: ['echo'] })).toThrow(/socket scan failure/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  describe('socket scan listing cache', () => {
    let clock = 0;
    beforeEach(() => {
      clock = 1_000_000;
      vi.spyOn(performance, 'now').mockImplementation(() => clock);
    });
    afterEach(() => { vi.mocked(performance.now).mockRestore(); });
    const build = (workspaceDir: string) => buildDockerSandboxArgs({ workspaceDir, cwd: workspaceDir, readOnly: true, command: ['echo'] });
    // Two identical listings far enough apart confirm a directory's listing.
    const buildConfirmed = (workspaceDir: string) => { build(workspaceDir); clock += 3_000; build(workspaceDir); clock += 1_000; };

    it.skipIf(process.platform === 'win32')('re-reads only changed directories and still rejects a socket created after a cached scan', async () => {
      const temp = mkdtempSync(join(tmpdir(), 'kaos-scan-cache-'));
      const server = createServer();
      try {
        mkdirSync(join(temp, 'a', 'deep'), { recursive: true });
        mkdirSync(join(temp, 'b'));
        buildConfirmed(temp);
        vi.mocked(readdirSync).mockClear();
        build(temp);
        expect(readdirSync).not.toHaveBeenCalled();
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(join(temp, 'a', 'deep', 'late.sock'), resolve);
        });
        expect(() => build(temp)).toThrow(/socket/);
        // Only the directory whose entries changed was listed again.
        expect(vi.mocked(readdirSync).mock.calls.map(call => call[0])).toEqual([join(realpathSync(temp), 'a', 'deep')]);
      } finally {
        if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
        rmSync(temp, { recursive: true, force: true });
      }
    });

    it('does not trust a listing until a much later listing agrees', () => {
      const temp = mkdtempSync(join(tmpdir(), 'kaos-scan-confirm-'));
      try {
        build(temp);
        clock += 1_000; // Within one coarse timestamp tick: must re-read.
        vi.mocked(readdirSync).mockClear();
        build(temp);
        expect(readdirSync).toHaveBeenCalledTimes(1);
        clock += 3_000;
        build(temp);
        vi.mocked(readdirSync).mockClear();
        build(temp);
        expect(readdirSync).not.toHaveBeenCalled();
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    });

    it.skipIf(process.platform === 'win32')('re-resolves symlinks on every exec even when their directory listing is cached', async () => {
      const temp = mkdtempSync(join(tmpdir(), 'kaos-scan-link-'));
      const outside = mkdtempSync(join(tmpdir(), 'kaos-scan-outside-'));
      const server = createServer();
      try {
        const workspace = join(temp, 'ws');
        mkdirSync(workspace);
        const target = join(outside, 'later.sock');
        symlinkSync(target, join(workspace, 'link'));
        buildConfirmed(workspace);
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(target, resolve);
        });
        expect(() => build(workspace)).toThrow(/socket/);
      } finally {
        if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
        rmSync(temp, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it('classifies a cached subdirectory that changed type while its parent listing is reused', async () => {
      const temp = mkdtempSync(join(tmpdir(), 'kaos-scan-swap-'));
      try {
        mkdirSync(join(temp, 'swap'));
        buildConfirmed(temp);
        const child = join(realpathSync(temp), 'swap');
        const { lstatSync: realLstat } = await vi.importActual<typeof import('node:fs')>('node:fs');
        // A same-tick swap leaves the parent's timestamps (and confirmed listing) intact.
        const swapped = (kind: 'file' | 'socket') => (path: unknown, ...rest: unknown[]) => path === child
          ? { isDirectory: () => false, isSocket: () => kind === 'socket', isSymbolicLink: () => false }
          : (realLstat as (...args: unknown[]) => unknown)(path, ...rest);
        vi.mocked(lstatSync).mockImplementation(swapped('file') as never);
        vi.mocked(readdirSync).mockClear();
        expect(build(temp)).toContain(`type=bind,source=${realpathSync(temp)},target=/workspace,readonly`);
        expect(readdirSync).not.toHaveBeenCalled();
        vi.mocked(lstatSync).mockImplementation(swapped('socket') as never);
        expect(() => build(temp)).toThrow(/socket/);
      } finally {
        vi.mocked(lstatSync).mockReset();
        const { lstatSync: realLstat } = await vi.importActual<typeof import('node:fs')>('node:fs');
        vi.mocked(lstatSync).mockImplementation(realLstat as never);
        rmSync(temp, { recursive: true, force: true });
      }
    });

    it('lets this exec reuse its own preflight listing of a tree beyond the synchronous budget', async () => {
      const temp = mkdtempSync(join(tmpdir(), 'kaos-scan-preflight-'));
      try {
        const { readdir } = await import('node:fs/promises');
        const many = Array.from({ length: 100_001 }, (_, index) => dirent(`file-${String(index)}`));
        vi.mocked(readdirSync).mockReturnValueOnce(many as never);
        expect(() => build(temp)).toThrow(/socket scan failure/);
        const config = { backend: 'docker' as const, workspaceDir: temp, readOnly: true };
        vi.mocked(readdir).mockResolvedValueOnce(many as never);
        const preflight = await preflightProcessSandboxMounts(config);
        vi.mocked(readdirSync).mockClear();
        const wrapped = wrapLocalExecForProcessSandbox({ file: 'echo', args: [], cwd: temp, config, preflight });
        expect(wrapped.args).toContain(`type=bind,source=${realpathSync(temp)},target=/workspace,readonly`);
        expect(readdirSync).not.toHaveBeenCalled();
        // A token is single-use, and without this exec's preflight the unconfirmed listing is not reused.
        vi.mocked(readdirSync).mockReturnValueOnce(many as never);
        expect(() => wrapLocalExecForProcessSandbox({ file: 'echo', args: [], cwd: temp, config, preflight })).toThrow(/socket scan failure/);
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    });
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
    ['cd /ws&& printf hi', "cd '/workspace' && printf hi"],
    ['cd /ws&&printf hi', "cd '/workspace' && printf hi"],
    ['cd /ws &&', 'cd /ws &&'],
    ['cd /ws&&', 'cd /ws&&'],
    ['cd &&printf hi', 'cd &&printf hi'],
    ['cd /ws& printf hi', 'cd /ws& printf hi'],
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

  it.skipIf(process.platform === 'win32')('maps a root host to the non-root workspace owner, never to root', () => {
    const temp = mkdtempSync(join(tmpdir(), 'kaos-root-owner-'));
    const getuid = vi.spyOn(process, 'getuid').mockReturnValue(0);
    const getgid = vi.spyOn(process, 'getgid').mockReturnValue(0);
    try {
      const owner = statSync(temp);
      const expected = owner.uid > 0
        ? `--user=${String(owner.uid)}:${String(owner.gid > 0 ? owner.gid : 1000)}`
        : '--user=1000:1000';
      expect(buildDockerSandboxArgs({ workspaceDir: temp, cwd: temp, command: ['echo'] })).toContain(expected);
      // Missing workspace: unprivileged default, not root.
      const missing = join(temp, 'missing');
      expect(buildDockerSandboxArgs({ workspaceDir: missing, cwd: missing, command: ['echo'] })).toContain('--user=1000:1000');
    } finally {
      getuid.mockRestore();
      getgid.mockRestore();
      rmSync(temp, { recursive: true, force: true });
    }
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
    expect(docker.args.slice(0, 3)).toEqual(['--host', 'unix:///outside-sandbox/daemon.sock', 'run']);

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
