import { describe, expect, it } from 'vitest';

import { parseHostSetupAction } from '#/tui/commands/info/host-setup';
import { formatWindowsSetupApply, formatWindowsSetupStatus } from '#/tui/commands/info/windows-setup';
import { findBuiltInSlashCommand } from '#/tui/commands/hub/registry';
import { HostSetupConfirmSheetComponent } from '#/tui/components/dialogs/host-setup/host-setup-confirm';
import {
  isCiLike,
  shouldAutoApplyWindowsSetup,
  shouldPromptHostSetup,
  windowsTuiHostDegraded,
} from '#/tui/utils/terminal/windows-host';

const samplePlan = {
  platform: 'win32',
  applicable: true,
  needsApply: true,
  items: [
    {
      id: 'nerd-font',
      kind: 'install' as const,
      title: 'CaskaydiaCove NF (Nerd Font)',
      detail: 'User fonts',
      status: 'needed' as const,
    },
    {
      id: 'omp-theme',
      kind: 'write' as const,
      title: 'Oh My Posh Neon Noir theme',
      detail: 'theme.json',
      status: 'refresh' as const,
    },
  ],
};

describe('host-setup slash + host probe', () => {
  it('registers /host-setup with platform aliases', () => {
    expect(findBuiltInSlashCommand('host-setup')?.name).toBe('host-setup');
    expect(findBuiltInSlashCommand('windows-setup')?.name).toBe('host-setup');
    expect(findBuiltInSlashCommand('macos-setup')?.name).toBe('host-setup');
    expect(findBuiltInSlashCommand('linux-setup')?.name).toBe('host-setup');
    expect(findBuiltInSlashCommand('vibe-setup')?.name).toBe('host-setup');
    expect(findBuiltInSlashCommand('terminal-setup')?.name).toBe('host-setup');
  });

  it('defaults slash args to apply and honors -y', () => {
    expect(parseHostSetupAction('')).toEqual({ action: 'apply', skipConfirm: false });
    expect(parseHostSetupAction('status')).toEqual({ action: 'status', skipConfirm: false });
    expect(parseHostSetupAction('apply -y')).toEqual({ action: 'apply', skipConfirm: true });
    expect(parseHostSetupAction('yes')).toEqual({ action: 'apply', skipConfirm: true });
    expect(parseHostSetupAction('nope').action).toBe('unknown');
  });

  it('treats missing WT_SESSION on Windows as a degraded TUI host', () => {
    expect(windowsTuiHostDegraded({}, 'win32')).toBe(true);
    expect(windowsTuiHostDegraded({ WT_SESSION: 'abc' }, 'win32')).toBe(false);
    expect(windowsTuiHostDegraded({}, 'linux')).toBe(false);
  });

  it('never silently auto-applies; startup uses a confirm sheet', () => {
    expect(shouldAutoApplyWindowsSetup({}, 'win32')).toBe(false);
    expect(shouldPromptHostSetup({})).toBe(true);
    expect(shouldPromptHostSetup({ CI: 'true' })).toBe(false);
    expect(shouldPromptHostSetup({ SUPERLIORA_AUTO_TERMINAL: '0' })).toBe(false);
    expect(shouldPromptHostSetup({ SUPERLIORA_NO_HOST_SETUP: '1' })).toBe(false);
    expect(shouldPromptHostSetup({ SUPERLIORA_NO_TERMINAL: '1' })).toBe(true);
    expect(isCiLike({ GITHUB_ACTIONS: 'true' })).toBe(true);
  });

  it('formats a plan with an apply hint', () => {
    const text = formatWindowsSetupStatus(samplePlan);
    expect(text).toContain('platform=win32');
    expect(text).toContain('needsApply=yes');
    expect(text).toContain('install:nerd-font=needed');
    expect(text).toContain('/host-setup');
  });

  it('formats a successful apply summary', () => {
    const text = formatWindowsSetupApply({
      ok: true,
      installed: true,
      nerdFontInstalled: true,
      ohMyPoshInstalled: true,
      zoxideInstalled: true,
      fragmentWritten: true,
      shortcutWritten: true,
    });
    expect(text).toContain('terminal');
    expect(text).toContain('nerd-font');
    expect(text).toContain('oh-my-posh');
    expect(text).toContain('zoxide');
    expect(text).toContain('profile');
  });

  it('renders the confirm sheet with install and write sections', () => {
    const sheet = new HostSetupConfirmSheetComponent({
      plan: samplePlan,
      onSelect: () => {},
      onCancel: () => {},
    });
    const lines = sheet.render(80).join('\n');
    expect(lines).toContain('CaskaydiaCove NF');
    expect(lines).toContain('Oh My Posh Neon Noir theme');
  });
});
