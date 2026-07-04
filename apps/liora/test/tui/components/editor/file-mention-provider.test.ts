import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileMentionProvider } from '#/tui/components/editor/file-mention-provider';
import { findBuiltInSlashCommand } from '#/tui/commands/index';

function ctrl(): AbortSignal {
  return new AbortController().signal;
}

const NO_FD = null;
const GOAL_COMMAND = {
  name: 'goal',
  description: 'Start or manage a goal',
  getArgumentCompletions: (prefix: string) =>
    prefix.length === 0
      ? [
          {
            value: 'status',
            label: 'status',
          },
        ]
      : null,
};

const NEW_COMMAND = {
  name: 'new',
  aliases: ['clear'],
  description: 'Start a fresh session in the current workspace',
};

const LARK_CALENDAR_COMMAND = {
  name: 'skill:lark-calendar',
  aliases: [],
  description: 'Manage Lark calendars',
};

const HELP_COMMAND = {
  name: 'help',
  aliases: ['h'],
  description: 'Show help',
};

const HELP_FULL_COMMAND = {
  name: 'help',
  aliases: ['h', '?'],
  description: 'Show help',
};

const ULTRAWORK_COMMAND = {
  name: 'ultrawork',
  aliases: ['uw'],
  description: 'Start a guided autonomous coding workflow',
  visibility: 'advanced' as const,
  getArgumentCompletions: (prefix: string) =>
    prefix.length === 0
      ? [
          {
            value: 'replace',
            label: 'replace',
          },
        ]
      : null,
};

const ADD_DIR_COMMAND = {
  name: 'add-dir',
  description: 'Add or list an additional workspace directory',
  getArgumentCompletions: (prefix: string) =>
    prefix === '/'
      ? [
          {
            value: '/tmp/shared/',
            label: 'shared/',
            description: '/tmp/shared',
          },
        ]
      : null,
};

