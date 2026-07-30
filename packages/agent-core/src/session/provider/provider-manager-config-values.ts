import { ErrorCodes, LioraError } from '../../errors';

export function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

export function parseEnvReference(value: string): string | undefined {
  const patterns = [
    /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/,
    /^env:([A-Za-z_][A-Za-z0-9_]*)$/,
    /^env\/([A-Za-z_][A-Za-z0-9_]*)$/,
    /^os\.environ\/([A-Za-z_][A-Za-z0-9_]*)$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

export function providerConfiguredValue(value: string | undefined, label: string): string | undefined {
  const trimmed = nonEmptyString(value);
  if (trimmed === undefined) return undefined;
  const envKey = parseEnvReference(trimmed);
  if (envKey === undefined) return trimmed;
  const resolved = nonEmptyString(process.env[envKey]);
  if (resolved !== undefined) return resolved;
  throw new LioraError(
    ErrorCodes.CONFIG_INVALID,
    `${label} references environment variable "${envKey}", but it is not set.`,
  );
}

export function envValue(
  env: Record<string, string> | undefined,
  key: string,
  label: string,
): string | undefined {
  return providerConfiguredValue(env?.[key], label);
}

export function providerValue(
  configured: string | undefined,
  env: Record<string, string> | undefined,
  envKey: string,
  label: string,
): string | undefined {
  return providerConfiguredValue(configured, label) ?? envValue(env, envKey, `provider env ${envKey}`);
}

export function locationFromVertexAIBaseUrl(baseUrl: string | undefined): string | undefined {
  const url = nonEmptyString(baseUrl);
  if (url === undefined) return undefined;
  try {
    const host = new URL(url).hostname;
    const suffix = '-aiplatform.googleapis.com';
    return host.endsWith(suffix) ? nonEmptyString(host.slice(0, -suffix.length)) : undefined;
  } catch {
    return undefined;
  }
}
