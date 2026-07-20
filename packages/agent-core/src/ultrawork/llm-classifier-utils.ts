/**
 * Shared utilities for LLM-backed classifiers (auto-activation, resume intent,
 * objective profile). Extracts common JSON parsing and response handling to
 * reduce duplication across the three classifier modules.
 */

import type { ChatProvider } from '@superliora/kosong';
import type { Agent } from '../agent';

/** Default timeout for LLM classifier calls (10 seconds). */
export const LLM_CLASSIFIER_TIMEOUT_MS = 10_000;

/** Maximum user text characters sent to classifiers. */
export const MAX_CLASSIFIER_TEXT_CHARS = 2_000;

export interface LlmClassifierDeps {
  readonly generate: Agent['generate'];
  readonly provider: ChatProvider;
}

/**
 * Clip user text to a maximum length for classifier prompts.
 */
export function clipClassifierText(text: string, maxChars = MAX_CLASSIFIER_TEXT_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars)}…`;
}

/**
 * Extract text content from an LLM generate response.
 */
export function extractTextFromGenerateResponse(response: unknown): string {
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

/**
 * Extract a JSON object from LLM response text.
 * Handles both raw JSON and markdown code-fenced JSON.
 */
export function extractJsonObject(text: string): string | null {
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

/**
 * Parse a JSON object from LLM response text into a typed record.
 * Returns undefined if parsing fails or the result is not a plain object.
 */
export function parseJsonResponse(text: string): Record<string, unknown> | undefined {
  const json = extractJsonObject(text);
  if (json === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  return parsed as Record<string, unknown>;
}

/**
 * Create an AbortSignal that times out after the specified duration.
 * Combines with an optional external signal.
 */
export function createClassifierTimeoutSignal(
  timeoutMs = LLM_CLASSIFIER_TIMEOUT_MS,
  externalSignal?: AbortSignal,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (externalSignal === undefined) return timeoutSignal;
  return AbortSignal.any([timeoutSignal, externalSignal]);
}

/**
 * Validate and clamp a confidence value to [0, 1].
 */
export function clampConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

/**
 * Validate a non-empty string field.
 */
export function validateStringField(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  return value.trim();
}
