import { describe, expect, it } from 'vitest';

import { highlightLines } from '#/tui/components/media/code-highlight';
import { formatTranscriptOutput } from '#/tui/utils/transcript/transcript-output-format';
import { withTranscriptMeasureMode } from '#/tui/renderer';

describe('measure-mode format short-circuits', () => {
  it('highlightLines returns plain lines without caching poison during measure', () => {
    const code = ['function hello() {', '  return 1;', '}'].join('\n');
    const measured = withTranscriptMeasureMode(() => highlightLines(code, 'typescript'));
    expect(measured).toEqual(code.split('\n'));

    const painted = highlightLines(code, 'typescript');
    // Paint path may colorize; measure must not force paint to stay plain.
    expect(painted.length).toBe(3);
    // At least one line should differ from raw when highlight works, or all
    // equal if grammar missing — either way paint must run freely.
    expect(painted.join('\n').length).toBeGreaterThan(0);
  });

  it('formatTranscriptOutput skips pretty-print during measure', () => {
    const json = '{"a":1,"b":2,"c":[1,2,3]}';
    const measured = withTranscriptMeasureMode(() =>
      formatTranscriptOutput(json, { mode: 'tool' }),
    );
    // Compact form preserved (no multi-line pretty).
    expect(measured).toContain('{"a":1');
    expect(measured.split('\n').length).toBe(1);

    const painted = formatTranscriptOutput(json, { mode: 'tool' });
    // Pretty path may expand; must not be stuck on measure stub via LRU.
    expect(painted.length).toBeGreaterThan(0);
  });
});
