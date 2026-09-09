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

export function promptTextOf(input: readonly ContentPart[]): string | undefined {
  return promptText(input);
}

/**
 * Deterministic guard that decides whether an LLM language re-detection is
 * worth paying for when a language preference is already locked.
 *
 * Once a session's response language is known, re-running the detection LLM
 * on every user prompt is pure waste (one small call per message). A locked
 * preference can only be moved by an *explicit* demand anyway (the resolver
 * ignores non-explicit detections while locked), so re-detect only when the
 * message plausibly demands one:
 *
 * - explicit markers — `/lang`, “answer in French”, `한국어로 답변해줘`,
 *   `日本語で` …; or
 * - a bare “in <language>” directive that names a language other than the
 *   locked one.
 *
 * Best-effort by construction: a missed trigger costs a locked session one
 * wrong-language reply; a false trigger costs one redundant 1-request detect
 * that resolves to the current preference again.
 */
export function mayRequestLanguageSwitch(text: string, currentCode: string): boolean {
  const stripped = stripPromptTextForLanguageDetection(text);
  if (stripped.trim().length === 0) return false;
  if (LANGUAGE_SWITCH_MARKER_PATTERN.test(stripped)) return true;
  // Bare “in <language>” directives only signal a switch when they name a
  // language other than the locked one (“한국어로 계속 진행해줘” while already
  // locked to Korean is same-language chatter, not a switch request).
  for (const [code, pattern] of BARE_LANGUAGE_DIRECTIVES) {
    if (code !== currentCode && pattern.test(stripped)) return true;
  }
  return false;
}

const LANGUAGE_SWITCH_MARKER_PATTERN =
  /(?:^|\s)\/(?:lang|language|locale|언어)(?:\s|$)|\b(?:answer|respond|reply|speak|write|talk)\b[^.\n]{0,40}\b(?:in|using)\b|(?:한국어|영어|일본어|중국어|프랑스어|독일어|스페인어|러시아어|베트남어|태국어|아랍어|히브리어|포르투갈어|이탈리아어|터키어|인도네시아어|힌디어)(?:로|으로)?\s*(?:대답|답변|응답|말해|말씀|해줘|해주세요)|(?:대답|답변|응답)\s*(?:은|는)\s*(?:한국어|영어|일본어|중국어)(?:로)?|на\s+(?:русском|украинском)|по-русски|по-українськи|tiếng\s+(?:việt|anh|hàn|nhật|trung)|bahasa\s+\w+|(?:^|\s)(?:korean|english|japanese|chinese|french|german|spanish|portuguese|italian|russian|vietnamese|thai|arabic|hebrew|hindi|turkish|indonesian|dutch|swedish|ukrainian)\b/iu;

/** “in <language>” phrases that only matter when they name a different language. */
const BARE_LANGUAGE_DIRECTIVES: ReadonlyArray<readonly [string, RegExp]> = [
  ['ko', /한국어로/u],
  ['ja', /日本語で/u],
  ['en', /(?:영어로|英語で)/u],
  ['zh', /(?:중국어로|中国語で)/u],
];

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
