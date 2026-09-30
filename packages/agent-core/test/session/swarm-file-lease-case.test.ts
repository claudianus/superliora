/**
 * Lease identity is a filesystem property, not a platform one: a default macOS
 * volume folds case, so `src/App.ts` and `src/app.ts` are one file and must
 * contend for one lease. Folding only on `win32` handed two workers the same
 * path with `ok: true` for both.
 *
 * The host is taken out of the decision by driving the probe, and the module is
 * imported per case: a static import would fold once against the real host.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type LeaseModule = typeof import('#/fleet/swarm-file-lease');

async function withCaseFoldingProbe(foldsCase: boolean): Promise<LeaseModule> {
  vi.resetModules();
  vi.doMock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
      ...actual,
      default: actual,
      existsSync: (p: unknown) =>
        typeof p === 'string' && p.endsWith('caseprobe')
          ? foldsCase
          : actual.existsSync(p as never),
    };
  });
  return import('#/fleet/swarm-file-lease');
}

afterEach(() => {
  vi.doUnmock('node:fs');
  vi.resetModules();
});

describe('swarm file lease identity follows the filesystem', () => {
  it('gives two case spellings of one path a single lease when the filesystem folds case', async () => {
    const { createSwarmFileLeaseRegistry, normalizeLeasePath } =
      await withCaseFoldingProbe(true);

    expect(normalizeLeasePath('/work/src/App.ts')).toBe('/work/src/app.ts');

    const registry = createSwarmFileLeaseRegistry();
    expect(registry.claim('/work/src/App.ts', 'expert-a', 'run-1').ok).toBe(true);
    const second = registry.claim('/work/src/app.ts', 'expert-b', 'run-1');
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.conflict.holder.ownerId).toBe('expert-a');
  });

  it('keeps two case spellings distinct when the filesystem does not fold case', async () => {
    const { createSwarmFileLeaseRegistry, normalizeLeasePath } =
      await withCaseFoldingProbe(false);

    expect(normalizeLeasePath('/work/src/App.ts')).toBe('/work/src/App.ts');

    const registry = createSwarmFileLeaseRegistry();
    expect(registry.claim('/work/src/App.ts', 'expert-a', 'run-1').ok).toBe(true);
    expect(registry.claim('/work/src/app.ts', 'expert-b', 'run-1').ok).toBe(true);
  });
});