/**
 * Live tool stdout must patch the mounted body in place after the first chunk.
 * Full content rebuild on every stream delta is the hot-path tax under long
 * bash/tool logs.
 */
import { describe, expect, it, vi } from 'vitest';

import { ToolCallComponent } from '#/tui/components/messages/tool-call/index';

describe('ToolCallComponent live stdout patch', () => {
  it('updates live output without remounting the output viewport on later chunks', () => {
    const tc = new ToolCallComponent(
      {
        id: 'call_live_stdout',
        name: 'Bash',
        args: { command: 'seq 1 100' },
      },
      undefined,
    );

    const viewport = (
      tc as unknown as {
        outputViewport: {
          mount: (...args: unknown[]) => void;
          reset: () => void;
          active: unknown;
        };
      }
    ).outputViewport;
    const mountSpy = vi.spyOn(viewport, 'mount');
    const resetSpy = vi.spyOn(viewport, 'reset');

    // First chunk mounts the live shell via content rebuild.
    tc.appendLiveOutput('line-0\n');
    expect(mountSpy).toHaveBeenCalledTimes(1);
    expect(viewport.active).toBeDefined();
    mountSpy.mockClear();
    resetSpy.mockClear();

    // Later chunks patch TruncatedOutput in place — no remount/reset.
    tc.appendLiveOutput('line-1\n');
    tc.appendLiveOutput('line-2\n');
    tc.appendLiveOutput('line-3\n');
    expect(mountSpy).not.toHaveBeenCalled();
    expect(resetSpy).not.toHaveBeenCalled();

    const painted = tc.render(100).join('\n');
    expect(painted).toContain('line-0');
    expect(painted).toContain('line-3');
  });
});
