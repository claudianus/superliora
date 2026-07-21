import { describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands/dispatch';
import { handleCronCommand } from '#/tui/commands/cron';

function createHost() {
  return {
    showStatus: vi.fn(),
    sendNormalUserInput: vi.fn(),
  } as unknown as SlashCommandHost & {
    showStatus: ReturnType<typeof vi.fn>;
    sendNormalUserInput: ReturnType<typeof vi.fn>;
  };
}

describe('/cron command', () => {
  it('shows usage with no arguments', () => {
    const host = createHost();
    handleCronCommand(host, '');
    expect(host.showStatus).toHaveBeenCalledTimes(1);
    expect(host.showStatus.mock.calls[0]?.[0]).toContain('/cron list');
    expect(host.showStatus.mock.calls[0]?.[0]).toContain('/cron delete <jobId>');
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('shows usage for help and unknown subcommands', () => {
    const host = createHost();
    handleCronCommand(host, 'help');
    handleCronCommand(host, 'frobnicate');
    expect(host.showStatus).toHaveBeenCalledTimes(2);
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('delegates list to the agent CronList tool with a /cron list display text', () => {
    const host = createHost();
    handleCronCommand(host, 'list');
    expect(host.sendNormalUserInput).toHaveBeenCalledTimes(1);
    expect(host.sendNormalUserInput.mock.calls[0]).toEqual([
      expect.stringContaining('CronList'),
      { displayText: '/cron list' },
    ]);
    expect(host.showStatus).not.toHaveBeenCalled();
  });

  it('accepts ls as a list alias', () => {
    const host = createHost();
    handleCronCommand(host, 'ls');
    expect(host.sendNormalUserInput).toHaveBeenCalledTimes(1);
    expect(host.sendNormalUserInput.mock.calls[0]?.[0]).toContain('CronList');
  });

  it('asks for a job id when delete has no argument', () => {
    const host = createHost();
    handleCronCommand(host, 'delete');
    expect(host.showStatus).toHaveBeenCalledTimes(1);
    expect(host.showStatus.mock.calls[0]?.[0]).toContain('/cron delete <jobId>');
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('delegates delete with the job id to the agent CronDelete tool', () => {
    const host = createHost();
    handleCronCommand(host, 'delete ab12cd34');
    expect(host.sendNormalUserInput).toHaveBeenCalledTimes(1);
    expect(host.sendNormalUserInput.mock.calls[0]).toEqual([
      expect.stringContaining('CronDelete'),
      { displayText: '/cron delete ab12cd34' },
    ]);
    expect(host.sendNormalUserInput.mock.calls[0]?.[0]).toContain('ab12cd34');
  });
});
