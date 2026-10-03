import {
  BUILTIN_SLASH_COMMANDS,
  findBuiltInSlashCommand,
  parseSlashInput,
  resolveSlashCommandAvailability,
  addDirArgumentCompletions,
  editorArgumentCompletions,
  helpArgumentCompletions,
  permissionArgumentCompletions,
  slashCommandsForHelp,
  sortSlashCommands,
  thinkingArgumentCompletions,
  thinkingArgumentCompletionsForModel,
  themeArgumentCompletions,
  appearanceArgumentCompletions,
  toggleOnOffArgumentCompletions,
  type LioraSlashCommand,
} from '#/tui/commands/index';
import { describe, expect, it } from 'vitest';

describe('parseSlashInput', () => {
  it('parses command names and trimmed args', () => {
    expect(parseSlashInput('/help')).toEqual({ name: 'help', args: '' });
    expect(parseSlashInput('  /new')).toEqual({ name: 'new', args: '' });
    expect(parseSlashInput('/model   kimi-k2  ')).toEqual({
      name: 'model',
      args: 'kimi-k2',
    });
  });

  it('returns null for non-commands and path-like input', () => {
    expect(parseSlashInput('hello')).toBeNull();
    expect(parseSlashInput('/')).toBeNull();
    expect(parseSlashInput('/   ')).toBeNull();
    expect(parseSlashInput('/some/path')).toBeNull();
    expect(parseSlashInput('/some/path with args')).toBeNull();
  });
});

