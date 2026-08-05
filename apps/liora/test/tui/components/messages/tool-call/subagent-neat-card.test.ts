import type { ToolResultDisplay } from '@superliora/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildSingleSubagentBlockComponents,
  type SingleSubagentBlockState,
} from '#/tui/components/messages/tool-call/subagent-block';
import {
  setActiveNeatMode,
  setActiveTranscriptDetail,
} from '#/tui/features/transcript/transcript-density';
import type { TranscriptDetailLevel } from '#/tui/types';

function strip(text: string): string {
  return text.replaceAll(/\u001B?\[[0-9;]*m/g, '');
}

const RAW = 'raw-line-one\nraw-line-two';

const CHECK: ToolResultDisplay = {
  kind: 'check_report',
  tool: 'vitest',
  exit_code: 1,
  passed: 12,
  failed: 3,
};

function state(display?: ToolResultDisplay): SingleSubagentBlockState {
  return {
    toolCallId: 'tc_sub',
    workspaceDir: undefined,
    activities: [
      {
        id: 'sub_1',
        name: 'Bash',
        args: { command: 'pnpm test' },
        phase: 'done',
        output: RAW,
        ...(display === undefined ? {} : { display }),
        orderSeq: 1,
      },
    ],
    derivedSubagentPhase: 'done',
    subagentError: undefined,
    subagentText: '',
    subagentThinkingText: '',
  };
}

function render(detail: TranscriptDetailLevel, display?: ToolResultDisplay): string {
  setActiveTranscriptDetail(detail);
  return strip(
    buildSingleSubagentBlockComponents(state(display))
      .flatMap((component) => component.render(100))
      .join('\n'),
  );
}

afterEach(() => {
  setActiveNeatMode(true);
  setActiveTranscriptDetail('standard');
});

describe('subagent neat cards', () => {
  it('replaces the raw tail with a card below full detail', () => {
    const out = render('standard', CHECK);
    expect(out).toContain('vitest');
    expect(out).toContain('3');
    expect(out).not.toContain('raw-line-one');
  });

  it('keeps the raw tail below the card at full detail', () => {
    const out = render('full', CHECK);
    expect(out).toContain('vitest');
    expect(out).toContain('raw-line-one');
  });

  it('falls back to the raw tail when no card was attached', () => {
    const out = render('standard');
    expect(out).toContain('raw-line-one');
  });

  it('shows the raw tail when neat mode is off', () => {
    setActiveNeatMode(false);
    const out = render('standard', CHECK);
    expect(out).toContain('raw-line-one');
    expect(out).not.toContain('12 passed');
  });
});
