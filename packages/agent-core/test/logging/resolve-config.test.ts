import { describe, expect, it } from 'vitest';

import { resolveLoggingConfig } from '#/logging/resolve-config';

describe('resolveLoggingConfig', () => {
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
