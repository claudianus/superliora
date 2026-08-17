import { describe, expect, it } from 'vitest';

import { formatWindowsSetupApply, formatWindowsSetupStatus } from '#/tui/commands/info/windows-setup';
import { findBuiltInSlashCommand } from '#/tui/commands/hub/registry';
import {
  isCiLike,
  shouldAutoApplyWindowsSetup,
  windowsTuiHostDegraded,
} from '#/tui/utils/terminal/windows-host';

describe('windows-setup slash + host probe', () => {
  it('registers /windows-setup with vibe-setup and terminal-setup aliases', () => {
    expect(findBuiltInSlashCommand('windows-setup')?.name).toBe('windows-setup');
    expect(findBuiltInSlashCommand('vibe-setup')?.name).toBe('windows-setup');
    expect(findBuiltInSlashCommand('terminal-setup')?.name).toBe('windows-setup');
  });

  it('treats missing WT_SESSION on Windows as a degraded TUI host', () => {
    expect(windowsTuiHostDegraded({}, 'win32')).toBe(true);
    expect(windowsTuiHostDegraded({ WT_SESSION: 'abc' }, 'win32')).toBe(false);
    expect(windowsTuiHostDegraded({}, 'linux')).toBe(false);
  });

  it('auto-applies on conhost unless CI or skip flags', () => {
    expect(shouldAutoApplyWindowsSetup({}, 'win32')).toBe(true);
    expect(shouldAutoApplyWindowsSetup({ WT_SESSION: 'abc' }, 'win32')).toBe(false);
    expect(shouldAutoApplyWindowsSetup({ CI: 'true' }, 'win32')).toBe(false);
    expect(shouldAutoApplyWindowsSetup({ SUPERLIORA_AUTO_TERMINAL: '0' }, 'win32')).toBe(false);
    expect(shouldAutoApplyWindowsSetup({ SUPERLIORA_NO_TERMINAL: '1' }, 'win32')).toBe(false);
    expect(shouldAutoApplyWindowsSetup({}, 'linux')).toBe(false);
    expect(isCiLike({ GITHUB_ACTIONS: 'true' })).toBe(true);
  });

  it('formats a degraded probe with an apply hint', () => {
    const text = formatWindowsSetupStatus({
      applicable: true,
      host: 'conhost',
      status: 'degraded',
      inWindowsTerminal: false,
      hasWt: false,
      hasNerdFont: false,
      hasOhMyPosh: false,
    });
    expect(text).toContain('host=conhost');
    expect(text).toContain('status=degraded');
    expect(text).toContain('/windows-setup apply');
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
});
