import { describe, expect, it } from 'vitest';

import {
  collectFooterStaleAppStatePatches,
  EXTENSIONS_RELOAD_BADGE_TTL_MS,
  formatExtensionsReloadFooterBadge,
  staleExtensionsReloadClearPatch,
} from '#/tui/components/chrome/footer/footer-badges';

describe('formatExtensionsReloadFooterBadge', () => {
  const atMs = 1_000_000;

  it('shows Extensions reloaded within TTL', () => {
    expect(formatExtensionsReloadFooterBadge({ atMs }, atMs + EXTENSIONS_RELOAD_BADGE_TTL_MS - 1)).toEqual({
      text: 'Extensions reloaded',
      severity: 'info',
    });
  });

  it('hides at and after TTL', () => {
    expect(formatExtensionsReloadFooterBadge({ atMs }, atMs + EXTENSIONS_RELOAD_BADGE_TTL_MS)).toBeNull();
    expect(formatExtensionsReloadFooterBadge({ atMs }, atMs + EXTENSIONS_RELOAD_BADGE_TTL_MS + 1)).toBeNull();
  });

  it('returns null when unset', () => {
    expect(formatExtensionsReloadFooterBadge(null, atMs)).toBeNull();
    expect(formatExtensionsReloadFooterBadge(undefined, atMs)).toBeNull();
  });
});

describe('extensionsReload stale patch', () => {
  const atMs = 1_000_000;
  const sample = { atMs };

  it('clears stale AppState patch only when expired', () => {
    expect(staleExtensionsReloadClearPatch(null)).toBeNull();
    expect(staleExtensionsReloadClearPatch(sample, atMs)).toBeNull();
    expect(
      staleExtensionsReloadClearPatch(sample, atMs + EXTENSIONS_RELOAD_BADGE_TTL_MS),
    ).toEqual({ extensionsReload: null });
  });

  it('collectFooterStaleAppStatePatches clears expired extensionsReload', () => {
    expect(
      collectFooterStaleAppStatePatches(
        { runtimeDegraded: null, searchCascade: null, extensionsReload: sample },
        atMs + EXTENSIONS_RELOAD_BADGE_TTL_MS,
      ),
    ).toEqual({ extensionsReload: null });
  });
});
