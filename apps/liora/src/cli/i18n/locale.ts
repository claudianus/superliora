import { STRINGS_EN, STRINGS_KO, type CliLocale } from './strings';

const LOCALE_ENV_NAMES = [
  'SUPERLIORA_LOCALE',
  'LANGUAGE',
  'LC_ALL',
  'LC_MESSAGES',
  'LANG',
] as const;

/**
 * Active CLI locale. Defaults to `'en'` so importing the module (e.g. in
 * tests that call `createProgram` directly, without going through the runtime
 * entry in `main.ts`) always renders the English catalog and keeps existing
 * English-text assertions green. The runtime applies the user's locale via
 * `setCliLocale(detectCliLocale(process.env))` before building the program.
 */
let activeLocale: CliLocale = 'en';

/**
 * Resolves the CLI locale from the process environment. Checks an explicit
 * `SUPERLIORA_LOCALE` override first, then the standard POSIX locale
 * variables (`LANGUAGE`, `LC_ALL`, `LC_MESSAGES`, `LANG`). `LANGUAGE` is
 * colon-separated and only its first entry is considered. Any Korean locale
 * (`ko`, `ko_*`, `ko-*`) selects Korean; everything else falls back to
 * English.
 */
export function detectCliLocale(
  env: Record<string, string | undefined> = {},
): CliLocale {
  for (const name of LOCALE_ENV_NAMES) {
    const raw = env[name];
    if (typeof raw !== 'string' || raw.length === 0) continue;
    // LANGUAGE is colon-separated; only the first entry matters. Strip the
    // codeset (after '.') and the modifier (after '@') so forms like
    // `ko_KR.UTF-8`, `ko.UTF-8`, and `ko_KR@latin` all match the language.
    const first = raw.split(':')[0]!.toLowerCase();
    const localePart = first.split('.')[0]!.split('@')[0]!;
    if (localePart === 'ko' || localePart.startsWith('ko_') || localePart.startsWith('ko-')) {
      return 'ko';
    }
    if (localePart === 'en' || localePart.startsWith('en_') || localePart.startsWith('en-')) {
      return 'en';
    }
  }
  return 'en';
}

export function getCliLocale(): CliLocale {
  return activeLocale;
}

export function setCliLocale(locale: CliLocale): void {
  activeLocale = locale;
}

/**
 * Looks up a localized CLI string. Falls back to the English catalog for any
 * key missing from the active locale's catalog, then to the raw key, so a
 * missing translation never renders a placeholder. `{name}` placeholders are
 * substituted from `params` when provided.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const catalog = activeLocale === 'ko' ? STRINGS_KO : STRINGS_EN;
  const template = catalog[key] ?? STRINGS_EN[key] ?? key;
  if (params === undefined) return template;
  return template.replaceAll(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

/** Localized string with a trailing newline — common for CLI stdout/stderr lines. */
export function tln(key: string, params?: Record<string, string | number>): string {
  return `${t(key, params)}\n`;
}
