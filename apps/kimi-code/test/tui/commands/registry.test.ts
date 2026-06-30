import {
  BUILTIN_SLASH_COMMANDS,
  findBuiltInSlashCommand,
  parseSlashInput,
  resolveSlashCommandAvailability,
  addDirArgumentCompletions,
  helpArgumentCompletions,
  memoryArgumentCompletions,
  slashCommandsForHelp,
  sortSlashCommands,
  swarmArgumentCompletions,
  type KimiSlashCommand,
} from '#/tui/commands/index';
import { describe, expect, it } from 'vitest';

describe('parseSlashInput', () => {
  it('parses command names and trimmed args', () => {
    expect(parseSlashInput('/help')).toEqual({ name: 'help', args: '' });
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
    expect(findBuiltInSlashCommand('ultraswarm')?.name).toBe('ultraswarm');
    expect(findBuiltInSlashCommand('us')?.name).toBe('ultraswarm');
    expect(findBuiltInSlashCommand('ultragoal')?.name).toBe('ultrawork');
    expect(findBuiltInSlashCommand('ug')?.name).toBe('ultrawork');
    expect(findBuiltInSlashCommand('vibe')).toBeUndefined();
    expect(findBuiltInSlashCommand('code')).toBeUndefined();
    expect(findBuiltInSlashCommand('mcp')?.name).toBe('mcp');
    expect(findBuiltInSlashCommand('status')?.name).toBe('status');
    expect(findBuiltInSlashCommand('usage')?.aliases).not.toContain('status');
    expect(findBuiltInSlashCommand('web')).toBeUndefined();
    expect(findBuiltInSlashCommand('unknown')).toBeUndefined();
  });

  it('marks plan clear as idle-only while normal plan toggles are always available', () => {
    const plan = findBuiltInSlashCommand('plan');
    expect(plan).toBeDefined();
    expect(resolveSlashCommandAvailability(plan!, '')).toBe('always');
    expect(resolveSlashCommandAvailability(plan!, 'on')).toBe('always');
    expect(resolveSlashCommandAvailability(plan!, 'clear')).toBe('idle-only');
  });

  it('keeps team mode changes and swarm tasks idle-only', () => {
    const swarm = findBuiltInSlashCommand('swarm');
    expect(swarm).toBeDefined();
    expect((swarm as KimiSlashCommand).experimentalFlag).toBeUndefined();
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
    expect(primaryNames).not.toContain('ultrawork');
    expect(primaryNames).not.toContain('ultraswarm');
    expect(primaryNames).not.toContain('btw');
    expect(primaryNames).not.toContain('experiments');
    expect(primaryNames).not.toContain('permission');
    expect(primaryNames).not.toContain('reload');
    expect(primaryNames).not.toContain('reload-tui');
    expect(primaryNames).not.toContain('settings');
    expect(primaryNames).not.toContain('swarm');
    expect(primaryNames).not.toContain('export-debug-zip');
    expect(advancedNames).toEqual(
      expect.arrayContaining([
        'btw',
        'experiments',
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
    expect(diagnosticNames).toEqual(expect.arrayContaining(['bench', 'export-debug-zip', 'preflight']));
    const help = findBuiltInSlashCommand('help') as KimiSlashCommand | undefined;
    expect(helpArgumentCompletions('')?.map((item) => item.value)).toEqual(['advanced']);
    expect(helpArgumentCompletions('d')).toBeNull();
    expect(help?.argumentHint).toBeUndefined();
  });

  it('puts core vibe-coding controls first in primary help order', () => {
    const primaryNames = sortSlashCommands(slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'primary')).map(
      (command) => command.name,
    );

    expect(primaryNames.slice(0, 6)).toEqual(['auto', 'model', 'plan', 'status', 'usage', 'yolo']);
  });

  it('describes long-work controls without telling users to start with command names', () => {
    const goal = findBuiltInSlashCommand('goal');
    const swarm = findBuiltInSlashCommand('swarm');

    expect(goal?.description).toBe('Keep long-running work organized across turns');
    expect(goal?.description).not.toContain('/goal');
    expect(goal?.description).not.toContain('defined outcome');
    expect(swarm?.description).toBe('Toggle team mode or send one task to the team');
    expect(swarm?.description).not.toContain('swarm mode');
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

    expect(primaryValues).not.toContain('readiness');
    expect(primaryValues).not.toContain('health');
    expect(memoryArgumentCompletions('r')?.map((item) => item.value)).not.toContain('readiness');
    expect(memoryArgumentCompletions('h')).toBeNull();
  });

  it('defaults commands without explicit availability to idle-only', () => {
    const command: KimiSlashCommand = {
      name: 'example',
      aliases: [],
      description: 'Example command',
    };

    expect(resolveSlashCommandAvailability(command, '')).toBe('idle-only');
  });

  it('sorts commands by priority descending and name ascending', () => {
    const commands: KimiSlashCommand[] = [
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
    expect((goal as KimiSlashCommand).experimentalFlag).toBeUndefined();
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
