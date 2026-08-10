/**
 * Machine-readable worker model-failure note for Job ledger / desk routing.
 */

const MODEL_FAILED_NOTE_RE =
  /model_failed:\s*alias=(\S+)\s+kind=(\S+)\s+tried=\[([^\]]*)](?:\s+next_hint=(\S+))?/;

export function formatModelFailedNote(input: {
  readonly alias: string | undefined;
  readonly kind: string;
  readonly tried: readonly string[];
  readonly nextHint?: string | undefined;
}): string {
  const alias = input.alias?.trim() || 'unknown';
  const tried =
    input.tried.length > 0
      ? input.tried.map((a) => a.trim()).filter((a) => a.length > 0).join(',')
      : alias;
  const hint =
    input.nextHint !== undefined && input.nextHint.trim().length > 0
      ? ` next_hint=${input.nextHint.trim()}`
      : '';
  return `model_failed: alias=${alias} kind=${input.kind} tried=[${tried}]${hint}`;
}

export function parseModelFailedNote(
  text: string | undefined,
):
  | {
      readonly alias: string;
      readonly kind: string;
      readonly tried: readonly string[];
      readonly nextHint?: string;
    }
  | undefined {
  if (text === undefined || text.length === 0) return undefined;
  const match = MODEL_FAILED_NOTE_RE.exec(text);
  if (match === null) return undefined;
  const tried = (match[3] ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const nextHint = match[4]?.trim();
  return {
    alias: match[1] ?? 'unknown',
    kind: match[2] ?? 'route_fail',
    tried,
    ...(nextHint !== undefined && nextHint.length > 0 ? { nextHint } : {}),
  };
}
