/**
 * Pure helpers for extracting JSON/text from LLM responses (Ultra Plan).
 */

export function extractTextFromLLMResponse(response: unknown): string {
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

export function extractJsonFromText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const match = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
    if (match?.[1]) return match[1].trim();
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return trimmed.slice(start, end + 1);
  return null;
}

export function parseJsonFromLLMResponse(response: unknown): unknown | null {
  const text = extractTextFromLLMResponse(response);
  const json = extractJsonFromText(text);
  if (json === null) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}
