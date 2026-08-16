/**
 * Soft secret redaction for tool output and diagnostic text (SSOT §8).
 * Masks obvious credential shapes before logs/traces persist strings.
 */

export const REDACTED_SECRET = '[REDACTED]';

/** Patterns for bare tokens that often leak through tool stdout/stderr. */
const TOOL_OUTPUT_SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[a-z]-[A-Za-z0-9-]{8,}\b/g,
  /\bAuthorization\s*:\s*[^\r\n]+/gi,
];

/** `https://user:password@host` userinfo — keep the username, mask the password. */
const URL_PASSWORD_PATTERN = /(https?:\/\/[^/\s:@]+:)[^/\s:@]+@/gi;

export interface SecretRedactionResult {
  readonly text: string;
  readonly redactions: number;
}

export function redactSecretsInText(input: string): SecretRedactionResult {
  let text = input;
  let redactions = 0;
  text = text.replace(URL_PASSWORD_PATTERN, (_match, prefix: string) => {
    redactions += 1;
    return `${prefix}${REDACTED_SECRET}@`;
  });
  for (const pattern of TOOL_OUTPUT_SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      redactions += 1;
      return REDACTED_SECRET;
    });
  }
  return { text, redactions };
}
