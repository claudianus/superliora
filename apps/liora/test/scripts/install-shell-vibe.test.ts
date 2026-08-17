import { describe, expect, it } from 'vitest';

import {
  FZF_WINGET_ID,
  VIBE_PROFILE_MARKER_END,
  VIBE_PROFILE_MARKER_START,
  ZOXIDE_WINGET_ID,
  defaultPowerShellProfilePaths,
  defaultUnixProfilePaths,
  ensureShellVibe,
  renderUnixVibeProfileBlock,
  renderVibeProfileBlock,
  skipShellVibeRequested,
  upsertMarkedBlock,
} from '../../../../scripts/install/ensure-shell-vibe.mjs';

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
    expect(first).toContain('$ompCmd init pwsh');
    expect(first).toContain('zoxide init powershell');
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
