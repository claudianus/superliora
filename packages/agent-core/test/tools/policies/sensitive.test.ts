import { describe, expect, it } from 'vitest';

import { isSensitiveFile } from '../../../src/tools/policies/sensitive';

describe('isSensitiveFile', () => {
  it('flags base .env files in any directory', () => {
    for (const path of ['.env', '/app/.env', 'project/.env']) {
      expect(isSensitiveFile(path), path).toBe(true);
    }
  });

  it('flags .env.<environment> variants', () => {
    for (const path of ['.env.local', '.env.production', '/app/.env.staging']) {
      expect(isSensitiveFile(path), path).toBe(true);
    }
  });

  it('flags cloud credential file locations', () => {
    for (const path of [
      '/home/user/.aws/credentials',
      '/home/user/.aws/config',
      '/home/user/.gcp/credentials',
      '.aws/credentials',
      '.aws/config',
      '.gcp/credentials',
      'credentials',
    ]) {
      expect(isSensitiveFile(path), path).toBe(true);
    }
  });

  it('flags directory-scoped credential stores (.ssh, .gnupg, .kube, .docker)', () => {
    for (const path of [
      // .ssh — the whole directory is protected (config, known_hosts, ...).
      '/home/user/.ssh/config',
      '/home/user/.ssh/known_hosts',
      '/home/user/.ssh/authorized_keys',
      '/home/user/.ssh/id_ecdsa',
      '/home/user/.ssh',
      '.ssh/config',
      '.ssh/id_dsa',
      // .gnupg — keyrings, trusted keys, etc.
      '/home/user/.gnupg/pubring.kbx',
      '/home/user/.gnupg/private-keys-v1.d/KEY.key',
      '/home/user/.gnupg',
      '.gnupg/secring.gpg',
      // .kube / .docker — exact config files.
      '/home/user/.kube/config',
      '.kube/config',
      '/home/user/.docker/config.json',
      '.docker/config.json',
    ]) {
      expect(isSensitiveFile(path), path).toBe(true);
    }
  });

  it('does not false-positive on directory-like substrings', () => {
    for (const path of [
      // `.ssh` as a file extension, not a directory part.
      'myapp.ssh/config',
      'notes.ssh',
      // `.gnupg` inside an unrelated name.
      'docs/.gnupg-readme.md',
    ]) {
      expect(isSensitiveFile(path), path).toBe(false);
    }
  });

  it('matches sensitive patterns case-insensitively on posix paths', () => {
    for (const path of [
      '.ENV',
      '/app/.Env.Local',
      '/home/user/.AWS/Credentials',
      '/home/user/.GCP/CREDENTIALS',
      '/home/user/.ssh/ID_RSA',
      '/home/user/.ssh/ID_ED25519.OLD',
    ]) {
      expect(isSensitiveFile(path), path).toBe(true);
    }
  });

  it('does not flag normal source / config files or env exemplars', () => {
    // Mirrors the py parametrization exactly. `.envrc`, `environment.py`,
    // `.env_example`, `server.key.example`, `id_rsa.pub`, `credentials.json`
    // (basename is `credentials.json`, not the bare `credentials` token) must
    // all pass through.
    for (const path of [
      'app.py',
      'config.yml',
      'README.md',
      'package.json',
      'server.key.example',
      'id_rsa.pub',
      'credentials.json',
      '.envrc',
      'environment.py',
      '.env_example',
      '.env.example',
      '.ENV.EXAMPLE',
      '.env.sample',
      '.ENV.SAMPLE',
      '.env.template',
      '.ENV.TEMPLATE',
      '/app/.env.example',
      '/app/.ENV.EXAMPLE',
    ]) {
      expect(isSensitiveFile(path), path).toBe(false);
    }
  });
});
