import { describe, expect, it } from 'vitest';

import {
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
    expect(plan.items.some((item: { id: string }) => item.id === 'nerd-font')).toBe(true);
  });

  it('honors SUPERLIORA_NO_HOST_SETUP without treating --no-terminal as a full skip', () => {
    expect(skipHostSetupRequested({ SUPERLIORA_NO_HOST_SETUP: '1' })).toBe(true);
    expect(skipHostSetupRequested({ SUPERLIORA_NO_TERMINAL: '1' })).toBe(false);
    expect(skipHostSetupRequested({}, { skip: true })).toBe(true);
  });
});
