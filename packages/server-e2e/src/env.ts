const DEFAULT_SERVER_URL = 'http://127.0.0.1:58627';

export function resolveServerUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  // SUPERLIORA_SERVER_URL is canonical; KIMI_SERVER_URL remains as a legacy
  // alias for backward compatibility (see root AGENTS.md).
  return env['SUPERLIORA_SERVER_URL'] ?? env['KIMI_SERVER_URL'] ?? DEFAULT_SERVER_URL;
}
