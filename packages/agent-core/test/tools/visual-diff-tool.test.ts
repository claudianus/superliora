import { describe, expect, it } from 'vitest';

import { createVisualDiffTool, VisualDiffTool } from '../../src/tools/visual-diff-tool';

describe('VisualDiffTool factory', () => {
  it('registers name VisualDiff', () => {
    const kaos = {
      readBytes: async () => new Uint8Array([1, 2, 3]),
    } as any;
    const tool = createVisualDiffTool(kaos);
    expect(tool).toBeInstanceOf(VisualDiffTool);
    expect(tool.name).toBe('VisualDiff');
  });

  it('returns JSON comparison via resolveExecution', async () => {
    const left = new Uint8Array([1, 2, 3]);
    const right = new Uint8Array([1, 2, 4]);
    const kaos = {
      readBytes: async (path: string) => (path.includes('left') ? left : right),
    } as any;
    const tool = createVisualDiffTool(kaos);
    const exec = tool.resolveExecution({ left_path: 'left.png', right_path: 'right.png' });
    expect('execute' in exec).toBe(true);
    if (!('execute' in exec)) throw new Error('expected runnable execution');
    const result = await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    const parsed = JSON.parse(String(result.output));
    expect(parsed.identical).toBe(false);
    expect(parsed.note).toContain('MVP not pixel SSIM');
  });
});