describe('FileMentionProvider', () => {
  let workDir: string;
  let extraDirs: string[];

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'kimi-file-mention-'));
    extraDirs = [];
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    for (const extraDir of extraDirs) {
      rmSync(extraDir, { recursive: true, force: true });
    }
  });

  function createExtraDir(): string {
    const extraDir = mkdtempSync(join(tmpdir(), 'kimi-file-mention-extra-'));
    extraDirs.push(extraDir);
    return extraDir;
  }

  it('returns null when there is no completable prefix', async () => {
    const provider = new FileMentionProvider([], workDir, NO_FD);
    const result = await provider.getSuggestions(['hello world'], 0, 11, { signal: ctrl() });
    expect(result).toBeNull();
  });

  it('does not complete slash arguments before existing free text', async () => {
    const provider = new FileMentionProvider([GOAL_COMMAND], workDir, NO_FD);
    const line = '/goal Fix the checkout docs';
    const result = await provider.getSuggestions([line], 0, '/goal '.length, { signal: ctrl() });
    expect(result).toBeNull();
  });

  it('opens @ file mentions inside slash command arguments', async () => {
    writeFileSync(join(workDir, 'README.md'), 'readme');
    const provider = new FileMentionProvider([GOAL_COMMAND], workDir, NO_FD);
    const line = '/goal Fix the @checkout docs';
    const result = await provider.getSuggestions([line], 0, '/goal Fix the @'.length, {
      signal: ctrl(),
    });

    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('@');
    expect(result!.items.map((item) => item.value)).toContain('@README.md');
  });

  it('still completes slash arguments at the end of an empty argument', async () => {
    const provider = new FileMentionProvider([GOAL_COMMAND], workDir, NO_FD);
    const line = '/goal ';
    const result = await provider.getSuggestions([line], 0, line.length, { signal: ctrl() });
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('');
    expect(result!.items.map((item) => item.value)).toEqual(['status']);
  });

  it('opens add-dir directory completions after slash command completion and entering slash', async () => {
    const provider = new FileMentionProvider([ADD_DIR_COMMAND], workDir, NO_FD);
    const command = ADD_DIR_COMMAND;
    const completed = provider.applyCompletion(['/add'], 0, 4, { value: command.name, label: command.name }, '/add');
    const completedLine = completed.lines[0]!;
    const line = `${completedLine}/`;
    const result = await provider.getSuggestions([line], 0, line.length, { signal: ctrl() });

    expect(completedLine).toBe('/add-dir ');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('/');
    expect(result!.items.map((item) => item.value)).toEqual(['/tmp/shared/']);
  });

  it('searches slash command aliases and displays aliases in the command label', async () => {
    const provider = new FileMentionProvider([NEW_COMMAND], workDir, NO_FD);
    const line = '/clear';

    const result = await provider.getSuggestions([line], 0, line.length, { signal: ctrl() });

    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('/clear');
    expect(result!.items[0]).toMatchObject({
      value: 'new',
      label: 'new (clear)',
    });
  });

  it('prefers exact alias matches over fuzzy skill matches', async () => {
    const provider = new FileMentionProvider(
      [NEW_COMMAND, LARK_CALENDAR_COMMAND],
      workDir,
      NO_FD,
    );
    const line = '/clear';

    const result = await provider.getSuggestions([line], 0, line.length, { signal: ctrl() });

    expect(result).not.toBeNull();
    expect(result!.items[0]).toMatchObject({
      value: 'new',
      label: 'new (clear)',
    });
    expect(result!.items[0]?.value).not.toBe('skill:lark-calendar');
  });

  it('fetches skill-prefixed slash completions from the dynamic provider', async () => {
    const calls: string[] = [];
    const provider = new FileMentionProvider(
      [HELP_COMMAND],
      workDir,
      NO_FD,
      [],
      async (query) => {
        calls.push(query);
        return [LARK_CALENDAR_COMMAND];
      },
    );
    const line = '/skill:lark';

    const result = await provider.getSuggestions([line], 0, line.length, { signal: ctrl() });

    expect(calls).toEqual(['skill:lark']);
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('/skill:lark');
    expect(result!.items[0]).toMatchObject({
      value: 'skill:lark-calendar',
      label: 'skill:lark-calendar',
    });
  });

  it('does not call the dynamic slash provider for normal built-in prefixes', async () => {
    let calls = 0;
    const provider = new FileMentionProvider([HELP_COMMAND], workDir, NO_FD, [], async () => {
      calls += 1;
      return [LARK_CALENDAR_COMMAND];
    });

    const result = await provider.getSuggestions(['/h'], 0, 2, { signal: ctrl() });

    expect(calls).toBe(0);
    expect(result).not.toBeNull();
    expect(result!.items[0]?.value).toBe('help');
  });

  it('does not show aliases when the primary name already matches', async () => {
    const provider = new FileMentionProvider([HELP_COMMAND], workDir, NO_FD);
    const line = '/h';

    const result = await provider.getSuggestions([line], 0, line.length, { signal: ctrl() });

    expect(result).not.toBeNull();
    expect(result!.items[0]).toMatchObject({
      value: 'help',
      label: 'help',
    });
  });

  it('does not show aliases in labels when query is empty', async () => {
    const provider = new FileMentionProvider([NEW_COMMAND], workDir, NO_FD);
    const line = '/';

    const result = await provider.getSuggestions([line], 0, line.length, { signal: ctrl() });

    expect(result).not.toBeNull();
    expect(result!.items[0]).toMatchObject({
      value: 'new',
      label: 'new',
    });
  });

  it('keeps advanced commands out of slash name suggestions but supports exact command arguments', async () => {
    const provider = new FileMentionProvider([HELP_COMMAND, ULTRAWORK_COMMAND], workDir, NO_FD);

    const bare = await provider.getSuggestions(['/'], 0, 1, { signal: ctrl() });
    const prefixed = await provider.getSuggestions(['/ul'], 0, 3, { signal: ctrl() });
    const exactArgs = await provider.getSuggestions(['/ultrawork '], 0, '/ultrawork '.length, { signal: ctrl() });

    expect(bare).not.toBeNull();
    expect(bare!.items.map((item) => item.value)).not.toContain('ultrawork');
    expect(prefixed).toBeNull();
    expect(exactArgs).not.toBeNull();
    expect(exactArgs!.items.map((item) => item.value)).toEqual(['replace']);
  });

  it('includes the argument hint in the description like the inner provider does', async () => {
    const provider = new FileMentionProvider(
      [{ name: 'goal', description: 'Start or manage a goal', argumentHint: '<objective>' }],
      workDir,
      NO_FD,
    );

    const result = await provider.getSuggestions(['/go'], 0, 3, { signal: ctrl() });

    expect(result).not.toBeNull();
    expect(result!.items[0]).toMatchObject({
      value: 'goal',
      description: '<objective> — Start or manage a goal',
    });
  });

  it('does not tag the primary help suggestion as advanced', async () => {
    const help = findBuiltInSlashCommand('help');
    expect(help).toBeDefined();
    if (help === undefined) throw new Error('expected built-in help command');
    const provider = new FileMentionProvider([help], workDir, NO_FD);

    const result = await provider.getSuggestions(['/h'], 0, 2, { signal: ctrl() });

    expect(result).not.toBeNull();
    expect(result!.items[0]).toMatchObject({
      value: 'help',
      description: 'Show available commands and shortcuts',
    });
    expect(result!.items[0]?.description).not.toContain('[advanced]');
  });

  it('joins multiple aliases with an ASCII comma in the label', async () => {
    const provider = new FileMentionProvider([HELP_FULL_COMMAND], workDir, NO_FD);
    // '?' only matches the alias, not the primary name, so the label must
    // list the aliases.
    const result = await provider.getSuggestions(['/?'], 0, 2, { signal: ctrl() });

    expect(result).not.toBeNull();
    expect(result!.items[0]).toMatchObject({
      value: 'help',
      label: 'help (h, ?)',
    });
  });

  it('returns null for a bare slash when no commands are registered', async () => {
    const provider = new FileMentionProvider([], workDir, NO_FD);

    const result = await provider.getSuggestions(['/'], 0, 1, { signal: ctrl() });

    expect(result).toBeNull();
  });

  it('ranks primary-name matches above alias matches with equal scores', async () => {
    const provider = new FileMentionProvider(
      [
        { name: 'bar', aliases: ['foo'], description: 'Bar command' },
        { name: 'foo', aliases: [], description: 'Foo command' },
      ],
      workDir,
      NO_FD,
    );

    const result = await provider.getSuggestions(['/foo'], 0, 4, { signal: ctrl() });

    expect(result).not.toBeNull();
    expect(result!.items[0]?.value).toBe('foo');
    expect(result!.items[1]).toMatchObject({
      value: 'bar',
      label: 'bar (foo)',
    });
  });

  it('does not turn leading-whitespace slash into root path completion', async () => {
    const provider = new FileMentionProvider([], workDir, NO_FD);
    const result = await provider.getSuggestions([' /'], 0, 2, { signal: ctrl() });
    expect(result).toBeNull();
  });

  it('still allows forced root path completion after leading whitespace', async () => {
    const provider = new FileMentionProvider([], workDir, NO_FD);
    const result = await provider.getSuggestions([' /'], 0, 2, { signal: ctrl(), force: true });
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('/');
  });

  it('does not trigger the @ branch when @ is preceded by a non-delimiter', async () => {
    const provider = new FileMentionProvider([], workDir, NO_FD);
    const result = await provider.getSuggestions(['email@example'], 0, 13, { signal: ctrl() });
    expect(result).toBeNull();
  });

  it('uses a filesystem fallback for @ mentions when fd is not available', async () => {
    mkdirSync(join(workDir, 'src', 'components'), { recursive: true });
    writeFileSync(join(workDir, 'src', 'components', 'Button.tsx'), 'export {};');
    writeFileSync(join(workDir, 'README.md'), 'readme');
    const provider = new FileMentionProvider([], workDir, NO_FD);

    const result = await provider.getSuggestions(['@but'], 0, 4, { signal: ctrl() });

    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('@but');
    expect(result!.items.map((item) => item.value)).toContain('@src/components/Button.tsx');
  });

  it('uses the filesystem fallback for additionalDirs when fd is unavailable', async () => {
    const extraDir = createExtraDir();
    mkdirSync(join(extraDir, 'src'), { recursive: true });
    writeFileSync(join(extraDir, 'src', 'Additional.ts'), 'export {};');
    const provider = new FileMentionProvider([], workDir, join(workDir, 'missing-fd'), [extraDir]);

    const result = await provider.getSuggestions(['@add'], 0, 4, { signal: ctrl() });

    expect(result).not.toBeNull();
    expect(result!.items.map((item) => item.value)).toContain(
      `@${join(extraDir, 'src', 'Additional.ts').replaceAll('\\', '/')}`,
    );
  });

  it('keeps cwd @ mention values relative and additionalDir values absolute', async () => {
    mkdirSync(join(workDir, 'src'), { recursive: true });
    writeFileSync(join(workDir, 'src', 'Cwd.ts'), 'export {};');
    const extraDir = createExtraDir();
    mkdirSync(join(extraDir, 'src'), { recursive: true });
    writeFileSync(join(extraDir, 'src', 'Additional.ts'), 'export {};');
    const provider = new FileMentionProvider([], workDir, NO_FD, [extraDir]);

    const cwdResult = await provider.getSuggestions(['@cwd'], 0, 4, { signal: ctrl() });
    expect(cwdResult).not.toBeNull();
    expect(cwdResult!.items.map((item) => item.value)).toContain('@src/Cwd.ts');

    const additionalResult = await provider.getSuggestions(['@add'], 0, 4, { signal: ctrl() });
    expect(additionalResult).not.toBeNull();
    expect(additionalResult!.items.map((item) => item.value)).toContain(
      `@${join(extraDir, 'src', 'Additional.ts').replaceAll('\\', '/')}`,
    );
  });

  it('deduplicates cwd and additionalDir candidates by absolute path', async () => {
    const extraDir = join(workDir, 'extra');
    mkdirSync(join(extraDir, 'src'), { recursive: true });
    writeFileSync(join(extraDir, 'src', 'Overlap.ts'), 'export {};');
    const provider = new FileMentionProvider([], workDir, NO_FD, [extraDir]);

    const result = await provider.getSuggestions(['@overlap'], 0, 8, { signal: ctrl() });

    expect(result).not.toBeNull();
    const overlapItems = result!.items.filter(
      (item) => item.description === join(extraDir, 'src', 'Overlap.ts').replaceAll('\\', '/'),
    );
    expect(overlapItems).toHaveLength(1);
  });

  it('does not bypass fd filtering with filesystem suggestions when fd returns no matches', async () => {
    writeFileSync(join(workDir, 'README.md'), 'readme');
    const provider = new FileMentionProvider([], workDir, join(workDir, 'missing-fd'));

    const result = await provider.getSuggestions(['@read'], 0, 5, { signal: ctrl() });

    expect(result).toBeNull();
  });

  it('filesystem fallback returns folders and excludes .git', async () => {
    mkdirSync(join(workDir, 'src'));
    mkdirSync(join(workDir, '.git'));
    writeFileSync(join(workDir, '.git', 'config'), 'secret');
    const provider = new FileMentionProvider([], workDir, NO_FD);

    const result = await provider.getSuggestions(['@'], 0, 1, { signal: ctrl() });

    expect(result).not.toBeNull();
    const values = result!.items.map((item) => item.value);
    expect(values).toContain('@src/');
    expect(values.some((value) => value.startsWith('@.git'))).toBe(false);
  });

  it('filesystem fallback quotes paths with spaces', async () => {
    mkdirSync(join(workDir, 'my folder'));
    const provider = new FileMentionProvider([], workDir, NO_FD);

    const result = await provider.getSuggestions(['@my'], 0, 3, { signal: ctrl() });

    expect(result).not.toBeNull();
    expect(result!.items.map((item) => item.value)).toContain('@"my folder/"');
  });

  it('filesystem fallback does not recurse into symlinked directories', async () => {
    writeFileSync(join(workDir, 'target.txt'), 'target');
    symlinkSync('.', join(workDir, 'current'), 'dir');
    const provider = new FileMentionProvider([], workDir, NO_FD);

    const result = await provider.getSuggestions(['@target'], 0, 7, { signal: ctrl() });

    expect(result).not.toBeNull();
    const values = result!.items.map((item) => item.value);
    expect(values).toContain('@target.txt');
    expect(values.some((value) => value.startsWith('@current/'))).toBe(false);
  });

  it('delegates path suggestions to the renderer provider for regular path completion', async () => {
    mkdirSync(join(workDir, 'src'));
    writeFileSync(join(workDir, 'README.md'), 'readme');
    const provider = new FileMentionProvider([], workDir, NO_FD);

    const result = await provider.getSuggestions([''], 0, 0, { signal: ctrl(), force: true });

    expect(result).not.toBeNull();
    expect(result!.items.map((item) => item.value)).toEqual(['src/', 'README.md']);
  });

  it('applyCompletion delegates file and directory insertion to the renderer provider', () => {
    const provider = new FileMentionProvider([], workDir, NO_FD);

    const file = provider.applyCompletion(
      ['hey @read'],
      0,
      9,
      { value: '@README.md', label: 'README.md' },
      '@read',
    );
    expect(file.lines[0]).toBe('hey @README.md ');

    const dir = provider.applyCompletion(
      ['hey @sr'],
      0,
      7,
      { value: '@src/', label: 'src/' },
      '@sr',
    );
    expect(dir.lines[0]).toBe('hey @src/');
  });

  describe('bash-mode path completion', () => {
    it('hides dot-prefixed path entries in bash mode', async () => {
      mkdirSync(join(workDir, '.hidden'));
      mkdirSync(join(workDir, 'visible'));
      writeFileSync(join(workDir, '.dotfile'), '');
      writeFileSync(join(workDir, 'normal.txt'), '');

      const provider = new FileMentionProvider([], workDir, NO_FD, [], undefined, () => 'bash');
      const text = `cd ${workDir}/`;
      const result = await provider.getSuggestions([text], 0, text.length, {
        signal: ctrl(),
        force: true,
      });

      expect(result).not.toBeNull();
      const labels = result!.items.map((item) => item.label);
      expect(labels).toContain('visible/');
      expect(labels).toContain('normal.txt');
      expect(labels).not.toContain('.hidden/');
      expect(labels).not.toContain('.dotfile');
    });

    it('keeps dot-prefixed path entries in prompt mode', async () => {
      mkdirSync(join(workDir, '.hidden'));
      writeFileSync(join(workDir, '.dotfile'), '');

      const provider = new FileMentionProvider([], workDir, NO_FD);
      const text = `cd ${workDir}/`;
      const result = await provider.getSuggestions([text], 0, text.length, {
        signal: ctrl(),
        force: true,
      });

      expect(result).not.toBeNull();
      const labels = result!.items.map((item) => item.label);
      expect(labels).toContain('.hidden/');
      expect(labels).toContain('.dotfile');
    });

    it('does not double a leading slash when applying a bash path completion', () => {
      const provider = new FileMentionProvider([], workDir, NO_FD, [], undefined, () => 'bash');
      const result = provider.applyCompletion(
        ['/'],
        0,
        1,
        { value: '/Applications/', label: 'Applications/' },
        '/',
      );

      expect(result.lines[0]).toBe('/Applications/');
      expect(result.cursorCol).toBe('/Applications/'.length);
    });

    it('replaces a bash path prefix without adding a trailing space', () => {
      const provider = new FileMentionProvider([], workDir, NO_FD, [], undefined, () => 'bash');
      const result = provider.applyCompletion(
        ['cd /App'],
        0,
        7,
        { value: '/Applications/', label: 'Applications/' },
        '/App',
      );

      expect(result.lines[0]).toBe('cd /Applications/');
      expect(result.cursorCol).toBe('cd /Applications/'.length);
    });

    it('suppresses slash argument completions for bash absolute paths', async () => {
      const getArgumentCompletions = vi.fn(() => [{ value: 'list', label: 'list' }]);
      const provider = new FileMentionProvider(
        [{ name: 'add-dir', description: 'Add directory', getArgumentCompletions }],
        workDir,
        NO_FD,
        [],
        undefined,
        () => 'bash',
      );

      const result = await provider.getSuggestions(['/add-dir '], 0, '/add-dir '.length, {
        signal: ctrl(),
        force: true,
      });

      expect(getArgumentCompletions).not.toHaveBeenCalled();
      expect(result?.items.map((item) => item.label) ?? []).not.toContain('list');
    });

    it('keeps slash argument completions in prompt mode', async () => {
      const getArgumentCompletions = vi.fn(() => [{ value: '/shared/', label: 'shared/' }]);
      const provider = new FileMentionProvider(
        [{ name: 'add-dir', description: 'Add directory', getArgumentCompletions }],
        workDir,
        NO_FD,
      );

      const result = await provider.getSuggestions(['/add-dir /'], 0, '/add-dir /'.length, {
        signal: ctrl(),
        force: false,
      });

      expect(getArgumentCompletions).toHaveBeenCalled();
      expect(result?.items.map((item) => item.label)).toContain('shared/');
    });
  });
});
