import { describe, expect, it } from 'vitest';

import {
  ARCHIVE_RECOVER_TOOL,
  resolveArchiveRecoverToolName,
} from '#/agent/compaction/micro/micro-helpers';

describe('resolveArchiveRecoverToolName', () => {
  it('uses the single Expand recovery tool', () => {
    expect(resolveArchiveRecoverToolName(['Read', 'Expand'])).toBe(ARCHIVE_RECOVER_TOOL);
    expect(resolveArchiveRecoverToolName(['Read', 'Grep'])).toBe(ARCHIVE_RECOVER_TOOL);
  });
});
