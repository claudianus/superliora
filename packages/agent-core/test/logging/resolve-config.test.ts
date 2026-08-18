import { describe, expect, it } from 'vitest';

import { resolveLoggingConfig } from '#/logging/resolve-config';

describe('resolveLoggingConfig', () => {
  it('defaults to warn so user sessions skip info-level disk chatter', () => {
    expect(resolveLoggingConfig({ homeDir: '/tmp/home', env: {} }).level).toBe('warn');
  });

  it('raises the default to info when SUPERLIORA_DEBUG is on', () => {
    expect(
      resolveLoggingConfig({ homeDir: '/tmp/home', env: { SUPERLIORA_DEBUG: '1' } }).level,
    ).toBe('info');
  });

  it('lets SUPERLIORA_LOG_LEVEL win over SUPERLIORA_DEBUG', () => {
    expect(
      resolveLoggingConfig({
        homeDir: '/tmp/home',
        env: { SUPERLIORA_DEBUG: '1', SUPERLIORA_LOG_LEVEL: 'error' },
      }).level,
    ).toBe('error');
  });

  it('prefers SUPERLIORA_LOG_* over legacy KIMI_LOG_*', () => {
    const config = resolveLoggingConfig({
      homeDir: '/tmp/home',
      env: {
        SUPERLIORA_LOG_LEVEL: 'debug',
        KIMI_LOG_LEVEL: 'error',
        SUPERLIORA_LOG_GLOBAL_FILES: '9',
        KIMI_LOG_GLOBAL_FILES: '2',
      },
    });
    expect(config.level).toBe('debug');
    expect(config.globalFiles).toBe(9);
    expect(config.mirrorSessionWarnToGlobal).toBe(true);
  });

  it('falls back to KIMI_LOG_* when SuperLiora keys are unset', () => {
    const config = resolveLoggingConfig({
      homeDir: '/tmp/home',
      env: {
        KIMI_LOG_LEVEL: 'warn',
        KIMI_LOG_MIRROR_WARN: '0',
      },
    });
    expect(config.level).toBe('warn');
    expect(config.mirrorSessionWarnToGlobal).toBe(false);
  });
});
