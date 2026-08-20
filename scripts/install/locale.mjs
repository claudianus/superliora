/**
 * Installer locale: Korean or English.
 * Matches apps/liora CLI detection, including Windows Git Bash LANG noise.
 */

const POSIX_ENV_NAMES = ['LANGUAGE', 'LC_ALL', 'LC_MESSAGES', 'LANG'];

export function parseLanguageTag(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return 'other';
  const first = raw.split(':')[0].toLowerCase().trim();
  const localePart = first.split('.')[0].split('@')[0];
  if (localePart === 'c' || localePart === 'posix') return 'neutral';
  if (localePart === 'ko' || localePart.startsWith('ko_') || localePart.startsWith('ko-')) {
    return 'ko';
  }
  if (localePart === 'en' || localePart.startsWith('en_') || localePart.startsWith('en-')) {
    return 'en';
  }
  return 'other';
}

export function isKoreanTag(raw) {
  return parseLanguageTag(raw) === 'ko';
}

export function isEnglishTag(raw) {
  return parseLanguageTag(raw) === 'en';
}

function firstPosixLanguage(env) {
  for (const name of POSIX_ENV_NAMES) {
    const kind = parseLanguageTag(env[name]);
    if (kind === 'ko' || kind === 'en' || kind === 'neutral') {
      return kind === 'neutral' ? 'neutral' : kind;
    }
  }
  return null;
}

function readIntlLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? '';
  } catch {
    return '';
  }
}

export function isPosixOnWindows(env) {
  return Boolean(env.MSYSTEM || env.CYGWIN);
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {{ intl?: boolean, platform?: string, osLocale?: string }} [options]
 * @returns {'en'|'ko'}
 */
export function detectInstallLocale(env = process.env, options = {}) {
  const explicit = parseLanguageTag(env.SUPERLIORA_LOCALE);
  if (explicit === 'ko' || explicit === 'en') return explicit;

  const posix = firstPosixLanguage(env);
  if (posix === 'ko') return 'ko';
  if (posix === 'neutral') return 'en';

  const platform = options.platform ?? process.platform;
  const allowOs = options.osLocale !== undefined
    || options.intl === true
    || (options.intl !== false && env === process.env);
  let os = null;
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
