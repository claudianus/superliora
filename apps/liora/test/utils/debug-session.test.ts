import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SUPERLIORA_DEBUG_ENV, SUPERLIORA_HOME_ENV } from '#/constant/app';
import {
  applyDebugCliFlag,
  isDebugSession,
  resolveDebugLogPath,
  writeDebugLog,
} from '#/utils/debug-session';

describe('debug-session', () => {
  const homes: string[] = [];
  const previousHome = process.env[SUPERLIORA_HOME_ENV];
  const previousDebug = process.env[SUPERLIORA_DEBUG_ENV];

  afterEach(() => {
    if (previousHome === undefined) delete process.env[SUPERLIORA_HOME_ENV];
    else process.env[SUPERLIORA_HOME_ENV] = previousHome;
    if (previousDebug === undefined) delete process.env[SUPERLIORA_DEBUG_ENV];
    else process.env[SUPERLIORA_DEBUG_ENV] = previousDebug;
    for (const dir of homes.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applyDebugCliFlag turns analysis on and lifts CI/TERM leftovers', () => {
    const env: NodeJS.ProcessEnv = {
      CI: 'true',
      NO_COLOR: '1',
      TERM: 'dumb',
      SUPERLIORA_HOME: '/tmp/debug-home',
    };
    applyDebugCliFlag(env);
    expect(env.CI).toBeUndefined();
    expect(env.NO_COLOR).toBeUndefined();
    expect(env.SUPERLIORA_DEBUG).toBe('1');
    expect(env.SUPERLIORA_LOG_LEVEL).toBe('info');
    expect(env.TERM).toBe('xterm-256color');
    expect(env.SUPERLIORA_DEBUG_LOG?.replaceAll('\\', '/')).toBe(
      '/tmp/debug-home/logs/debug-local.ndjson',
    );
  });

  it('does not write a log unless SUPERLIORA_DEBUG is on', () => {
    const home = mkdtempSync(join(tmpdir(), 'debug-session-'));
    homes.push(home);
    process.env[SUPERLIORA_HOME_ENV] = home;
    delete process.env[SUPERLIORA_DEBUG_ENV];
    writeDebugLog({ location: 'test.ts', message: 'should-not-write' });
    expect(isDebugSession()).toBe(false);
    expect(resolveDebugLogPath()).toBeUndefined();
  });

  it('writes redacted NDJSON when SUPERLIORA_DEBUG is on', () => {
    const home = mkdtempSync(join(tmpdir(), 'debug-session-'));
    homes.push(home);
    process.env[SUPERLIORA_HOME_ENV] = home;
    process.env[SUPERLIORA_DEBUG_ENV] = '1';
    writeDebugLog({
      location: 'test.ts:1',
      message: 'probe',
      data: { apiKey: 'sk-secret', text: 'ok' },
    });
    const logPath = resolveDebugLogPath();
    expect(logPath).toBeDefined();
    const line = readFileSync(logPath!, 'utf8').trim();
    const parsed = JSON.parse(line) as { message: string; data: { apiKey: string; text: string } };
    expect(parsed.message).toBe('probe');
    expect(parsed.data.apiKey).toBe('***');
    expect(parsed.data.text).toBe('ok');
  });
});
