import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  needsWindowsCmdWrapper,
  resolveSetupSpawn,
  runSetupCommand,
} from '../src/setup-command';

describe('resolveSetupSpawn', () => {
  it('wraps .cmd through cmd.exe /d /s /c on win32', () => {
    const resolved = resolveSetupSpawn('npx.cmd', ['--version'], {
      platform: 'win32',
      comspec: 'C:\\Windows\\System32\\cmd.exe',
    });
    expect(resolved.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(resolved.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(resolved.args[3]).toContain('npx.cmd');
    expect(resolved.args[3]).toContain('--version');
    expect(resolved.windowsVerbatimArguments).toBe(true);
    expect(resolved.displayCommand).toEqual(['npx.cmd', '--version']);
  });

  it('wraps extensionless Windows shims (npx, corepack, pnpm)', () => {
    for (const shim of ['npx', 'corepack', 'pnpm.cmd']) {
      expect(needsWindowsCmdWrapper(shim, 'win32')).toBe(true);
      const resolved = resolveSetupSpawn(shim, ['info'], { platform: 'win32', comspec: 'cmd.exe' });
      expect(resolved.command).toBe('cmd.exe');
      expect(resolved.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    }
  });

  it('spawns .exe directly without a cmd.exe wrapper', () => {
    const resolved = resolveSetupSpawn('C:\\tools\\node.exe', ['-e', '0'], {
      platform: 'win32',
      comspec: 'cmd.exe',
    });
    expect(resolved.command).toBe('C:\\tools\\node.exe');
    expect(resolved.args).toEqual(['-e', '0']);
    expect(resolved.windowsVerbatimArguments).toBeUndefined();
  });

  it('does not wrap on posix', () => {
    const resolved = resolveSetupSpawn('npx', ['--version'], { platform: 'linux' });
    expect(resolved.command).toBe('npx');
    expect(resolved.args).toEqual(['--version']);
  });
});

describe('runSetupCommand Windows .cmd', () => {
  it('runs a .cmd file without spawn EINVAL', async () => {
    if (process.platform !== 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'gui-use-cmd-'));
    const cmdPath = join(dir, 'echo-ok.cmd');
    writeFileSync(cmdPath, '@echo off\r\necho OK-FROM-CMD\r\n');
    const result = await runSetupCommand(cmdPath, [], { quiet: true, timeoutMs: 15_000 });
    expect(result.error ?? '').not.toMatch(/EINVAL/i);
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('OK-FROM-CMD');
  });
});
