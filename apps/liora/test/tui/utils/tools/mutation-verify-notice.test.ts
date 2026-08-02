import { describe, expect, it } from 'vitest';

import {
  MUTATION_VERIFY_MARKER,
  extractMutationPackageDir,
  formatMutationVerifyNotice,
  isMutationVerifyNudgeOutput,
} from '../../../../src/tui/utils/tools/mutation-verify-notice';

describe('isMutationVerifyNudgeOutput', () => {
  it('detects the PostToolUse sensor marker', () => {
    expect(
      isMutationVerifyNudgeOutput(
        `ok\n\n${MUTATION_VERIFY_MARKER}. Before claiming done, run RunProjectChecks.`,
      ),
    ).toBe(true);
  });

  it('ignores ordinary successes', () => {
    expect(isMutationVerifyNudgeOutput('wrote a.ts')).toBe(false);
    expect(isMutationVerifyNudgeOutput(null)).toBe(false);
  });
});

describe('extractMutationPackageDir', () => {
  it('reads packageDir from under-backticks form', () => {
    expect(
      extractMutationPackageDir(
        `${MUTATION_VERIFY_MARKER} under \`apps/liora\`. Before claiming done...`,
      ),
    ).toBe('apps/liora');
  });

  it('reads packageDir= form', () => {
    expect(
      extractMutationPackageDir(
        'run RunProjectChecks with packageDir=packages/agent-core (or package-scoped)',
      ),
    ).toBe('packages/agent-core');
  });
});

describe('formatMutationVerifyNotice', () => {
  it('names the tool and package scope', () => {
    const notice = formatMutationVerifyNotice('Edit', 'apps/liora');
    expect(notice.title).toBe('Mutation needs verification');
    expect(notice.detail).toContain('Edit');
    expect(notice.detail).toContain('apps/liora');
    expect(notice.status).toContain('apps/liora');
    expect(notice.coalesceKey).toBe('mutation-verify-nudge');
  });
});
