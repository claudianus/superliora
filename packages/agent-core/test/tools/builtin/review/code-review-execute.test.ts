import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type { Kaos } from '@superliora/kaos';

import { createLioraReviewTool } from '../../../../src/tools/builtin/review/code-review';

const SAMPLE_DIFF = `diff --git a/src/x.ts b/src/x.ts
index 1111111..2222222 100644
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,6 @@
 export function f() {
-  return 1;
+  // TODO: handle error
+  debugger;
+  console.log('debug');
+  return 2;
 }
`;

function mockGitDiffKaos(diff: string): Kaos {
  return {
    exec: async () => ({
      stdin: { end: () => undefined },
      stdout: Readable.from([diff]),
      stderr: Readable.from(['']),
      wait: async () => 0,
    }),
  } as unknown as Kaos;
}

describe('LioraReview execute baseline scan', () => {
  it('returns structured comments from pure heuristics on a unified diff', async () => {
    const kaos = mockGitDiffKaos(SAMPLE_DIFF);
    const agent = {} as never;
    const tool = createLioraReviewTool(kaos, agent);
    const execution = tool.resolveExecution({
      diff_source: 'range',
      from_ref: 'main',
      to_ref: 'HEAD',
    });
    expect(execution.isError).toBeFalsy();
    const result = await execution.execute!();
    expect(result.isError).toBeFalsy();
    const output = result.output as string;
    expect(output).toContain('Code Review Report');
    expect(output).toContain('TODO');
    expect(output).toContain('debugger');
    expect(output).toContain('console.log');
    expect(output).toContain('src/x.ts');
  });

  it('reports empty when the diff has no changes', async () => {
    const kaos = mockGitDiffKaos('');
    const tool = createLioraReviewTool(kaos, {} as never);
    const execution = tool.resolveExecution({ diff_source: 'workspace' });
    const result = await execution.execute!();
    expect(result.isError).toBeFalsy();
    expect(result.output as string).toContain('No changes to review');
  });
});
