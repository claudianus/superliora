import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleFolderCommand } from '#/tui/commands/session/folder';
import { findBuiltInSlashCommand } from '#/tui/commands/index';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;
const tempDirs: string[] = [];

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeHost(workDir: string) {
  const state = {
    appState: {
      workDir,
      streamingPhase: 'idle' as const,
      isCompacting: false,
      isBackgroundCompacting: false,
    },
    centerModalStack: [] as unknown[],
  };
  let mountedPanel: { handleInput: (data: string) => void; render: (width: number) => string[] } | null =
    null;
  const host = {
    state,
    harness: {
      listSessions: vi.fn(async () => [
        { workDir: join(workDir, 'recent-proj'), updatedAt: Date.now() },
      ]),
    },
    openWorkspace: vi.fn(async () => {}),
    showError: vi.fn(),
    showStatus: vi.fn(),
    mountCenterModal: vi.fn((panel: { handleInput: (data: string) => void; render: (width: number) => string[] }) => {
      mountedPanel = panel;
      state.centerModalStack = [panel];
    }),
    closeCenterModal: vi.fn(() => {
      mountedPanel = null;
      state.centerModalStack = [];
    }),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(() => {
      mountedPanel = null;
    }),
  } as unknown as SlashCommandHost & {
    openWorkspace: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
    showStatus: ReturnType<typeof vi.fn>;
  };
  return {
    host,
    getMountedPanel: () => mountedPanel,
  };
}

describe('/folder', () => {
  it('registers folder with workspace/open/cd aliases', () => {
    expect(findBuiltInSlashCommand('folder')?.name).toBe('folder');
    expect(findBuiltInSlashCommand('workspace')?.name).toBe('folder');
    expect(findBuiltInSlashCommand('open')?.name).toBe('folder');
    expect(findBuiltInSlashCommand('cd')?.name).toBe('folder');
  });

  it('opens a path argument without mounting the picker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'liora-folder-'));
    tempDirs.push(root);
    const { host, getMountedPanel } = makeHost(root);
    await handleFolderCommand(host, root);
    expect(host.openWorkspace).toHaveBeenCalledWith(root);
    expect(getMountedPanel()).toBeNull();
  });

  it('blocks folder switches while a turn is streaming', async () => {
    const { host } = makeHost('/tmp/proj');
    host.state.appState.streamingPhase = 'composing';
    await handleFolderCommand(host, '');
    expect(host.showError).toHaveBeenCalled();
    expect(host.openWorkspace).not.toHaveBeenCalled();
  });

  it('mounts a searchable picker with recent / places / this-folder sections', async () => {
    const root = mkdtempSync(join(tmpdir(), 'liora-folder-pick-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'recent-proj'));
    const { host, getMountedPanel } = makeHost(root);
    await handleFolderCommand(host, '');
    const panel = getMountedPanel();
    expect(panel).not.toBeNull();
    const text = strip(panel!.render(80).join('\n'));
    expect(text).toContain('Open workspace');
    expect(text).toContain('Recent');
    expect(text).toContain('Places');
    expect(text).toContain('This folder');
    expect(text).toContain('Open this folder');
  });
});
