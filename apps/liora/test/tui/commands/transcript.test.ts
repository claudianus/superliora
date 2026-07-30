import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES, loadTuiConfig } from '#/tui/config';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import {
  handleTranscriptCommand,
  transcriptArgumentCompletions,
} from '#/tui/commands/transcript';

async function withTempHome<T>(run: () => Promise<T>): Promise<T> {
  const originalHome = process.env['SUPERLIORA_HOME'];
  const home = await mkdtemp(join(tmpdir(), 'liora-transcript-command-'));
  process.env['SUPERLIORA_HOME'] = home;
  try {
    return await run();
  } finally {
    await rm(home, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env['SUPERLIORA_HOME'];
    } else {
      process.env['SUPERLIORA_HOME'] = originalHome;
    }
  }
}

function makeHost(detail = 'standard') {
  const appState = {
    theme: 'auto',
    notifications: { enabled: true, condition: 'unfocused' },
    upgrade: { autoInstall: true },
    appearance: { ...DEFAULT_APPEARANCE_PREFERENCES, transcriptDetail: detail },
  };
  const host = {
    state: {
      transcriptDetail: detail,
      appState,
      centerModalStack: [],
      applyTheme: vi.fn(),
      getSnapshot: vi.fn(),
      requestRender: vi.fn(),
    },
    showStatus: vi.fn(),
    showNotice: vi.fn(),
    showError: vi.fn(),
    setAppState: vi.fn((patch: Record<string, unknown>) => {
      Object.assign(appState, patch);
    }),
    setTranscriptDetail: vi.fn(),
    track: vi.fn(),
  };
  return host as unknown as SlashCommandHost & typeof host;
}

describe('handleTranscriptCommand', () => {
  it('shows current detail and usage without arguments', async () => {
    const host = makeHost('compact');
    await handleTranscriptCommand(host, '');
    expect(host.showNotice).toHaveBeenCalled();
    const detail = String(host.showNotice.mock.calls[0]?.[1]);
    expect(detail).toContain('compact');
    expect(detail).toContain('minimal');
    expect(host.setTranscriptDetail).not.toHaveBeenCalled();
  });

  it('switches detail, persists it, and applies it live', async () =>
    withTempHome(async () => {
      const host = makeHost('standard');
      await handleTranscriptCommand(host, 'minimal');
      expect(host.state.appState.appearance.transcriptDetail).toBe('minimal');
      expect((await loadTuiConfig()).appearance?.transcriptDetail).toBe('minimal');
      expect(host.setTranscriptDetail).toHaveBeenCalledWith('minimal');
      expect(host.showStatus).toHaveBeenCalledWith(
        'Appearance transcript-detail set to minimal.',
        'success',
      );
    }));

  it('rejects unknown levels', async () => {
    const host = makeHost();
    await handleTranscriptCommand(host, 'dense');
    expect(host.showError).toHaveBeenCalled();
    expect(host.setTranscriptDetail).not.toHaveBeenCalled();
  });
});

describe('transcriptArgumentCompletions', () => {
  it('offers all levels for an empty argument', () => {
    expect(transcriptArgumentCompletions('').map((item) => item.value)).toEqual([
      'minimal',
      'compact',
      'standard',
      'full',
    ]);
  });

  it('filters by prefix', () => {
    expect(transcriptArgumentCompletions('m').map((item) => item.value)).toEqual(['minimal']);
  });

  it('stops after the first token', () => {
    expect(transcriptArgumentCompletions('minimal extra')).toEqual([]);
  });
});
