import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_MODEL_UNAVAILABLE_COOLDOWN_MS,
  ModelRouteHealthStore,
  resetModelRouteHealthStoreForTests,
  sharedModelRouteHealthStore,
} from '../../../src/agent/routing/model-route-health';

describe('ModelRouteHealthStore', () => {
  afterEach(() => {
    resetModelRouteHealthStoreForTests();
  });

  it('marks alias unavailable and expires after cooldown', () => {
    const store = new ModelRouteHealthStore(new Map());
    const now = 1_000_000;
    store.markUnavailable('dead', {
      kind: 'model_unavailable',
      failureReason: '404',
      now,
    });
    expect(store.isAvailable('dead', now)).toBe(false);
    expect(store.failureReason('dead', now)).toBe('404');
    expect(store.isAvailable('dead', now + DEFAULT_MODEL_UNAVAILABLE_COOLDOWN_MS + 1)).toBe(true);
  });

  it('clear and markHealthy restore availability', () => {
    sharedModelRouteHealthStore.markUnavailable('x', { kind: 'probe_fail' });
    expect(sharedModelRouteHealthStore.isAvailable('x')).toBe(false);
    sharedModelRouteHealthStore.markHealthy('x');
    expect(sharedModelRouteHealthStore.isAvailable('x')).toBe(true);
  });

  it('ignores empty alias', () => {
    expect(sharedModelRouteHealthStore.markUnavailable('  ')).toBeUndefined();
    expect(sharedModelRouteHealthStore.isAvailable('')).toBe(true);
  });
});
