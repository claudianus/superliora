import { describe, it, expect, afterEach } from 'vitest';

import { createProgram } from '#/cli/commands';
import { detectCliLocale, getCliLocale, setCliLocale, t } from '#/cli/i18n';

afterEach(() => {
  // The locale is a module-level singleton; always restore English so other
  // test files that assert on English help text are not affected.
  setCliLocale('en');
});

describe('detectCliLocale', () => {
  it('selects Korean for ko* locales and English otherwise', () => {
    expect(detectCliLocale({ LANG: 'ko_KR.UTF-8' })).toBe('ko');
    expect(detectCliLocale({ LANG: 'ko.UTF-8' })).toBe('ko');
    expect(detectCliLocale({ LC_ALL: 'ko_KR.UTF-8' })).toBe('ko');
    expect(detectCliLocale({ LC_MESSAGES: 'ko-KR' })).toBe('ko');
    expect(detectCliLocale({ LANGUAGE: 'ko:en' })).toBe('ko');
    expect(detectCliLocale({ LANG: 'en_US.UTF-8' })).toBe('en');
    expect(detectCliLocale({ LANG: 'C' })).toBe('en');
    expect(detectCliLocale({})).toBe('en');
  });

  it('honors SUPERLIORA_LOCALE over the standard locale variables', () => {
    expect(detectCliLocale({ SUPERLIORA_LOCALE: 'ko', LANG: 'en_US.UTF-8' })).toBe('ko');
    expect(detectCliLocale({ SUPERLIORA_LOCALE: 'en', LANG: 'ko_KR.UTF-8' })).toBe('en');
  });

  it('checks variables in priority order', () => {
    // LANGUAGE is checked before LANG.
    expect(detectCliLocale({ LANGUAGE: 'ko', LANG: 'en_US.UTF-8' })).toBe('ko');
    // LC_ALL outranks LC_MESSAGES and LANG.
    expect(detectCliLocale({ LC_ALL: 'ko_KR.UTF-8', LANG: 'en_US.UTF-8' })).toBe('ko');
  });
});

describe('t()', () => {
  it('renders English by default and Korean after setCliLocale', () => {
    expect(getCliLocale()).toBe('en');
    expect(t('cli.description')).toBe('The Starting Point for Next-Gen Agents');
    setCliLocale('ko');
    expect(getCliLocale()).toBe('ko');
    expect(t('cli.description')).toBe('차세대 에이전트의 시작점');
  });

  it('falls back to English for keys missing from the Korean catalog', () => {
    setCliLocale('ko');
    // A key that only exists in the English catalog still renders English.
    expect(t('cli.option.plan')).toBe('Ultrawork 플랜 조향으로 시작합니다.');
  });

  it('substitutes {placeholder} params', () => {
    expect(t('cli.error.unknownCommand', { arg: 'bogus', cmd: 'liora' })).toBe(
      "unknown command 'bogus'. See 'liora --help'.",
    );
    setCliLocale('ko');
    expect(t('cli.error.unknownCommand', { arg: 'bogus', cmd: 'liora' })).toBe(
      "알 수 없는 명령 'bogus'. 'liora --help'를 참고하세요.",
    );
  });
});

describe('createProgram localization', () => {
  it('renders Korean help text when the locale is Korean', () => {
    setCliLocale('ko');
    const program = createProgram('0.0.0', () => {}, () => {}, () => {});
    let output = '';
    program.exitOverride();
    program.configureOutput({
      writeOut: (s) => {
        output += s;
      },
      writeErr: (s) => {
        output += s;
      },
    });
    expect(() => program.parse(['node', 'liora', '--help'])).toThrow();
    expect(output).toContain('차세대 에이전트의 시작점');
    expect(output).toContain('Ultrawork 플랜 조향으로 시작합니다.');
    // Subcommand summary in the help listing.
    expect(output).toContain('세션을 ZIP 아카이브로 내보냅니다.');
  });

  it('renders English help text by default', () => {
    const program = createProgram('0.0.0', () => {}, () => {}, () => {});
    let output = '';
    program.exitOverride();
    program.configureOutput({
      writeOut: (s) => {
        output += s;
      },
      writeErr: (s) => {
        output += s;
      },
    });
    expect(() => program.parse(['node', 'liora', '--help'])).toThrow();
    expect(output).toContain('The Starting Point for Next-Gen Agents');
    expect(output).toContain('Start with Ultrawork plan steering.');
  });

  it('localizes runtime export messages when locale is Korean', () => {
    setCliLocale('ko');
    expect(t('cli.runtime.export.noPreviousSession')).toBe('내보낼 이전 세션이 없습니다.');
  });

  it('localizes subcommand descriptions', () => {
    setCliLocale('ko');
    const program = createProgram('0.0.0', () => {}, () => {}, () => {});
    const exportCmd = program.commands.find((c) => c.name() === 'export');
    expect(exportCmd?.description()).toBe('세션을 ZIP 아카이브로 내보냅니다.');
    const loginCmd = program.commands.find((c) => c.name() === 'login');
    expect(loginCmd?.description()).toBe('디바이스 코드 흐름으로 SuperLiora CLI 인증을 합니다.');
    const doctorCmd = program.commands.find((c) => c.name() === 'doctor');
    const doctorConfig = doctorCmd?.commands.find((c) => c.name() === 'config');
    expect(doctorConfig?.description()).toBe('config.toml을 검사합니다.');
    const serverCmd = program.commands.find((c) => c.name() === 'server');
    const serverRun = serverCmd?.commands.find((c) => c.name() === 'run');
    expect(serverRun?.description()).toBe(
      'SuperLiora 서버를 시작합니다(백그라운드 데몬; --foreground로 포그라운드 실행).',
    );
  });
});
