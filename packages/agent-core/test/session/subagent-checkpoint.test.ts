import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildCheckpointRecoveryReminder,
  clearSubagentCheckpoint,
  readSubagentCheckpoint,
  subagentCheckpointPath,
  writeSubagentCheckpoint,
} from '../../src/session/subagent/subagent-checkpoint';

describe('subagent checkpoint store', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'subagent-checkpoint-'));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('round-trips a checkpoint with envelope fields filled in', () => {
    writeSubagentCheckpoint(
      'agent-0',
      {
        toolCount: 12,
        lastTool: 'Bash',
        lastTarget: 'pnpm test',
        tokens: 5_000,
        elapsedMs: 900_000,
        todos: [{ title: 'fix bug', status: 'done' }],
        dirtyFiles: ['src/a.ts'],
      },
      home,
    );
    const read = readSubagentCheckpoint('agent-0', home);
    expect(read).toMatchObject({
      version: 1,
      subagentId: 'agent-0',
      toolCount: 12,
      lastTool: 'Bash',
      lastTarget: 'pnpm test',
      tokens: 5_000,
      elapsedMs: 900_000,
      dirtyFiles: ['src/a.ts'],
    });
    expect(typeof read?.savedAt).toBe('string');
  });

  it('returns undefined for missing, corrupt, or foreign checkpoints', async () => {
    expect(readSubagentCheckpoint('missing', home)).toBeUndefined();

    writeSubagentCheckpoint('corrupt', { toolCount: 1, tokens: 1, elapsedMs: 1 }, home);
    await writeFile(subagentCheckpointPath('corrupt', home), '{not json');
    expect(readSubagentCheckpoint('corrupt', home)).toBeUndefined();

    const foreignPath = subagentCheckpointPath('foreign', home);
    await mkdir(join(foreignPath, '..'), { recursive: true });
    await writeFile(
      foreignPath,
      JSON.stringify({ version: 1, subagentId: 'someone-else', toolCount: 1 }),
    );
    expect(readSubagentCheckpoint('foreign', home)).toBeUndefined();
  });

  it('clears checkpoints and sanitizes unsafe ids', () => {
    writeSubagentCheckpoint('../escape', { toolCount: 1, tokens: 1, elapsedMs: 1 }, home);
    const path = subagentCheckpointPath('../escape', home);
    expect(path).not.toContain('..');
    expect(path.startsWith(join(home, 'subagent-checkpoints'))).toBe(true);
    expect(readSubagentCheckpoint('../escape', home)).toBeDefined();
    clearSubagentCheckpoint('../escape', home);
    expect(readSubagentCheckpoint('../escape', home)).toBeUndefined();
    // Clearing a missing checkpoint must not throw.
    expect(() => clearSubagentCheckpoint('never-written', home)).not.toThrow();
  });

  it('renders a recovery reminder with progress, todos, and dirty files', () => {
    const reminder = buildCheckpointRecoveryReminder({
      version: 1,
      subagentId: 'agent-0',
      toolCount: 12,
      lastTool: 'Edit',
      lastTarget: 'src/session/subagent/subagent-host.ts',
      tokens: 5_000,
      elapsedMs: 900_000,
      todos: [
        { title: 'fix bug', status: 'done' },
        { title: 'add test', status: 'pending' },
      ],
      dirtyFiles: ['src/a.ts', 'test/a.test.ts'],
      savedAt: '2026-07-27T00:00:00.000Z',
    });
    expect(reminder).toContain('tool calls completed: 12');
    expect(reminder).toContain('last tool: Edit (src/session/subagent/subagent-host.ts)');
    expect(reminder).toContain('[done] fix bug');
    expect(reminder).toContain('[pending] add test');
    expect(reminder).toContain('src/a.ts, test/a.test.ts');
    expect(reminder).toContain('Do not repeat completed work');
  });
});
