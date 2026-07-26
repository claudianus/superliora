import {
  BUILTIN_SLASH_COMMANDS,
  findBuiltInSlashCommand,
  parseSlashInput,
  resolveSlashCommandAvailability,
  addDirArgumentCompletions,
  contextArgumentCompletions,
  cronArgumentCompletions,
  editorArgumentCompletions,
  extensionsArgumentCompletions,
  helpArgumentCompletions,
  improveHarnessArgumentCompletions,
  loopArgumentCompletions,
  memoryArgumentCompletions,
  permissionArgumentCompletions,
  personaArgumentCompletions,
  planArgumentCompletions,
  preflightArgumentCompletions,
  premiumArgumentCompletions,
  pluginsArgumentCompletions,
  rendererArgumentCompletions,
  slashCommandsForHelp,
  sortSlashCommands,
  swarmArgumentCompletions,
  thinkingArgumentCompletions,
  thinkingArgumentCompletionsForModel,
  themeArgumentCompletions,
  appearanceArgumentCompletions,
  toggleOnOffArgumentCompletions,
  ultragoalArgumentCompletions,
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
    expect(findBuiltInSlashCommand('ultraplan')?.name).toBe('ultraplan');
    expect(findBuiltInSlashCommand('up')?.name).toBe('ultraplan');
    expect(findBuiltInSlashCommand('ultraresearch')).toBeUndefined();
    expect(findBuiltInSlashCommand('ur')).toBeUndefined();
    expect(findBuiltInSlashCommand('ultraswarm')?.name).toBe('ultraswarm');
    expect(findBuiltInSlashCommand('us')?.name).toBe('ultraswarm');
    expect(findBuiltInSlashCommand('ultragoal')?.name).toBe('ultragoal');
    expect(findBuiltInSlashCommand('ug')?.name).toBe('ultragoal');
    expect(findBuiltInSlashCommand('vibe')).toBeUndefined();
    expect(findBuiltInSlashCommand('code')).toBeUndefined();
    expect(findBuiltInSlashCommand('mcp')?.name).toBe('mcp');
    expect(findBuiltInSlashCommand('tools')?.name).toBe('tools');
    expect(findBuiltInSlashCommand('tool')?.name).toBe('tools');
    expect(findBuiltInSlashCommand('eyes')?.name).toBe('eyes');
    expect(findBuiltInSlashCommand('eye')?.name).toBe('eyes');
    expect(findBuiltInSlashCommand('harness')?.name).toBe('harness');
    expect(findBuiltInSlashCommand('premium')?.name).toBe('premium');
    expect(findBuiltInSlashCommand('pq')?.name).toBe('premium');
    expect(findBuiltInSlashCommand('persona')?.name).toBe('persona');
    expect(findBuiltInSlashCommand('character')?.name).toBe('persona');
    expect(findBuiltInSlashCommand('feed')?.name).toBe('feed');
    expect(findBuiltInSlashCommand('food')?.name).toBe('feed');
    expect(findBuiltInSlashCommand('context')?.name).toBe('context');
    expect(findBuiltInSlashCommand('working-set')?.name).toBe('context');
    expect(findBuiltInSlashCommand('workingset')?.name).toBe('context');
    expect(findBuiltInSlashCommand('status')?.name).toBe('status');
    expect(findBuiltInSlashCommand('thinking')?.name).toBe('thinking');
    expect(findBuiltInSlashCommand('think')?.name).toBe('thinking');
    expect(findBuiltInSlashCommand('usage')?.aliases).not.toContain('status');
    expect(findBuiltInSlashCommand('web')?.name).toBe('web');
    expect(findBuiltInSlashCommand('fetch')?.name).toBe('web');
    expect(findBuiltInSlashCommand('unknown')).toBeUndefined();
  });

  it('lists harness observation commands in help with eyes aliases', () => {
    // Primary help mode keeps high-signal harness observation commands visible.
    const helpNames = new Set(slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'primary').map((c) => c.name));
    expect(helpNames.has('tools')).toBe(true);
    expect(helpNames.has('eyes')).toBe(true);
    expect(helpNames.has('harness')).toBe(true);
    const eyes = findBuiltInSlashCommand('eyes');
    expect(eyes?.aliases).toContain('eye');
    expect(eyes?.description.toLowerCase()).toMatch(/eyes|browser|computer-use|readiness/);
    const harness = findBuiltInSlashCommand('harness');
    expect(harness?.description.toLowerCase()).toMatch(/tools|eyes|premium|mcp/);
  });

  it('marks plan clear as idle-only while normal plan toggles are always available', () => {
    const plan = findBuiltInSlashCommand('plan');
    expect(plan).toBeDefined();
    expect(resolveSlashCommandAvailability(plan!, '')).toBe('always');
    expect(resolveSlashCommandAvailability(plan!, 'on')).toBe('always');
    expect(resolveSlashCommandAvailability(plan!, 'ultra')).toBe('always');
    expect(resolveSlashCommandAvailability(plan!, 'clear')).toBe('idle-only');
  });

  it('offers plan mode argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = planArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['on', 'off', 'clear']);
    expect(values('u')).toBeNull();
    expect(planArgumentCompletions('')).toEqual([
      { value: 'on', label: 'on', description: 'Enable free-form plan mode' },
      { value: 'off', label: 'off', description: 'Disable plan mode' },
      { value: 'clear', label: 'clear', description: 'Clear current plan' },
    ]);
    expect(values('ultra')).toBeNull();
    expect(values('Ship feature X')).toBeNull();
  });

  it('offers premium quality argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = premiumArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['on', 'off', 'status']);
    expect(values('o')).toEqual(['on', 'off']);
    expect(values('s')).toEqual(['status']);
    expect(premiumArgumentCompletions('st')).toEqual([
      { value: 'status', label: 'status', description: 'Show Premium Quality status' },
    ]);
    expect(values('on')).toBeNull();
    expect(values('off')).toBeNull();
    expect(values('status')).toBeNull();
    expect(values('turbo')).toBeNull();
  });

  it('offers persona argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = personaArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual([
      'list',
      'set',
      'name',
      'tone',
      'personality',
      'instructions',
      'clear',
      'help',
    ]);
    expect(values('l')).toEqual(['list']);
    expect(values('p')).toEqual(['personality']);
    expect(values('i')).toEqual(['instructions']);
    expect(personaArgumentCompletions('to')).toEqual([
      { value: 'tone', label: 'tone', description: 'Set response tone' },
    ]);
    expect(values('list')).toBeNull();
    expect(values('clear')).toBeNull();
    expect(values('unknown')).toBeNull();
    expect(values('set ')).toEqual([
      'set friendly',
      'set professional',
      'set concise',
      'set creative',
      'set mentor',
      'set playful',
    ]);
    expect(values('set p')).toEqual(['set professional', 'set playful']);
    expect(values('set professional')).toBeNull();
    expect(values('preset m')).toEqual(['preset mentor']);
    // Free-form second tokens for name/tone/instructions stay unclobbered.
    expect(values('name ')).toBeNull();
    expect(values('tone warm')).toBeNull();
    expect(values('set extra token')).toBeNull();
    expect(findBuiltInSlashCommand('persona')?.completeArgs).toBe(personaArgumentCompletions);
    expect(resolveSlashCommandAvailability(findBuiltInSlashCommand('persona')!, '')).toBe('always');
  });

  it('offers context working-set argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = contextArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['economy', 'balanced', 'deep', 'full', 'status']);
    expect(values('e')).toEqual(['economy']);
    expect(values('b')).toEqual(['balanced']);
    expect(values('d')).toEqual(['deep']);
    expect(values('f')).toEqual(['full']);
    expect(values('s')).toEqual(['status']);
    expect(contextArgumentCompletions('ba')).toEqual([
      { value: 'balanced', label: 'balanced', description: 'Default working-set balance' },
    ]);
    expect(values('economy')).toBeNull();
    expect(values('status')).toBeNull();
    expect(values('turbo')).toBeNull();
    expect(findBuiltInSlashCommand('context')?.completeArgs).toBe(contextArgumentCompletions);
    expect(findBuiltInSlashCommand('working-set')?.completeArgs).toBe(contextArgumentCompletions);
    expect(resolveSlashCommandAvailability(findBuiltInSlashCommand('context')!, 'deep')).toBe(
      'always',
    );
  });

  it('offers loop list/stop argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = loopArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['list', 'stop']);
    expect(values('l')).toEqual(['list']);
    expect(values('s')).toEqual(['stop']);
    expect(loopArgumentCompletions('st')).toEqual([
      { value: 'stop', label: 'stop', description: 'Stop a conversation loop (optional id)' },
    ]);
    expect(values('list')).toBeNull();
    expect(values('2m')).toBeNull();
    expect(findBuiltInSlashCommand('loop')?.completeArgs).toBe(loopArgumentCompletions);
  });

  it('offers cron list/delete/help argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = cronArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['list', 'delete', 'help']);
    expect(values('d')).toEqual(['delete']);
    expect(values('h')).toEqual(['help']);
    expect(cronArgumentCompletions('li')).toEqual([
      { value: 'list', label: 'list', description: 'List scheduled cron jobs' },
    ]);
    expect(values('list')).toBeNull();
    expect(values('delete')).toBeNull();
    expect(values('unknown')).toBeNull();
    expect(findBuiltInSlashCommand('cron')?.completeArgs).toBe(cronArgumentCompletions);
  });

  it('offers improve-harness area and --auto argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = improveHarnessArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual([
      'tui',
      'tools',
      'performance',
      'reliability',
      'ux',
      'docs',
      'tests',
      '--auto',
    ]);
    expect(values('t')).toEqual(['tui', 'tools', 'tests']);
    expect(values('p')).toEqual(['performance']);
    expect(values('-')).toEqual(['--auto']);
    expect(improveHarnessArgumentCompletions('re')).toEqual([
      {
        value: 'reliability',
        label: 'reliability',
        description: 'Focus harness improvement on reliability',
      },
    ]);
    expect(values('tui')).toBeNull();
    expect(values('--auto')).toBeNull();
    expect(values('unknown')).toBeNull();
    expect(findBuiltInSlashCommand('improve-harness')?.completeArgs).toBe(
      improveHarnessArgumentCompletions,
    );
  });

  it('offers extensions tab and Claude import argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = extensionsArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual([
      'plugins',
      'hooks',
      'skills',
      'mcp',
      'claude',
      'import-claude',
      'import',
    ]);
    expect(values('p')).toEqual(['plugins']);
    expect(values('h')).toEqual(['hooks']);
    expect(values('s')).toEqual(['skills']);
    expect(values('m')).toEqual(['mcp']);
    expect(values('c')).toEqual(['claude']);
    expect(values('i')).toEqual(['import-claude', 'import']);
    expect(extensionsArgumentCompletions('import-c')).toEqual([
      {
        value: 'import-claude',
        label: 'import-claude',
        description: 'Import from Claude allowlist inventory',
      },
    ]);
    expect(values('plugins')).toBeNull();
    expect(values('claude')).toBeNull();
    expect(values('unknown')).toBeNull();
    expect(findBuiltInSlashCommand('extensions')?.completeArgs).toBe(
      extensionsArgumentCompletions,
    );
    expect(findBuiltInSlashCommand('ext')?.completeArgs).toBe(extensionsArgumentCompletions);
    expect(findBuiltInSlashCommand('import-claude')?.completeArgs).toBe(
      extensionsArgumentCompletions,
    );
  });

  it('offers ultragoal replace/--loop argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = ultragoalArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['replace', '--loop']);
    expect(values('r')).toEqual(['replace']);
    expect(values('-')).toEqual(['--loop']);
    expect(ultragoalArgumentCompletions('--l')).toEqual([
      {
        value: '--loop',
        label: '--loop',
        description: 'Open self-improvement loop with circuit breaker',
      },
    ]);
    expect(values('replace')).toBeNull();
    expect(values('--loop')).toBeNull();
    // Free-form objectives stay untouched after the first token.
    expect(values('Ship feature')).toBeNull();
    expect(findBuiltInSlashCommand('ultragoal')?.completeArgs).toBe(ultragoalArgumentCompletions);
    expect(findBuiltInSlashCommand('ug')?.completeArgs).toBe(ultragoalArgumentCompletions);
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

  it('offers preflight --query= argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = preflightArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['--query=']);
    expect(values('-')).toEqual(['--query=']);
    expect(values('--q')).toEqual(['--query=']);
    expect(preflightArgumentCompletions('--que')).toEqual([
      {
        value: '--query=',
        label: '--query=',
        description: 'Override Liora Recall readiness query',
      },
    ]);
    expect(values('--query=')).toBeNull();
    expect(values('evidence')).toBeNull();
    expect(findBuiltInSlashCommand('preflight')?.completeArgs).toBe(
      preflightArgumentCompletions,
    );
    expect(findBuiltInSlashCommand('pf')?.completeArgs).toBe(preflightArgumentCompletions);
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
    expect(primaryNames).toContain('plan');
    expect(primaryNames).toContain('swarm');
    expect(primaryNames).not.toContain('ultrawork');
    expect(primaryNames).not.toContain('ultraswarm');
    expect(primaryNames).not.toContain('experiments');
    expect(primaryNames).not.toContain('permission');
    expect(primaryNames).not.toContain('reload');
    expect(primaryNames).not.toContain('reload-tui');
    expect(primaryNames).not.toContain('settings');
    expect(primaryNames).not.toContain('export-debug-zip');
    expect(advancedNames).toEqual(
      expect.arrayContaining([
        'experiments',
        'permission',
        'reload',
        'reload-tui',
        'settings',
        'ultragoal',
        'ultraswarm',
        'ultraplan',
        'ultrawork',
      ]),
    );
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

  it('offers /plugins subcommand and mcp enable|disable completions', () => {
    expect(pluginsArgumentCompletions('')?.map((item) => item.value)).toEqual([
      'list',
      'install',
      'marketplace',
      'info',
      'mcp',
      'enable',
      'disable',
      'remove',
      'reload',
    ]);
    expect(pluginsArgumentCompletions('i')?.map((item) => item.value)).toEqual([
      'install',
      'info',
    ]);
    expect(pluginsArgumentCompletions('list')).toBeNull();
    expect(pluginsArgumentCompletions('install ./plugins/foo')).toBeNull();
    expect(pluginsArgumentCompletions('mcp ')?.map((item) => item.value)).toEqual([
      'mcp enable',
      'mcp disable',
    ]);
    expect(pluginsArgumentCompletions('mcp e')?.map((item) => item.value)).toEqual([
      'mcp enable',
    ]);
    expect(pluginsArgumentCompletions('mcp enable')).toBeNull();
    expect(pluginsArgumentCompletions('mcp enable foo')).toBeNull();
    const plugins = findBuiltInSlashCommand('plugins') as LioraSlashCommand | undefined;
    expect(plugins?.completeArgs).toBe(pluginsArgumentCompletions);
    expect(plugins?.argumentHint).toContain('mcp');
  });

  it('puts core vibe-coding controls first in primary help order', () => {
    const primaryNames = sortSlashCommands(slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'primary')).map(
      (command) => command.name,
    );

    expect(primaryNames.slice(0, 8)).toEqual([
      'auto',
      'model',
      'premium',
      'quota',
      'status',
      'thinking',
      'usage',
      'yolo',
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

  it('describes plan, goal, swarm, and ultrawork controls', () => {
    const plan = findBuiltInSlashCommand('plan');
    const goal = findBuiltInSlashCommand('goal');
    const swarm = findBuiltInSlashCommand('swarm');
    const ultrawork = findBuiltInSlashCommand('ultrawork');

    expect(plan?.description).toBe(
      'Free-form plan: model writes a plan file, you approve (interview → write)',
    );
    expect(goal?.description).toBe(
      'Simple goal loop: set objective, agent iterates until done (Ralph Loop)',
    );
    expect(goal?.description).not.toContain('/goal');
    expect(swarm?.description).toBe(
      'Parallel delegation: send task to specialist subagents (model decides split)',
    );
    expect(swarm?.description).not.toContain('/swarm');
    expect(ultrawork?.description).toBe(
      'Run Ultrawork: UltraPlan interview, UltraGoal, Research, Swarm decision, Integrate, Verify, Learn',
    );
    expect(ultrawork?.description).not.toContain('/ultrawork');
    expect((ultrawork as LioraSlashCommand | undefined)?.hiddenAliases).toBeUndefined();
  });

  it('offers swarm subcommand argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = swarmArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['on', 'off', 'pause', 'restaff', 'raw']);
    expect(values('O')).toEqual(['on', 'off']);
    expect(values('p')).toEqual(['pause']);
    expect(values('re')).toEqual(['restaff']);
    expect(values('ra')).toEqual(['raw']);
    expect(swarmArgumentCompletions('of')).toEqual([
      { value: 'off', label: 'off', description: 'Turn team mode off' },
    ]);
    expect(values('on')).toBeNull();
    expect(values('off')).toBeNull();
    expect(values('pause')).toBeNull();
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
    expect(names).toContain('web');
    expect(names).toContain('bench');
    expect(names).toContain('preflight');
    expect(names).toEqual(
      expect.arrayContaining([
        'add-dir',
        'aquarium',
        'blame',
        'compact',
        'btw',
        'editor',
        'errors',
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
        'web',
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
