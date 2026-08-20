import { STRINGS_EN, STRINGS_KO, type CliLocale } from './strings';

const POSIX_ENV_NAMES = ['LANGUAGE', 'LC_ALL', 'LC_MESSAGES', 'LANG'] as const;

/** Persisted UI language preference (`tui.toml` `locale`). */
export type LocalePreference = 'auto' | CliLocale;

export type LanguageTagKind = 'ko' | 'en' | 'neutral' | 'other';

/**
 * Active CLI locale. Defaults to `'en'` so importing the module (e.g. in
 * tests that call `createProgram` directly, without going through the runtime
 * entry in `main.ts`) always renders the English catalog and keeps existing
 * English-text assertions green. The runtime applies the user's locale via
 * `setCliLocale(resolveCliLocale(...))` before building the program.
 */
let activeLocale: CliLocale = 'en';

/**
 * Classify a locale tag. `LANGUAGE` is colon-separated (first entry wins).
 * Codeset (`.UTF-8`) and modifier (`@latin`) are stripped. `C` / `POSIX`
 * are CI/neutral English, not an OS UI signal.
 */
export function parseLanguageTag(raw: string | undefined): LanguageTagKind {
  if (typeof raw !== 'string' || raw.length === 0) return 'other';
  const first = raw.split(':')[0]!.toLowerCase().trim();
  const localePart = first.split('.')[0]!.split('@')[0]!;
  if (localePart === 'c' || localePart === 'posix') return 'neutral';
  if (localePart === 'ko' || localePart.startsWith('ko_') || localePart.startsWith('ko-')) {
    return 'ko';
  }
  if (localePart === 'en' || localePart.startsWith('en_') || localePart.startsWith('en-')) {
    return 'en';
  }
  return 'other';
}

function firstPosixLanguage(env: Record<string, string | undefined>): CliLocale | 'neutral' | null {
  for (const name of POSIX_ENV_NAMES) {
    const kind = parseLanguageTag(env[name]);
    if (kind === 'ko' || kind === 'en' || kind === 'neutral') return kind === 'neutral' ? 'neutral' : kind;
  }
  return null;
}

function readIntlLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? '';
  } catch {
    return '';
  }
}

/** True for Git Bash / MSYS / Cygwin, which often set LANG=en_US on Korean Windows. */
export function isPosixOnWindows(env: Record<string, string | undefined>): boolean {
  return Boolean(env['MSYSTEM'] || env['CYGWIN']);
}

export interface DetectCliLocaleOptions {
  readonly intl?: boolean;
  readonly platform?: NodeJS.Platform;
  /** Injected OS UI locale (e.g. `ko-KR`) so tests do not call Intl. */
  readonly osLocale?: string;
}

/**
 * Resolves the CLI locale from the process environment and OS UI language.
 *
 * Order:
 * 1. `SUPERLIORA_LOCALE`
 * 2. Korean POSIX (`LANGUAGE` / `LC_*` / `LANG`)
 * 3. `C` / `POSIX` → English (CI)
 * 4. Windows + Git Bash/Cygwin: OS UI Korean wins over LANG=en_US
 * 5. Explicit POSIX English
 * 6. OS UI locale (`Intl`, or `osLocale` in tests)
 * 7. English
 */
export function detectCliLocale(
  env: Record<string, string | undefined> = {},
  options: DetectCliLocaleOptions = {},
): CliLocale {
  const explicit = parseLanguageTag(env['SUPERLIORA_LOCALE']);
  if (explicit === 'ko' || explicit === 'en') return explicit;

  const posix = firstPosixLanguage(env);
  if (posix === 'ko') return 'ko';
  if (posix === 'neutral') return 'en';

  const platform = options.platform ?? process.platform;
  const allowOs = options.osLocale !== undefined
    || options.intl === true
    || (options.intl !== false && env === process.env);
  let os: CliLocale | null = null;
  if (allowOs) {
    const tag = options.osLocale ?? readIntlLocale();
    const kind = parseLanguageTag(tag);
    if (kind === 'ko' || kind === 'en') os = kind;
  }

  if (os === 'ko' && platform === 'win32' && (isPosixOnWindows(env) || posix !== 'en')) {
    return 'ko';
  }

  if (posix === 'en') return 'en';
  if (os === 'ko' || os === 'en') return os;
  return 'en';
}

/**
 * Resolves the active locale from a persisted preference plus the environment.
 * Fixed `en` / `ko` win; `auto` (default) uses {@link detectCliLocale}.
 */
export function resolveCliLocale(options: {
  readonly preference?: LocalePreference | null;
  readonly env?: Record<string, string | undefined>;
  readonly platform?: NodeJS.Platform;
  readonly osLocale?: string;
}): CliLocale {
  const preference = options.preference ?? 'auto';
  if (preference === 'en' || preference === 'ko') return preference;
  return detectCliLocale(options.env ?? {}, {
    platform: options.platform,
    osLocale: options.osLocale,
  });
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

