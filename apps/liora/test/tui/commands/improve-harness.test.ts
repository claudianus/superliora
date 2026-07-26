import { describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands/dispatch';
import {
  IMPROVEMENT_AREAS,
  handleImproveHarnessCommand,
  improveHarnessArgumentCompletions,
  parseImproveHarnessCommand,
} from '#/tui/commands/improve-harness';

function createHost() {
  return {
    requireSession: vi.fn(() => ({})),
    showError: vi.fn(),
    showStatus: vi.fn(),
    sendNormalUserInput: vi.fn(),
  } as unknown as SlashCommandHost & {
    requireSession: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
    showStatus: ReturnType<typeof vi.fn>;
    sendNormalUserInput: ReturnType<typeof vi.fn>;
  };
}

describe('/improve-harness command', () => {
  it('parses area and --auto tokens', () => {
    expect(parseImproveHarnessCommand('')).toEqual({});
    expect(parseImproveHarnessCommand('tui')).toEqual({ area: 'tui' });
    expect(parseImproveHarnessCommand('--auto')).toEqual({ auto: true });
    expect(parseImproveHarnessCommand('performance --auto')).toEqual({
      area: 'performance',
      auto: true,
    });
    expect(parseImproveHarnessCommand('--auto reliability')).toEqual({
      area: 'reliability',
      auto: true,
    });
  });

  it('exposes the fixed improvement area catalog', () => {
    expect([...IMPROVEMENT_AREAS]).toEqual([
      'tui',
      'tools',
      'performance',
      'reliability',
      'ux',
      'docs',
      'tests',
    ]);
  });

  it('completes leading area/--auto tokens', () => {
    expect(improveHarnessArgumentCompletions('')?.map((item) => item.value)).toEqual([
      ...IMPROVEMENT_AREAS,
      '--auto',
    ]);
    expect(improveHarnessArgumentCompletions('to')?.map((item) => item.value)).toEqual(['tools']);
    expect(improveHarnessArgumentCompletions('--a')?.map((item) => item.value)).toEqual(['--auto']);
    expect(improveHarnessArgumentCompletions('tui')).toBeNull();
    expect(improveHarnessArgumentCompletions('tui ')?.map((item) => item.value)).toEqual([
      'tui --auto',
    ]);
    expect(improveHarnessArgumentCompletions('tui --a')?.map((item) => item.value)).toEqual([
      'tui --auto',
    ]);
    expect(improveHarnessArgumentCompletions('tui --auto')).toBeNull();
    expect(improveHarnessArgumentCompletions('--auto ')?.map((item) => item.value)).toEqual([
      ...IMPROVEMENT_AREAS.map((area) => `--auto ${area}`),
    ]);
    expect(improveHarnessArgumentCompletions('--auto r')?.map((item) => item.value)).toEqual([
      '--auto reliability',
    ]);
    expect(improveHarnessArgumentCompletions('--auto reliability')).toBeNull();
    expect(improveHarnessArgumentCompletions('unknown ')).toBeNull();
    expect(improveHarnessArgumentCompletions('tui --auto extra')).toBeNull();
  });

  it('rejects unknown areas without starting a session prompt', async () => {
    const host = createHost();
    await handleImproveHarnessCommand(host, 'not-a-real-area');
    expect(host.showError).toHaveBeenCalledTimes(1);
    expect(host.showError.mock.calls[0]?.[0]).toContain('Unknown improvement area');
    expect(host.showError.mock.calls[0]?.[0]).toContain('tui');
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('starts an improvement session for a valid area', async () => {
    const host = createHost();
    await handleImproveHarnessCommand(host, 'tui --auto');
    expect(host.showStatus).toHaveBeenCalledWith(
      expect.stringContaining('harness improvement session (tui)'),
    );
    expect(host.sendNormalUserInput).toHaveBeenCalledTimes(1);
    const [prompt, options] = host.sendNormalUserInput.mock.calls[0] ?? [];
    expect(String(prompt)).toContain('Focus area: tui');
    expect(options).toMatchObject({ displayText: '/improve-harness tui --auto' });
  });
});
