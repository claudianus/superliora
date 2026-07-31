import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { showStorageSettings } from '#/tui/commands/config/storage-settings';
import { resolveStoragePaths } from '#/tui/utils/storage/storage-glance';

describe('storage settings', () => {
  it('resolveStoragePaths uses live session dir for journal + tool-results', () => {
    const home = '/tmp/superliora-home';
    const sessionDir = join(home, 'sessions', 'abc123', 'ses_live');
    const paths = resolveStoragePaths({
      homeDir: home,
      configPath: join(home, 'config.toml'),
      sessionDir,
    });
    expect(paths.sessionsDir).toBe(join(home, 'sessions'));
    expect(paths.journalPath).toBe(join(sessionDir, 'agents/main/wire.jsonl'));
    expect(paths.toolResultsDir).toBe(join(sessionDir, 'agents/main/tool-results'));
  });

  it('mounts read-only storage panel with live harness paths', async () => {
    const originalHome = process.env.SUPERLIORA_HOME;
    const home = await mkdtemp(join(tmpdir(), 'liora-storage-settings-'));
    process.env.SUPERLIORA_HOME = home;
    const sessionDir = join(home, 'sessions', 'bucket', 'ses_a');
    const configPath = join(home, 'config.toml');

    const host = {
      harness: {
        homeDir: home,
        configPath,
        listSessions: vi.fn(async () => [{ id: 'a' }, { id: 'b' }]),
      },
      state: {
        transcriptContainer: { addChild: vi.fn() },
        appState: { workDir: '/tmp/ws' },
        renderer: { invalidateFrame: vi.fn() },
      },
      requireSession: vi.fn(() => ({
        workDir: '/tmp/ws',
        summary: { sessionDir, workDir: '/tmp/ws' },
      })),
    } as never;

    showStorageSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };
    const lines = panel.buildLines(1).join('\n');
    expect(lines).toContain('Storage (read-only)');
    expect(lines).toContain(`Home: ${home}`);
    expect(lines).toContain(`Config: ${configPath}`);
    expect(lines).toContain(`Sessions: ${join(home, 'sessions')}/`);
    expect(lines).toContain(`Journal: ${join(sessionDir, 'agents/main/wire.jsonl')}`);
    expect(lines).toContain(`Tool results: ${join(sessionDir, 'agents/main/tool-results')}/`);
    expect(lines).toContain('SUPERLIORA_HOME override');
    expect(lines).toContain('2 session(s)');

    await rm(home, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.SUPERLIORA_HOME;
    else process.env.SUPERLIORA_HOME = originalHome;
  });
});
