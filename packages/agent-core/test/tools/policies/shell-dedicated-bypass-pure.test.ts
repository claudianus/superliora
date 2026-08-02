import { describe, expect, it } from 'vitest';

import {
  SHELL_DEDICATED_BYPASS_CODE,
  SHELL_DEDICATED_BYPASS_FORCE_PREFIX,
  detectShellDedicatedBypass,
  formatShellDedicatedBypassError,
} from '#/tools/policies/shell-dedicated-bypass';

describe('tools/policies/shell-dedicated-bypass — SHELL_DEDICATED_BYPASS_FORCE_PREFIX', () => {
  it('exposes the documented escape-hatch prefix', () => {
    expect(SHELL_DEDICATED_BYPASS_FORCE_PREFIX).toBe('LIORA_FORCE_BASH=1');
  });
});

describe('tools/policies/shell-dedicated-bypass — detectShellDedicatedBypass', () => {
  it('returns undefined for a plain safe command', () => {
    expect(detectShellDedicatedBypass('ls -la')).toBeUndefined();
    expect(detectShellDedicatedBypass('echo hello')).toBeUndefined();
  });

  it('returns undefined for empty / whitespace input', () => {
    expect(detectShellDedicatedBypass('')).toBeUndefined();
    expect(detectShellDedicatedBypass('   \n  ')).toBeUndefined();
  });

  it('ALLOWS a command prefixed with the escape-hatch (returns undefined)', () => {
    expect(
      detectShellDedicatedBypass(`${SHELL_DEDICATED_BYPASS_FORCE_PREFIX} rm -rf /tmp/build`),
    ).toBeUndefined();
  });

  it('ALLOWS a command prefixed with the escape-hatch even when dangerous', () => {
    expect(
      detectShellDedicatedBypass(`${SHELL_DEDICATED_BYPASS_FORCE_PREFIX} git reset --hard`),
    ).toBeUndefined();
  });
});

describe('tools/policies/shell-dedicated-bypass — formatShellDedicatedBypassError', () => {
  const sampleHit = {
    prefer: 'Read' as const,
    pattern: 'cat',
    message: 'Use the Read tool for simple file dumps.',
  };

  it('mentions the LIORA_FORCE_BASH escape-hatch in the error', () => {
    const message = formatShellDedicatedBypassError(sampleHit);
    expect(message).toContain('LIORA_FORCE_BASH');
  });

  it('mentions blocked state in the error', () => {
    const message = formatShellDedicatedBypassError(sampleHit);
    expect(message).toMatch(/block|dedicated|tool/i);
  });

  it('includes Loop43a stable code marker for TUI detection', () => {
    const message = formatShellDedicatedBypassError(sampleHit);
    expect(message).toContain(`code=${SHELL_DEDICATED_BYPASS_CODE}`);
    expect(message).toContain('Read');
  });
});
