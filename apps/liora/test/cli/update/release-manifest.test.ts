import { describe, expect, it, vi } from 'vitest';

import { SUPERLIORA_RELEASE_MANIFEST_LATEST_URL } from '#/constant/app';
import { fetchLatestReleaseManifest } from '#/cli/update/release-manifest';

describe('fetchLatestReleaseManifest', () => {
  it('parses the GitHub Release manifest version', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ version: '0.5.0', platforms: {} }),
    });
    const result = await fetchLatestReleaseManifest(fetchImpl as unknown as typeof fetch);
    expect(result.version).toBe('0.5.0');
    expect(result.manifestUrl).toBe(SUPERLIORA_RELEASE_MANIFEST_LATEST_URL);
    expect(fetchImpl).toHaveBeenCalledWith(
      SUPERLIORA_RELEASE_MANIFEST_LATEST_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('throws on non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(
      fetchLatestReleaseManifest(fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/HTTP 503/);
  });
});
