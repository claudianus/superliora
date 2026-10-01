/**
 * The completion scripts are generated from the Commander program, so the test
 * pins both halves: the emitted scripts mention what the program actually
 * declares (names, flags, enum choices), and `completions <shell>` writes the
 * script for each supported shell.
 */
import { Command, Option } from 'commander';
import { describe, expect, it, vi } from 'vitest';

import {
  describeProgram,
  registerCompletionsCommand,
  renderBashCompletions,
  renderFishCompletions,
  renderZshCompletions,
} from '#/cli/sub/completions';

/** A program with the shapes the generators care about. */
function sampleProgram(): Command {
  const program = new Command('liora');
  program.addOption(new Option('-y, --yolo', 'Skip confirmation prompts'));
  program.addOption(
    new Option('--output-format <format>', 'Output format').choices(['text', 'stream-json']),
  );
  program
    .command('gc')
    .description('Reclaim idle cache')
    .option('--dry-run', 'Report candidates only', false)
    .option('--idle-days <n>', 'Idle window in days', '7');
  program.command('doctor').description('Print diagnostics');
  return program;
}

describe('shell completions', () => {
  it('describes the program tree the way the generators need it', () => {
    const described = describeProgram(sampleProgram());

    expect(described.map((command) => command.name)).toEqual(['doctor', 'gc']);
    const gc = described.find((command) => command.name === 'gc')!;
    expect(gc.options.map((option) => option.flags)).toEqual([['--dry-run'], ['--idle-days']]);
    expect(gc.options[1]!.takesValue).toBe(true);
  });

  it('emits bash names, flags, and enum choices from the live tree', () => {
    const script = renderBashCompletions('liora', sampleProgram());

    expect(script).toContain('complete -F _liora_completions liora');
    expect(script).toContain('doctor gc');
    expect(script).toContain('gc) opts="$opts --dry-run --idle-days"');
    // Enum values complete after the option that declares them.
    expect(script).toContain(
      '--output-format) COMPREPLY=( $(compgen -W "text stream-json" -- "$cur") ); return ;;',
    );
    expect(script).toContain('--yolo');
  });

  it('emits fish completions for subcommands, flags, and choices', () => {
    const script = renderFishCompletions('liora', sampleProgram());

    expect(script).toContain(
      "complete -c liora -n '__fish_use_subcommand' -a 'gc' -d 'Reclaim idle cache'",
    );
    expect(script).toContain("complete -c liora -n '__fish_seen_subcommand_from gc' -l dry-run");
    expect(script).toContain("-a 'text stream-json'");
    expect(script).toContain('-l output-format');
  });

  it('emits a zsh script that completes through bashcompinit', () => {
    const script = renderZshCompletions('liora', sampleProgram());

    expect(script.startsWith('#compdef liora')).toBe(true);
    expect(script).toContain('autoload -Uz bashcompinit && bashcompinit');
    expect(script).toContain('complete -F _liora_completions liora');
  });

  it('writes the script for a supported shell and rejects an unknown one', () => {
    const program = new Command('liora');
    const write = vi.fn();
    registerCompletionsCommand(program, { stdout: write });

    program.parse(['completions', 'fish'], { from: 'user' });
    expect(write.mock.calls[0]?.[0]).toContain('complete -c liora');

    write.mockClear();
    program.parse(['completions', 'tcsh'], { from: 'user' });
    expect(write.mock.calls[0]?.[0]).toContain('Unknown shell "tcsh"');
  });
});