import { describe, expect, it, vi } from 'vitest';
import { resolveSlashCommandInput, slashCommandBusyReason } from '#/tui/commands/index';
import { dispatchInput, type SlashCommandHost } from '#/tui/commands/hub/dispatch';

function resolve(input: string, busy: { isStreaming?: boolean; isCompacting?: boolean } = {}) {
  return resolveSlashCommandInput({ input, isStreaming: busy.isStreaming ?? false, isCompacting: busy.isCompacting ?? false });
}

describe('autonomous slash resolution', () => {
  it('resolves builtin aliases without a dynamic skill or plugin catalog', () => {
    expect(resolve('/workspace ./project')).toMatchObject({ kind: 'builtin', name: 'folder', args: './project' });
    expect(resolve('/resume')).toMatchObject({ kind: 'builtin', name: 'sessions' });
    expect(resolve('/config')).toMatchObject({ kind: 'builtin', name: 'settings' });
    expect(resolve('/clear-queue')).toMatchObject({ kind: 'builtin', name: 'queue' });
  });

  it('keeps unknown slash text as normal input', () => {
    expect(resolve('/project-specific instruction')).toEqual({ kind: 'message', input: '/project-specific instruction' });
    expect(resolve('Implement the change')).toEqual({ kind: 'not-command' });
  });

  it.each(['streaming', 'compacting'] as const)('blocks session mutations while %s', (reason) => {
    const busy = reason === 'streaming' ? { isStreaming: true } : { isCompacting: true };
    expect(resolve('/compact keep decisions', busy)).toEqual({ kind: 'blocked', commandName: 'compact', reason });
    expect(resolve('/folder ./other', busy)).toEqual({ kind: 'blocked', commandName: 'folder', reason });
    expect(resolve('/jobs board', busy)).toMatchObject({ kind: 'builtin', name: 'jobs' });
    expect(resolve('/queue clear', busy)).toMatchObject({ kind: 'builtin', name: 'queue' });
    expect(resolve('/settings', busy)).toMatchObject({ kind: 'builtin', name: 'settings' });
  });

  it('prioritizes active streaming over compaction for busy reporting', () => {
    expect(slashCommandBusyReason({ isStreaming: true, isCompacting: true })).toBe('streaming');
    expect(slashCommandBusyReason({ isStreaming: false, isCompacting: false })).toBeUndefined();
  });
});

describe('normal prompt dispatch', () => {
  it.each(['idle', 'running'])('sends normal input directly while %s', (phase) => {
    const sendNormalUserInput = vi.fn();
    const host = { state: { appState: { streamingPhase: phase, isCompacting: false } }, sendNormalUserInput } as unknown as SlashCommandHost;
    dispatchInput(host, 'Implement a new feature');
    expect(sendNormalUserInput).toHaveBeenCalledExactlyOnceWith('Implement a new feature');
  });

  it('dispatches compact to the real session API with the user instruction', async () => {
    const compact = vi.fn(async () => {});
    const host = {
      state: { appState: { streamingPhase: 'idle', isCompacting: false } },
      session: { compact },
      track: vi.fn(),
      showError: vi.fn(),
    } as unknown as SlashCommandHost;
    dispatchInput(host, '/compact Preserve open work');
    await vi.waitFor(() => expect(compact).toHaveBeenCalledExactlyOnceWith({ instruction: 'Preserve open work' }));
    expect(host.showError).not.toHaveBeenCalled();
  });
});
