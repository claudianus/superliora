import { describe, expect, it } from 'vitest';

import {
  detectShellSensitivePath,
  formatShellSensitivePathError,
} from '../../src/tools/policies/shell-sensitive-path';

describe('detectShellSensitivePath', () => {
  it('blocks cat/read of .env and key files', () => {
    expect(detectShellSensitivePath('cat .env')?.path).toBe('.env');
    expect(detectShellSensitivePath('cat ./.env.local')?.path).toContain('.env.local');
    expect(detectShellSensitivePath('cat ~/.ssh/id_rsa')?.path).toContain('id_rsa');
    expect(detectShellSensitivePath('base64 /home/u/.aws/credentials')?.path).toContain(
      'credentials',
    );
  });

  it('blocks redirects and source of secrets', () => {
    expect(detectShellSensitivePath('echo x > .env')?.path).toBe('.env');
    expect(detectShellSensitivePath('source .env')?.path).toBe('.env');
    expect(detectShellSensitivePath('. .env')?.path).toBe('.env');
  });

  it('blocks even with LIORA_FORCE_BASH escape', () => {
    expect(detectShellSensitivePath('LIORA_FORCE_BASH=1 cat .env')?.path).toBe('.env');
  });

  it('allows non-secret paths and .env.example', () => {
    expect(detectShellSensitivePath('cat README.md')).toBeUndefined();
    expect(detectShellSensitivePath('cat .env.example')).toBeUndefined();
    expect(detectShellSensitivePath('pnpm test')).toBeUndefined();
    expect(detectShellSensitivePath('echo "update the env file later"')).toBeUndefined();
  });

  it('formats a clear hard-deny message', () => {
    const hit = detectShellSensitivePath('cat .env');
    expect(hit).toBeDefined();
    const msg = formatShellSensitivePathError(hit!);
    expect(msg).toContain('Bash blocked');
    expect(msg).toContain('sensitive');
    expect(msg).toContain('.env');
  });
});
