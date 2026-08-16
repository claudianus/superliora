import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const windowsCmdInstallScript = resolve(repoRoot, 'install.cmd');
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

  it('writes liora.cmd and removes a leftover liora.ps1 that would shadow it', async () => {
    const binDir = await makeDir('liora-win-bin-');
    await writeFile(
      join(binDir, 'liora.ps1'),
      `# ${WRAPPER_MARKER}\nWrite-Output 'stale'\n`,
      'utf8',
    );
    await execFileAsync(process.execPath, [
      installScript,
      '--bin-dir',
      binDir,
      '--windows',
      '--no-shell-rc',
    ], { cwd: repoRoot });

    const cmd = await readFile(join(binDir, 'liora.cmd'), 'utf-8');
    expect(cmd).toContain(WRAPPER_MARKER);
    expect(cmd).toMatch(/dist[/\\]main\.mjs/);
    expect(cmd).toContain('dev:cli-only');
    await expect(readFile(join(binDir, 'liora.ps1'), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.skipIf(
    process.platform !== 'win32' || !existsSync(join(repoRoot, 'apps/liora/dist/main.mjs')),
  )('spawns the produced liora.cmd --version', async () => {
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

  it.skipIf(process.platform !== 'win32')('runs install.ps1 --help without installing', async () => {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', windowsSourceInstallScript, '--help'],
      { cwd: repoRoot },
    );
    expect(stdout).toContain('install.ps1');
    expect(stdout).toContain('--no-shell-rc');
    expect(stdout).toContain('--no-terminal');
    expect(stdout).toContain('cmd.exe');
    expect(stdout).toContain('session PATH');
    expect(stdout).toContain('SUPERLIORA_*');
  });

  it.skipIf(process.platform !== 'win32')(
    'runs install.ps1 through an irm|iex pipeline without treating param as a command',
    async () => {
      const escaped = windowsSourceInstallScript.replaceAll("'", "''");
      const command = [
        "$ErrorActionPreference = 'Stop'",
        "$env:SUPERLIORA_INSTALL_HELP = '1'",
        `Get-Content -LiteralPath '${escaped}' -Raw | Invoke-Expression`,
      ].join('; ');
      const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', command], {
        env: { ...process.env, SUPERLIORA_INSTALL_HELP: '1' },
      });
      expect(stdout).toContain('install.ps1');
      expect(stdout).toContain('--no-shell-rc');
      expect(stdout).not.toMatch(/param :/);
      expect(stdout).not.toContain('bootstrapping');
    },
  );

  it.skipIf(process.platform !== 'win32')('runs install.cmd --help from cmd.exe', async () => {
    const { stdout } = await execFileAsync('cmd.exe', [
      '/d',
      '/c',
      windowsCmdInstallScript,
      '--help',
    ]);
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

  it('downloads over HTTP with UseBasicParsing on every Invoke-WebRequest', async () => {
    const ps1 = await readFile(windowsSourceInstallScript, 'utf-8');
    const lines = [...ps1.matchAll(/Invoke-WebRequest[^\n]*/g)].map((match) => match[0]);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toContain('-UseBasicParsing');
    }
    expect(ps1).toContain('$ProgressPreference = \'SilentlyContinue\'');
    expect(ps1).toContain('.superliora\\runtime\\node');
  });

  it('does not read OSArchitecture as a PowerShell property under StrictMode', async () => {
    const ps1 = await readFile(windowsSourceInstallScript, 'utf-8');
    expect(ps1).not.toMatch(/::OSArchitecture/);
    expect(ps1).not.toMatch(/\$\w+\.OSArchitecture\b/);
    expect(ps1).toContain("GetProperty('OSArchitecture')");
    expect(ps1).toContain('PROCESSOR_ARCHITECTURE');
    expect(ps1).toContain('PROCESSOR_ARCHITEW6432');
    expect(ps1).toContain('function Get-WindowsNodeArch');
  });

  it.skipIf(process.platform !== 'win32')(
    'maps Windows arch tokens and survives StrictMode when OSArchitecture is absent',
    async () => {
      const ps1 = await readFile(windowsSourceInstallScript, 'utf-8');
      const start = ps1.indexOf('function Convert-WindowsArchToken');
      const end = ps1.indexOf('function Install-LocalNode');
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      const functions = ps1.slice(start, end);
      const command = [
        "$ErrorActionPreference = 'Stop'",
        'Set-StrictMode -Version 2.0',
        'function Fail { param([string]$Message) throw $Message }',
        functions,
        "if ((Convert-WindowsArchToken 'AMD64') -ne 'x64') { throw 'AMD64' }",
        "if ((Convert-WindowsArchToken 'X64') -ne 'x64') { throw 'X64' }",
        "if ((Convert-WindowsArchToken 'Arm64') -ne 'arm64') { throw 'Arm64' }",
        "if ((Convert-WindowsArchToken 'ARM64') -ne 'arm64') { throw 'ARM64' }",
        "if ($null -ne (Convert-WindowsArchToken 'x86')) { throw 'x86' }",
        "if ($null -ne (Convert-WindowsArchToken '')) { throw 'empty' }",
        '$missing = New-Object psobject',
        'try { $null = $missing.OSArchitecture; throw "StrictMode did not fire" } catch {',
        "  if ($_.FullyQualifiedErrorId -notmatch 'PropertyNotFoundStrict') { throw }",
        '}',
        '$runtimeToken = Get-RuntimeOsArchToken',
        "if ($null -ne $runtimeToken -and $runtimeToken -notmatch '^(X64|Arm64|X86|Arm)$') { throw ('runtime token ' + $runtimeToken) }",
        '$arch = Get-WindowsNodeArch',
        "if ($arch -ne 'x64' -and $arch -ne 'arm64') { throw ('node arch ' + $arch) }",
        "Write-Output ('ARCH_FN_OK ' + $arch)",
      ].join('; ');
      const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', command]);
      expect(stdout).toMatch(/ARCH_FN_OK (x64|arm64)/);
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'parses GNU and PowerShell flags in dump mode without treating them as named parameters',
    async () => {
      const binDir = 'C:\\Apps\\SuperLiora\\bin';
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          windowsSourceInstallScript,
          '--prefer-source',
          '--no-browser-use',
          '--no-git',
          '--bin-dir',
          binDir,
          '--no-shell-rc',
        ],
        { env: { ...process.env, SUPERLIORA_INSTALL_DUMP: '1' } },
      );
      expect(stdout).toContain(`DUMP binDir=${binDir}`);
      expect(stdout).toContain('DUMP preferSource=1');
      expect(stdout).toContain('DUMP noBrowserUse=1');
      expect(stdout).toContain('DUMP noGit=1');
      expect(stdout).toContain('DUMP noPath=1');
      expect(stdout).toContain('DUMP noShellRc=1');
      expect(stdout).toMatch(/DUMP nodeArch=(x64|arm64)/);
      expect(stdout).toContain('DUMP ok');
      expect(stdout).not.toContain('bootstrapping');
      expect(stdout).not.toMatch(/param :/);
      expect(stdout).not.toMatch(/A parameter cannot be found/i);
    },
  );

  it.skipIf(process.platform !== 'win32')('parses --bin-dir=value and -PreferSource in dump mode', async () => {
    const binDir = 'C:\\Apps\\Equals\\bin';
    const { stdout: equalsOut } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        windowsSourceInstallScript,
        `--bin-dir=${binDir}`,
        '--main',
      ],
      { env: { ...process.env, SUPERLIORA_INSTALL_DUMP: '1' } },
    );
    expect(equalsOut).toContain(`DUMP binDir=${binDir}`);
    expect(equalsOut).toContain('DUMP main=1');
    expect(equalsOut).toMatch(/DUMP nodeArch=(x64|arm64)/);

    const psBin = 'C:\\Apps\\Pascal\\bin';
    const { stdout: pascalOut } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        windowsSourceInstallScript,
        '-PreferSource',
        '-BinDir',
        psBin,
        '-NoShellRc',
      ],
      { env: { ...process.env, SUPERLIORA_INSTALL_DUMP: '1' } },
    );
    expect(pascalOut).toContain(`DUMP binDir=${psBin}`);
    expect(pascalOut).toContain('DUMP preferSource=1');
    expect(pascalOut).toContain('DUMP noShellRc=1');
  });

  it.skipIf(process.platform !== 'win32')(
    'puts liora on the current session PATH after irm|iex dump (no new window required)',
    async () => {
      const binDir = await makeDir('liora-ps-path-');
      const commandName = 'liorasmoke';
      await writeFile(
        join(binDir, `${commandName}.cmd`),
        '@echo off\r\necho SMOKE_OK\r\n',
        'utf8',
      );
      const escapedScript = windowsSourceInstallScript.replaceAll("'", "''");
      const escapedBin = binDir.replaceAll("'", "''");
      const command = [
        "$ErrorActionPreference = 'Stop'",
        "$env:SUPERLIORA_INSTALL_DUMP = '1'",
        "$env:SUPERLIORA_NO_SHELL_RC = '1'",
        `$env:SUPERLIORA_BIN_DIR = '${escapedBin}'`,
        `$env:SUPERLIORA_COMMAND = '${commandName}'`,
        `Get-Content -LiteralPath '${escapedScript}' -Raw | Invoke-Expression`,
        `if (-not (Get-Command ${commandName} -ErrorAction SilentlyContinue)) { throw '${commandName} missing from session PATH' }`,
        commandName,
      ].join('; ');
      const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', command], {
        env: {
          ...process.env,
          SUPERLIORA_INSTALL_DUMP: '1',
          SUPERLIORA_NO_SHELL_RC: '1',
          SUPERLIORA_BIN_DIR: binDir,
          SUPERLIORA_COMMAND: commandName,
        },
      });
      expect(stdout).toContain('DUMP ok');
      expect(stdout).toContain('SMOKE_OK');
      expect(stdout).not.toMatch(/param :/);
    },
  );
});
