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
const windowsCmdInstallScript = resolve(repoRoot, 'install.cmd');
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
    // Managed installs must not force-disable auto-update; tui.toml owns that.
    expect(wrapper).not.toMatch(/SUPERLIORA_NO_AUTO_UPDATE=.*:-1/);
    expect(wrapper).not.toContain('SUPERLIORA_NO_AUTO_UPDATE="${SUPERLIORA_NO_AUTO_UPDATE:-1}"');

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
    expect(sh).toContain('scripts/install-superliora.mjs');
    expect(ps1).toContain('scripts/install-superliora.mjs');
    expect(sh).toContain('manifest.json');
    expect(ps1).toContain('manifest.json');
    expect(sh).toContain('--prefer-source');
    expect(sh).toContain('--main');
    expect(ps1).toContain('PreferSource');
    expect(ps1).toContain('--main');
    expect(ps1).toContain('NoShellRc');
    expect(ps1).toContain('$PSScriptRoot');
    expect(ps1).not.toContain('$MyInvocation.MyCommand.Path');
    expect(ps1).not.toMatch(/^param\s*\(/m);
    expect(ps1).toMatch(/&\s*\{/);
    expect(ps1).toContain('} @args');
    expect(ps1).toContain('Invoke-WebRequest -UseBasicParsing');
    expect(ps1).toContain('SUPERLIORA_NO_SHELL_RC');
    expect(ps1).toContain('SUPERLIORA_INSTALL_DUMP');
    expect(ps1).toContain('Add-SessionPath');
    expect(ps1).toContain('Add-SessionGitRuntime');
    expect(ps1).toContain('LIORA_SHELL_PATH');
    const cmd = await readFile(windowsCmdInstallScript, 'utf-8');
    expect(cmd).toContain('install.ps1');
    expect(cmd).toContain('cmd.exe');
    expect(cmd).toMatch(/powershell/i);
    expect(sh).toContain('spawn.mjs');
    expect(sh).toContain('wrappers.mjs');
    expect(sh).toContain('ensure-git.mjs');
    expect(sh).toContain('ensure-pnpm.mjs');
    expect(sh).toContain('ensure-terminal.mjs');
    expect(sh).toContain('ensure-winget.mjs');
    expect(sh).toContain('ensure-nerd-font.mjs');
    expect(sh).toContain('ensure-oh-my-posh.mjs');
    expect(sh).toContain('ensure-shell-vibe.mjs');
    expect(sh).toContain('host-setup.mjs');
    expect(sh).toContain('host-path.mjs');
    expect(sh).toContain('--no-git');
    expect(sh).toContain('--no-terminal');
    expect(sh).toContain('--no-host-setup');
    expect(ps1).toContain('spawn.mjs');
    expect(ps1).toContain('wrappers.mjs');
    expect(ps1).toContain('ensure-git.mjs');
    expect(ps1).toContain('ensure-pnpm.mjs');
    expect(ps1).toContain('ensure-terminal.mjs');
    expect(ps1).toContain('ensure-winget.mjs');
    expect(ps1).toContain('ensure-nerd-font.mjs');
    expect(ps1).toContain('ensure-oh-my-posh.mjs');
    expect(ps1).toContain('ensure-shell-vibe.mjs');
    expect(ps1).toContain('host-setup.mjs');
    expect(ps1).toContain('host-path.mjs');
    expect(ps1).toContain('Add-SessionPnpmRuntime');
    expect(ps1).toContain('NoGit');
    expect(ps1).toContain('NoTerminal');
    expect(ps1).toContain('NoHostSetup');
    const orch = await readFile(resolve(repoRoot, 'scripts/install-superliora.mjs'), 'utf-8');
    expect(orch).toContain("SUPERLIORA_NO_SHELL_RC === '1'");
    expect(orch).toContain('Git bootstrap failed');
    expect(orch).toContain('ensurePnpm');
    expect(orch).toContain('Ensuring pnpm');
    expect(sh).toContain('SUPERLIORA_NO_SHELL_RC');
  });

  it('keeps install.ps1 and install.cmd ASCII so Windows PowerShell 5.1 parses them on any code page', async () => {
    for (const path of [windowsSourceInstallScript, windowsCmdInstallScript]) {
      const buf = await readFile(path);
      const nonAscii = [...buf].findIndex((byte) => byte > 127);
      expect(nonAscii, path).toBe(-1);
    }
  });

  it('has valid bash syntax for the POSIX source installer when bash is available', async () => {
    try {
      const result = await execFileAsync('bash', ['-n', posixSourceInstallScript], { cwd: repoRoot });
      expect(result.stderr).toBe('');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        expect(process.platform).toBe('win32');
        return;
      }
      throw error;
    }
  });
});
