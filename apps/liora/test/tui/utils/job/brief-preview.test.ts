import { describe, expect, it } from 'vitest';
import { formatBriefPreviewLines, formatJobAckDetail } from '#/tui/utils/job/brief-preview';
describe('recorded Job brief preview', () => {
  it('shows requested criteria, boundaries, and optional operator verification commands', () => {
    expect(formatBriefPreviewLines({ successCriteria: ['Ship'], mustNotTouch: ['secrets'], verificationCommands: ['pnpm test'] })).toEqual(['ok: Ship', "don't touch: secrets", 'verify: pnpm test']);
  });
  it('caps brief rows and combines observed effect with brief details', () => {
    expect(formatBriefPreviewLines({ successCriteria: ['Ship'], mustNotTouch: ['secrets'] }, 1)).toEqual(['ok: Ship']);
    expect(formatJobAckDetail({ effectPreview: { summary: ' workspace changes ' }, briefPreview: { successCriteria: ['Ship'] } })).toBe('workspace changes\nok: Ship');
  });
  it('does not fabricate an acknowledgement detail without a recorded brief or effect', () => {
    expect(formatJobAckDetail({})).toBeUndefined();
  });
});
