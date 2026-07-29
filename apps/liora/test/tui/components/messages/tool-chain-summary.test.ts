import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolChainSummaryComponent } from '#/tui/components/messages/tool-chain-summary';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function render(component: ToolChainSummaryComponent): string {
  return strip(component.render(100).join('\n'));
}

describe('ToolChainSummaryComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a live aggregate with the current tool label', () => {
    const summary = new ToolChainSummaryComponent(Date.now());
    summary.setCurrentLabel('Edit');
    summary.record({ file: 'src/a.ts', linesAdded: 4, linesRemoved: 1 });
    summary.record({ file: 'src/b.ts', linesAdded: 2 });

    const out = render(summary);
    expect(out).toContain('Edit');
    expect(out).toContain('2 tools');
    expect(out).toContain('+6/−1');
    expect(out).toContain('⚙');
  });

  it('singular tool count reads "1 tool"', () => {
    const summary = new ToolChainSummaryComponent(Date.now());
    summary.record({});
    expect(render(summary)).toContain('1 tool');
  });

  it('settle switches to past tense with elapsed duration', () => {
    const startedAt = Date.now();
    const summary = new ToolChainSummaryComponent(startedAt);
    summary.setCurrentLabel('Bash');
    summary.record({});
    summary.record({});

    vi.setSystemTime(new Date(startedAt + 64_000));
    summary.settle(Date.now());

    const out = render(summary);
    expect(summary.isSettled()).toBe(true);
    expect(out).toContain('Worked for 1m 4s');
    expect(out).toContain('2 tools');
    // The live label drops once settled.
    expect(out).not.toContain('Bash');
  });

  it('settle is idempotent and keeps the first settle time', () => {
    const startedAt = Date.now();
    const summary = new ToolChainSummaryComponent(startedAt);
    summary.record({});
    vi.setSystemTime(new Date(startedAt + 10_000));
    summary.settle(Date.now());
    vi.setSystemTime(new Date(startedAt + 99_000));
    summary.settle(Date.now());
    expect(render(summary)).toContain('Worked for 10s');
  });

  it('failed tools surface in the settled summary', () => {
    const summary = new ToolChainSummaryComponent(Date.now());
    summary.record({ isError: true, errorText: 'boom: first\nsecond line' });
    summary.record({});
    summary.settle(Date.now());

    const out = render(summary);
    expect(out).toContain('1 failed');
    expect(summary.getStats().firstError).toBe('boom: first');
  });

  it('omits the diff chip when nothing was edited', () => {
    const summary = new ToolChainSummaryComponent(Date.now());
    summary.record({});
    expect(render(summary)).not.toContain('+0');
  });
});
