import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  showStorageSettings,
  STORAGE_HOME_TIP,
  STORAGE_LOGS_TIP,
  STORAGE_RETENTION_TIP,
} from '#/tui/commands/config/storage/storage-settings';
import { resolveStoragePaths } from '#/tui/utils/storage/storage-glance';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

function makeStorageHost(options: {
  home: string;
  configPath: string;
  sessionDir?: string;
  listSessions?: () => Promise<readonly unknown[]>;
}): SlashCommandHost {
  return {
    harness: {
      homeDir: options.home,
      configPath: options.configPath,
      listSessions: options.listSessions ?? vi.fn(async () => []),
    },
    state: {
      transcriptContainer: { addChild: vi.fn() },
      centerModalStack: [] as readonly unknown[],
      appState: { workDir: '/tmp/ws' },
      renderer: { invalidateFrame: vi.fn() },
    },
    requireSession: vi.fn(() => ({
      workDir: '/tmp/ws',
      summary: {
        sessionDir: options.sessionDir,
        workDir: '/tmp/ws',
      },
    })),
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
}

function selectStorageAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('storage settings tips', () => {
  it('exports home, retention, and logs tips (glance copy, not menu rows)', () => {
    expect(STORAGE_HOME_TIP).toContain('SUPERLIORA_HOME');
    expect(STORAGE_RETENTION_TIP).toContain('wire.jsonl');
    expect(STORAGE_LOGS_TIP).toContain('log-level');
  });
});

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

  it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
    const host = makeStorageHost({
      home: '/tmp/home',
      configPath: '/tmp/home/config.toml',
    });
    showStorageSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual([
      'status',
    ]);
    expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
  });


  it('mounts read-only storage panel with live harness paths', async () => {
    const originalHome = process.env['SUPERLIORA_HOME'];
    const home = await mkdtemp(join(tmpdir(), 'liora-storage-settings-'));
    process.env['SUPERLIORA_HOME'] = home;
    const sessionDir = join(home, 'sessions', 'bucket', 'ses_a');
    const configPath = join(home, 'config.toml');

    const host = makeStorageHost({
      home,
      configPath,
      sessionDir,
      listSessions: vi.fn(async () => [{ id: 'a' }, { id: 'b' }]),
    });

    showStorageSettings(host);
    selectStorageAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('Storage (read-only)');
    expect(lines).toContain(`Home: ${home}`);
    expect(lines).toContain(`Config: ${configPath}`);
    expect(lines).toContain(`Sessions: ${join(home, 'sessions')}/`);
    expect(lines).toContain(`Journal: ${join(sessionDir, 'agents/main/wire.jsonl')}`);
    expect(lines).toContain(`Tool results: ${join(sessionDir, 'agents/main/tool-results')}/`);
    expect(lines).toContain('SUPERLIORA_HOME override');
    expect(lines).toContain('2 session(s)');

    await rm(home, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env['SUPERLIORA_HOME'];
    else process.env['SUPERLIORA_HOME'] = originalHome;
  });
});
