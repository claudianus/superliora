import type { ContentPart } from '@superliora/kosong';

import type { LlmResponseLanguageDetection } from './response-language-llm';

export type ResponseLanguageSource = 'detected' | 'explicit' | 'locale';

export interface ResponseLanguagePreference {
  readonly code: string;
  readonly label: string;
  readonly source: ResponseLanguageSource;
  readonly locked: true;
  readonly updatedAt: string;
}

export interface HostLocaleTag {
  readonly code: string;
  readonly label: string;
}

const HOST_LOCALE_ENV_NAMES = [
  'SUPERLIORA_LOCALE',
  'LANGUAGE',
  'LC_ALL',
  'LC_MESSAGES',
  'LANG',
] as const;

const MIN_LLM_CONFIDENCE = 0.5;

export interface ResponseLanguageDetectDeps {
  readonly env?: Record<string, string | undefined> | undefined;
  readonly detectWithLlm?:
    | ((
        text: string,
        current: ResponseLanguagePreference | undefined,
        hostLocale: HostLocaleTag | undefined,
      ) => Promise<LlmResponseLanguageDetection | undefined>)
    | undefined;
}

export function normalizeResponseLanguageCode(code: string): string | undefined {
  const normalized = code.trim().toLowerCase();
  if (!/^[a-z]{2}$/u.test(normalized)) return undefined;
  if (normalized === 'und') return undefined;
  return normalized;
}

export function responseLanguageLabelForCode(code: string, displayLocale = 'en'): string {
  const normalized = normalizeResponseLanguageCode(code);
  if (normalized === undefined) return code;
  try {
    const label = new Intl.DisplayNames([displayLocale], { type: 'language' }).of(normalized);
    if (label !== undefined && label.length > 0 && label !== normalized) return label;
  } catch {
    // Intl may be unavailable in some runtimes.
  }
  return normalized;
}

export function responseLanguagePreferenceFromUnknown(
  value: unknown,
): ResponseLanguagePreference | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const code = input['code'];
  const source = input['source'];
  const updatedAt = input['updatedAt'];
  if (typeof code !== 'string') return undefined;
  const normalizedCode = normalizeResponseLanguageCode(code);
  if (normalizedCode === undefined) return undefined;
  if (source !== 'detected' && source !== 'explicit' && source !== 'locale') return undefined;
  if (typeof updatedAt !== 'string' || updatedAt.trim().length === 0) return undefined;
  const storedLabel = input['label'];
  const label =
    typeof storedLabel === 'string' && storedLabel.trim().length > 0
      ? storedLabel.trim()
      : responseLanguageLabelForCode(normalizedCode);
  return {
    code: normalizedCode,
    label,
    source,
    locked: true,
    updatedAt,
  };
}

/**
 * Reads the host process locale from standard environment variables. Returns
 * `undefined` for neutral locales such as `C` / `C.UTF-8` so a language is not
 * forced when the OS locale is unset.
 */
export function detectHostLocaleTag(
  env: Record<string, string | undefined> = {},
): HostLocaleTag | undefined {
  for (const name of HOST_LOCALE_ENV_NAMES) {
    const raw = env[name];
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const first = raw.split(':')[0]!.toLowerCase();
    const localePart = first.split('.')[0]!.split('@')[0]!;
    if (localePart === 'c' || localePart === 'posix') continue;
    const primary = localePart.split(/[-_]/)[0] ?? localePart;
    const code = normalizeResponseLanguageCode(primary);
    if (code === undefined) continue;
    return {
      code,
      label: responseLanguageLabelForCode(code),
    };
  }
  return undefined;
}

export function responseLanguagePreferenceFromHostLocale(
  env: Record<string, string | undefined> = {},
  now: Date = new Date(),
): ResponseLanguagePreference | undefined {
  const hostLocale = detectHostLocaleTag(env);
  if (hostLocale === undefined) return undefined;
  return createPreference(hostLocale.code, 'locale', now, hostLocale.label);
}

export async function resolveResponseLanguagePreference(
  current: ResponseLanguagePreference | undefined,
  input: readonly ContentPart[],
  deps: ResponseLanguageDetectDeps = {},
  now: Date = new Date(),
): Promise<ResponseLanguagePreference | undefined> {
  const text = promptText(input);
  const hostLocale = detectHostLocaleTag(deps.env ?? {});

  if (text !== undefined && deps.detectWithLlm !== undefined) {
    const llm = await deps.detectWithLlm(text, current, hostLocale);
    if (llm !== undefined && llm.confidence >= MIN_LLM_CONFIDENCE) {
      const normalizedCode = normalizeResponseLanguageCode(llm.code);
      if (normalizedCode !== undefined) {
        if (llm.explicit) {
          return createPreference(normalizedCode, 'explicit', now, llm.label);
        }
        if (current?.locked !== true) {
          return createPreference(normalizedCode, 'detected', now, llm.label);
        }
      }
    }
  }

  if (current?.locked === true) return current;

  if (hostLocale !== undefined) {
    return createPreference(hostLocale.code, 'locale', now, hostLocale.label);
  }

  return current;
}

export function stripPromptTextForLanguageDetection(text: string): string {
  return text
    .replaceAll(/```[\s\S]*?```/g, ' ')
    .replaceAll(/`[^`\n]*`/g, ' ')
    .replaceAll(/https?:\/\/\S+/giu, ' ')
    .trim();
}

function promptText(input: readonly ContentPart[]): string | undefined {
  const text = input
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
    .trim();
  return text.length === 0 ? undefined : text;
}

function createPreference(
  code: string,
  source: ResponseLanguageSource,
  now: Date,
  label?: string,
): ResponseLanguagePreference {
  return {
    code,
    label: label ?? responseLanguageLabelForCode(code),
    source,
    locked: true,
    updatedAt: now.toISOString(),
  };
}
