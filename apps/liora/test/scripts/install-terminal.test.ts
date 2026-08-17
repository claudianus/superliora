import { describe, expect, it } from 'vitest';

import { ensureRuntimePrereqs } from '#/cli/update/runtime-prereqs';
import { getHostPackageRoot } from '#/cli/version';

import {
  SUPERLIORA_NEON_NOIR_SCHEME,
  SUPERLIORA_SHELL_PROFILE_GUID,
  SUPERLIORA_SHELL_PROFILE_NAME,
  SUPERLIORA_WT_FONT_FACE,
  SUPERLIORA_WT_FONT_FACE_FALLBACK,
  SUPERLIORA_WT_PROFILE_GUID,
  SUPERLIORA_WT_PROFILE_NAME,
  SUPERLIORA_WT_SCHEME_NAME,
  isStockWindowsTerminalDefault,
  mergeWindowsTerminalSettings,
  parseJsonc,
  TERMINAL_INSTALL_HINT,
  WT_CONSOLE_HOST_GUID,
  WT_DELEGATION_CONSOLE,
  WINGET_TERMINAL_ID,
  ensureTerminal,
  findWindowsTerminal,
  probeWindowsTerminalEnv,
  renderSuperLioraFragment,
  resolveCommandLine,
  resolveFragmentFontFace,
  shouldPromoteDefaultTerminal,
  skipTerminalRequested,
  wellKnownWtCandidates,
} from '../../../../scripts/install/ensure-terminal.mjs';

