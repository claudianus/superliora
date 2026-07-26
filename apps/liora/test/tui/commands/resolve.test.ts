import {
  resolveSkillCommand,
  resolveSlashCommandInput,
  setExperimentalFeatures,
  slashBusyMessage,
  slashCommandBusyReason,
} from '#/tui/commands/index';
import { afterEach, describe, expect, it } from 'vitest';

function resolve(
  input: string,
  overrides: Partial<Parameters<typeof resolveSlashCommandInput>[0]> = {},
) {
  return resolveSlashCommandInput({
    input,
    skillCommandMap: new Map<string, string>(),
    pluginCommandMap: new Map<string, string>(),
    isStreaming: false,
    isCompacting: false,
    ...overrides,
  });
}

describe('resolveSlashCommandInput', () => {
  afterEach(() => {
    setExperimentalFeatures([]);
  });

  it('returns not-command for normal text', () => {
    expect(resolve('hello')).toEqual({ kind: 'not-command' });
  });

  it('resolves explicit skill-prefixed commands without a preloaded skill map', () => {
    expect(resolve('/skill:review src/app.ts')).toEqual({
      kind: 'skill',
      commandName: 'skill:review',
      skillName: 'review',
      args: 'src/app.ts',
    });
  });

  it('resolves namespaced plugin commands only when registered', () => {
    const pluginCommandMap = new Map([['my-plugin:deploy', 'Deploy $ARGUMENTS']]);

    expect(resolve('/my-plugin:deploy prod', { pluginCommandMap })).toEqual({
      kind: 'plugin-command',
      pluginId: 'my-plugin',
      commandName: 'deploy',
      args: 'prod',
    });
    expect(resolve('/my-plugin:missing prod', { pluginCommandMap })).toEqual({
      kind: 'message',
      input: '/my-plugin:missing prod',
    });
  });

  it('blocks plugin commands while busy', () => {
    const pluginCommandMap = new Map([['my-plugin:deploy', 'Deploy $ARGUMENTS']]);

    expect(resolve('/my-plugin:deploy prod', { pluginCommandMap, isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'my-plugin:deploy',
      reason: 'streaming',
    });
    expect(resolve('/my-plugin:deploy prod', { pluginCommandMap, isCompacting: true })).toEqual({
      kind: 'blocked',
      commandName: 'my-plugin:deploy',
      reason: 'compacting',
    });
  });

  it('resolves built-in commands by name and alias', () => {
    expect(resolve('/help')).toMatchObject({ kind: 'builtin', name: 'help', args: '' });
    expect(resolve('/new')).toMatchObject({ kind: 'builtin', name: 'new', args: '' });
    expect(resolve('  /new')).toMatchObject({ kind: 'builtin', name: 'new', args: '' });
    expect(resolve('/q')).toMatchObject({ kind: 'builtin', name: 'exit', args: '' });
    expect(resolve('/clear')).toMatchObject({ kind: 'builtin', name: 'new', args: '' });
    expect(resolve('/tools')).toMatchObject({ kind: 'builtin', name: 'tools', args: '' });
    expect(resolve('/tool')).toMatchObject({ kind: 'builtin', name: 'tools', args: '' });
    expect(resolve('/eyes')).toMatchObject({ kind: 'builtin', name: 'eyes', args: '' });
    expect(resolve('/eye')).toMatchObject({ kind: 'builtin', name: 'eyes', args: '' });
    expect(resolve('/harness')).toMatchObject({ kind: 'builtin', name: 'harness', args: '' });
    expect(resolve('/premium')).toMatchObject({ kind: 'builtin', name: 'premium', args: '' });
    expect(resolve('/pq')).toMatchObject({ kind: 'builtin', name: 'premium', args: '' });
    expect(resolve('/premium on')).toMatchObject({ kind: 'builtin', name: 'premium', args: 'on' });
    expect(resolve('/persona list')).toMatchObject({
      kind: 'builtin',
      name: 'persona',
      args: 'list',
    });
    expect(resolve('/character tone friendly')).toMatchObject({
      kind: 'builtin',
      name: 'persona',
      args: 'tone friendly',
    });
    expect(resolve('/feed')).toMatchObject({ kind: 'builtin', name: 'feed', args: '' });
    expect(resolve('/food')).toMatchObject({ kind: 'builtin', name: 'feed', args: '' });
    expect(resolve('/context status')).toMatchObject({
      kind: 'builtin',
      name: 'context',
      args: 'status',
    });
    expect(resolve('/working-set deep')).toMatchObject({
      kind: 'builtin',
      name: 'context',
      args: 'deep',
    });
    expect(resolve('/workingset economy')).toMatchObject({
      kind: 'builtin',
      name: 'context',
      args: 'economy',
    });
    expect(resolve('/fork')).toMatchObject({ kind: 'builtin', name: 'fork', args: '' });
    expect(resolve('/title New title')).toMatchObject({
      kind: 'builtin',
      name: 'title',
      args: 'New title',
    });
    expect(resolve('/add-dir list')).toMatchObject({
      kind: 'builtin',
      name: 'add-dir',
      args: 'list',
    });
    expect(resolve('/init')).toMatchObject({ kind: 'builtin', name: 'init', args: '' });
    expect(resolve('/btw')).toMatchObject({
      kind: 'builtin',
      name: 'btw',
      args: '',
    });
    expect(resolve('/btw what are you doing?')).toMatchObject({
      kind: 'builtin',
      name: 'btw',
      args: 'what are you doing?',
    });
    expect(resolve('/preflight')).toMatchObject({
      kind: 'builtin',
      name: 'preflight',
      args: '',
    });
    expect(resolve('/pf .super-kimi/evidence/bench')).toMatchObject({
      kind: 'builtin',
      name: 'preflight',
      args: '.super-kimi/evidence/bench',
    });
    expect(resolve('/experiments')).toMatchObject({
      kind: 'builtin',
      name: 'experiments',
      args: '',
    });
    expect(resolve('/ultrawork Ship feature X')).toMatchObject({
      kind: 'builtin',
      name: 'ultrawork',
      args: 'Ship feature X',
    });
    expect(resolve('/ultraplan Ship feature X')).toMatchObject({
      kind: 'builtin',
      name: 'ultraplan',
      args: 'Ship feature X',
    });
    expect(resolve('/up Ship feature X')).toMatchObject({
      kind: 'builtin',
      name: 'ultraplan',
      args: 'Ship feature X',
    });
    expect(resolve('/ultragoal replace Ship feature X')).toMatchObject({
      kind: 'builtin',
      name: 'ultragoal',
      args: 'replace Ship feature X',
    });
    expect(resolve('/uw Ship feature X')).toMatchObject({
      kind: 'builtin',
      name: 'ultrawork',
      args: 'Ship feature X',
    });
    expect(resolve('/ug Ship feature X')).toMatchObject({
      kind: 'builtin',
      name: 'ultragoal',
      args: 'Ship feature X',
    });
    expect(resolve('/ultraswarm Ship feature X')).toMatchObject({
      kind: 'builtin',
      name: 'ultraswarm',
      args: 'Ship feature X',
    });
    expect(resolve('/us Ship feature X')).toMatchObject({
      kind: 'builtin',
      name: 'ultraswarm',
      args: 'Ship feature X',
    });
  });

  it('blocks idle-only built-ins while streaming', () => {
    expect(resolve('/new', { isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'new',
      reason: 'streaming',
    });
    expect(resolve('/init', { isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'init',
      reason: 'streaming',
    });
    expect(resolve('/sessions', { isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'sessions',
      reason: 'streaming',
    });
    expect(resolve('/resume', { isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'resume',
      reason: 'streaming',
    });
    expect(resolve('/undo', { isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'undo',
      reason: 'streaming',
    });
    expect(resolve('/reload', { isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'reload',
      reason: 'streaming',
    });
    expect(resolve('/add-dir ../shared', { isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'add-dir',
      reason: 'streaming',
    });
    expect(resolve('/experiments', { isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'experiments',
      reason: 'streaming',
    });
    expect(resolve('/swarm on', { isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'swarm',
      reason: 'streaming',
    });
    expect(resolve('/swarm off', { isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'swarm',
      reason: 'streaming',
    });
    expect(resolve('/ultrawork Ship feature X', { isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'ultrawork',
      reason: 'streaming',
    });
    expect(resolve('/ultraplan Ship feature X', { isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'ultraplan',
      reason: 'streaming',
    });
    expect(resolve('/ultragoal Ship feature X', { isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'ultragoal',
      reason: 'streaming',
    });
    expect(resolve('/ultraswarm Ship feature X', { isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'ultraswarm',
      reason: 'streaming',
    });
  });

  it('blocks model and session pickers while compacting', () => {
    expect(resolve('/sessions', { isCompacting: true })).toEqual({
      kind: 'blocked',
      commandName: 'sessions',
      reason: 'compacting',
    });
    expect(resolve('/resume', { isCompacting: true })).toEqual({
      kind: 'blocked',
      commandName: 'resume',
      reason: 'compacting',
    });
    expect(resolve('/reload', { isCompacting: true })).toEqual({
      kind: 'blocked',
      commandName: 'reload',
      reason: 'compacting',
    });
    expect(resolve('/add-dir ../shared', { isCompacting: true })).toEqual({
      kind: 'blocked',
      commandName: 'add-dir',
      reason: 'compacting',
    });
    expect(resolve('/experiments', { isCompacting: true })).toEqual({
      kind: 'blocked',
      commandName: 'experiments',
      reason: 'compacting',
    });
    expect(resolve('/swarm on', { isCompacting: true })).toEqual({
      kind: 'blocked',
      commandName: 'swarm',
      reason: 'compacting',
    });
    expect(resolve('/swarm off', { isCompacting: true })).toEqual({
      kind: 'blocked',
      commandName: 'swarm',
      reason: 'compacting',
    });
    expect(resolve('/ultrawork Ship feature X', { isCompacting: true })).toEqual({
      kind: 'blocked',
      commandName: 'ultrawork',
      reason: 'compacting',
    });
    expect(resolve('/up Ship feature X', { isCompacting: true })).toEqual({
      kind: 'blocked',
      commandName: 'up',
      reason: 'compacting',
    });
    expect(resolve('/ultragoal Ship feature X', { isCompacting: true })).toEqual({
      kind: 'blocked',
      commandName: 'ultragoal',
      reason: 'compacting',
    });
    expect(resolve('/us Ship feature X', { isCompacting: true })).toEqual({
      kind: 'blocked',
      commandName: 'us',
      reason: 'compacting',
    });
  });

  it('allows always-available built-ins while streaming', () => {
    expect(resolve('/plan on', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'plan',
      args: 'on',
    });
    expect(resolve('/mcp', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'mcp',
      args: '',
    });
    expect(resolve('/mcp', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'mcp',
      args: '',
    });
    expect(resolve('/tools', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'tools',
      args: '',
    });
    expect(resolve('/eyes', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'eyes',
      args: '',
    });
    expect(resolve('/eye', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'eyes',
      args: '',
    });
    expect(resolve('/harness', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'harness',
      args: '',
    });
    expect(resolve('/harness', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'harness',
      args: '',
    });
    expect(resolve('/premium', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'premium',
      args: '',
    });
    expect(resolve('/pq status', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'premium',
      args: 'status',
    });
    expect(resolve('/reload-tui', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'reload-tui',
      args: '',
    });
    expect(resolve('/reload-tui', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'reload-tui',
      args: '',
    });
    expect(resolve('/btw side question', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'btw',
      args: 'side question',
    });
    expect(resolve('/persona list', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'persona',
      args: 'list',
    });
    expect(resolve('/character help', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'persona',
      args: 'help',
    });
    expect(resolve('/feed', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'feed',
      args: '',
    });
    expect(resolve('/food', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'feed',
      args: '',
    });
    expect(resolve('/context balanced', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'context',
      args: 'balanced',
    });
    expect(resolve('/working-set full', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'context',
      args: 'full',
    });
    expect(resolve('/loop list', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'loop',
      args: 'list',
    });
    expect(resolve('/loop stop', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'loop',
      args: 'stop',
    });
    expect(resolve('/cron list', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'cron',
      args: 'list',
    });
    expect(resolve('/cron delete job-1', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'cron',
      args: 'delete job-1',
    });
    expect(resolve('/extensions mcp', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'extensions',
      args: 'mcp',
    });
    expect(resolve('/ext hooks', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'extensions',
      args: 'hooks',
    });
    expect(resolve('/import-claude', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'extensions',
      args: '',
    });
    expect(resolve('/extensions claude', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'extensions',
      args: 'claude',
    });
    expect(resolve('/yolo on', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'yolo',
      args: 'on',
    });
    expect(resolve('/yes off', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'yolo',
      args: 'off',
    });
    expect(resolve('/auto on', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'auto',
      args: 'on',
    });
    expect(resolve('/auto off', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'auto',
      args: 'off',
    });
    expect(resolve('/permission manual', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'permission',
      args: 'manual',
    });
    expect(resolve('/permission yolo', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'permission',
      args: 'yolo',
    });
    expect(resolve('/theme dark', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'theme',
      args: 'dark',
    });
    expect(resolve('/theme import ./x.json', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'theme',
      args: 'import ./x.json',
    });
    expect(resolve('/appearance profile subtle', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'appearance',
      args: 'profile subtle',
    });
    expect(resolve('/skin density compact', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'appearance',
      args: 'density compact',
    });
    expect(resolve('/preflight --query=harness readiness', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'preflight',
      args: '--query=harness readiness',
    });
    expect(resolve('/pf', { isCompacting: true })).toMatchObject({
      kind: 'builtin',
      name: 'preflight',
      args: '',
    });
  });

  it('blocks plan clear while compacting because it is idle-only', () => {
    expect(resolve('/plan clear', { isCompacting: true })).toEqual({
      kind: 'blocked',
      commandName: 'plan',
      reason: 'compacting',
    });
  });

  it('resolves skill commands and blocks them while busy', () => {
    const skillCommandMap = new Map([['skill:review', 'review']]);

    expect(resolve('/skill:review src/app.ts', { skillCommandMap })).toEqual({
      kind: 'skill',
      commandName: 'skill:review',
      skillName: 'review',
      args: 'src/app.ts',
    });
    expect(resolve('/skill:review src/app.ts', { skillCommandMap, isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'skill:review',
      reason: 'streaming',
    });
  });

  it('resolves unprefixed built-in skill commands and blocks them while busy', () => {
    const skillCommandMap = new Map([['mcp-config', 'mcp-config']]);

    expect(resolve('/mcp-config', { skillCommandMap })).toEqual({
      kind: 'skill',
      commandName: 'mcp-config',
      skillName: 'mcp-config',
      args: '',
    });
    expect(resolve('/mcp-config', { skillCommandMap, isCompacting: true })).toEqual({
      kind: 'blocked',
      commandName: 'mcp-config',
      reason: 'compacting',
    });
  });

  it('resolves unprefixed sub-skill commands with dotted names', () => {
    const skillCommandMap = new Map([['outer.inner', 'outer.inner']]);

    expect(resolve('/outer.inner src/app.ts', { skillCommandMap })).toEqual({
      kind: 'skill',
      commandName: 'outer.inner',
      skillName: 'outer.inner',
      args: 'src/app.ts',
    });
  });

  it('returns message for unknown slash input', () => {
    expect(resolve('/does-not-exist arg')).toEqual({
      kind: 'message',
      input: '/does-not-exist arg',
    });
  });

  it('resolves /web as the built-in URL content viewer, not the retired Web UI handoff', () => {
    expect(resolve('/web https://example.com')).toMatchObject({
      kind: 'builtin',
      name: 'web',
      args: 'https://example.com',
    });
  });

  it('resolves /swarm without an experimental flag', () => {
    expect(resolve('/swarm Ship feature X')).toMatchObject({
      kind: 'builtin',
      name: 'swarm',
      args: 'Ship feature X',
    });
  });

});

describe('goal command resolution', () => {
  afterEach(() => {
    setExperimentalFeatures([]);
  });

  it('resolves /goal to the builtin command without an experimental flag', () => {
    expect(resolve('/goal Ship feature X')).toMatchObject({
      kind: 'builtin',
      name: 'goal',
      args: 'Ship feature X',
    });
  });

  it('blocks goal creation while streaming', () => {
    expect(resolve('/goal Ship feature X', { isStreaming: true })).toEqual({
      kind: 'blocked',
      commandName: 'goal',
      reason: 'streaming',
    });
  });

  it('does not block status/pause/cancel/bare goal while streaming', () => {
    for (const sub of ['status', 'pause', 'cancel']) {
      expect(resolve(`/goal ${sub}`, { isStreaming: true })).toMatchObject({
        kind: 'builtin',
        name: 'goal',
      });
    }
    expect(resolve('/goal', { isStreaming: true })).toMatchObject({
      kind: 'builtin',
      name: 'goal',
    });
  });
});

describe('slash command busy helpers', () => {
  it('resolves skill command aliases with and without skill prefix', () => {
    const map = new Map([
      ['skill:review', 'review'],
      ['mcp-config', 'mcp-config'],
    ]);

    expect(resolveSkillCommand(map, 'skill:review')).toBe('review');
    expect(resolveSkillCommand(map, 'review')).toBe('review');
    expect(resolveSkillCommand(map, 'mcp-config')).toBe('mcp-config');
  });

  it('formats busy messages', () => {
    expect(slashCommandBusyReason({ isStreaming: true, isCompacting: false })).toBe('streaming');
    expect(slashCommandBusyReason({ isStreaming: false, isCompacting: true })).toBe('compacting');
    expect(slashBusyMessage('new', 'streaming')).toContain('Cannot /new while streaming');
    expect(slashBusyMessage('new', 'compacting')).toContain('Cannot /new while compacting');
  });
});
