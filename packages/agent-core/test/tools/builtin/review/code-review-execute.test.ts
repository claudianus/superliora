import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type { Kaos } from '@superliora/kaos';

import {
  REVIEW_JUDGMENT_DEFERRED,
  createLioraReviewTool,
} from '../../../../src/tools/builtin/review/code-review';

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

describe('LioraReview execute mechanical inventory', () => {
  it('inventories the diff and does not emit regex quality findings', async () => {
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
    expect(output).toContain('src/x.ts');
    expect(output).toContain('+4 / -1');
    expect(output).toContain(REVIEW_JUDGMENT_DEFERRED);
    expect(output).not.toContain('**CRITICAL**');
    expect(output).not.toContain('**SUGGESTION**');
    expect(output).not.toContain('Unresolved TODO');
    expect(output).not.toContain('debugger statement');
    expect(output).not.toContain('console.log left in code');
    expect(output).not.toContain('The diff looks clean');
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
