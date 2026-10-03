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

const COMMAND_OUTPUT: ToolResultDisplay = {
  kind: 'command_output',
  exit_code: 1,
  stdout: 'native-command-tail',
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
    const out = render('standard', COMMAND_OUTPUT);
    expect(out).toContain('exit 1');
    expect(out).toContain('native-command-tail');
    expect(out).not.toContain('raw-line-one');
  });

  it('keeps the raw tail below the card at full detail', () => {
    const out = render('full', COMMAND_OUTPUT);
    expect(out).toContain('exit 1');
    expect(out).toContain('raw-line-one');
  });

  it('falls back to the raw tail when no card was attached', () => {
    const out = render('standard');
    expect(out).toContain('raw-line-one');
  });

  it('shows the raw tail when neat mode is off', () => {
    setActiveNeatMode(false);
    const out = render('standard', COMMAND_OUTPUT);
    expect(out).toContain('raw-line-one');
    expect(out).not.toContain('native-command-tail');
  });
});
