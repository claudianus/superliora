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

  it('blocks redirects, source, and command-substitution wrappers', () => {
    expect(detectShellSensitivePath('echo x > .env')?.path).toBe('.env');
    expect(detectShellSensitivePath('source .env')?.path).toBe('.env');
    expect(detectShellSensitivePath('. .env')?.path).toBe('.env');
    expect(detectShellSensitivePath('echo $(cat .env)')?.path).toBe('.env');
    expect(detectShellSensitivePath('export $(cat .env | xargs)')?.path).toBe('.env');
  });

  it('blocks flag/assignment forms and $HOME paths', () => {
    expect(detectShellSensitivePath('docker run --env-file=.env')?.path).toBe('.env');
    expect(detectShellSensitivePath('cmd --env-file .env')?.path).toBe('.env');
    expect(detectShellSensitivePath('tool ENV_FILE=.env.production')?.path).toContain('.env');
    expect(detectShellSensitivePath('cat $HOME/.ssh/id_ed25519')?.path).toContain('id_ed25519');
    expect(detectShellSensitivePath('cat file://.env')?.path).toBe('.env');
  });

  it('blocks remote scp/rsync and language open() one-liners', () => {
    expect(detectShellSensitivePath('scp user@host:.env ./')?.path).toBe('.env');
    expect(detectShellSensitivePath('scp host:/home/u/.ssh/id_rsa ./key')?.path).toContain('id_rsa');
    expect(detectShellSensitivePath('python -c "print(open(\'.env\').read())"')?.path).toBe('.env');
    expect(detectShellSensitivePath("node -e \"require('fs').readFileSync('.env')\"")?.path).toBe('.env');
  });

  it('blocks even with LIORA_FORCE_BASH escape', () => {
    expect(detectShellSensitivePath('LIORA_FORCE_BASH=1 cat .env')?.path).toBe('.env');
  });

  it('allows non-secret paths, prose, and bare English words', () => {
    expect(detectShellSensitivePath('cat README.md')).toBeUndefined();
    expect(detectShellSensitivePath('cat .env.example')).toBeUndefined();
    expect(detectShellSensitivePath('pnpm test')).toBeUndefined();
    expect(detectShellSensitivePath('echo "update the env file later"')).toBeUndefined();
    expect(detectShellSensitivePath('echo credentials')).toBeUndefined();
    expect(detectShellSensitivePath('git config user.name')).toBeUndefined();
    expect(detectShellSensitivePath('npm config get registry')).toBeUndefined();
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
