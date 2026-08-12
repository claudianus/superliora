/**
 * Locks the public argv surface to the keep-list in apps/liora/AGENTS.md.
 * Ghosts (web/migrate/vis) and unregistered server lifecycle must stay out.
 */

import { describe, expect, it } from 'vitest';

import { createProgram } from '#/cli/commands';

type HiddenCommand = { _hidden?: boolean };

function commandNames(program: { commands: readonly { name(): string }[] }): string[] {
  return program.commands.map((c) => c.name()).toSorted();
}

function visibleCommandNames(
  program: { commands: readonly ({ name(): string } & HiddenCommand)[] },
): string[] {
  return program.commands
    .filter((c) => c._hidden !== true)
    .map((c) => c.name())
    .toSorted();
}

describe('createProgram public argv surface', () => {
  it('registers only the keep-list subcommands (plus hidden plugin runner)', () => {
    const program = createProgram(
      '0.0.0-test',
      () => {},
      () => {},
      () => {},
    );

    expect(visibleCommandNames(program)).toEqual([
      'acp',
      'browser-use',
      'computer-use',
      'doctor',
      'export',
      'login',
      'provider',
      'server',
      'update',
      'upgrade',
      'worktree',
    ]);

    expect(commandNames(program)).toEqual([
      '__plugin_run_node',
      'acp',
      'browser-use',
      'computer-use',
      'doctor',
      'export',
      'login',
      'provider',
      'server',
      'update',
      'upgrade',
      'worktree',
    ]);

    expect(commandNames(program)).not.toContain('vis');
    expect(commandNames(program)).not.toContain('web');
    expect(commandNames(program)).not.toContain('migrate');
  });

  it('keeps server OS lifecycle commands unregistered', () => {
    const program = createProgram(
      '0.0.0-test',
      () => {},
      () => {},
      () => {},
    );
    const server = program.commands.find((c) => c.name() === 'server');
    expect(server).toBeDefined();
    const subs = server!.commands.map((c) => c.name()).toSorted();
    expect(subs).toEqual(['kill', 'ps', 'rotate-token', 'run']);
    expect(subs).not.toContain('install');
    expect(subs).not.toContain('start');
    expect(subs).not.toContain('status');
  });
});
