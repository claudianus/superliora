/**
 * `resolveExecution` parses a patch to resolve the paths it touches, and
 * execution used to parse the same string again — the whole patch re-normalized,
 * re-split and re-matched twice per call. The parse is pure, so it is memoized
 * on the patch text.
 */
import { describe, expect, it, vi } from 'vitest';

import { parseOpenCodePatch } from '../../src/tools/builtin/file/apply-patch-core';
import { ApplyPatchTool } from '../../src/tools/builtin/file/apply-patch';
import { createFakeKaos, PERMISSIVE_WORKSPACE } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';

vi.mock('../../src/tools/builtin/file/apply-patch-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/tools/builtin/file/apply-patch-core')>();
  return { ...actual, parseOpenCodePatch: vi.fn(actual.parseOpenCodePatch) };
});

describe('ApplyPatch call overhead', () => {
  it('parses the patch once for a call that resolves paths and then applies it', async () => {
    const parse = vi.mocked(parseOpenCodePatch);
    parse.mockClear();
    const tool = new ApplyPatchTool(
      createFakeKaos({ readText: vi.fn(async () => 'alpha\nbeta\n') }),
      PERMISSIVE_WORKSPACE,
    );

    await executeTool(tool, {
      turnId: '0',
      toolCallId: 'tc_patch_parse',
      signal: new AbortController().signal,
      args: {
        patch: [
          '*** Begin Patch',
          '*** Update File: /ws/one.ts',
          '@@',
          '-alpha',
          '+ALPHA',
          '*** Update File: /ws/two.ts',
          '@@',
          '-beta',
          '+BETA',
          '*** End Patch',
        ].join('\n'),
      },
    });

    expect(parse).toHaveBeenCalledTimes(1);
  });
});