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
      chmod: async () => {},
      markDesktopTrusted: async () => {},
      readText: () => '',
    });
    expect(result.desktopShortcutWritten).toBe(true);
    expect(files.get('/home/dev/Desktop/SuperLiora.desktop')).toContain('Terminal=true');
    expect(files.get('/home/dev/Desktop/SuperLiora.desktop')).toContain('Exec=/home/dev/.local/bin/liora');
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
