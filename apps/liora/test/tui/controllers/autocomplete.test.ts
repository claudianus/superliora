import { describe, expect, it, vi } from 'vitest';

import { AutocompleteController } from '#/tui/controllers/shell/autocomplete';
import type { AutocompleteHost } from '#/tui/controllers/shell/autocomplete';

const { providerArgs } = vi.hoisted(() => ({ providerArgs: vi.fn() }));
vi.mock('#/tui/components/editor/file-mention-provider', () => ({
  FileMentionProvider: class {
    constructor(...args: unknown[]) { providerArgs(...args); }
  },
}));
vi.mock('#/tui/commands/index', () => ({
  getBuiltinSlashCommands: () => [
    { name: 'help', description: 'Help', aliases: ['h'], argumentHint: '[query]', visibility: 'primary' },
    { name: 'thinking', description: 'Thinking', visibility: 'advanced' },
    { name: 'job', description: 'Jobs', visibility: 'primary' },
  ],
  sortSlashCommands: (commands: unknown[]) => commands,
  slashCommandsForHelp: (commands: Array<{ visibility: string }>, mode: string) =>
    commands.filter((command) => command.visibility === mode),
  thinkingArgumentCompletionsForModel: vi.fn(() => [{ value: 'high', label: 'high' }]),
  jobArgumentCompletions: vi.fn(() => [{ value: 'review', label: 'review' }]),
}));

describe('static autocomplete', () => {
  it('wires slash commands, aliases, workspace mentions and bash mode without a session catalog', () => {
    const setAutocompleteProvider = vi.fn();
    const setArgumentHints = vi.fn();
    const appState = {
      workDir: '/workspace', additionalDirs: ['/shared'], inputMode: 'prompt',
      availableModels: {}, model: '', conductorJobs: null,
    };
    const host = {
      state: { appState, editor: { setAutocompleteProvider, setArgumentHints } },
      fdPath: null,
    } as unknown as AutocompleteHost;
    const controller = new AutocompleteController(host);
    controller.setupAutocomplete();

    expect(setAutocompleteProvider).toHaveBeenCalledOnce();
    const [commands, workDir, fdPath, additionalDirs, getInputMode] = providerArgs.mock.calls.at(-1)!;
    expect(commands.map((command: { name: string }) => command.name)).toEqual(['help', 'job', 'thinking']);
    expect(workDir).toBe('/workspace');
    expect(fdPath).toBeNull();
    expect(additionalDirs).toBe(appState.additionalDirs);
    expect(getInputMode()).toBe('prompt');
    appState.inputMode = 'bash';
    expect(getInputMode()).toBe('bash');
    expect(setArgumentHints).toHaveBeenCalledWith(new Map([['help', '[query]'], ['h', '[query]']]));
    expect(controller.getSlashCommands('advanced').map((command) => command.name)).toEqual(['thinking']);
  });
});
