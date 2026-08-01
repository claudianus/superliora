import { describe, expect, it } from 'vitest';

import {
  ARCHIVE_RECOVER_LEGACY_TOOL,
  ARCHIVE_RECOVER_PREFERRED_TOOL,
  resolveArchiveRecoverToolName,
} from '#/agent/compaction/tool-policy';

describe('resolveArchiveRecoverToolName', () => {
  it('prefers Expand when both Expand and LioraExpand are registered', () => {
    expect(resolveArchiveRecoverToolName(['Read', 'Expand', 'LioraExpand'])).toBe(
      ARCHIVE_RECOVER_PREFERRED_TOOL,
    );
  });

  it('falls back to LioraExpand when only the legacy tool is registered', () => {
    expect(resolveArchiveRecoverToolName(['Read', 'LioraExpand'])).toBe(ARCHIVE_RECOVER_LEGACY_TOOL);
  });

  it('defaults to LioraExpand when no recover tools are registered', () => {
    expect(resolveArchiveRecoverToolName(['Read', 'Grep'])).toBe(ARCHIVE_RECOVER_LEGACY_TOOL);
  });
});
