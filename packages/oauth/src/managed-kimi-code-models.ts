import { readApiErrorMessage } from './api-error';
import { isRecord } from './utils';
import type {
  FetchManagedKimiCodeModelsOptions,
  ManagedKimiCodeModelInfo,
} from './managed-kimi-code-types';
import { ManagedKimiCodeModelsAuthError } from './managed-kimi-code-types';
import { toModelInfo } from './managed-kimi-code-parse';
import { defaultBaseUrl } from './managed-kimi-code-url';

export async function fetchManagedKimiCodeModels(
  options: FetchManagedKimiCodeModelsOptions,
): Promise<ManagedKimiCodeModelInfo[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = defaultBaseUrl(options.baseUrl);
  const response = await fetchImpl(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const message = await readApiErrorMessage(
      response,
      `Failed to list SuperLiora models (HTTP ${response.status}).`,
    );
    if (response.status === 401 || response.status === 402 || response.status === 403) {
      throw new ManagedKimiCodeModelsAuthError({
        status: response.status,
        baseUrl,
        message,
      });
    }
    throw new Error(message);
  }
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload['data'])) {
    throw new Error(`Unexpected models response for ${baseUrl}.`);
  }
  return payload['data']
    .map((item) => toModelInfo(item))
    .filter((item): item is ManagedKimiCodeModelInfo => item !== undefined);
}
