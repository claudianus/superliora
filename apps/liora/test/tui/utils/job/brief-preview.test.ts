import { describe, expect, it } from 'vitest';
import { formatBriefPreviewLines, formatJobAckDetail } from '#/tui/utils/job/brief-preview';
describe('recorded Job brief preview', () => {
  it.each([1, 2, 3])('limits embedded line breaks to %i rendered rows without dropping visible brief content', (maxLines) => {
    const rows = formatBriefPreviewLines({
      successCriteria: ['first\nsecond\r\nthird'],
      mustNotTouch: ['safe\rsecret'],
      verificationCommands: ['npm\u2028test\u2029--run'],
    }, maxLines);
    expect(rows.join('\n').split(/[\r\n\u2028\u2029]/)).toHaveLength(maxLines);
    expect(rows[0]).toContain('first second third');
    if (maxLines >= 2) expect(rows[1]).toContain('safe secret');
    if (maxLines >= 3) expect(rows[2]).toContain('npm test --run');
  });
  it('does not fabricate an acknowledgement detail without a recorded brief or effect', () => {
    expect(formatJobAckDetail({})).toBeUndefined();
  });
});
