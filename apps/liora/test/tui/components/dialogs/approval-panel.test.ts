import chalk from 'chalk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { ApprovalPanelComponent } from '#/tui/components/dialogs/approval/approval-panel';
import type {
  PendingApproval,
} from '#/tui/reverse-rpc/types';
import * as appearanceEffects from '#/tui/features/appearance/appearance-effects';
import { currentTheme } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  motionEffectsAllowed,
  SETTLE_FLASH_MS,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/features/appearance/appearance-effects';


const previousEnv = {
  TERM: process.env['TERM'],
  CI: process.env['CI'],
  NO_COLOR: process.env['NO_COLOR'],
  SSH_TTY: process.env['SSH_TTY'],
  SSH_CONNECTION: process.env['SSH_CONNECTION'],
  SSH_CLIENT: process.env['SSH_CLIENT'],
};
const previousChalkLevel = chalk.level;

afterEach(() => {
  chalk.level = previousChalkLevel;
  setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function enablePremiumAmbient(): void {
  process.env['TERM'] = 'xterm-256color';
  delete process.env['CI'];
  delete process.env['NO_COLOR'];
  delete process.env['SSH_TTY'];
  delete process.env['SSH_CONNECTION'];
  delete process.env['SSH_CLIENT'];
  setAppearanceRenderHealth('healthy');
  setAppearanceRenderQuality('full');
  setActiveAppearancePreferences({
    ...DEFAULT_APPEARANCE_PREFERENCES,
    profile: 'premium',
    particles: 'premium',
  });
}

function makeDangerPending(): PendingApproval {
  return {
    data: {
      id: 'approval_danger_motion',
      tool_call_id: 'tool_danger_motion',
      tool_name: 'Bash',
      action: 'run',
      description: '',
      display: [
        {
          type: 'shell',
          language: 'bash',
          command: 'rm -rf /tmp/cache',
          danger: 'recursive delete',
        },
      ],
      choices: [
        { label: 'Approve once', response: 'approved' },
        { label: 'Reject', response: 'rejected' },
      ],
    },
  };
}

function commandLineOf(rendered: string[]): string {
  const line = rendered.find((l) => strip(l).includes('rm -rf /tmp/cache'));
  if (line === undefined) throw new Error('command line not found');
  return line;
}

function choiceLineOf(rendered: string[], label: string): string {
  const line = rendered.find((l) => strip(l).includes(label));
  if (line === undefined) throw new Error(`choice line not found: ${label}`);
  return line;
}

function makePending(): PendingApproval {
  return {
    data: {
      id: 'approval_1',
      tool_call_id: 'tool_1',
      tool_name: 'Bash',
      action: 'run',
      description: 'Update README.md using a shell command',
      display: [],
      choices: [
        { label: 'Approve once', response: 'approved' },
        { label: 'Approve for this session', response: 'approved_for_session' },
        { label: 'Reject', response: 'rejected' },
        { label: 'Reject with feedback', response: 'rejected', requires_feedback: true },
      ],
    },
  };
}

function makeDialog(): {
  dialog: ApprovalPanelComponent;
  responses: Array<{
    response: string;
    feedback?: string | undefined;
    selected_label?: string | undefined;
  }>;
} {
  const responses: Array<{
    response: string;
    feedback?: string | undefined;
    selected_label?: string | undefined;
  }> = [];
  const dialog = new ApprovalPanelComponent(
    makePending(),
    (response) => responses.push(response),
  );
  return { dialog, responses };
}

describe('ApprovalPanelComponent', () => {
  it('renders only numeric approval shortcuts in the hint', () => {
    const { dialog } = makeDialog();
    const out = strip(dialog.render(80).join('\n'));
    expect(out).toContain('1/2/3/4 choose');
    expect(out).not.toContain('y/a/n/f');
  });

  it('esc during feedback editing cancels the input instead of rejecting', () => {
    const { dialog, responses } = makeDialog();

    dialog.handleInput('4'); // "Reject with feedback" → feedback editor
    dialog.handleInput('n');
    dialog.handleInput('o');
    dialog.handleInput('\u001B'); // Esc — cancel the draft, not the tool call
    expect(responses).toEqual([]);

    // The choice list is still functional after leaving the feedback editor.
    dialog.handleInput('1');
    expect(responses).toEqual([
      { response: 'approved', feedback: undefined, selected_label: undefined },
    ]);
  });

  it('esc from the choice list still rejects the tool call', () => {
    const { dialog, responses } = makeDialog();
    dialog.handleInput('\u001B');
    expect(responses).toEqual([
      { response: 'rejected', feedback: undefined, selected_label: undefined },
    ]);
  });

  it('renders choice descriptions beneath the label when present', () => {
    const pending: PendingApproval = {
      data: {
        id: 'approval_choice',
        tool_call_id: 'tool_choice',
        tool_name: 'Bash',
        action: 'Run a shell command',
        description: '',
        display: [],
        choices: [
          {
            label: 'Approve once',
            response: 'approved',
            selected_label: 'once',
            description: 'Run this command once without changing permissions.',
          },
          { label: 'Do not start', response: 'cancelled', selected_label: 'cancel' },
        ],
      },
    };
    const out = strip(new ApprovalPanelComponent(pending, () => {}).render(80).join('\n'));
    expect(out).toContain('1. Approve once');
    expect(out).toContain('Run this command once without changing permissions.');
    // A choice without a description stays label-only — no stray blank helper line.
    expect(out).toContain('2. Do not start');
  });

  it('renders brief approval details beneath the command title', () => {
    const pending: PendingApproval = {
      data: {
        id: 'approval_brief',
        tool_call_id: 'tool_brief',
        tool_name: 'Bash',
        action: 'run',
        description: '',
        display: [
          {
            type: 'brief',
            text: 'Workspace: /tmp/project\nCommand: printf ready\nOutput: terminal',
          },
        ],
        choices: [{ label: 'Approve once', response: 'approved' }],
      },
    };
    const out = strip(new ApprovalPanelComponent(pending, () => {}).render(80).join('\n'));

    expect(out).toContain('Run this command?');
    expect(out).toContain('Workspace: /tmp/project');
    expect(out).toContain('Command: printf ready');
    expect(out).toContain('Output: terminal');
  });

  it('renders dangerous shell warnings with simple copy and no icon', () => {
    const pending: PendingApproval = {
      data: {
        id: 'approval_danger',
        tool_call_id: 'tool_danger',
        tool_name: 'Bash',
        action: 'run',
        description: '',
        display: [
          {
            type: 'shell',
            language: 'bash',
            command: 'rm -rf /tmp/cache',
            danger: 'recursive delete',
          },
        ],
        choices: [{ label: 'Approve once', response: 'approved' }],
      },
    };
    const dialog = new ApprovalPanelComponent(pending, () => {});

    const out = strip(dialog.render(80).join('\n'));
    expect(out).toContain('Dangerous: recursive delete');
    expect(out).not.toContain('potentially destructive');
    expect(out).not.toContain('⚠');
  });

  it('wraps a long single-line shell command instead of truncating it', () => {
    const head = 'approve-long-command-head';
    const tail = 'approve-long-command-tail';
    const command = `printf ${head}_${'x'.repeat(220)}_${tail}`;
    const pending: PendingApproval = {
      data: {
        id: 'approval_long_command',
        tool_call_id: 'tool_long_command',
        tool_name: 'Bash',
        action: 'run',
        description: '',
        display: [
          {
            type: 'shell',
            language: 'bash',
            command,
          },
        ],
        choices: [{ label: 'Approve once', response: 'approved' }],
      },
    };
    const dialog = new ApprovalPanelComponent(pending, () => {});

    const rendered = dialog.render(60);
    const out = strip(rendered.join('\n'));
    expect(rendered.length).toBeGreaterThan(8);
    expect(out).toContain(head);
    expect(out).toContain(tail);
    expect(out).not.toContain('...');
    expect(out).not.toContain('…');
  });

  it('numeric shortcuts still drive approval actions', () => {
    const { dialog, responses } = makeDialog();
    dialog.handleInput('2');
    expect(responses).toEqual([{ response: 'approved_for_session', feedback: undefined }]);
  });

  it('shortcut 4 enters feedback mode and submits the typed feedback', () => {
    const { dialog, responses } = makeDialog();
    dialog.handleInput('4');
    dialog.handleInput('n');
    dialog.handleInput('o');
    dialog.handleInput('\r');
    expect(responses).toEqual([{ response: 'rejected', feedback: 'no' }]);
  });

  it('renders feedback input inline with the selected choice', () => {
    const { dialog } = makeDialog();
    dialog.handleInput('4');

    const out = strip(dialog.render(80).join('\n'));
    expect(out).toContain('❯ 4. Reject with feedback');
    expect(out).not.toContain('\n  > ');
  });

  it('legacy y/a/n/f shortcuts no longer trigger approval actions', () => {
    for (const key of ['y', 'a', 'n', 'f']) {
      const { dialog, responses } = makeDialog();
      dialog.handleInput(key);
      expect(responses).toEqual([]);
    }
  });

  it('feedback input supports left/right cursor editing', () => {
    const { dialog, responses } = makeDialog();
    dialog.handleInput('4');
    dialog.handleInput('n');
    dialog.handleInput('o');
    dialog.handleInput('\u001B[D');
    dialog.handleInput('!');
    dialog.handleInput('\r');
    expect(responses).toEqual([{ response: 'rejected', feedback: 'n!o' }]);
  });

  it('feedback input keeps editor shortcuts like ctrl+b / ctrl+f', () => {
    const { dialog, responses } = makeDialog();
    dialog.handleInput('4');
    dialog.handleInput('a');
    dialog.handleInput('b');
    dialog.handleInput('c');
    dialog.handleInput('\u0002');
    dialog.handleInput('\u0002');
    dialog.handleInput('X');
    dialog.handleInput('\u0006');
    dialog.handleInput('Y');
    dialog.handleInput('\r');
    expect(responses).toEqual([{ response: 'rejected', feedback: 'aXbYc' }]);
  });

  it('renders focused feedback input inline when editing feedback', () => {
    const { dialog } = makeDialog();
    dialog.focused = true;
    dialog.handleInput('4');
    dialog.handleInput('x');

    const out = dialog.render(80).join('\n');
    expect(out).toContain('x');
  });

  it.each(['\u0003', '\u0004', '\u001B'])(
    'shortcut %j rejects approval immediately',
    (key) => {
      const { dialog, responses } = makeDialog();
      dialog.handleInput(key);
      expect(responses).toEqual([{ response: 'rejected' }]);
    },
  );


  it('forwards ctrl+o to the global tool-output toggle without affecting the panel', () => {
    const pending: PendingApproval = {
      data: {
        id: 'approval_forward',
        tool_call_id: 'tool_forward',
        tool_name: 'Bash',
        action: 'run',
        description: '',
        display: [
          {
            type: 'shell',
            language: 'bash',
            command: 'printf approval-forwarded',
          },
        ],
        choices: [{ label: 'Approve once', response: 'approved' }],
      },
    };
    let globalToggleCalls = 0;
    const dialog = new ApprovalPanelComponent(pending, () => {}, () => globalToggleCalls++);

    dialog.handleInput('\u000F'); // Ctrl+O

    const after = strip(dialog.render(120).join('\n'));
    expect(globalToggleCalls).toBe(1);
    expect(after).toContain('approval-forwarded');
  });


  it('breathes dangerous shell command ANSI across ticks under premium (plain text stable)', () => {
    chalk.level = 3;
    enablePremiumAmbient();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    // Premium danger breathe interval is 220ms; advance past one odd tick.
    advanceAppearanceAnimationClock(0);
    expect(motionEffectsAllowed()).toBe(true);
    const dialog = new ApprovalPanelComponent(makeDangerPending(), () => {});

    const a = commandLineOf(dialog.render(80));
    advanceAppearanceAnimationClock(300);
    const b = commandLineOf(dialog.render(80));

    expect(strip(a)).toContain('rm -rf /tmp/cache');
    expect(strip(b)).toBe(strip(a));
    expect(a).not.toBe(b);
  });

  it('keeps dangerous shell command styling static when appearance is off', () => {
    chalk.level = 3;
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'off',
      particles: 'off',
    });
    advanceAppearanceAnimationClock(0);
    const dialog = new ApprovalPanelComponent(makeDangerPending(), () => {});

    const a = commandLineOf(dialog.render(80));
    advanceAppearanceAnimationClock(300);
    const b = commandLineOf(dialog.render(80));

    expect(strip(a)).toContain('rm -rf /tmp/cache');
    expect(a).toBe(b);
  });

  it('settle-flashes the selected choice label after cursor moves under premium', () => {
    chalk.level = 3;
    enablePremiumAmbient();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
    const settleSpy = vi.spyOn(appearanceEffects, 'renderSettleFlash');
    const { dialog } = makeDialog();

    dialog.handleInput('\u001B[B'); // ↓ to choice 2
    const settling = choiceLineOf(dialog.render(80), '2. Approve for this session');
    expect(settleSpy).toHaveBeenCalled();
    expect(String(settleSpy.mock.calls[0]?.[0])).toContain('2. Approve for this session');

    settleSpy.mockClear();
    advanceAppearanceAnimationClock(Date.now() + SETTLE_FLASH_MS + 80);
    const settled = choiceLineOf(dialog.render(80), '2. Approve for this session');

    expect(strip(settling)).toContain('2. Approve for this session');
    expect(strip(settled)).toBe(strip(settling));
    // Past the settle window we fall back to static accent bold (no settle flash).
    expect(settleSpy).not.toHaveBeenCalled();
  });

  it('keeps selected choice accent after cursor moves when appearance is off', () => {
    chalk.level = 3;
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'off',
      particles: 'off',
    });
    advanceAppearanceAnimationClock(0);
    const settleSpy = vi.spyOn(appearanceEffects, 'renderSettleFlash');
    const { dialog } = makeDialog();
    const label = '2. Approve for this session';

    dialog.handleInput('\u001B[B'); // ↓ to choice 2
    const selected = choiceLineOf(dialog.render(80), label);

    expect(settleSpy).not.toHaveBeenCalled();
    expect(selected).toContain(currentTheme.boldFg('accent', label));
    expect(selected).not.toContain(currentTheme.boldFg('textStrong', label));
  });
});