describe('built-in slash command registry', () => {
  it('finds built-ins by name or alias', () => {
    expect(findBuiltInSlashCommand('exit')?.name).toBe('exit');
    expect(findBuiltInSlashCommand('quit')?.name).toBe('exit');
    expect(findBuiltInSlashCommand('q')?.name).toBe('exit');
    expect(findBuiltInSlashCommand('clear')?.name).toBe('new');
    expect(findBuiltInSlashCommand('btw')?.name).toBe('btw');
    expect(findBuiltInSlashCommand('bench')).toBeUndefined();
    expect(findBuiltInSlashCommand('preflight')).toBeUndefined();
    expect(findBuiltInSlashCommand('pf')).toBeUndefined();
    expect(findBuiltInSlashCommand('renderer')).toBeUndefined();
    expect(findBuiltInSlashCommand('render')).toBeUndefined();
    expect(findBuiltInSlashCommand('term')).toBeUndefined();
    expect(findBuiltInSlashCommand('export-debug-zip')).toBeUndefined();
    expect(findBuiltInSlashCommand('improve-harness')).toBeUndefined();
    expect(findBuiltInSlashCommand('ultraresearch')).toBeUndefined();
    expect(findBuiltInSlashCommand('ur')).toBeUndefined();
    expect(findBuiltInSlashCommand('vibe')).toBeUndefined();
    expect(findBuiltInSlashCommand('code')).toBeUndefined();
    for (const retired of ['plan', 'ask', 'goal', 'refine', 'skills', 'mcp', 'tools', 'tool', 'eyes', 'eye', 'harness', 'premium', 'pq', 'profile', 'persona', 'character', 'feed', 'food', 'context', 'working-set', 'workingset', 'free', 'free-mode', 'freemode']) {
      expect(findBuiltInSlashCommand(retired)).toBeUndefined();
    }
    expect(findBuiltInSlashCommand('status')?.name).toBe('status');
    expect(findBuiltInSlashCommand('thinking')?.name).toBe('thinking');
    expect(findBuiltInSlashCommand('think')?.name).toBe('thinking');
    expect(findBuiltInSlashCommand('usage')?.aliases).not.toContain('status');
    expect(findBuiltInSlashCommand('web')?.name).toBe('web');
    expect(findBuiltInSlashCommand('fetch')?.name).toBe('web');
    expect(findBuiltInSlashCommand('dashboard')).toBeUndefined();
    expect(findBuiltInSlashCommand('dash')).toBeUndefined();
    expect(findBuiltInSlashCommand('unknown')).toBeUndefined();
  });











  it('offers yolo/auto on/off argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = toggleOnOffArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['on', 'off']);
    expect(values('o')).toEqual(['on', 'off']);
    expect(values('of')).toEqual(['off']);
    expect(toggleOnOffArgumentCompletions('on')).toBeNull();
    expect(toggleOnOffArgumentCompletions('off')).toBeNull();
    expect(values('turbo')).toBeNull();
    expect(findBuiltInSlashCommand('yolo')?.completeArgs).toBe(toggleOnOffArgumentCompletions);
    expect(findBuiltInSlashCommand('yes')?.completeArgs).toBe(toggleOnOffArgumentCompletions);
    expect(findBuiltInSlashCommand('auto')?.completeArgs).toBe(toggleOnOffArgumentCompletions);
    expect(resolveSlashCommandAvailability(findBuiltInSlashCommand('yolo')!, 'on')).toBe('always');
    expect(resolveSlashCommandAvailability(findBuiltInSlashCommand('auto')!, 'off')).toBe(
      'always',
    );
  });

  it('offers permission mode argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = permissionArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['manual', 'auto', 'yolo']);
    expect(values('m')).toEqual(['manual']);
    expect(values('a')).toEqual(['auto']);
    expect(values('y')).toEqual(['yolo']);
    expect(permissionArgumentCompletions('man')).toEqual([
      { value: 'manual', label: 'manual', description: 'Prompt for every tool call' },
    ]);
    expect(values('manual')).toBeNull();
    expect(values('auto')).toBeNull();
    expect(values('yolo')).toBeNull();
    expect(values('turbo')).toBeNull();
    expect(findBuiltInSlashCommand('permission')?.completeArgs).toBe(
      permissionArgumentCompletions,
    );
    expect(resolveSlashCommandAvailability(findBuiltInSlashCommand('permission')!, 'yolo')).toBe(
      'always',
    );
  });

  it('offers theme built-in argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = themeArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['auto', 'dark', 'light', 'import']);
    expect(values('d')).toEqual(['dark']);
    expect(values('l')).toEqual(['light']);
    expect(values('i')).toEqual(['import']);
    expect(themeArgumentCompletions('au')).toEqual([
      { value: 'auto', label: 'auto', description: 'Follow terminal light/dark detection' },
    ]);
    expect(values('auto')).toBeNull();
    expect(values('import')).toBeNull();
    expect(values('unknown')).toBeNull();
    expect(findBuiltInSlashCommand('theme')?.completeArgs).toBe(themeArgumentCompletions);
  });

  it('offers appearance key argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = appearanceArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual([
      'profile',
      'density',
      'timestamps',
      'particles',
      'animation-fps',
      'canvas-background',
      'terminal-background',
      'terminal-palette',
      'help',
    ]);
    expect(values('p')).toEqual(['profile', 'particles']);
    expect(values('t')).toEqual(['timestamps', 'terminal-background', 'terminal-palette']);
    expect(values('d')).toEqual(['density']);
    expect(appearanceArgumentCompletions('term')).toEqual([
      {
        value: 'terminal-background',
        label: 'terminal-background',
        description: 'Terminal background (off|session)',
      },
      {
        value: 'terminal-palette',
        label: 'terminal-palette',
        description: 'Terminal palette (on|off)',
      },
    ]);
    expect(values('profile')).toBeNull();
    expect(values('help')).toBeNull();
    expect(values('unknown')).toBeNull();
    expect(values('profile ')).toEqual(['profile auto', 'profile off', 'profile subtle', 'profile premium']);
    expect(values('profile p')).toEqual(['profile premium']);
    expect(values('profile premium')).toBeNull();
    expect(values('density c')).toEqual(['density compact', 'density comfortable']);
    expect(values('timestamps ')).toEqual(['timestamps on', 'timestamps off']);
    expect(values('particles e')).toEqual(['particles events']);
    expect(values('terminal-background ')).toEqual([
      'terminal-background off',
      'terminal-background session',
    ]);
    expect(values('canvas-background o')).toEqual([
      'canvas-background on',
      'canvas-background off',
    ]);
    // Free numeric fps and unknown keys must not invent second-token menus.
    expect(values('animation-fps ')).toBeNull();
    expect(values('animation-fps 30')).toBeNull();
    expect(values('help ')).toBeNull();
    expect(values('profile extra token')).toBeNull();
    expect(findBuiltInSlashCommand('appearance')?.completeArgs).toBe(
      appearanceArgumentCompletions,
    );
    expect(findBuiltInSlashCommand('skin')?.completeArgs).toBe(appearanceArgumentCompletions);
  });

  it('offers editor argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = editorArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['code --wait', 'vim', 'nvim', 'nano']);
    expect(values('v')).toEqual(['vim']);
    expect(values('n')).toEqual(['nvim', 'nano']);
    expect(values('c')).toEqual(['code --wait']);
    expect(editorArgumentCompletions('nv')).toEqual([
      { value: 'nvim', label: 'nvim', description: 'Neovim' },
    ]);
    expect(values('vim')).toBeNull();
    expect(values('nano')).toBeNull();
    expect(values('emacs')).toBeNull();
    expect(findBuiltInSlashCommand('editor')?.completeArgs).toBe(editorArgumentCompletions);
  });

  it('keeps advanced and diagnostics commands out of primary help', () => {
    const primaryNames = slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'primary').map((command) => command.name);
    const advancedNames = slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'advanced').map((command) => command.name);
    const diagnosticNames = slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'diagnostics').map((command) => command.name);

    expect(primaryNames).not.toContain('bench');
    expect(primaryNames).not.toContain('renderer');
    expect(primaryNames).toContain('compact');
    expect(primaryNames).not.toContain('ops');
    expect(primaryNames).not.toContain('experiments');
    expect(primaryNames).toContain('permission');
    expect(primaryNames).toContain('settings');
    expect(primaryNames).not.toContain('yolo');
    expect(primaryNames).not.toContain('auto');
    expect(primaryNames).not.toContain('plugins');
    expect(primaryNames).not.toContain('aquarium');
    expect(primaryNames).not.toContain('feed');
    expect(primaryNames).not.toContain('term');
    expect(primaryNames).not.toContain('reload');
    expect(primaryNames).not.toContain('reload-tui');
    expect(primaryNames).not.toContain('export-debug-zip');
    expect(advancedNames).toEqual(
      expect.arrayContaining([
        'auto',
        'quota',
        'reload',
        'reload-tui',
        'usage',
        'yolo',
      ]),
    );
    expect(advancedNames).not.toContain('permission');
    expect(advancedNames).not.toContain('settings');
    expect(diagnosticNames).not.toContain('bench');
    expect(diagnosticNames).not.toContain('export-debug-zip');
    expect(diagnosticNames).not.toContain('renderer');
    expect(diagnosticNames).not.toContain('term');
    expect(diagnosticNames).not.toContain('improve-harness');
    const help = findBuiltInSlashCommand('help') as LioraSlashCommand | undefined;
    expect(helpArgumentCompletions('')?.map((item) => item.value)).toEqual(['advanced']);
    expect(helpArgumentCompletions('')?.[0]?.description).toBe('Show steering controls');
    expect(helpArgumentCompletions('d')).toBeNull();
    expect(help?.argumentHint).toBeUndefined();
  });


  it('puts core vibe-coding controls first in primary help order', () => {
    const primaryNames = sortSlashCommands(slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'primary')).map(
      (command) => command.name,
    );

    // Highest-priority primary commands sort first (then alphabetically).
    expect(primaryNames.slice(0, 6)).toEqual([
      'help',
      'model',
      'permission',
      'settings',
      'status',
      'thinking',
    ]);
  });

  it('offers thinking effort argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = thinkingArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['off', 'on', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(values('h')).toEqual(['high']);
    expect(values('m')).toEqual(['medium', 'max']);
    expect(values('max')).toBeNull();
    expect(values('very high')).toBeNull();
  });

  it('filters thinking completions through active model effort metadata', () => {
    const values = (
      prefix: string,
      model: Parameters<typeof thinkingArgumentCompletionsForModel>[1],
    ): string[] | null => {
      const items = thinkingArgumentCompletionsForModel(prefix, model);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('', {
      capabilities: ['thinking'],
      supportEfforts: ['low', 'medium'],
    })).toEqual(['off', 'on', 'low', 'medium']);
    expect(values('h', {
      capabilities: ['thinking'],
      supportEfforts: ['low', 'medium'],
    })).toBeNull();
    expect(values('', {
      capabilities: ['always_thinking'],
      supportEfforts: ['low', 'medium'],
    })).toEqual(['on', 'low', 'medium']);
    expect(values('', {
      provider: 'cursor-oauth',
      capabilities: ['thinking'],
      supportEfforts: [],
    })).toEqual([]);
    expect(values('', {
      capabilities: ['tool_use'],
    })).toEqual(['off']);
  });


  it('offers add-dir list and directory argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = addDirArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['list']);
    expect(values('L')).toEqual(['list']);
    expect(values('list')).toBeNull();
    const directoryCompletions = values('/') ?? [];
    expect(directoryCompletions.length).toBeGreaterThan(0);
    expect(directoryCompletions.every((value) => value.startsWith('/') && value.endsWith('/'))).toBe(true);
    expect(directoryCompletions.some((value) => value.startsWith('/.'))).toBe(false);
    expect(values('/.')).toBeNull();
    const homeCompletions = values('~/') ?? [];
    expect(homeCompletions.length).toBeGreaterThan(0);
    expect(homeCompletions.every((value) => value.startsWith('~/') && value.endsWith('/'))).toBe(true);
    expect(homeCompletions.some((value) => value.startsWith('~/.'))).toBe(false);
    expect(homeCompletions.some((value) => value.startsWith('~/sers/'))).toBe(false);
  });


  it('defaults commands without explicit availability to idle-only', () => {
    const command: LioraSlashCommand = {
      name: 'example',
      aliases: [],
      description: 'Example command',
    };

    expect(resolveSlashCommandAvailability(command, '')).toBe('idle-only');
  });

  it('sorts commands by priority descending and name ascending', () => {
    const commands: LioraSlashCommand[] = [
      { name: 'zebra', aliases: [], description: 'Z', priority: 100 },
      { name: 'alpha', aliases: [], description: 'A', priority: 100 },
      { name: 'middle', aliases: [], description: 'M', priority: 50 },
      { name: 'plain', aliases: [], description: 'P' },
    ];

    expect(sortSlashCommands(commands).map((command) => command.name)).toEqual([
      'alpha',
      'zebra',
      'middle',
      'plain',
    ]);
  });


  it('registers each command name once', () => {
    const names = BUILTIN_SLASH_COMMANDS.map((command) => command.name);

    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps TUI reload always available and full reload idle-only', () => {
    const reload = findBuiltInSlashCommand('reload');
    const reloadTui = findBuiltInSlashCommand('reload-tui');

    expect(reload).toBeDefined();
    expect(reloadTui).toBeDefined();
    expect(resolveSlashCommandAvailability(reload!, '')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(reloadTui!, '')).toBe('always');
  });
});
