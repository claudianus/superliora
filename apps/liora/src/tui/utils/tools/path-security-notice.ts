/**
 * Loop45a — surface path-security denials (Read/Write/Edit/Grep/Glob) in the TUI.
 *
 * Engine `PathSecurityError` tool results now carry `code=PATH_*`. Without a
 * notice the operator only sees a red tool card and may miss sandbox / sensitive
 * / read-only recovery paths.
 */

export type PathSecurityCode =
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'PATH_SENSITIVE'
  | 'PATH_INVALID'
  | 'PATH_READ_ONLY';

export type PathSecurityNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'path-security';
  readonly code: PathSecurityCode | 'PATH_SECURITY';
};

const PATH_CODES: readonly PathSecurityCode[] = [
  'PATH_OUTSIDE_WORKSPACE',
  'PATH_SENSITIVE',
  'PATH_INVALID',
  'PATH_READ_ONLY',
];

function outputText(output: unknown): string | undefined {
  if (typeof output === 'string') return output;
  if (output !== null && typeof output === 'object') {
    try {
      return JSON.stringify(output);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function extractPathSecurityCode(output: unknown): PathSecurityCode | undefined {
  const text = outputText(output);
  if (text === undefined) return undefined;
  for (const code of PATH_CODES) {
    if (text.includes(`code=${code}`) || text.includes(code)) return code;
  }
  return undefined;
}

export function isPathSecurityOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  if (extractPathSecurityCode(text) !== undefined) return true;
  // Legacy prose fallbacks (pre-Loop45a marker).
  return (
    text.includes('matches a sensitive-file pattern') ||
    text.includes('is outside the workspace') ||
    text.includes('Sandbox is read-only') ||
    text.includes('Path cannot be empty') ||
    text.includes('outside the working directory')
  );
}

export function formatPathSecurityNotice(
  toolName?: string,
  output?: unknown,
): PathSecurityNotice {
  const tool = toolName !== undefined && toolName.length > 0 ? toolName : 'tool';
  const code = extractPathSecurityCode(output) ?? 'PATH_SECURITY';
  switch (code) {
    case 'PATH_SENSITIVE':
      return {
        title: 'Sensitive path blocked',
        detail: `${tool} was blocked for a sensitive path (env / credential / SSH key; code=PATH_SENSITIVE). Secrets cannot be read or written through tools.`,
        status: `${tool} blocked: PATH_SENSITIVE`,
        coalesceKey: 'path-security',
        code,
      };
    case 'PATH_OUTSIDE_WORKSPACE':
      return {
        title: 'Outside workspace',
        detail: `${tool} was blocked for a path outside workspace roots (code=PATH_OUTSIDE_WORKSPACE). Use an in-workspace path, absolute path when profile allows, or /add-dir for extra roots.`,
        status: `${tool} blocked: PATH_OUTSIDE_WORKSPACE`,
        coalesceKey: 'path-security',
        code,
      };
    case 'PATH_READ_ONLY':
      return {
        title: 'Sandbox read-only',
        detail: `${tool} write/edit was blocked by the read-only sandbox profile (code=PATH_READ_ONLY). Switch sandbox profile or use read-only tools.`,
        status: `${tool} blocked: PATH_READ_ONLY`,
        coalesceKey: 'path-security',
        code,
      };
    case 'PATH_INVALID':
      return {
        title: 'Invalid path',
        detail: `${tool} received an invalid path (code=PATH_INVALID). Provide a non-empty, well-formed path.`,
        status: `${tool} blocked: PATH_INVALID`,
        coalesceKey: 'path-security',
        code,
      };
    default:
      return {
        title: 'Path security blocked',
        detail: `${tool} was blocked by path security. Check workspace roots, sandbox profile, and sensitive-file rules.`,
        status: `${tool} blocked: path security`,
        coalesceKey: 'path-security',
        code: 'PATH_SECURITY',
      };
  }
}
