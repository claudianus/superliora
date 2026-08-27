import { describe, expect, it } from 'vitest';

import {
  ensureHostSetup,
  formatHostSetupPlan,
  planHostSetup,
  skipHostSetupRequested,
} from '../../../../scripts/install/host-setup.mjs';

describe('scripts/install/host-setup', () => {
  it('plans Windows installs, writes, and setting changes', () => {
    const plan = planHostSetup({
      platform: 'win32',
      env: { USERPROFILE: 'E:\\Users\\dev', LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local' },
      isFile: () => false,
      which: () => undefined,
      readText: () => '',
    });
    expect(plan.applicable).toBe(true);
    expect(plan.needsApply).toBe(true);
    expect(plan.items.some((item: { id: string }) => item.id === 'windows-terminal')).toBe(true);
    expect(plan.items.some((item: { id: string }) => item.id === 'desktop-shortcut')).toBe(true);
    expect(plan.items.some((item: { id: string }) => item.id === 'nerd-font')).toBe(true);
    expect(plan.items.some((item: { id: string }) => item.id === 'oh-my-posh')).toBe(true);
    expect(plan.items.some((item: { id: string }) => item.id === 'shell-profile')).toBe(true);
    expect(plan.items.some((item: { kind: string }) => item.kind === 'change')).toBe(true);
    expect(formatHostSetupPlan(plan)).toContain('Install');
    expect(formatHostSetupPlan(plan)).toContain('Write');
    expect(formatHostSetupPlan(plan)).toContain('Change');
  });

  it('plans macOS and Linux without Windows Terminal', () => {
    const darwin = planHostSetup({
      platform: 'darwin',
      env: { HOME: '/Users/dev' },
      isFile: () => false,
      which: () => undefined,
      readText: () => '',
    });
    expect(darwin.applicable).toBe(true);
    expect(darwin.items.some((item: { id: string }) => item.id === 'windows-terminal')).toBe(false);
    expect(darwin.items.some((item: { id: string }) => item.id === 'desktop-shortcut')).toBe(true);
    expect(darwin.items.some((item: { id: string }) => item.id === 'nerd-font')).toBe(true);
    expect(darwin.items.some((item: { id: string }) => item.id === 'shell-profile')).toBe(true);

    const linux = planHostSetup({
      platform: 'linux',
      env: { HOME: '/home/dev' },
      isFile: () => false,
      which: () => undefined,
      readText: () => '',
    });
    expect(linux.items.some((item: { id: string }) => item.id === 'font-cache')).toBe(true);
    expect(linux.items.some((item: { id: string }) => item.id === 'desktop-shortcut')).toBe(true);
  });

  it('marks a stale Linux Terminal=true desktop shortcut as needed', () => {
    const dest = '/home/dev/Desktop/SuperLiora.desktop';
    const stale = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=SuperLiora',
      'Exec=/home/dev/.local/bin/liora',
      'Terminal=true',
      '',
    ].join('\n');
    const plan = planHostSetup({
      platform: 'linux',
      env: { HOME: '/home/dev' },
      isFile: (p: string) => p === dest,
      which: () => undefined,
      readText: (p: string) => (p === dest ? stale : ''),
    });
    const row = plan.items.find((item: { id: string }) => item.id === 'desktop-shortcut');
    expect(row?.status).toBe('needed');
    expect(plan.needsApply).toBe(true);
  });

  it('omits Windows Terminal when skipTerminal is set, but keeps font and shell', () => {
    const plan = planHostSetup({
      platform: 'win32',
      skipTerminal: true,
      env: { USERPROFILE: 'E:\\Users\\dev' },
      isFile: () => false,
      which: () => undefined,
      readText: () => '',
    });
    expect(plan.items.some((item: { id: string }) => item.id === 'windows-terminal')).toBe(false);
    expect(plan.items.some((item: { id: string }) => item.id === 'desktop-shortcut')).toBe(false);
    expect(plan.items.some((item: { id: string }) => item.id === 'nerd-font')).toBe(true);
  });

  it('honors SUPERLIORA_NO_HOST_SETUP without treating --no-terminal as a full skip', () => {
    expect(skipHostSetupRequested({ SUPERLIORA_NO_HOST_SETUP: '1' })).toBe(true);
    expect(skipHostSetupRequested({ SUPERLIORA_NO_TERMINAL: '1' })).toBe(false);
    expect(skipHostSetupRequested({}, { skip: true })).toBe(true);
  });

  it('writes the desktop launcher when host setup applies on Linux', async () => {
    const files = new Map<string, string>();
    const result = await ensureHostSetup({
      platform: 'linux',
      desktopDir: '/home/dev/Desktop',
      binDir: '/home/dev/.local/bin',
      noShellRc: true,
      skipPackages: true,
      env: {
        HOME: '/home/dev',
        SUPERLIORA_NO_NERD_FONT: '1',
        SUPERLIORA_NO_SHELL_VIBE: '1',
      },
      isFile: (p: string) => p === '/home/dev/.local/bin/liora',
      writeFile: async (dest: string, text: string) => {
        files.set(dest, text);
      },
      writeBrandIcon: async () => {},
      chmod: async () => {},
      markDesktopTrusted: async () => {},
      readText: () => '',
    });
    expect(result.desktopShortcutWritten).toBe(true);
    expect(files.get('/home/dev/.local/bin/superliora-term')).toContain('xdg-terminal-exec');
    expect(files.get('/home/dev/Desktop/SuperLiora.desktop')).toContain('Terminal=false');
    expect(files.get('/home/dev/Desktop/SuperLiora.desktop')).toContain(
      'Exec=/home/dev/.local/bin/superliora-term',
    );
    expect(files.get('/home/dev/Desktop/SuperLiora.desktop')).toContain(
      'Icon=/home/dev/.local/bin/superliora.png',
    );
  });

  it('marks existing stale Windows shortcuts as needed, not refresh', () => {
    const env = {
      USERPROFILE: 'E:\\Users\\dev',
      LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local',
      APPDATA: 'E:\\Users\\dev\\AppData\\Roaming',
    };
    const desktop = 'E:\\Users\\dev\\Desktop\\SuperLiora.lnk';
    const startMenu = 'E:\\Users\\dev\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\SuperLiora.lnk';
    const present = new Set([
      desktop.replaceAll('/', '\\').toLowerCase(),
      startMenu.replaceAll('/', '\\').toLowerCase(),
    ]);
    const payloads = new Map([
      [desktop.replaceAll('/', '\\').toLowerCase(), 'C:\\Windows\\System32\\cmd.exe /c start "" wt.exe'],
      [
        startMenu.replaceAll('/', '\\').toLowerCase(),
        'E:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe',
      ],
    ]);
    const stale = planHostSetup({
      platform: 'win32',
      env,
      isFile: (p: string) => present.has(p.replaceAll('/', '\\').toLowerCase()),
      which: () => undefined,
      readText: () => '',
      readBytes: (p: string) => payloads.get(p.replaceAll('/', '\\').toLowerCase()),
    });
    expect(stale.needsApply).toBe(true);
    expect(stale.items.find((item: { id: string }) => item.id === 'desktop-shortcut')?.status)
      .toBe('needed');
    expect(stale.items.find((item: { id: string }) => item.id === 'start-menu')?.status)
      .toBe('needed');

    const current = planHostSetup({
      platform: 'win32',
      env,
      isFile: (p: string) => present.has(p.replaceAll('/', '\\').toLowerCase()),
      which: () => undefined,
      readText: () => '',
      readBytes: () => 'C:\\Windows\\System32\\conhost.exe --headless powershell -File superliora-wt.ps1',
    });
    expect(current.items.find((item: { id: string }) => item.id === 'desktop-shortcut')?.status)
      .toBe('refresh');
    expect(current.items.find((item: { id: string }) => item.id === 'start-menu')?.status)
      .toBe('refresh');
  });

  it('skipPackages rewrites the Windows desktop shortcut without GetFolderPath', async () => {
    const shortcuts: Array<{ dest: string; target: string; arguments: string }> = [];
    const wt = 'E:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe';
    const liora = 'E:\\Users\\dev\\AppData\\Local\\SuperLiora\\bin\\liora.exe';
    const result = await ensureHostSetup({
      platform: 'win32',
      skipPackages: true,
      noShellRc: true,
      binDir: 'E:\\Users\\dev\\AppData\\Local\\SuperLiora\\bin',
      env: {
        USERPROFILE: 'E:\\Users\\dev',
        LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local',
        APPDATA: 'E:\\Users\\dev\\AppData\\Roaming',
        SystemRoot: 'C:\\Windows',
        SUPERLIORA_NO_NERD_FONT: '1',
        SUPERLIORA_NO_SHELL_VIBE: '1',
      },
      isFile: (p: string) => {
        const n = p.replaceAll('/', '\\').toLowerCase();
        return n === wt.toLowerCase() || n === liora.toLowerCase();
      },
      which: () => undefined,
      listAppx: () => undefined,
      resolveWindowsDesktop: () => {
        throw new Error('should not resolve Desktop during upgrade refresh');
      },
      writeFile: async () => {},
      writeBrandIcon: async () => {},
      writeShortcut: async (spec: { dest: string; target: string; arguments: string }) => {
        shortcuts.push(spec);
        return true;
      },
      readText: () => '',
    });
    expect(result.desktopShortcutWritten).toBe(true);
    const desktop = shortcuts.find((spec) =>
      spec.dest.replaceAll('/', '\\').toLowerCase().endsWith('\\desktop\\superliora.lnk'),
    );
    expect(desktop).toBeDefined();
    expect(desktop?.target.replaceAll('/', '\\')).toBe('C:\\Windows\\System32\\conhost.exe');
    expect(desktop?.arguments).toContain('superliora-wt.ps1');
  });

  it('skipPackages does not probe GetFolderPath when Terminal is missing', async () => {
    const result = await ensureHostSetup({
      platform: 'win32',
      skipPackages: true,
      noShellRc: true,
      env: {
        USERPROFILE: 'E:\\Users\\dev',
        LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local',
        SUPERLIORA_NO_NERD_FONT: '1',
        SUPERLIORA_NO_SHELL_VIBE: '1',
      },
      isFile: () => false,
      which: () => undefined,
      listAppx: () => undefined,
      resolveWindowsDesktop: () => {
        throw new Error('should not resolve Desktop during upgrade refresh');
      },
      writeShortcut: async () => {
        throw new Error('should not write desktop shortcut');
      },
      readText: () => '',
    });
    expect(result.desktopShortcutWritten).toBe(false);
  });

  it('does not write a Windows desktop shortcut when skipTerminal is set', async () => {
    const result = await ensureHostSetup({
      platform: 'win32',
      skipTerminal: true,
      noShellRc: true,
      skipPackages: true,
      env: {
        USERPROFILE: 'E:\\Users\\dev',
        SUPERLIORA_NO_NERD_FONT: '1',
        SUPERLIORA_NO_SHELL_VIBE: '1',
      },
      isFile: () => false,
      which: () => undefined,
      writeShortcut: async () => {
        throw new Error('should not write desktop shortcut');
      },
      readText: () => '',
    });
    expect(result.desktopShortcutWritten).toBe(false);
  });
});
