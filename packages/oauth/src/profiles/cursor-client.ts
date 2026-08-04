/** Shared Cursor CLI client identity (auth headers + AvailableModels RPC). */

export const CURSOR_CLIENT_TYPE = 'cli';
export const CURSOR_CLIENT_VERSION_DEFAULT = 'cli-2026.07.08-0c04a8a';

export function resolveCursorClientVersion(): string {
  const fromEnv = process.env['SUPERLIORA_CURSOR_CLIENT_VERSION']?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return CURSOR_CLIENT_VERSION_DEFAULT;
}

/** Static headers identifying a Cursor CLI session for Connect-RPC calls. */
export function cursorAuthHeaders(): Record<string, string> {
  return {
    'x-cursor-client-type': CURSOR_CLIENT_TYPE,
    'x-cursor-client-version': resolveCursorClientVersion(),
    'x-ghost-mode': 'false',
  };
}
