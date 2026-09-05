import { describe, expect, it } from 'vitest';

import { DynamicInjector } from '../../../src/agent/injection/injector';

class StaticInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'static_test';
  protected override dedupeIdenticalBatchContent = true;
  protected override getInjection(): string {
    return 'static card';
  }
}

class ChangingInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'changing_test';
  protected override dedupeIdenticalBatchContent = true;
  private state = 'a';
  protected override getInjection(): string {
    return `card ${this.state}`;
  }
  setState(next: string): void {
    this.state = next;
  }
}

class CadenceInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'cadence_test';
  protected override getInjection(): string {
    return 'periodic refresh';
  }
}

describe('DynamicInjector identical-content batch dedup', () => {
  it('skips a byte-identical re-send while the anchor is live', async () => {
    const injector = new StaticInjector({} as never);
    expect(await injector.collectForBatch()).toBe('static card');
    injector.markBatchInjected(7);
    expect(await injector.collectForBatch()).toBeUndefined();
    expect(await injector.collectForBatch()).toBeUndefined();
  });

  it('re-injects after the anchor is lost (message removal, clear, compaction)', async () => {
    const injector = new StaticInjector({} as never);
    expect(await injector.collectForBatch()).toBe('static card');
    injector.markBatchInjected(7);

    injector.onContextMessageRemoved(7);
    expect(await injector.collectForBatch()).toBe('static card');
    injector.markBatchInjected(9);

    injector.onContextClear();
    expect(await injector.collectForBatch()).toBe('static card');
    injector.markBatchInjected(2);

    injector.onContextCompacted(10);
    expect(injector['injectedAt']).toBeNull();
    expect(await injector.collectForBatch()).toBe('static card');
  });

  it('re-injects when the state changes the content', async () => {
    const injector = new ChangingInjector({} as never);
    expect(await injector.collectForBatch()).toBe('card a');
    injector.markBatchInjected(3);
    expect(await injector.collectForBatch()).toBeUndefined();

    injector.setState('b');
    expect(await injector.collectForBatch()).toBe('card b');
    injector.markBatchInjected(5);
    expect(await injector.collectForBatch()).toBeUndefined();
  });

  it('leaves cadence injectors (flag off) re-emitting identical content', async () => {
    const injector = new CadenceInjector({} as never);
    expect(await injector.collectForBatch()).toBe('periodic refresh');
    injector.markBatchInjected(4);
    expect(await injector.collectForBatch()).toBe('periodic refresh');
  });
});
