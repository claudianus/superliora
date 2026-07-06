import { createUserMessage } from '@superliora/kosong';
import type { ChatProvider } from '@superliora/kosong';

import type { Agent } from '../agent';
import type { HostLocaleTag, ResponseLanguagePreference } from './response-language';
import { stripPromptTextForLanguageDetection } from './response-language';

export interface LlmResponseLanguageDetection {
  readonly code: string;
  readonly label: string;
  readonly explicit: boolean;
  readonly confidence: number;
}

const MAX_PROMPT_CHARS = 2_000;

const RESPONSE_LANGUAGE_DETECT_SYSTEM = `You detect the response language for a coding-agent CLI from one user message.

Return ONLY compact JSON with this shape:
{"language_code":"en","language_name":"English","explicit_override":false,"confidence":0.9}

Rules:
- language_code: ISO 639-1 primary subtag (examples: en, ko, ja, fr, de, es, ar, hi, pt, ru, zh, vi, th, id, tr, pl, nl, it, sv, uk, he).
- language_name: the English name of that language.
- explicit_override: true when the user explicitly demands replies in a specific language, even if the rest of the message is in another language.
- confidence: 0.0-1.0. Use below 0.5 when the message is too short or ambiguous to choose a language (for example "ok", "yes", a single emoji, or only code/paths).
- Prefer the dominant natural language of the request prose. Ignore fenced code, inline code, file paths, commands, and URLs.
- When the user mixes languages without an explicit override, choose the language they are most likely expecting replies in.
- Do not guess when unsure; return low confidence instead.`;

export interface ResponseLanguageLlmDeps {
  readonly generate: Agent['generate'];
  readonly provider: ChatProvider;
}

export async function detectResponseLanguageWithLlm(
  deps: ResponseLanguageLlmDeps,
  input: {
    readonly text: string;
    readonly current?: ResponseLanguagePreference | undefined;
    readonly hostLocale?: HostLocaleTag | undefined;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<LlmResponseLanguageDetection | undefined> {
  const stripped = stripPromptTextForLanguageDetection(input.text);
  if (stripped.length === 0) return undefined;

  const clipped =
    stripped.length <= MAX_PROMPT_CHARS
      ? stripped
      : `${stripped.slice(0, MAX_PROMPT_CHARS)}…`;

  const user = buildDetectionUserPrompt(clipped, input.current, input.hostLocale);
  try {
    const response = await deps.generate(
      deps.provider,
      RESPONSE_LANGUAGE_DETECT_SYSTEM,
      [],
      [createUserMessage(user)],
      undefined,
      { signal: input.signal },
    );
    const parsed = parseDetectionResponse(extractTextFromGenerateResponse(response));
    if (parsed === undefined) return undefined;
    return {
      code: parsed.language_code,
      label: parsed.language_name,
      explicit: parsed.explicit_override,
      confidence: parsed.confidence,
    };
  } catch {
    return undefined;
  }
}

function buildDetectionUserPrompt(
  text: string,
  current: ResponseLanguagePreference | undefined,
  hostLocale: HostLocaleTag | undefined,
): string {
  const lines = ['Detect the response language for this user message.', '', 'User message:', text];
  if (current !== undefined) {
    lines.push(
      '',
      `Current locked response language: ${current.label} (${current.code}). Only change it when explicit_override is true.`,
    );
  }
  if (hostLocale !== undefined) {
    lines.push(
      '',
      `Host locale hint (fallback only when the message is ambiguous): ${hostLocale.label} (${hostLocale.code}).`,
    );
  }
  return lines.join('\n');
}

interface ParsedDetectionJson {
  readonly language_code: string;
  readonly language_name: string;
  readonly explicit_override: boolean;
  readonly confidence: number;
}

function parseDetectionResponse(text: string): ParsedDetectionJson | undefined {
  const json = extractJsonObject(text);
  if (json === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const languageCode = record['language_code'];
  const languageName = record['language_name'];
  const explicitOverride = record['explicit_override'];
  const confidence = record['confidence'];
  if (typeof languageCode !== 'string' || languageCode.trim().length === 0) return undefined;
  if (typeof languageName !== 'string' || languageName.trim().length === 0) return undefined;
  if (typeof explicitOverride !== 'boolean') return undefined;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return undefined;
  return {
    language_code: languageCode.trim().toLowerCase(),
    language_name: languageName.trim(),
    explicit_override: explicitOverride,
    confidence: Math.max(0, Math.min(1, confidence)),
  };
}

function extractTextFromGenerateResponse(response: unknown): string {
  const msg = response as {
    message?: {
      content?: ReadonlyArray<{ type?: string; text?: string }>;
    };
  };
  const parts = msg.message?.content ?? [];
  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') return part.text;
  }
  return '';
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const match = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u);
    if (match?.[1] !== undefined) return match[1].trim();
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return trimmed.slice(start, end + 1);
  return null;
}
