import { valid } from 'semver';
import { z } from 'zod';

import { SUPERLIORA_RELEASE_MANIFEST_LATEST_URL } from '#/constant/app';

const RELEASE_FETCH_TIMEOUT_MS = 3_000;

const ReleaseManifestSchema = z.object({
  version: z.string().refine((value) => valid(value) !== null, { error: 'invalid semver' }),
});

export interface FetchReleaseManifestResult {
  readonly version: string;
  readonly manifestUrl: string;
}

async function fetchWithTimeout(fetchImpl: typeof fetch, input: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, RELEASE_FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(input, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch the published native release version from GitHub Release `manifest.json`.
 * This is the authority for SEA / native installs (not the CDN tip files).
 */
export async function fetchLatestReleaseManifest(
  fetchImpl: typeof fetch = fetch,
  manifestUrl: string = SUPERLIORA_RELEASE_MANIFEST_LATEST_URL,
): Promise<FetchReleaseManifestResult> {
  const response = await fetchWithTimeout(fetchImpl, manifestUrl);
  if (!response.ok) {
    throw new Error(`Release manifest returned HTTP ${response.status}`);
  }
  const parsed = ReleaseManifestSchema.parse(JSON.parse(await response.text()));
  return { version: parsed.version, manifestUrl };
}
