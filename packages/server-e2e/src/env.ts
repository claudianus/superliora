const DEFAULT_SERVER_URL = 'http://127.0.0.1:58627';

export function resolveServerUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return env['SUPERLIORA_SERVER_URL'] ?? DEFAULT_SERVER_URL;
}