describe('scripts/install/ensure-terminal', () => {
  it('lists well-known wt.exe locations from LOCALAPPDATA', () => {
    const list = wellKnownWtCandidates({
      LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local',
      USERPROFILE: 'E:\\Users\\dev',
    });
    expect(list.some((p) => p.replaceAll('/', '\\').endsWith('\\WindowsApps\\wt.exe'))).toBe(true);
    expect(list.some((p) => p.replaceAll('/', '\\').includes('\\Windows Terminal\\wt.exe'))).toBe(true);
  });

  it('finds an existing Windows Terminal on well-known paths', () => {
    const found = findWindowsTerminal({
      platform: 'win32',
      env: { LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local' },
      isFile: (p: string) => p === 'E:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe',
      which: () => undefined,
    });
    expect(found?.source).toBe('well-known');
    expect(found?.alreadyPresent).toBe(true);
    expect(found?.wtPath.toLowerCase()).toContain('wt.exe');
  });

  it('prefers wt.exe from PATH before well-known folders', () => {
    const found = findWindowsTerminal({
      platform: 'win32',
      env: {},
      which: (name: string) => (name === 'wt' ? 'D:\\Apps\\wt.exe' : undefined),
      isFile: (p: string) => p === 'D:\\Apps\\wt.exe',
    });
    expect(found?.source).toBe('path');
    expect(found?.wtPath).toBe('D:\\Apps\\wt.exe');
  });

  it('honors skip flags and env without calling install', async () => {
    let wingetCalls = 0;
    const skippedFlag = await ensureTerminal({
      skip: true,
      platform: 'win32',
      runWinget: () => {
        wingetCalls += 1;
        return { status: 0 };
      },
    });
    expect(skippedFlag.skipped).toBe(true);
    expect(wingetCalls).toBe(0);

    expect(skipTerminalRequested({ SUPERLIORA_NO_TERMINAL: '1' })).toBe(true);
    expect(skipTerminalRequested({ SUPERLIORA_SKIP_TERMINAL: '1' })).toBe(true);

    const skippedEnv = await ensureTerminal({
      platform: 'win32',
      env: { SUPERLIORA_NO_TERMINAL: '1' },
      runWinget: () => {
        wingetCalls += 1;
        return { status: 0 };
      },
    });
    expect(skippedEnv.skipped).toBe(true);
    expect(wingetCalls).toBe(0);
  });

  it('is a no-op on non-Windows platforms', async () => {
    const result = await ensureTerminal({
      platform: 'linux',
      runWinget: () => {
        throw new Error('should not install');
      },
    });
    expect(result.skipped).toBe(true);
    expect(result.platform).toBe('linux');
    expect(result.ok).toBe(true);
  });

  it('does not throw when winget and MSIX both fail', async () => {
    const result = await ensureTerminal({
      platform: 'win32',
      env: { LOCALAPPDATA: 'E:\\empty', APPDATA: 'E:\\empty', USERPROFILE: 'E:\\empty' },
      isFile: () => false,
      which: () => undefined,
      listAppx: () => undefined,
      ensureWinget: async () => ({ ok: false, installed: false }),
      ensureNerdFont: async () => ({ ok: true, skipped: true }),
      ensureShellVibe: async () => ({ ok: true, skipped: true }),
      runWinget: () => ({ status: 1, message: 'no winget' }),
      fetchLatestRelease: async () => {
        throw new Error('offline');
      },
    });
    expect(result.ok).toBe(false);
    expect(result.installed).toBe(false);
    expect(result.message).toContain(TERMINAL_INSTALL_HINT);
  });

  it('renders a SuperLiora fragment with Nerd Font, acrylic, and the 16-color scheme', () => {
    const fragment = renderSuperLioraFragment({
      commandline: 'C:\\Apps\\SuperLiora\\bin\\liora.exe',
    });
    expect(fragment.profiles[0]?.name).toBe(SUPERLIORA_WT_PROFILE_NAME);
    expect(fragment.profiles[0]?.guid).toBe(SUPERLIORA_WT_PROFILE_GUID);
    expect(fragment.profiles[0]?.font.face).toBe(SUPERLIORA_WT_FONT_FACE);
    expect(fragment.profiles[0]?.font.features).toEqual({ calt: 1, liga: 1 });
    expect(fragment.profiles[0]?.useAcrylic).toBe(true);
    expect(fragment.profiles[0]?.opacity).toBe(82);
    expect(fragment.profiles[0]?.colorScheme).toBe(SUPERLIORA_WT_SCHEME_NAME);
    expect(fragment.profiles[0]?.commandline).toBe('C:\\Apps\\SuperLiora\\bin\\liora.exe');
    expect(fragment.profiles[1]?.name).toBe(SUPERLIORA_SHELL_PROFILE_NAME);
    expect(fragment.profiles[1]?.guid).toBe(SUPERLIORA_SHELL_PROFILE_GUID);
    expect(fragment.schemes[0]?.name).toBe(SUPERLIORA_NEON_NOIR_SCHEME.name);
    expect(fragment.schemes[0]?.background).toBe('#0D1422');
    expect(fragment.schemes[0]?.brightWhite).toBe('#FFFFFF');
    expect(SUPERLIORA_WT_PROFILE_GUID).toBe('{3f8c1d2a-7b64-5e91-9c04-2a6d8f1e5b70}');
  });

  it('falls back to Cascadia Mono when no Nerd Font file is present', () => {
    expect(resolveFragmentFontFace({
      platform: 'win32',
      env: { LOCALAPPDATA: 'E:\\empty' },
      isFile: () => false,
    })).toBe(SUPERLIORA_WT_FONT_FACE_FALLBACK);
  });

  it('probes conhost as a degraded Windows TUI host', () => {
    const probe = probeWindowsTerminalEnv({
      platform: 'win32',
      env: { LOCALAPPDATA: 'E:\\empty' },
      isFile: () => false,
      which: () => undefined,
      listAppx: () => undefined,
    });
    expect(probe.applicable).toBe(true);
    expect(probe.host).toBe('conhost');
    expect(probe.status).toBe('degraded');
    expect(probe.inWindowsTerminal).toBe(false);
  });

  it('probes WT_SESSION as an ok Windows Terminal host when wt.exe exists', () => {
    const wt = 'E:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe';
    const probe = probeWindowsTerminalEnv({
      platform: 'win32',
      env: {
        LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local',
        WT_SESSION: 'abc',
      },
      isFile: (p: string) => p === wt,
      which: () => undefined,
    });
    expect(probe.host).toBe('windowsterminal');
    expect(probe.status).toBe('ok');
    expect(probe.hasWt).toBe(true);
  });

  it('is not applicable on non-Windows', () => {
    expect(probeWindowsTerminalEnv({ platform: 'linux' }).applicable).toBe(false);
  });

  it('prefers liora.exe over liora.cmd when both exist', () => {
    const binDir = 'C:\\Apps\\SuperLiora\\bin';
    const line = resolveCommandLine(binDir, 'liora', (p: string) =>
      p.replaceAll('/', '\\') === `${binDir}\\liora.exe`
      || p.replaceAll('/', '\\') === `${binDir}\\liora.cmd`,
    );
    expect(line?.replaceAll('/', '\\')).toBe(`${binDir}\\liora.exe`);
  });

  it('promotes only empty or Console Host default-terminal values', () => {
    expect(shouldPromoteDefaultTerminal({})).toBe(true);
    expect(shouldPromoteDefaultTerminal({ DelegationConsole: WT_CONSOLE_HOST_GUID })).toBe(true);
    expect(shouldPromoteDefaultTerminal({
      DelegationConsole: WT_DELEGATION_CONSOLE,
      DelegationTerminal: '{E12CFF52-A866-4C77-9A90-F570A7AA2C6B}',
    })).toBe(false);
    expect(shouldPromoteDefaultTerminal({
      DelegationConsole: '{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}',
    })).toBe(false);
  });

  it('treats empty or stock Windows Terminal defaults as replaceable', () => {
    expect(isStockWindowsTerminalDefault(undefined)).toBe(true);
    expect(isStockWindowsTerminalDefault('{61c54bbd-c2c6-5271-96e7-009a87ff44bf}')).toBe(true);
    expect(isStockWindowsTerminalDefault(SUPERLIORA_SHELL_PROFILE_GUID)).toBe(false);
  });

  it('merges Neon Noir defaults and quake into Windows Terminal settings', () => {
    const merged = mergeWindowsTerminalSettings({
      defaultProfile: '{61c54bbd-c2c6-5271-96e7-009a87ff44bf}',
      profiles: { defaults: { font: { face: 'Consolas' } } },
    });
    expect(merged.defaultProfile).toBe(SUPERLIORA_SHELL_PROFILE_GUID);
    expect(merged.profiles.defaults.colorScheme).toBe(SUPERLIORA_WT_SCHEME_NAME);
    expect(merged.profiles.defaults.font.face).toBe(SUPERLIORA_WT_FONT_FACE);
    expect(merged.profiles.defaults.useAcrylic).toBe(true);
    expect(merged.schemes[0]?.name).toBe(SUPERLIORA_NEON_NOIR_SCHEME.name);
    expect(merged.actions.some((action: { command?: { action?: string } }) => action.command?.action === 'quakeMode')).toBe(true);
    expect(parseJsonc('{\n  // comment\n  "defaultProfile": "{abc}"\n}')).toEqual({
      defaultProfile: '{abc}',
    });
  });

  it('writes fragment and shortcut for an existing Terminal without calling winget', async () => {
    const files = new Map<string, string>();
    const shortcuts: Array<{ dest: string; target: string; arguments: string }> = [];
    let wingetCalls = 0;
    let promoted: unknown;
    const wt = 'E:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe';
    const result = await ensureTerminal({
      platform: 'win32',
      noShellRc: false,
      binDir: 'C:\\Apps\\SuperLiora\\bin',
      commandName: 'liora',
      env: {
        LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local',
        APPDATA: 'E:\\Users\\dev\\AppData\\Roaming',
        USERPROFILE: 'E:\\Users\\dev',
      },
      isFile: (p: string) => p === wt || p === 'C:\\Apps\\SuperLiora\\bin\\liora.exe',
      which: () => undefined,
      ensureNerdFont: async () => ({ ok: true, skipped: true }),
      ensureShellVibe: async () => ({
        ok: true,
        ohMyPoshInstalled: true,
        zoxideInstalled: true,
        fzfInstalled: true,
        profilePatched: true,
      }),
      readText: async () => '',
      runWinget: () => {
        wingetCalls += 1;
        return { status: 0 };
      },
      writeFile: async (dest: string, text: string) => {
        files.set(dest, text);
      },
      writeShortcut: async (spec: { dest: string; target: string; arguments: string }) => {
        shortcuts.push(spec);
        return true;
      },
      readDelegation: () => ({ DelegationConsole: WT_CONSOLE_HOST_GUID }),
      writeDelegation: (value: unknown) => {
        promoted = value;
      },
    });

    expect(wingetCalls).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.alreadyPresent).toBe(true);
    expect(result.fragmentWritten).toBe(true);
    expect(result.shortcutWritten).toBe(true);
    expect(result.promotedDefault).toBe(true);
    expect(result.settingsMerged).toBe(true);
    expect(result.ohMyPoshInstalled).toBe(true);
    expect(result.profilePatched).toBe(true);
    const fragmentText = [...files.values()][0];
    expect(fragmentText).toContain(SUPERLIORA_WT_FONT_FACE_FALLBACK);
    expect(fragmentText).toContain('SuperLiora Neon Noir');
    expect(fragmentText).toContain('liora.exe');
    expect(fragmentText).toContain(SUPERLIORA_SHELL_PROFILE_NAME);
    const settingsText = [...files.values()].find((text) => text.includes('defaultProfile'));
    expect(settingsText).toContain(SUPERLIORA_SHELL_PROFILE_GUID);
    expect(shortcuts[0]?.target).toBe(wt);
    expect(shortcuts[0]?.arguments).toBe(`-w new -p ${SUPERLIORA_WT_PROFILE_NAME}`);
    expect(promoted).toMatchObject({ DelegationConsole: WT_DELEGATION_CONSOLE });
  });

  it('skipPackages refreshes a present Terminal without winget or font downloads', async () => {
    let wingetCalls = 0;
    let fontCalls = 0;
    const wt = 'D:\\wt.exe';
    const result = await ensureTerminal({
      platform: 'win32',
      skipPackages: true,
      noShellRc: true,
      env: { LOCALAPPDATA: 'D:\\la', APPDATA: 'D:\\roam', USERPROFILE: 'D:\\home' },
      isFile: (p: string) => p === wt,
      which: () => wt,
      ensureWinget: async () => {
        wingetCalls += 1;
        return { ok: true };
      },
      ensureNerdFont: async () => {
        fontCalls += 1;
        return { ok: true, installed: true };
      },
      runWinget: () => {
        wingetCalls += 1;
        return { status: 0 };
      },
      writeFile: async () => {},
      writeShortcut: async () => true,
    });
    expect(result.ok).toBe(true);
    expect(result.fragmentWritten).toBe(true);
    expect(wingetCalls).toBe(0);
    expect(fontCalls).toBe(0);
  });

  it('skipPackages does not fail upgrade when Windows Terminal is missing', async () => {
    const result = await ensureTerminal({
      platform: 'win32',
      skipPackages: true,
      env: { LOCALAPPDATA: 'E:\\empty', APPDATA: 'E:\\empty', USERPROFILE: 'E:\\empty' },
      isFile: () => false,
      which: () => undefined,
      listAppx: () => undefined,
      ensureWinget: async () => {
        throw new Error('should not bootstrap winget');
      },
      ensureNerdFont: async () => {
        throw new Error('should not install font');
      },
      runWinget: () => {
        throw new Error('should not install terminal');
      },
      ensureShellVibe: async () => ({ ok: true, skipped: true }),
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.fragmentWritten).toBe(false);
  });

  it('skips registry promotion when noShellRc is set', async () => {
    let wroteDelegation = false;
    const wt = 'D:\\wt.exe';
    const result = await ensureTerminal({
      platform: 'win32',
      noShellRc: true,
      env: { LOCALAPPDATA: 'D:\\la', APPDATA: 'D:\\roam', USERPROFILE: 'D:\\home' },
      isFile: (p: string) => p === wt,
      which: () => wt,
      ensureNerdFont: async () => ({ ok: true, skipped: true }),
      writeFile: async () => {},
      writeShortcut: async () => true,
      writeDelegation: () => {
        wroteDelegation = true;
      },
    });
    expect(result.ok).toBe(true);
    expect(result.promotedDefault).toBe(false);
    expect(wroteDelegation).toBe(false);
  });

  it('installs via winget when Terminal is missing, then writes the fragment', async () => {
    const files = new Map<string, string>();
    let present = false;
    const wt = 'E:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe';
    const result = await ensureTerminal({
      platform: 'win32',
      noShellRc: true,
      binDir: 'C:\\Apps\\SuperLiora\\bin',
      env: {
        LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local',
        APPDATA: 'E:\\Users\\dev\\AppData\\Roaming',
        USERPROFILE: 'E:\\Users\\dev',
      },
      isFile: (p: string) => present && p === wt,
      which: () => undefined,
      listAppx: () => undefined,
      ensureWinget: async () => ({ ok: true, alreadyPresent: true }),
      ensureNerdFont: async () => ({ ok: true, installed: true, face: SUPERLIORA_WT_FONT_FACE }),
      runWinget: ({ scopeUser }: { scopeUser: boolean }) => {
        if (scopeUser) {
          present = true;
          return { status: 0 };
        }
        return { status: 1 };
      },
      writeFile: async (dest: string, text: string) => {
        files.set(dest, text);
      },
      writeShortcut: async () => true,
    });
    expect(result.ok).toBe(true);
    expect(result.installed).toBe(true);
    expect(files.size).toBe(1);
    expect(WINGET_TERMINAL_ID).toBe('Microsoft.WindowsTerminal');
  });

  it('upgrade prereq hook still finds Git after the terminal module is added', async () => {
    const result = await ensureRuntimePrereqs(getHostPackageRoot());
    expect(result.gitOk).toBe(true);
  });
});
