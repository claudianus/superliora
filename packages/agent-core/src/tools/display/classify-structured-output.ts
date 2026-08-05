/**
 * JSON tool output → structured display.
 *
 * MCP servers and JSON-emitting builtins return objects serialized as text, so
 * clients that only see the string paint a raw blob. Parsing it once here lets
 * every client render a key/value surface instead.
 *
 * Only genuinely structural output earns a display. Plain prose deliberately
 * returns `undefined`: a `text` display would duplicate the whole body on the
 * wire while telling the client nothing it cannot already see in `output`.
 */

import type { ToolResultDisplay } from './schemas';

/** Above this size, parsing costs more than the card is worth. */
const MAX_PARSE_CHARS = 200_000;

export function classifyStructuredOutput(output: unknown): ToolResultDisplay | undefined {
  if (typeof output !== 'string') return undefined;
  const text = output.trim();
  if (text.length === 0 || text.length > MAX_PARSE_CHARS) return undefined;
  const first = text[0];
  if (first !== '{' && first !== '[') return undefined;

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  // A bare scalar wrapped in JSON syntax is not worth a structured card.
  if (typeof data !== 'object' || data === null) return undefined;
  return { kind: 'structured', data };
}
