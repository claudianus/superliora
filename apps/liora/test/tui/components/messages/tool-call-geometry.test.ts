/**
 * Product mutators (setResult / live output / expand) rebuild tool-call body
 * in place. After geometry was decoupled from paint epoch, those mutators must
 * dirty the parent transcript line-count slot so virtual scroll does not clip
 * grown output.
 */
import { describe, expect, it } from 'vitest';

import { ToolCallComponent } from '#/tui/components/messages/tool-call/index';
import {
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
} from '#/tui/renderer';

describe('ToolCallComponent transcript geometry dirty', () => {
  function mountUnderTranscript(tc: ToolCallComponent): RendererTranscriptViewportComponent {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 80,
    });
    // Historical siblings — prove setResult does not force full remeasure.
    for (let i = 0; i < 8; i++) {
      transcript.addChild({
        invalidate: () => {},
        render: () => [`hist-${i}`],
      });
    }
    transcript.addChild(tc);
    return transcript;
  }

  it('setResult grows contentRowCount without a full parent invalidate', () => {
    const tc = new ToolCallComponent(
      {
        id: 'call_geom_result',
        name: 'Bash',
        args: { command: 'seq 1 20' },
      },
      undefined,
    );
    const transcript = mountUnderTranscript(tc);

    // Warm geometry while the tool is still running (header-only-ish height).
    const before = transcript.contentRowCount(100);
    expect(before).toBeGreaterThan(0);

    const tallOutput = Array.from({ length: 20 }, (_, i) => `out-line-${i}`).join('\n');
    tc.setResult({
      tool_call_id: 'call_geom_result',
      output: tallOutput,
      is_error: false,
    });
    tc.setExpanded(true);

    const after = transcript.contentRowCount(100);
    // Virtual window must see the grown body — stale counts would stay ≈ before.
    expect(after).toBeGreaterThan(before + 5);
    // Paint path must also expose the result lines.
    const painted = transcript.render(100).join('\n');
    expect(painted).toContain('out-line-0');
    expect(painted).toContain('out-line-19');
  });

  it('appendLiveOutput dirties geometry so streaming stdout is not clipped', () => {
    const tc = new ToolCallComponent(
      {
        id: 'call_geom_live',
        name: 'Bash',
        args: { command: 'long-running' },
      },
      undefined,
    );
    const transcript = mountUnderTranscript(tc);
    const before = transcript.contentRowCount(100);

    for (let i = 0; i < 12; i++) {
      tc.appendLiveOutput(`live-${i}\n`);
    }
    tc.setExpanded(true);

    const after = transcript.contentRowCount(100);
    expect(after).toBeGreaterThan(before);
    const painted = transcript.render(100).join('\n');
    expect(painted).toContain('live-0');
  });

  it('setExpanded from collapsed to expanded updates row counts in place', () => {
    const output = Array.from({ length: 15 }, (_, i) => `body-${i}`).join('\n');
    const tc = new ToolCallComponent(
      {
        id: 'call_geom_expand',
        name: 'Read',
        args: { path: 'big.ts' },
      },
      {
        tool_call_id: 'call_geom_expand',
        output,
        is_error: false,
      },
    );
    tc.setExpanded(false);
    const transcript = mountUnderTranscript(tc);
    const collapsed = transcript.contentRowCount(100);

    tc.setExpanded(true);
    const expanded = transcript.contentRowCount(100);
    expect(expanded).toBeGreaterThan(collapsed);
  });
});
