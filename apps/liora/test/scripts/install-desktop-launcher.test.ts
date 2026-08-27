import { describe, expect, it } from 'vitest';

import {
  DESKTOP_LAUNCHER_NAME,
  LINUX_TERM_LAUNCHER_NAME,
  defaultDesktopDir,
  desktopLauncherPath,
  ensureDesktopLauncher,
  escapeDesktopExec,
  isCurrentLinuxDesktopEntry,
  linuxApplicationsDesktopPath,
  linuxDesktopShortcutStatus,
  linuxTermLauncherPath,
  renderLinuxDesktopEntry,
  renderLinuxTermLauncherScript,
  renderMacosInfoPlist,
  renderMacosLauncherScript,
  resolveLauncherCommand,
  shSingleQuote,
  windowsTerminalLaunchArgs,
} from '../../../../scripts/install/ensure-desktop-launcher.mjs';
import { SUPERLIORA_WT_PROFILE_NAME } from '../../../../scripts/install/ensure-terminal.mjs';

describe('scripts/install/ensure-desktop-launcher', () => {
  it('builds per-platform desktop launcher paths', () => {
    expect(desktopLauncherPath({
      platform: 'win32',
      env: { USERPROFILE: 'E:\\Users\\dev' },
    }).replaceAll('/', '\\')).toBe('E:\\Users\\dev\\Desktop\\SuperLiora.lnk');
    expect(desktopLauncherPath({
      platform: 'darwin',
      env: { HOME: '/Users/dev' },
    })).toBe('/Users/dev/Desktop/SuperLiora.app');
    expect(desktopLauncherPath({
      platform: 'linux',
      env: { HOME: '/home/dev', XDG_DESKTOP_DIR: '$HOME/Schreibtisch' },
    })).toBe('/home/dev/Schreibtisch/SuperLiora.desktop');
    expect(linuxApplicationsDesktopPath({ HOME: '/home/dev' }, 'linux'))
      .toBe('/home/dev/.local/share/applications/superliora.desktop');
    expect(linuxTermLauncherPath({
      platform: 'linux',
      binDir: '/home/dev/.local/bin',
    })).toBe(`/home/dev/.local/bin/${LINUX_TERM_LAUNCHER_NAME}`);
    expect(defaultDesktopDir({ HOME: '/home/dev' }, 'linux')).toBe('/home/dev/Desktop');
  });

  it('resolves the liora binary from binDir before well-known fallbacks', () => {
    const win = resolveLauncherCommand({
      platform: 'win32',
      binDir: 'C:\\Apps\\SuperLiora\\bin',
      env: { LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local' },
      isFile: (p: string) => p.replaceAll('/', '\\') === 'C:\\Apps\\SuperLiora\\bin\\liora.exe',
    });
    expect(win?.replaceAll('/', '\\')).toBe('C:\\Apps\\SuperLiora\\bin\\liora.exe');

    const posix = resolveLauncherCommand({
      platform: 'linux',
      binDir: '/home/dev/.local/bin',
      env: { HOME: '/home/dev' },
      isFile: (p: string) => p === '/home/dev/.local/bin/liora',
    });
    expect(posix).toBe('/home/dev/.local/bin/liora');
  });

  it('quotes shell, desktop Exec, and Windows Terminal args', () => {
    expect(shSingleQuote("it's")).toBe("'it'\\''s'");
    expect(escapeDesktopExec('/home/dev/.local/bin/liora')).toBe('/home/dev/.local/bin/liora');
    expect(escapeDesktopExec('/home/dev/My Apps/liora')).toBe('"/home/dev/My Apps/liora"');
    expect(windowsTerminalLaunchArgs('C:\\Apps\\liora.exe')).toEqual([
      '-w', 'new', 'nt', '-p', SUPERLIORA_WT_PROFILE_NAME, '--', 'C:\\Apps\\liora.exe',
    ]);
    expect(windowsTerminalLaunchArgs('C:\\Program Files\\liora.exe').at(-1))
      .toBe('"C:\\Program Files\\liora.exe"');
  });

  it('renders a Linux desktop entry that launches via the term helper', () => {
    const entry = renderLinuxDesktopEntry({
      commandline: '/home/dev/.local/bin/liora',
      launcher: '/home/dev/.local/bin/superliora-term',
    });
    expect(entry).toContain('Name=SuperLiora');
    expect(entry).toContain('Terminal=false');
    expect(entry).not.toContain('Terminal=true');
    expect(entry).toContain('Exec=/home/dev/.local/bin/superliora-term');
    expect(entry).toContain('TryExec=/home/dev/.local/bin/liora');
    expect(entry).not.toContain('Icon=');
    expect(isCurrentLinuxDesktopEntry(entry)).toBe(true);

    const branded = renderLinuxDesktopEntry({
      commandline: '/home/dev/.local/bin/liora',
      launcher: '/home/dev/.local/bin/superliora-term',
      icon: '/home/dev/.local/bin/superliora.png',
    });
    expect(branded).toContain('Icon=/home/dev/.local/bin/superliora.png');
  });

  it('treats Terminal=true / bare-liora Linux desktop files as stale', () => {
    const stale = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=SuperLiora',
      'Exec=/home/dev/.local/bin/liora',
      'TryExec=/home/dev/.local/bin/liora',
      'Terminal=true',
      '',
    ].join('\n');
    expect(isCurrentLinuxDesktopEntry(stale)).toBe(false);
    expect(linuxDesktopShortcutStatus(
      '/home/dev/Desktop/SuperLiora.desktop',
      (p: string) => p === '/home/dev/Desktop/SuperLiora.desktop',
      () => stale,
    )).toBe('needed');
    expect(linuxDesktopShortcutStatus(
      '/home/dev/Desktop/SuperLiora.desktop',
      () => false,
      () => stale,
    )).toBe('needed');

    const current = renderLinuxDesktopEntry({
      commandline: '/home/dev/.local/bin/liora',
      launcher: '/home/dev/.local/bin/superliora-term',
    });
    expect(linuxDesktopShortcutStatus(
      '/home/dev/Desktop/SuperLiora.desktop',
      () => true,
      () => current,
    )).toBe('refresh');
  });

  it('renders a Linux term helper that opens a real emulator then liora', () => {
    const script = renderLinuxTermLauncherScript('/home/dev/.local/bin/liora');
    expect(script.startsWith('#!/bin/bash')).toBe(true);
    expect(script).toContain("BIN='/home/dev/.local/bin/liora'");
    expect(script).toContain('xdg-terminal-exec');
    expect(script).toContain('gnome-terminal --');
    expect(script).toContain('ghostty -e');
    expect(script).toContain('no terminal emulator found');
    expect(script).not.toContain('Terminal=true');
  });

  it('renders a macOS app that opens Terminal.app (or Kitty/Ghostty) and runs liora', () => {
    const script = renderMacosLauncherScript('/Users/dev/.local/bin/liora');
    expect(script.startsWith('#!/bin/bash')).toBe(true);
    expect(script).toContain("BIN='/Users/dev/.local/bin/liora'");
    expect(script).toContain('tell application "Terminal"');
    expect(script).toContain('quoted form of lioraBin');
    expect(script).toContain('/Applications/kitty.app');
    expect(script).toContain('$HOME/Applications/kitty.app');
    expect(script).toContain('/Applications/Ghostty.app');
    expect(script).toContain('$HOME/Applications/Ghostty.app');
    expect(renderMacosInfoPlist()).toContain(`<string>${DESKTOP_LAUNCHER_NAME}</string>`);
    expect(renderMacosInfoPlist()).toContain('dev.superliora.launcher');
    expect(renderMacosInfoPlist()).not.toContain('CFBundleIconFile');
    expect(renderMacosInfoPlist({ iconFile: 'AppIcon.png' })).toContain(
      '<string>AppIcon.png</string>',
    );
  });

  it('writes a Windows .lnk that launches Windows Terminal then liora', async () => {
    const shortcuts: Array<{ dest: string; target: string; arguments: string; icon?: string; windowStyle?: number }> = [];
    const files = new Map<string, string>();
    const wt = 'E:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe';
    const liora = 'C:\\Apps\\SuperLiora\\bin\\liora.exe';
    const result = await ensureDesktopLauncher({
      platform: 'win32',
      desktopDir: 'E:\\Users\\dev\\Desktop',
      binDir: 'C:\\Apps\\SuperLiora\\bin',
      env: {
        USERPROFILE: 'E:\\Users\\dev',
        LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local',
        SystemRoot: 'C:\\Windows',
      },
      isFile: (p: string) => p.replaceAll('/', '\\') === liora,
      wtPath: wt,
      writeFile: async (dest: string, text: string) => {
        files.set(dest, text);
      },
      writeShortcut: async (spec: { dest: string; target: string; arguments: string; icon?: string; windowStyle?: number }) => {
        shortcuts.push(spec);
        return true;
      },
      writeBrandIcon: async () => {},
      resolveWindowsDesktop: () => {
        throw new Error('should use desktopDir');
      },
    });
    expect(result.written).toBe(true);
    expect(result.path?.replaceAll('/', '\\')).toBe('E:\\Users\\dev\\Desktop\\SuperLiora.lnk');
    expect(shortcuts).toHaveLength(1);
    expect(shortcuts[0]?.target.replaceAll('/', '\\')).toBe('C:\\Windows\\System32\\conhost.exe');
    expect(shortcuts[0]?.arguments.startsWith('--headless ')).toBe(true);
    expect(shortcuts[0]?.arguments).toContain('-File "C:\\Apps\\SuperLiora\\bin\\superliora-wt.ps1"');
    expect(files.get('C:\\Apps\\SuperLiora\\bin\\superliora-wt.ps1')).toContain(liora);
    expect(files.get('C:\\Apps\\SuperLiora\\bin\\superliora-wt.ps1')).toContain(`-p ${SUPERLIORA_WT_PROFILE_NAME}`);
    expect(shortcuts[0]?.icon?.replaceAll('/', '\\')).toBe('C:\\Apps\\SuperLiora\\bin\\superliora.ico');
    expect(shortcuts[0]?.windowStyle).toBe(7);
  });

  it('points an unpackaged Windows Terminal shortcut at wt.exe itself', async () => {
    const shortcuts: Array<{ dest: string; target: string; arguments: string; icon?: string; windowStyle?: number }> = [];
    const wt = 'D:\\Apps\\Windows Terminal\\wt.exe';
    const liora = 'C:\\Apps\\SuperLiora\\bin\\liora.exe';
    const result = await ensureDesktopLauncher({
      platform: 'win32',
      desktopDir: 'E:\\Users\\dev\\Desktop',
      binDir: 'C:\\Apps\\SuperLiora\\bin',
      env: {
        USERPROFILE: 'E:\\Users\\dev',
        LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local',
      },
      isFile: (p: string) => p.replaceAll('/', '\\') === liora,
      wtPath: wt,
      writeShortcut: async (spec: { dest: string; target: string; arguments: string; icon?: string; windowStyle?: number }) => {
        shortcuts.push(spec);
        return true;
      },
      writeBrandIcon: async () => {},
    });
    expect(result.written).toBe(true);
    expect(shortcuts[0]?.target).toBe(wt);
    expect(shortcuts[0]?.icon?.replaceAll('/', '\\')).toBe('C:\\Apps\\SuperLiora\\bin\\superliora.ico');
    expect(shortcuts[0]?.arguments).toContain(`-p ${SUPERLIORA_WT_PROFILE_NAME}`);
    expect(shortcuts[0]?.arguments).not.toMatch(/start ""/);
    expect(shortcuts[0]?.windowStyle).toBeUndefined();
  });

  it('skips the Windows desktop shortcut when Terminal is missing or disabled', async () => {
    const skippedNoWt = await ensureDesktopLauncher({
      platform: 'win32',
      desktopDir: 'E:\\Users\\dev\\Desktop',
      env: { USERPROFILE: 'E:\\Users\\dev', LOCALAPPDATA: 'E:\\empty' },
      isFile: () => false,
      which: () => undefined,
      listAppx: () => undefined,
      writeShortcut: async () => {
        throw new Error('should not write');
      },
    });
    expect(skippedNoWt.skipped).toBe(true);
    expect(skippedNoWt.reason).toBe('no-wt');

    const skippedFlag = await ensureDesktopLauncher({
      platform: 'win32',
      skip: true,
      writeShortcut: async () => {
        throw new Error('should not write');
      },
    });
    expect(skippedFlag.skipped).toBe(true);

    const skippedEnv = await ensureDesktopLauncher({
      platform: 'win32',
      env: { SUPERLIORA_NO_TERMINAL: '1' },
      wtPath: 'D:\\wt.exe',
      writeShortcut: async () => {
        throw new Error('should not write');
      },
    });
    expect(skippedEnv.skipped).toBe(true);
    expect(skippedEnv.reason).toBe('no-terminal');

    const skippedOpt = await ensureDesktopLauncher({
      platform: 'win32',
      skipTerminal: true,
      wtPath: 'D:\\wt.exe',
      writeShortcut: async () => {
        throw new Error('should not write');
      },
    });
    expect(skippedOpt.skipped).toBe(true);
    expect(skippedOpt.reason).toBe('no-terminal');
  });

  it('writes a macOS .app launcher without touching the real Desktop', async () => {
    const files = new Map<string, string>();
    const modes = new Map<string, number>();
    const result = await ensureDesktopLauncher({
      platform: 'darwin',
      desktopDir: '/Users/dev/Desktop',
      binDir: '/Users/dev/.local/bin',
      env: { HOME: '/Users/dev' },
      isFile: (p: string) => p === '/Users/dev/.local/bin/liora',
      writeFile: async (dest: string, text: string) => {
        files.set(dest, text);
      },
      writeBrandIcon: async (dest: string) => {
        files.set(dest, 'png');
      },
      chmod: async (dest: string, mode: number) => {
        modes.set(dest, mode);
      },
    });
    expect(result.written).toBe(true);
    expect(result.path).toBe('/Users/dev/Desktop/SuperLiora.app');
    const script = [...files.entries()].find(([path]) => path.endsWith('/Contents/MacOS/SuperLiora'));
    const plist = [...files.entries()].find(([path]) => path.endsWith('/Contents/Info.plist'));
    expect(script?.[1]).toContain("BIN='/Users/dev/.local/bin/liora'");
    expect(plist?.[1]).toContain('CFBundleExecutable');
    expect(plist?.[1]).toContain('CFBundleIconFile');
    expect(files.get('/Users/dev/Desktop/SuperLiora.app/Contents/Resources/AppIcon.png')).toBe('png');
    expect(modes.get(script?.[0] ?? '')).toBe(0o755);
  });

  it('writes a Linux desktop entry plus an applications-menu copy', async () => {
    const files = new Map<string, string>();
    let trusted: string | undefined;
    const result = await ensureDesktopLauncher({
      platform: 'linux',
      desktopDir: '/home/dev/Desktop',
      binDir: '/home/dev/.local/bin',
      env: { HOME: '/home/dev' },
      isFile: (p: string) => p === '/home/dev/.local/bin/liora',
      writeFile: async (dest: string, text: string) => {
        files.set(dest, text);
      },
      writeBrandIcon: async () => {},
      chmod: async () => {},
      markDesktopTrusted: async (dest: string) => {
        trusted = dest;
      },
    });
    expect(result.written).toBe(true);
    expect(result.applicationWritten).toBe(true);
    expect(files.get('/home/dev/.local/bin/superliora-term')).toContain("BIN='/home/dev/.local/bin/liora'");
    expect(files.get('/home/dev/.local/bin/superliora-term')).toContain('xdg-terminal-exec');
    expect(files.get('/home/dev/Desktop/SuperLiora.desktop')).toContain('Terminal=false');
    expect(files.get('/home/dev/Desktop/SuperLiora.desktop')).not.toContain('Terminal=true');
    expect(files.get('/home/dev/Desktop/SuperLiora.desktop')).toContain(
      'Exec=/home/dev/.local/bin/superliora-term',
    );
    expect(files.get('/home/dev/Desktop/SuperLiora.desktop')).toContain(
      'TryExec=/home/dev/.local/bin/liora',
    );
    expect(files.get('/home/dev/Desktop/SuperLiora.desktop')).toContain(
      'Icon=/home/dev/.local/bin/superliora.png',
    );
    expect(files.get('/home/dev/.local/share/applications/superliora.desktop')).toContain(
      'Exec=/home/dev/.local/bin/superliora-term',
    );
    expect(trusted).toBe('/home/dev/Desktop/SuperLiora.desktop');
  });
});
