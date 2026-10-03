import { kimiCodeBaseUrl } from './managed-usage';
import { SUPERLIORA_PLATFORM_ID } from './managed-kimi-code-constants';

export function managedModelKey(modelId: string): string {
  return `${SUPERLIORA_PLATFORM_ID}/${modelId}`;
}

export function defaultBaseUrl(baseUrl: string | undefined): string {
  return normalizeBaseUrl(baseUrl ?? kimiCodeBaseUrl());
}

export function normalizeBaseUrl(baseUrl: string): string {
  let end = baseUrl.length;
  while (end > 0 && baseUrl[end - 1] === '/') end--;
  return baseUrl.slice(0, end);
}

export function normalizeEndpoint(value: string): string {
  return normalizeBaseUrl(value.trim());
}
