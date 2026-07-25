import { describe, expect, it } from 'vitest';

import type { Kaos } from '@superliora/kaos';

import { createVisualDiffTool, VisualDiffTool } from '../../src/tools/visual-diff-tool';

function fakePng(width: number, height: number, payload = new Uint8Array([1, 2, 3])): Uint8Array {
  const out = new Uint8Array(8 + 4 + 4 + 4 + 4 + payload.length);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  out[8] = 0;
  out[9] = 0;
  out[10] = 0;
  out[11] = 13;
  out[12] = 0x49;
  out[13] = 0x48;
  out[14] = 0x44;
  out[15] = 0x52;
  const view = new DataView(out.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  out.set(payload, 24);
  return out;
}

describe('VisualDiffTool factory', () => {
  it('registers name VisualDiff', () => {
    const kaos = {
      readBytes: async () => new Uint8Array(),
    } as unknown as Kaos;
    const tool = createVisualDiffTool(kaos);
    expect(tool).toBeInstanceOf(VisualDiffTool);
    expect(tool.name).toBe('VisualDiff');
  });

  it('rejects invalid input', () => {
    const kaos = {
      readBytes: async () => new Uint8Array(),
    } as unknown as Kaos;
    const tool = createVisualDiffTool(kaos);
    const execution = tool.resolveExecution({ left_path: '', right_path: 'b.png' } as never);
    expect(execution.isError).toBe(true);
  });

  it('execute returns summary line plus JSON with status fields', async () => {
    const left = fakePng(10, 10, new Uint8Array([9]));
    const right = fakePng(20, 10, new Uint8Array([9]));
    const kaos = {
      readBytes: async (path: string) => (path.includes('left') ? left : right),
    } as unknown as Kaos;
    const tool = createVisualDiffTool(kaos);
    const execution = tool.resolveExecution({
      left_path: 'left.png',
      right_path: 'right.png',
    });
    expect(execution.isError).toBeFalsy();
    const result = await execution.execute!();
    expect(result.isError).toBeFalsy();
    const output = result.output as string;
    expect(output).toContain('dimension mismatch');
    expect(output).toContain('"status": "dimension_mismatch"');
    expect(output).toContain('"summary"');
    // First line is the human summary.
    expect(output.split('\n')[0]).toContain('dimension mismatch');
  });
});
