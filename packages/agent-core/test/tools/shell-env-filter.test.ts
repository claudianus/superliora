import { describe, expect, it, vi } from 'vitest';
import { Readable, type Writable } from 'node:stream';

import type { Environment, KaosProcess } from '@superliora/kaos';

import {
  buildShellChildEnv,
  filterShellEnv,
  isSecretEnvKeyName,
} from '../../src/tools/policies/shell-env';
import { BashTool } from '../../src/tools/builtin/shell/bash';
import { createBackgroundManager } from '../agent/background/helpers';
import { executeTool } from './fixtures/execute-tool';
import { createFakeKaos } from './fixtures/fake-kaos';

describe('isSecretEnvKeyName', () => {
  it('matches KEY / SECRET / TOKEN substrings case-insensitively', () => {
    expect(isSecretEnvKeyName('API_KEY')).toBe(true);
    expect(isSecretEnvKeyName('MY_SECRET')).toBe(true);
    expect(isSecretEnvKeyName('GH_TOKEN')).toBe(true);
    expect(isSecretEnvKeyName('api_key')).toBe(true);
    expect(isSecretEnvKeyName('OpenAi_Token')).toBe(true);
  });

  it('matches extended credential substrings (password, bearer, webhook, …)', () => {
    expect(isSecretEnvKeyName('DB_PASSWORD')).toBe(true);
    expect(isSecretEnvKeyName('MYSQL_PASSWD')).toBe(true);
    expect(isSecretEnvKeyName('AWS_CREDENTIAL_FILE')).toBe(true);
    expect(isSecretEnvKeyName('SSH_PRIVATE_KEY')).toBe(true);
    expect(isSecretEnvKeyName('HTTP_BEARER')).toBe(true);
    expect(isSecretEnvKeyName('AUTHORIZATION')).toBe(true);
    expect(isSecretEnvKeyName('SLACK_WEBHOOK_URL')).toBe(true);
    expect(isSecretEnvKeyName('OAUTH_CLIENT_SECRET')).toBe(true);
    expect(isSecretEnvKeyName('AWS_ACCESS_KEY_ID')).toBe(true);
  });

  it('does not match ordinary path-like keys', () => {
    expect(isSecretEnvKeyName('PATH')).toBe(false);
    expect(isSecretEnvKeyName('HOME')).toBe(false);
    expect(isSecretEnvKeyName('NODE_ENV')).toBe(false);
    expect(isSecretEnvKeyName('PWD')).toBe(false);
    expect(isSecretEnvKeyName('LANG')).toBe(false);
  });
});

describe('filterShellEnv', () => {
  it('strips secret-like keys by default and keeps PATH', () => {
    const { env, strippedKeys } = filterShellEnv({
      PATH: '/usr/bin',
      HOME: '/home/user',
      API_KEY: 'should-not-appear-in-assertions-as-value-check-only-absence',
      MY_SECRET: 'x',
      GH_TOKEN: 'y',
      api_key: 'z',
      DB_PASSWORD: 'p',
      SLACK_WEBHOOK_URL: 'w',
      NODE_ENV: 'test',
    });

    expect(env['PATH']).toBe('/usr/bin');
    expect(env['HOME']).toBe('/home/user');
    expect(env['NODE_ENV']).toBe('test');
    expect(env).not.toHaveProperty('API_KEY');
    expect(env).not.toHaveProperty('MY_SECRET');
    expect(env).not.toHaveProperty('GH_TOKEN');
    expect(env).not.toHaveProperty('api_key');
    expect(env).not.toHaveProperty('DB_PASSWORD');
    expect(env).not.toHaveProperty('SLACK_WEBHOOK_URL');
    expect(strippedKeys).toEqual(
      expect.arrayContaining([
        'API_KEY',
        'MY_SECRET',
        'GH_TOKEN',
        'api_key',
        'DB_PASSWORD',
        'SLACK_WEBHOOK_URL',
      ]),
    );
    // Never assert secret values — keys only.
  });

  it('honours allowKeys escape hatch', () => {
    const { env } = filterShellEnv(
      { PATH: '/bin', SPECIAL_KEY: 'keep-me' },
      { allowKeys: ['SPECIAL_KEY'] },
    );
    expect(env).toHaveProperty('SPECIAL_KEY');
    expect(env['PATH']).toBe('/bin');
  });

  it('supports inherit core and none', () => {
    const ambient = {
      PATH: '/bin',
      HOME: '/h',
      CUSTOM: 'c',
      API_KEY: 'k',
    };
    const core = filterShellEnv(ambient, { inherit: 'core' });
    expect(core.env['PATH']).toBe('/bin');
    expect(core.env).not.toHaveProperty('CUSTOM');
    expect(core.env).not.toHaveProperty('API_KEY');

    const none = filterShellEnv(ambient, { inherit: 'none', set: { FOO: '1' } });
    expect(none.env).toEqual({ FOO: '1' });
  });

  it('applies set after strip', () => {
    const { env } = filterShellEnv(
      { PATH: '/bin', API_KEY: 'ambient' },
      { set: { MARKER: 'ok' } },
    );
    expect(env).not.toHaveProperty('API_KEY');
    expect(env['MARKER']).toBe('ok');
  });
});

