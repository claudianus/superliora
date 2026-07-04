import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '../../../..');
const installScript = resolve(repoRoot, 'scripts/install-liora.mjs');
const posixSourceInstallScript = resolve(repoRoot, 'install.sh');
const windowsSourceInstallScript = resolve(repoRoot, 'install.ps1');
const tempHomes: string[] = [];

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'liora-install-home-'));
  tempHomes.push(home);
  return home;
}

async function runInstall(home: string, args: readonly string[] = []): Promise<void> {
  await execFileAsync(process.execPath, [installScript, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
    },
  });
}

describe('scripts/install-liora.mjs', () => {
  afterEach(async () => {
    await Promise.all(tempHomes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
  });

  it.skipIf(process.platform === 'win32')('installs liora and updates bash, zsh, and fish startup files idempotently', async () => {
    const home = await makeHome();

    await runInstall(home, ['--bin-dir', '~/local-bin']);
    await runInstall(home, ['--bin-dir', '~/local-bin']);

    const wrapper = await readFile(join(home, 'local-bin/liora'), 'utf-8');
    expect(wrapper).toContain('Managed by superliora scripts/install-liora.mjs');
    expect(wrapper).toContain('dist/main.mjs');
    expect(wrapper).toContain('pnpm -C "$app_root" run dev:cli-only');

    for (const file of ['.zshrc', '.bashrc', '.profile']) {
      const text = await readFile(join(home, file), 'utf-8');
      expect(text.match(/# >>> liora PATH >>>/g)).toHaveLength(1);
      expect(text).toContain('liora_bin_dir="$HOME/local-bin"');
      expect(text).toContain('export PATH="$liora_bin_dir:$PATH"');
    }

    const fish = await readFile(join(home, '.config/fish/config.fish'), 'utf-8');
    expect(fish.match(/# >>> liora PATH >>>/g)).toHaveLength(1);
    expect(fish).toContain('set -l liora_bin_dir "$HOME/local-bin"');
    expect(fish).toContain('fish_add_path $liora_bin_dir');
  });

  it.skipIf(process.platform === 'win32')('does not replace an unmanaged command unless forced', async () => {
    const home = await makeHome();
    await writeFile(join(home, 'liora'), 'user file\n');

    await expect(runInstall(home, ['--bin-dir', home])).rejects.toThrow(/already exists/);

    await runInstall(home, ['--bin-dir', home, '--force', '--no-shell-rc']);

    const wrapper = await readFile(join(home, 'liora'), 'utf-8');
    expect(wrapper).toContain('Managed by superliora scripts/install-liora.mjs');
  });

  it('keeps source install entrypoints on the SuperLiora GitHub repository', async () => {
    const sh = await readFile(posixSourceInstallScript, 'utf-8');
    const ps1 = await readFile(windowsSourceInstallScript, 'utf-8');

    expect(sh).toContain('https://github.com/claudianus/superliora.git');
    expect(ps1).toContain('https://github.com/claudianus/superliora.git');
    expect(sh).not.toContain('code.kimi.com/kimi-code');
    expect(ps1).not.toContain('code.kimi.com/kimi-code');
    expect(sh).toContain('scripts/install-liora.mjs');
    expect(ps1).toContain('[Environment]::SetEnvironmentVariable');
  });

  it.skipIf(process.platform === 'win32')('has valid bash syntax for the POSIX source installer', async () => {
    const result = await execFileAsync('bash', ['-n', posixSourceInstallScript], { cwd: repoRoot });
    expect(result.stderr).toBe('');
  });
});
