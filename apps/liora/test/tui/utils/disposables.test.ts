import { describe, expect, it, vi } from 'vitest';

import { DisposableRegistry } from '#/tui/utils/disposables';

describe('DisposableRegistry', () => {
  it('runs disposers in reverse registration order on disposeAll', () => {
    const registry = new DisposableRegistry();
    const order: string[] = [];
    registry.register(() => order.push('first'));
    registry.register(() => order.push('second'));
    registry.register(() => order.push('third'));

    registry.disposeAll();

    expect(order).toEqual(['third', 'second', 'first']);
  });

  it('returns an unregister function that removes the disposer', () => {
    const registry = new DisposableRegistry();
    const dispose = vi.fn();
    const unregister = registry.register(dispose);

    unregister();
    registry.disposeAll();

    expect(dispose).not.toHaveBeenCalled();
  });

  it('runs a disposer immediately if already disposed', () => {
    const registry = new DisposableRegistry();
    registry.disposeAll();

    const dispose = vi.fn();
    registry.register(dispose);

    expect(dispose).toHaveBeenCalledOnce();
  });

  it('is idempotent — disposeAll can be called multiple times safely', () => {
    const registry = new DisposableRegistry();
    const dispose = vi.fn();
    registry.register(dispose);

    registry.disposeAll();
    registry.disposeAll();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it('continues running remaining disposers if one throws', () => {
    const registry = new DisposableRegistry();
    const order: string[] = [];
    registry.register(() => order.push('first'));
    registry.register(() => {
      throw new Error('boom');
    });
    registry.register(() => order.push('third'));

    expect(() => registry.disposeAll()).not.toThrow();
    expect(order).toEqual(['third', 'first']);
  });
});
