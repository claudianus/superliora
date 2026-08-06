import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  pruneTuiSessionToolOutputViewports,
  readTuiSessionState,
  restoreTuiSessionState,
  type TuiSessionStateHost,
  writeTuiSessionState,
} from '#/tui/utils/tui-session-state';
import { createToolOutputViewportState } from '#/tui/utils/tool/tool-output-viewport';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeHost(sessionDir: string, overrides: Record<string, unknown> = {}) {
  const state = {
    transcriptDetail: 'standard' as const,
    userStageSize: undefined as { width: number; height: number } | undefined,
    toolOutputViewports: new Map<string, ReturnType<typeof createToolOutputViewportState>>(),
    sessionsScope: 'cwd' as const,
    terminal: { columns: 80, rows: 24 },
    transcriptEntries: [] as Array<{ toolCallData?: { id: string } }>,
    ...overrides,
  };
  return {
    session: { summary: { sessionDir } },
    state,
    setTranscriptDetail: (level: typeof state.transcriptDetail) => {
      state.transcriptDetail = level;
    },
  } as unknown as TuiSessionStateHost;
}

describe('tui session state', () => {
  it('restores whitelisted UI state and clamps geometry to the current terminal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'liora-tui-session-'));
    tempDirs.push(dir);
    const source = makeHost(dir, {
      transcriptDetail: 'full',
      userStageSize: { width: 200, height: 100 },
      sessionsScope: 'all',
      transcriptEntries: [{ toolCallData: { id: 'tool-1' } }],
    });
    source.state.toolOutputViewports.set(
      'tool-1',
      createToolOutputViewportState({ height: 10, contentRows: 40 }),
    );

    await writeTuiSessionState(source);

    const restored = makeHost(dir);
    await restoreTuiSessionState(restored);

    expect(restored.state.transcriptDetail).toBe('full');
    expect(restored.state.userStageSize).toEqual({ width: 80, height: 24 });
    expect(restored.state.sessionsScope).toBe('all');
    expect(restored.state.toolOutputViewports.get('tool-1')?.height).toBe(10);
  });

  it('drops viewport entries that are absent from replayed history', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'liora-tui-session-'));
    tempDirs.push(dir);
    const source = makeHost(dir);
    source.state.toolOutputViewports.set(
      'stale-tool',
      createToolOutputViewportState({ height: 12 }),
    );
    await writeTuiSessionState(source);

    const restored = makeHost(dir, {
      transcriptEntries: [{ toolCallData: { id: 'current-tool' } }],
    });
    await restoreTuiSessionState(restored);
    pruneTuiSessionToolOutputViewports(restored);
    await writeTuiSessionState(restored);

    const snapshot = await readTuiSessionState(restored.session!);
    expect(snapshot.toolOutputViewports).toBeUndefined();
  });
});
