import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyUserPathWin,
  ensureBinOnPath,
  readUserEnvWin,
  writeUserEnvWin,
} from '../../../../scripts/install/path.mjs';
import { spawnInstall, spawnOutputText } from '../../../../scripts/install/spawn.mjs';
import { WRAPPER_MARKER } from '../../../../scripts/install/wrappers.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '../../../..');
const installScript = resolve(repoRoot, 'scripts/install-liora.mjs');
const windowsSourceInstallScript = resolve(repoRoot, 'install.ps1');
const packageJsonPath = resolve(repoRoot, 'apps/liora/package.json');
const tempDirs: string[] = [];

async function makeDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('Windows install wrappers and spawn', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('writes liora.cmd and liora.ps1 from the shipped installer', async () => {
    const binDir = await makeDir('liora-win-bin-');
    await execFileAsync(process.execPath, [
      installScript,
      '--bin-dir',
      binDir,
      '--windows',
      '--no-shell-rc',
    ], { cwd: repoRoot });

    const cmd = await readFile(join(binDir, 'liora.cmd'), 'utf-8');
    const ps1 = await readFile(join(binDir, 'liora.ps1'), 'utf-8');
    expect(cmd).toContain(WRAPPER_MARKER);
    expect(cmd).toMatch(/dist[/\\]main\.mjs/);
    expect(cmd).toContain('dev:cli-only');
    expect(ps1).toContain(WRAPPER_MARKER);
    expect(ps1).toMatch(/dist[/\\]main\.mjs/);
  });

  it.skipIf(process.platform !== 'win32')('spawns the produced liora.cmd --version', async () => {
    const binDir = await makeDir('liora-win-spawn-');
    await execFileAsync(process.execPath, [
      installScript,
      '--bin-dir',
      binDir,
      '--windows',
      '--no-shell-rc',
    ], { cwd: repoRoot });

    const cmdPath = join(binDir, 'liora.cmd');
    const pkg = JSON.parse(await readFile(packageJsonPath, 'utf-8')) as { version: string };
    const result = spawnInstall(cmdPath, ['--version'], {
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, SUPERLIORA_NO_AUTO_UPDATE: '1' },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(spawnOutputText(result)).toContain(pkg.version);
  });

  it.skipIf(process.platform !== 'win32')('spawns corepack.cmd through the shipped helper', async () => {
    const result = spawnInstall('corepack', ['--version'], { encoding: 'utf8', timeout: 15_000 });
    expect(result.error, result.error?.message).toBeUndefined();
    expect(result.status).toBe(0);
    expect(spawnOutputText(result)).toMatch(/\d+\.\d+/);
  });

  it('updates a fake User PATH via ensureBinOnPath injectors', async () => {
    let stored = 'C:\\Windows';
    const binDir = 'C:\\Apps\\SuperLiora\\bin';
    const prevPath = process.env['PATH'];
    try {
      const result = await ensureBinOnPath(binDir, {
        platform: 'win32',
        getUserPath: () => stored,
        setUserPath: (next: string) => {
          stored = next;
        },
      });
      expect(result.updated).toEqual(['User PATH']);
      expect(stored.startsWith(`${binDir};`)).toBe(true);
      const again = await ensureBinOnPath(binDir, {
        platform: 'win32',
        getUserPath: () => stored,
        setUserPath: (next: string) => {
          stored = next;
        },
      });
      expect(again.updated).toEqual([]);
    } finally {
      process.env['PATH'] = prevPath;
    }
  });

  it('writes POSIX shell-rc markers when platform is injected as linux', async () => {
    const home = await makeDir('liora-posix-rc-');
    const prevHome = process.env['HOME'];
    const prevUser = process.env['USERPROFILE'];
    const prevPath = process.env['PATH'];
    process.env['HOME'] = home;
    process.env['USERPROFILE'] = home;
    try {
      const binDir = join(home, 'local-bin');
      const result = await ensureBinOnPath(binDir, { platform: 'linux' });
      expect(result.updated.length).toBeGreaterThan(0);
      const zsh = await readFile(join(home, '.zshrc'), 'utf-8');
      expect(zsh).toContain('# >>> liora PATH >>>');
      expect(zsh).toContain('export PATH="$liora_bin_dir:$PATH"');
      expect(zsh).toContain('liora_bin_dir="$HOME/local-bin"');
    } finally {
      if (prevHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = prevHome;
      if (prevUser === undefined) delete process.env['USERPROFILE'];
      else process.env['USERPROFILE'] = prevUser;
      process.env['PATH'] = prevPath;
    }
  });

  it.skipIf(process.platform !== 'win32')('runs install.ps1 -Help without installing', async () => {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-File', windowsSourceInstallScript, '-Help'],
      { cwd: repoRoot },
    );
    expect(stdout).toContain('install.ps1');
    expect(stdout).toContain('--no-shell-rc');
  });

  it.skipIf(process.platform !== 'win32')(
    'round-trips Hangul User env through shipped applyUserPathWin',
    async () => {
      const envName = 'SUPERLIORA_TEST_USER_PATH';
      const hangul = 'C:\\임시경로\\한글폴더';
      const binDir = 'C:\\Apps\\SuperLiora\\bin';
      const prevPath = process.env['PATH'];
      try {
        writeUserEnvWin(`${hangul};C:\\Windows`, { envName });
        const seeded = readUserEnvWin({ envName });
        expect(seeded).toContain('임시경로');
        expect(seeded).toContain('한글폴더');

        const first = applyUserPathWin(binDir, { envName });
        expect(first.changed).toBe(true);
        expect(first.next).toContain('임시경로');
        expect(first.next).toContain('한글폴더');
        expect(first.next.toLowerCase().startsWith(binDir.toLowerCase())).toBe(true);

        const readBack = readUserEnvWin({ envName });
        expect(readBack).toBe(first.next);
        expect(readBack).toContain('임시경로');
        expect(readBack).toContain('한글폴더');

        const result = await ensureBinOnPath(binDir, { platform: 'win32', envName });
        expect(result.updated).toEqual([]);
        expect(readUserEnvWin({ envName })).toContain('임시경로');
      } finally {
        process.env['PATH'] = prevPath;
        writeUserEnvWin('', { envName });
      }
    },
  );

  it.skipIf(process.platform !== 'win32')('parses install.ps1 with zero PowerShell errors', async () => {
    const escaped = windowsSourceInstallScript.replaceAll("'", "''");
    const command = [
      '$errs = $null',
      `$null = [System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$null, [ref]$errs)`,
      'if ($errs -and $errs.Count -gt 0) { $errs | ForEach-Object { $_.ToString() }; exit 1 }',
      "Write-Output 'PARSE_OK'",
    ].join('; ');
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', command]);
    expect(stdout).toContain('PARSE_OK');
  });
});
