import { afterEach, describe, expect, it } from 'vitest';

import { TruncatedOutputComponent } from '#/tui/components/messages/tool-renderers/truncated';
import {
  clearDeferredTranscriptFormatQueueForTest,
  flushDeferredTranscriptFormatQueueForTest,
  setDeferredFormatSchedulerForTest,
} from '#/tui/utils/transcript/deferred-format-queue';
import { withTranscriptMeasureMode } from '#/tui/renderer';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('TruncatedOutputComponent deferred highlight', () => {
  afterEach(() => {
    clearDeferredTranscriptFormatQueueForTest();
    setDeferredFormatSchedulerForTest(undefined);
  });

  it('does not highlight during geometry measure of a large body', () => {
    const body = Array.from({ length: 80 }, (_, i) => `{"id":${i},"v":"${'x'.repeat(40)}"}`).join(
      '\n',
    );
    const component = new TruncatedOutputComponent(body, {
      expanded: false,
      isError: false,
      maxLines: 3,
    });

    const measured = withTranscriptMeasureMode(() => component.render(100));
    const text = strip(measured.join('\n'));
    // Plain JSON keys should appear; pretty-print spacing from format may not.
    expect(text).toContain('"id":0');
    expect(component.isFormatPending).toBe(false);
  });

  it('shows plain body then applies highlight after queue flush', () => {
    setDeferredFormatSchedulerForTest(() => {
      // Leave jobs queued until explicit flush.
    });

    const body = `${'{"nested":true,"payload":"'}${'z'.repeat(2_000)}"}`;
    const component = new TruncatedOutputComponent(body, {
      expanded: false,
      isError: false,
      maxLines: 3,
    });

    const first = strip(component.render(100).join('\n'));
    expect(component.isFormatPending).toBe(true);
    expect(first.length).toBeGreaterThan(0);

    setDeferredFormatSchedulerForTest((run) => {
      run();
    });
    flushDeferredTranscriptFormatQueueForTest();
    expect(component.isFormatPending).toBe(false);

    const second = strip(component.render(100).join('\n'));
    expect(second.length).toBeGreaterThan(0);
    // After format, content still present (pretty or highlighted).
    expect(second).toContain('nested');
  });
});
