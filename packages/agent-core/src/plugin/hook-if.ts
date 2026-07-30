/**
 * Claude hook `if` filter — permission-rule-like patterns on tool events.
 * Examples: `Bash(git *)`, `Edit(*.ts)`, bare `Bash`.
 */

export function hookIfMatches(
  ifRule: string | undefined,
  input: {
    readonly toolName?: string;
    readonly toolInput?: unknown;
  },
): boolean {
  if (ifRule === undefined || ifRule.trim() === '') return true;
  const rule = ifRule.trim();
  const toolName =
    typeof input.toolName === 'string' && input.toolName.length > 0
      ? input.toolName
      : typeof (input.toolInput as { tool_name?: unknown } | undefined)?.tool_name === 'string'
        ? String((input.toolInput as { tool_name: string }).tool_name)
        : undefined;

  const paren = /^([A-Za-z0-9_.:-]+)\(([\s\S]*)\)$/.exec(rule);
  if (paren === null) {
    // Bare tool name
    return toolName !== undefined && toolName === rule;
  }
  const ruleTool = paren[1] ?? '';
  const patternRaw = paren[2] ?? '';
  if (toolName === undefined || toolName !== ruleTool) return false;
  const pattern = patternRaw.trim();
  if (pattern === '' || pattern === '*') return true;

  const haystack = toolInputHaystack(input.toolInput);
  return globMatch(pattern, haystack);
}

function toolInputHaystack(toolInput: unknown): string {
  if (typeof toolInput === 'string') return toolInput;
  if (toolInput === null || toolInput === undefined) return '';
  if (typeof toolInput !== 'object') return String(toolInput);
  const obj = toolInput as Record<string, unknown>;
  for (const key of ['command', 'file_path', 'path', 'pattern', 'query']) {
    if (typeof obj[key] === 'string') return obj[key];
  }
  try {
    return JSON.stringify(toolInput);
  } catch {
    return '';
  }
}

/** Minimal glob: `*` any chars, `?` one char; otherwise literal. */
function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern
    .replaceAll(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*')
    .replaceAll('?', '.');
  try {
    return new RegExp(`^${escaped}$`, 's').test(value);
  } catch {
    return value.includes(pattern.replaceAll('*', ''));
  }
}
