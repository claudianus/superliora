import { kimiCodeBaseUrl } from './managed-usage';
import { SUPERLIORA_PLATFORM_ID } from './managed-kimi-code-constants';

export function managedModelKey(modelId: string): string {
  return `${SUPERLIORA_PLATFORM_ID}/${modelId}`;
}

export function defaultBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl ?? kimiCodeBaseUrl()).replace(/\/+$/, '');
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export function normalizeEndpoint(value: string): string {
  return value.trim().replace(/\/+$/, '');
}
