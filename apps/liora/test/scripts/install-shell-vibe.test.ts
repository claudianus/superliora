import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FZF_WINGET_ID,
  VIBE_PROFILE_MARKER_END,
  VIBE_PROFILE_MARKER_START,
  ZOXIDE_WINGET_ID,
  defaultPowerShellProfilePaths,
  defaultUnixProfilePaths,
  ensureShellVibe,
  renderOhMyPoshInitBlock,
  renderUnixVibeProfileBlock,
  renderVibeProfileBlock,
  skipShellVibeRequested,
  upsertMarkedBlock,
} from '../../../../scripts/install/ensure-shell-vibe.mjs';

function assertOhMyPoshWinPsGuard(block: string) {
  expect(block).not.toMatch(/\$ompCmd init pwsh --config \$ompConfig\s*\|\s*Invoke-Expression/);
  expect(block).toContain('$ompCmd init $ompShell');
  expect(block).toContain("if ($PSVersionTable.PSVersion.Major -ge 7) { 'pwsh' } else { 'powershell' }");
  expect(block).toContain('if ($ompInit)');
  expect(block).toContain('Invoke-Expression $ompInit');
  const clearBefore = block.indexOf('$ompLoaded.OnRemove = {}');
  const initAt = block.indexOf('$ompCmd init $ompShell');
  const clearAfter = block.indexOf('$ompCore.OnRemove = {}');
  expect(clearBefore).toBeGreaterThan(-1);
  expect(initAt).toBeGreaterThan(clearBefore);
  expect(clearAfter).toBeGreaterThan(initAt);
  expect(block).toContain('-not $ompKeyPositional');
  expect(block).toContain('$param.Position -ge 0');
}