describe('buildShellChildEnv', () => {
  it('lets noninteractive overrides win after filtering', () => {
    const env = buildShellChildEnv(
      { PATH: '/bin', API_KEY: 'secret', TERM: 'xterm-256color' },
      { TERM: 'dumb', NO_COLOR: '1' },
    );
    expect(env['TERM']).toBe('dumb');
    expect(env['NO_COLOR']).toBe('1');
    expect(env).not.toHaveProperty('API_KEY');
    expect(env['PATH']).toBe('/bin');
  });
});

const posixEnv: Environment = {
  osKind: 'Linux',
  osArch: 'x86_64',
  osVersion: 'test',
  shellPath: '/bin/bash',
  shellName: 'bash',
};

function fakeProcess(): KaosProcess {
  return {
    stdin: { end: vi.fn(), write: vi.fn() } as unknown as Writable,
    stdout: Readable.from([]),
    stderr: Readable.from([]),
    pid: 402,
    exitCode: 0,
    wait: vi.fn(async () => 0),
    kill: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
}

describe('BashTool spawn secret filter (unit-env-filter)', () => {
  it('does not pass secret-like ambient keys to kaos.execWithEnv', async () => {
    const seeded: Record<string, string | undefined> = {
      API_KEY: 'do-not-log-value',
      MY_SECRET: 'do-not-log-value',
      GH_TOKEN: 'do-not-log-value',
      api_key: 'do-not-log-value',
      PATH: process.env['PATH'],
    };
    const previous: Record<string, string | undefined> = {};
    for (const key of Object.keys(seeded)) {
      previous[key] = process.env[key];
      const value = seeded[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    try {
      const execWithEnv = vi.fn().mockResolvedValue(fakeProcess());
      const tool = new BashTool(
        createFakeKaos({ execWithEnv, osEnv: posixEnv }),
        '/workspace',
        createBackgroundManager().manager,
      );
      await executeTool(tool, {
        turnId: '0',
        toolCallId: 'tc_env_filter',
        args: { command: 'true', timeout: 1000 },
        signal: new AbortController().signal,
      });

      const childEnv = execWithEnv.mock.calls[0]?.[1] as Record<string, string>;
      expect(childEnv).not.toHaveProperty('API_KEY');
      expect(childEnv).not.toHaveProperty('MY_SECRET');
      expect(childEnv).not.toHaveProperty('GH_TOKEN');
      expect(childEnv).not.toHaveProperty('api_key');
      expect(childEnv['NO_COLOR']).toBe('1');
      expect(childEnv['TERM']).toBe('dumb');
      // PATH may be present from ambient when not secret-named.
      if (seeded['PATH'] !== undefined) {
        expect(childEnv['PATH']).toBe(seeded['PATH']);
      }
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
