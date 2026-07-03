import type { ContentPart } from '@moonshot-ai/kosong';

export type ResponseLanguageCode = 'en' | 'ja' | 'ko' | 'zh';
export type ResponseLanguageSource = 'detected' | 'explicit';

export interface ResponseLanguagePreference {
  readonly code: ResponseLanguageCode;
  readonly label: string;
  readonly source: ResponseLanguageSource;
  readonly locked: true;
  readonly updatedAt: string;
}

interface ScriptCounts {
  readonly ko: number;
  readonly ja: number;
  readonly zh: number;
  readonly en: number;
}

const LANGUAGE_LABELS: Record<ResponseLanguageCode, string> = {
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
};

const EXPLICIT_PATTERNS: Array<readonly [ResponseLanguageCode, RegExp]> = [
  ['ko', /(?:한국어|한글|한국말)(?:로|으로)?\s*(?:답|응답|대답|말|작성|써|계속)/iu],
  ['ko', /(?:답|응답|대답|말|작성|써|계속).*?(?:한국어|한글|한국말)(?:로|으로)?/iu],
  ['en', /(?:영어|english)(?:로|으로)?\s*(?:답|응답|대답|말|작성|써|계속|reply|respond|answer|write|continue)/iu],
  ['en', /\b(?:reply|respond|answer|write|continue)\s+(?:in\s+)?english\b/iu],
  ['ja', /(?:일본어|日本語|japanese)(?:로|으로)?\s*(?:답|응답|대답|말|작성|써|계속|reply|respond|answer|write|continue)/iu],
  ['ja', /\b(?:reply|respond|answer|write|continue)\s+(?:in\s+)?japanese\b/iu],
  ['zh', /(?:중국어|中文|chinese)(?:로|으로)?\s*(?:답|응답|대답|말|작성|써|계속|reply|respond|answer|write|continue)/iu],
  ['zh', /\b(?:reply|respond|answer|write|continue)\s+(?:in\s+)?chinese\b/iu],
];

export function responseLanguagePreferenceFromUnknown(
  value: unknown,
): ResponseLanguagePreference | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const code = input['code'];
  const source = input['source'];
  const updatedAt = input['updatedAt'];
  if (!isResponseLanguageCode(code)) return undefined;
  if (source !== 'detected' && source !== 'explicit') return undefined;
  if (typeof updatedAt !== 'string' || updatedAt.trim().length === 0) return undefined;
  return {
    code,
    label: LANGUAGE_LABELS[code],
    source,
    locked: true,
    updatedAt,
  };
}

export function resolveResponseLanguagePreference(
  current: ResponseLanguagePreference | undefined,
  input: readonly ContentPart[],
  now: Date = new Date(),
): ResponseLanguagePreference | undefined {
  const text = promptText(input);
  if (text === undefined) return current;

  const explicit = detectExplicitResponseLanguage(text);
  if (explicit !== undefined) {
    return createPreference(explicit, 'explicit', now);
  }
  if (current?.locked === true) return current;

  const detected = detectResponseLanguage(text);
  return detected === undefined ? current : createPreference(detected, 'detected', now);
}

export function detectExplicitResponseLanguage(text: string): ResponseLanguageCode | undefined {
  const stripped = stripCode(text);
  for (const [code, pattern] of EXPLICIT_PATTERNS) {
    if (pattern.test(stripped)) return code;
  }
  return undefined;
}

export function detectResponseLanguage(text: string): ResponseLanguageCode | undefined {
  const stripped = stripCode(text);
  const counts = countScripts(stripped);
  const cjkTotal = counts.ko + counts.ja + counts.zh;
  const total = cjkTotal + counts.en;
  if (total < 4) return undefined;

  if (counts.ko >= 4 && counts.ko / total >= 0.18) return 'ko';
  if (counts.ja >= 4 && counts.ja / total >= 0.18) return 'ja';
  if (counts.ja >= 2 && counts.zh >= 2 && (counts.ja + counts.zh) / total >= 0.25) return 'ja';
  if (counts.zh >= 4 && counts.ja === 0 && counts.ko === 0 && counts.zh / total >= 0.35) return 'zh';
  if (counts.en >= 12 && cjkTotal === 0) return 'en';
  return undefined;
}

function promptText(input: readonly ContentPart[]): string | undefined {
  const text = input
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
    .trim();
  return text.length === 0 ? undefined : text;
}

function createPreference(
  code: ResponseLanguageCode,
  source: ResponseLanguageSource,
  now: Date,
): ResponseLanguagePreference {
  return {
    code,
    label: LANGUAGE_LABELS[code],
    source,
    locked: true,
    updatedAt: now.toISOString(),
  };
}

function stripCode(text: string): string {
  return text
    .replaceAll(/```[\s\S]*?```/g, ' ')
    .replaceAll(/`[^`\n]*`/g, ' ')
    .replaceAll(/https?:\/\/\S+/giu, ' ');
}

function countScripts(text: string): ScriptCounts {
  let ko = 0;
  let ja = 0;
  let zh = 0;
  let en = 0;

  for (const char of text) {
    if (/\p{Script=Hangul}/u.test(char)) {
      ko += 1;
    } else if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(char)) {
      ja += 1;
    } else if (/\p{Script=Han}/u.test(char)) {
      zh += 1;
    } else if (/[A-Za-z]/.test(char)) {
      en += 1;
    }
  }

  return { ko, ja, zh, en };
}

function isResponseLanguageCode(value: unknown): value is ResponseLanguageCode {
  return value === 'en' || value === 'ja' || value === 'ko' || value === 'zh';
}
