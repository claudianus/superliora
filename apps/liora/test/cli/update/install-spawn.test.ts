import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  canAutoInstall,
  installCommandFor,
  spawnForSource,
} from '#/cli/update/install-spawn';

describe('installCommandFor', () => {
  it('builds npm global install command', () => {
    expect(installCommandFor('npm-global', '1.2.3', 'darwin')).toBe(
      'npm install -g @superliora/liora@1.2.3',
    );
  });

  it('falls back to npm for unsupported sources', () => {
    expect(installCommandFor('unsupported', '1.2.3', 'darwin')).toBe(
      'npm install -g @superliora/liora@1.2.3',
    );
  });
});

describe('canAutoInstall', () => {
  it('allows package managers on all platforms', () => {
    expect(canAutoInstall('npm-global', 'darwin')).toBe(true);
    expect(canAutoInstall('pnpm-global', 'win32')).toBe(true);
  });

  it('blocks homebrew auto-install', () => {
    expect(canAutoInstall('homebrew', 'darwin')).toBe(false);
  });

  it('allows native auto-install on Windows via install.ps1', () => {
    expect(canAutoInstall('native', 'win32')).toBe(true);
    expect(canAutoInstall('github-checkout', 'win32')).toBe(false);
  });

  it('allows native and github-checkout on Unix', () => {
    expect(canAutoInstall('native', 'darwin')).toBe(true);
    expect(canAutoInstall('github-checkout', 'linux')).toBe(true);
  });

  it('spawns powershell for native installs on Windows', () => {
    const { cmd, args } = spawnForSource('native', '0.5.0', 'win32');
    expect(cmd).toBe('powershell');
    expect(args.join(' ')).toContain('install.ps1');
  });
});


describe('spawnForSource native', () => {
  it.skipIf(process.platform === 'win32')(
    'surfaces a failed curl download as a non-zero exit',
    () => {
      const { cmd, args } = spawnForSource('native', '0.5.0', 'darwin');
      const script = `curl() { return 7; }\n${args[1] ?? ''}`;
      const result = spawnSync(cmd, [args[0] ?? '-c', script], { encoding: 'utf8' });
      expect(result.error).toBeUndefined();
      expect(result.status).toBeGreaterThan(0);
    },
  );
});

describe('github-checkout update commands', () => {
  it('uses install.sh-aligned fetch, build, and wrapper refresh for manual commands', () => {
    const command = installCommandFor('github-checkout', 'origin/main@abcdef123456', 'darwin');

    expect(command).toContain('bash -lc');
    expect(command).toContain('fetch --depth 1 origin');
    expect(command).toContain('install --frozen-lockfile');
    expect(command).toContain('run build:packages');
    expect(command).toContain('apps/liora run build');
    expect(command).toContain('retrieval:bootstrap');
    expect(command).toContain('scripts/install-liora.mjs');
  });

  it('uses bash -lc for the auto-install script', () => {
    const { cmd, args } = spawnForSource('github-checkout', 'origin/main@abcdef123456', 'darwin');

    expect(cmd).toBe('bash');
    expect(args[0]).toBe('-lc');
    expect(args[1]).toContain('fetch --depth 1 origin');
    expect(args[1]).toContain('install --frozen-lockfile');
    expect(args[1]).toContain('run build:packages');
    expect(args[1]).toContain('apps/liora run build');
    expect(args[1]).toContain('retrieval:bootstrap');
    expect(args[1]).toContain('scripts/install-liora.mjs');
  });
});

describe('fromMain native install', () => {
  it('passes --main on Unix', () => {
    const command = installCommandFor('native', 'origin/main', 'darwin', { fromMain: true });
    expect(command).toContain('--main');
    const { args } = spawnForSource('native', 'origin/main', 'darwin', { fromMain: true });
    expect(args.join(' ')).toContain('--main');
  });

  it('sets SUPERLIORA_FROM_MAIN on Windows', () => {
    const command = installCommandFor('native', 'origin/main', 'win32', { fromMain: true });
    expect(command).toContain("SUPERLIORA_FROM_MAIN='1'");
  });

  it('pins github-checkout scripts to origin/main', () => {
    const { args } = spawnForSource('github-checkout', 'origin/main@abcdef', 'darwin', {
      fromMain: true,
      checkoutRoot: '/tmp/superliora',
    });
    expect(args[1]).toContain("upstream='origin/main'");
    expect(args[1]).toContain('/tmp/superliora');
  });
});

describe('spawnForSource package managers', () => {
  it('uses .cmd suffix on Windows', () => {
    const { cmd, args } = spawnForSource('npm-global', '0.5.0', 'win32');
    expect(cmd).toBe('npm.cmd');
    expect(args).toEqual(['install', '-g', '@superliora/liora@0.5.0']);
  });

  it('throws for unsupported auto-install sources', () => {
    expect(() => spawnForSource('unsupported', '0.5.0', 'darwin')).toThrow(
      'unsupported install source cannot be auto-installed',
    );
  });
});
