import {
  BUILTIN_SLASH_COMMANDS,
  findBuiltInSlashCommand,
  parseSlashInput,
  resolveSlashCommandAvailability,
  addDirArgumentCompletions,
  helpArgumentCompletions,
  memoryArgumentCompletions,
  planArgumentCompletions,
  rendererArgumentCompletions,
  slashCommandsForHelp,
  sortSlashCommands,
  swarmArgumentCompletions,
  thinkingArgumentCompletions,
  thinkingArgumentCompletionsForModel,
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
    expect(findBuiltInSlashCommand('bench')?.name).toBe('bench');
    expect(findBuiltInSlashCommand('preflight')?.name).toBe('preflight');
    expect(findBuiltInSlashCommand('pf')?.name).toBe('preflight');
    expect(findBuiltInSlashCommand('renderer')?.name).toBe('renderer');
    expect(findBuiltInSlashCommand('render')?.name).toBe('renderer');
    expect(findBuiltInSlashCommand('ultraplan')?.name).toBe('ultrawork');
    expect(findBuiltInSlashCommand('up')?.name).toBe('ultrawork');
    expect(findBuiltInSlashCommand('ultraresearch')?.name).toBe('ultrawork');
    expect(findBuiltInSlashCommand('ur')?.name).toBe('ultrawork');
    expect(findBuiltInSlashCommand('ultraswarm')?.name).toBe('ultrawork');
    expect(findBuiltInSlashCommand('us')?.name).toBe('ultrawork');
    expect(findBuiltInSlashCommand('ultragoal')?.name).toBe('ultrawork');
    expect(findBuiltInSlashCommand('ug')?.name).toBe('ultrawork');
    expect(findBuiltInSlashCommand('vibe')).toBeUndefined();
    expect(findBuiltInSlashCommand('code')).toBeUndefined();
    expect(findBuiltInSlashCommand('mcp')?.name).toBe('mcp');
    expect(findBuiltInSlashCommand('status')?.name).toBe('status');
    expect(findBuiltInSlashCommand('thinking')?.name).toBe('thinking');
    expect(findBuiltInSlashCommand('think')?.name).toBe('thinking');
    expect(findBuiltInSlashCommand('usage')?.aliases).not.toContain('status');
    expect(findBuiltInSlashCommand('web')).toBeUndefined();
    expect(findBuiltInSlashCommand('unknown')).toBeUndefined();
  });

  it('marks plan clear as idle-only while normal plan toggles are always available', () => {
    const plan = findBuiltInSlashCommand('plan');
    expect(plan).toBeDefined();
    expect(resolveSlashCommandAvailability(plan!, '')).toBe('always');
    expect(resolveSlashCommandAvailability(plan!, 'on')).toBe('always');
    expect(resolveSlashCommandAvailability(plan!, 'ultra')).toBe('always');
    expect(resolveSlashCommandAvailability(plan!, 'clear')).toBe('idle-only');
  });

  it('offers advanced Ultrawork plan steering completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = planArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['on', 'off', 'ultra', 'clear']);
    expect(values('u')).toEqual(['ultra']);
    expect(planArgumentCompletions('u')).toEqual([
      { value: 'ultra', label: 'ultra', description: 'Steer the UltraPlan stage' },
    ]);
    expect(planArgumentCompletions('')).toEqual([
      { value: 'on', label: 'on', description: 'Enable Ultrawork planning override' },
      { value: 'off', label: 'off', description: 'Disable Ultrawork planning override' },
      { value: 'ultra', label: 'ultra', description: 'Steer the UltraPlan stage' },
      { value: 'clear', label: 'clear', description: 'Clear current plan' },
    ]);
    expect(values('ultra')).toBeNull();
    expect(values('Ship feature X')).toBeNull();
  });

  it('keeps team mode changes and swarm tasks idle-only', () => {
    const swarm = findBuiltInSlashCommand('swarm');
    expect(swarm).toBeDefined();
    expect((swarm as LioraSlashCommand).experimentalFlag).toBeUndefined();
    expect(resolveSlashCommandAvailability(swarm!, 'on')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(swarm!, 'off')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(swarm!, 'Ship feature X')).toBe('idle-only');
  });

  it('keeps advanced and diagnostics commands out of primary help', () => {
    const primaryNames = slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'primary').map((command) => command.name);
    const advancedNames = slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'advanced').map((command) => command.name);
    const diagnosticNames = slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'diagnostics').map((command) => command.name);

    expect(primaryNames).not.toContain('bench');
    expect(primaryNames).not.toContain('preflight');
    expect(primaryNames).not.toContain('renderer');
    expect(primaryNames).not.toContain('plan');
    expect(primaryNames).not.toContain('ultrawork');
    expect(primaryNames).not.toContain('ultraswarm');
    expect(primaryNames).not.toContain('experiments');
    expect(primaryNames).not.toContain('permission');
    expect(primaryNames).not.toContain('reload');
    expect(primaryNames).not.toContain('reload-tui');
    expect(primaryNames).not.toContain('settings');
    expect(primaryNames).not.toContain('swarm');
    expect(primaryNames).not.toContain('export-debug-zip');
    expect(advancedNames).toEqual(
      expect.arrayContaining([
        'experiments',
        'plan',
        'permission',
        'reload',
        'reload-tui',
        'settings',
        'swarm',
        'ultrawork',
      ]),
    );
    expect(advancedNames).not.toContain('ultraswarm');
    expect(diagnosticNames).not.toContain('ultraswarm');
    const ultrawork = slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'advanced').find(
      (command) => command.name === 'ultrawork',
    );
    expect(ultrawork?.aliases).toEqual(['uw']);
    expect(diagnosticNames).toEqual(expect.arrayContaining(['bench', 'export-debug-zip', 'preflight', 'renderer']));
    const help = findBuiltInSlashCommand('help') as LioraSlashCommand | undefined;
    expect(helpArgumentCompletions('')?.map((item) => item.value)).toEqual(['advanced']);
    expect(helpArgumentCompletions('')?.[0]?.description).toBe('Show steering controls');
    expect(helpArgumentCompletions('d')).toBeNull();
    expect(help?.argumentHint).toBeUndefined();
  });

  it('offers native renderer diagnostics and trace completions', () => {
    expect(rendererArgumentCompletions('')?.map((item) => item.value)).toEqual([
      'diagnostics',
      'trace',
    ]);
    expect(rendererArgumentCompletions('diagnostics ')?.map((item) => item.value)).toEqual([
      'diagnostics on',
      'diagnostics off',
      'diagnostics toggle',
      'diagnostics status',
      'diagnostics reset',
    ]);
    expect(rendererArgumentCompletions('diagnostics o')?.map((item) => item.value)).toEqual([
      'diagnostics on',
      'diagnostics off',
    ]);
    expect(rendererArgumentCompletions('diagnostics status')).toBeNull();
    expect(rendererArgumentCompletions('trace ')?.map((item) => item.value)).toEqual([
      'trace status',
      'trace reset',
      'trace export',
    ]);
    expect(rendererArgumentCompletions('trace e')?.map((item) => item.value)).toEqual([
      'trace export',
    ]);
  });

  it('puts core vibe-coding controls first in primary help order', () => {
    const primaryNames = sortSlashCommands(slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'primary')).map(
      (command) => command.name,
    );

    expect(primaryNames.slice(0, 8)).toEqual([
      'auto',
      'model',
      'premium',
      'status',
      'thinking',
      'usage',
      'yolo',
      'btw',
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
      capabilities: ['tool_use'],
    })).toEqual(['off']);
  });

  it('describes long-work controls as Ultrawork steering surfaces', () => {
    const plan = findBuiltInSlashCommand('plan');
    const goal = findBuiltInSlashCommand('goal');
    const swarm = findBuiltInSlashCommand('swarm');
    const ultrawork = findBuiltInSlashCommand('ultrawork');

    expect(plan?.description).toBe('Advanced steering for UltraPlan; Ultrawork auto-enables it');
    expect(goal?.description).toBe('Manage the active Ultrawork goal');
    expect(goal?.description).not.toContain('/goal');
    expect(swarm?.description).toBe('Advanced steering for UltraSwarm; Ultrawork decides after UltraGoal');
    expect(swarm?.description).not.toContain('/swarm');
    expect(ultrawork?.description).toBe(
      'Run Ultrawork: UltraPlan interview, UltraGoal, Research, Swarm decision, Integrate, Verify, Learn',
    );
    expect(ultrawork?.description).not.toContain('/ultrawork');
    expect((ultrawork as LioraSlashCommand | undefined)?.hiddenAliases).toEqual([
      'ultraplan',
      'up',
      'ultraresearch',
      'ur',
      'ultragoal',
      'ug',
      'ultraswarm',
      'us',
    ]);
  });

  it('offers swarm subcommand argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = swarmArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['on', 'off']);
    expect(values('O')).toEqual(['on', 'off']);
    expect(swarmArgumentCompletions('of')).toEqual([
      { value: 'off', label: 'off', description: 'Turn team mode off' },
    ]);
    expect(values('on')).toBeNull();
    expect(values('off')).toBeNull();
    expect(values('Ship feature X')).toBeNull();
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

  it('keeps memory diagnostics out of the default memory completion list', () => {
    const primaryValues = memoryArgumentCompletions('')?.map((item) => item.value);

    expect(primaryValues).toContain('wiki');
    expect(primaryValues).toContain('verify');
    expect(primaryValues).not.toContain('readiness');
    expect(primaryValues).not.toContain('health');
    expect(memoryArgumentCompletions('r')?.map((item) => item.value)).not.toContain('readiness');
    expect(memoryArgumentCompletions('h')).toBeNull();
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

  it('registers goal with subcommand-aware availability', () => {
    const goal = findBuiltInSlashCommand('goal');
    expect(goal).toBeDefined();
    expect((goal as LioraSlashCommand).experimentalFlag).toBeUndefined();
    expect(resolveSlashCommandAvailability(goal!, '')).toBe('always');
    expect(resolveSlashCommandAvailability(goal!, 'status')).toBe('always');
    expect(resolveSlashCommandAvailability(goal!, 'pause')).toBe('always');
    expect(resolveSlashCommandAvailability(goal!, 'cancel')).toBe('always');
    expect(resolveSlashCommandAvailability(goal!, 'next')).toBe('always');
    expect(resolveSlashCommandAvailability(goal!, 'next Ship feature Y')).toBe('always');
    expect(resolveSlashCommandAvailability(goal!, 'next manage')).toBe('always');
    expect(resolveSlashCommandAvailability(goal!, 'status report')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(goal!, 'pause the rollout')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(goal!, 'cancel the migration')).toBe('idle-only');
    // `clear` is no longer a subcommand; it parses as an objective -> idle-only.
    expect(resolveSlashCommandAvailability(goal!, 'clear')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(goal!, 'resume')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(goal!, 'Ship feature X')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(goal!, 'replace Ship feature Y')).toBe('idle-only');
  });

  it('contains the expected command names once', () => {
    const names = BUILTIN_SLASH_COMMANDS.map((command) => command.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain('web');
    expect(names).toContain('bench');
    expect(names).toContain('preflight');
    expect(names).toEqual(
      expect.arrayContaining([
        'add-dir',
        'aquarium',
        'compact',
        'btw',
        'editor',
        'exit',
        'export-debug-zip',
        'fork',
        'help',
        'init',
        'login',
        'logout',
        'mcp',
        'model',
        'new',
        'permission',
        'plan',
        'preflight',
        'reload',
        'reload-tui',
        'sessions',
        'settings',
        'status',
        'theme',
        'thinking',
        'title',
        'undo',
        'usage',
        'version',
        'yolo',
      ]),
    );
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