describe('scripts/install/ensure-shell-vibe', () => {
  it('writes a managed PowerShell block for both hosts', () => {
    const paths = defaultPowerShellProfilePaths({ USERPROFILE: 'E:\\Users\\dev' });
    expect(paths.some((p) => p.includes('WindowsPowerShell'))).toBe(true);
    expect(paths.some((p) => p.replaceAll('/', '\\').includes('\\PowerShell\\Microsoft.PowerShell_profile.ps1'))).toBe(true);
  });

  it('replaces an existing managed block without dropping user lines', () => {
    const first = upsertMarkedBlock('Write-Host hi\n', renderVibeProfileBlock());
    const second = upsertMarkedBlock(first, renderVibeProfileBlock());
    expect(first).toContain('Write-Host hi');
    expect(first).toContain(VIBE_PROFILE_MARKER_START);
    expect(first).toContain('zoxide init powershell');
    assertOhMyPoshWinPsGuard(first);
    expect(first.split(VIBE_PROFILE_MARKER_START).length).toBe(2);
    expect(second.split(VIBE_PROFILE_MARKER_END).length).toBe(2);
  });

  it('patches profiles and records sidecar installs', async () => {
    const files = new Map<string, string>();
    const result = await ensureShellVibe({
      platform: 'win32',
      env: { USERPROFILE: 'E:\\Users\\dev', LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local' },
      profilePaths: ['E:\\Users\\dev\\Documents\\WindowsPowerShell\\Microsoft.PowerShell_profile.ps1'],
      readText: async (dest: string) => files.get(dest) ?? '',
      writeFile: async (dest: string, text: string) => {
        files.set(dest, text);
      },
      ensureOhMyPosh: async () => ({
        ok: true,
        installed: true,
        themeWritten: true,
        ompPath: 'E:\\omp.exe',
      }),
      isFile: () => false,
      which: () => undefined,
      runWinget: () => ({ status: 1 }),
      downloadToFile: async () => '',
      expandZip: () => {},
      installTerminalIcons: () => true,
      // Policy changes are consent-gated: only an explicit opt-in sets it.
      allowExecutionPolicy: true,
      setExecutionPolicy: () => true,
      addUserPath: () => {},
    });
    expect(result.ok).toBe(true);
    expect(result.ohMyPoshInstalled).toBe(true);
    expect(result.profilePatched).toBe(true);
    expect(result.terminalIconsInstalled).toBe(true);
    expect(result.executionPolicySet).toBe(true);
    const profile = [...files.values()][0] ?? '';
    expect(profile).toContain('#00D5FF');
    expect(profile).toContain('superliora-neon-noir.omp.json');
    assertOhMyPoshWinPsGuard(profile);
  });

  it('honors skip flags', async () => {
    expect(skipShellVibeRequested({ SUPERLIORA_NO_SHELL_VIBE: '1' })).toBe(true);
    expect((await ensureShellVibe({ skip: true, platform: 'win32' })).skipped).toBe(true);
    expect((await ensureShellVibe({ skip: true, platform: 'linux' })).skipped).toBe(true);
    expect((await ensureShellVibe({ platform: 'aix' })).skipped).toBe(true);
  });

  it('writes a managed bash/zsh block on Linux', async () => {
    const files = new Map<string, string>();
    const paths = defaultUnixProfilePaths({ HOME: '/tmp/sl-home' });
    expect(paths).toEqual(['/tmp/sl-home/.zshrc', '/tmp/sl-home/.bashrc']);
    const result = await ensureShellVibe({
      platform: 'linux',
      env: { HOME: '/tmp/sl-home' },
      profilePaths: paths,
      readText: async (dest: string) => files.get(dest) ?? '',
      writeFile: async (dest: string, text: string) => {
        files.set(dest, text);
      },
      ensureOhMyPosh: async () => ({
        ok: true,
        themeWritten: true,
        ompPath: '/tmp/sl-home/.superliora/runtime/oh-my-posh/oh-my-posh',
      }),
      isFile: () => false,
      which: () => undefined,
      downloadToFile: async () => '',
      expandZip: () => {},
      addUserPath: () => {},
    });
    expect(result.ok).toBe(true);
    expect(result.profilePatched).toBe(true);
    expect(files.get('/tmp/sl-home/.bashrc')).toContain('init bash --config');
    expect(files.get('/tmp/sl-home/.zshrc')).toContain('init zsh --config');
    expect(renderUnixVibeProfileBlock('bash')).toContain(VIBE_PROFILE_MARKER_START);
  });

  it('pins zoxide and fzf winget ids', () => {
    expect(ZOXIDE_WINGET_ID).toBe('ajeetdsouza.zoxide');
    expect(FZF_WINGET_ID).toBe('junegunn.fzf');
  });
});

describe('Oh My Posh inbox PSReadLine guard', () => {
  it('keeps the WinPS 5.1 re-init contract in the managed block', () => {
    assertOhMyPoshWinPsGuard(renderVibeProfileBlock());
    assertOhMyPoshWinPsGuard(renderOhMyPoshInitBlock());
  });

  it('clears OnRemove before inbox Get-PSReadLineKeyHandler can throw', () => {
    const root = process.env['SystemRoot'] ?? 'C:\\Windows';
    const exe = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (process.platform !== 'win32' || !existsSync(exe)) return;

    const dir = mkdtempSync(join(tmpdir(), 'sl-omp-guard-'));
    const script = join(dir, 'guard.ps1');
    writeFileSync(
      script,
      [
        "$ErrorActionPreference = 'Continue'",
        '$Error.Clear()',
        'function Import-BrokenOmp {',
        '    $loaded = Get-Module oh-my-posh-core',
        '    if ($loaded) { $loaded.OnRemove = {}; Remove-Module oh-my-posh-core -Force }',
        '    New-Module -Name oh-my-posh-core -ScriptBlock {',
        '        $ExecutionContext.SessionState.Module.OnRemove = {',
        "            $null = Get-PSReadLineKeyHandler Spacebar",
        "            $null = Get-PSReadLineKeyHandler Enter",
        "            $null = Get-PSReadLineKeyHandler Ctrl+c",
        '        }',
        '    } | Import-Module',
        '}',
        '$ompGetKey = Get-Command Get-PSReadLineKeyHandler -ErrorAction SilentlyContinue',
        'if (-not $ompGetKey) { Write-Output SKIP_NO_PSREADLINE; exit 0 }',
        '$ompKeyPositional = $false',
        'foreach ($set in $ompGetKey.ParameterSets) {',
        '    foreach ($param in $set.Parameters) {',
        '        if ($param.Position -ge 0 -and ($param.ParameterType -eq [string] -or $param.ParameterType -eq [string[]])) {',
        '            $ompKeyPositional = $true',
        '        }',
        '    }',
        '}',
        'if ($ompKeyPositional) { Write-Output SKIP_POSITIONAL; exit 0 }',
        'Import-BrokenOmp',
        'Remove-Module oh-my-posh-core -Force',
        "$control = @($Error | Where-Object { $_.FullyQualifiedErrorId -like '*PositionalParameterNotFound*' }).Count",
        'if ($control -lt 1) { Write-Output "CONTROL_FAILED:$control"; exit 1 }',
        '$Error.Clear()',
        'Import-BrokenOmp',
        "$ompConfig = Join-Path $env:TEMP 'sl-omp-guard-config.json'",
        "Set-Content -LiteralPath $ompConfig -Value '{}'",
        '$ompCmd = {',
        "    @'",
        'New-Module -Name oh-my-posh-core -ScriptBlock {',
        '    $ExecutionContext.SessionState.Module.OnRemove = {',
        '        $null = Get-PSReadLineKeyHandler Spacebar',
        '        $null = Get-PSReadLineKeyHandler Enter',
        '        $null = Get-PSReadLineKeyHandler Ctrl+c',
        '    }',
        '} | Import-Module',
        "'@",
        '}',
        renderOhMyPoshInitBlock(),
        "$bad = @($Error | Where-Object { $_.FullyQualifiedErrorId -like '*PositionalParameterNotFound*' }).Count",
        'if ($bad -ne 0) { Write-Output "INIT_FAILED:$bad"; exit 1 }',
        'Remove-Module oh-my-posh-core -Force -ErrorAction SilentlyContinue',
        "$bad2 = @($Error | Where-Object { $_.FullyQualifiedErrorId -like '*PositionalParameterNotFound*' }).Count",
        'if ($bad2 -ne 0) { Write-Output "REMOVE_FAILED:$bad2"; exit 1 }',
        'Write-Output OK',
      ].join('\n'),
      'utf8',
    );

    try {
      const result = spawnSync(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], {
        encoding: 'utf8',
        timeout: 20_000,
      });
      const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
      if (output.includes('SKIP_NO_PSREADLINE') || output.includes('SKIP_POSITIONAL')) return;
      expect(result.status, output).toBe(0);
      expect(output, output).toMatch(/\bOK\b/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
