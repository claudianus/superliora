import { describe, expect, it } from 'vitest';
import { findUnsafeVerificationCommand, parseVerificationCommand } from '../../../src/autopilot/verification';

describe('autopilot verification guard', () => {
  it('accepts plain tokenized commands', () => {
    expect(parseVerificationCommand('pnpm run build')?.tokens).toEqual(['pnpm', 'run', 'build']);
  });
  it('rejects shell metacharacters', () => {
    expect(parseVerificationCommand('pnpm run build; rm -rf /')).toBeNull();
    expect(parseVerificationCommand('cat $(whoami)')).toBeNull();
  });
  it('allows explicit shell opt-in', () => {
    expect(parseVerificationCommand({ command: 'a && b', shell: true })?.useShell).toBe(true);
  });
  it('findUnsafeVerificationCommand flags the first bad command', () => {
    const bad = findUnsafeVerificationCommand(['pnpm test', 'echo $HOME']);
    expect(bad).toBe('echo $HOME');
  });
});
