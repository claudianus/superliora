import { describe, expect, it, vi } from 'vitest';

import {
  INDEX_ENGINE_TIP,
  INDEX_FTS_TIP,
  INDEX_WARM_TIP,
  showIndexSettings,
} from '#/tui/commands/config/index/index-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

const codemapWarm = {
  warmth: 'warm' as const,
  dbPath: '/tmp/codemap.sqlite',
  gitRepo: true,
  fileCount: 42,
  symbolCount: 128,
  note: null,
};

const codemapCold = {
  warmth: 'cold' as const,
  dbPath: '/tmp/codemap-cold.sqlite',
  gitRepo: true,
  fileCount: null,
  symbolCount: null,
  note: 'Symbol index via RepoQuery mode=symbol (builds on first use in git repos).',
};

const rebuildWarm = {
  ok: true,
  ms: 1200,
  warmth: 'warm' as const,
  codemapFiles: 42,
  codemapSymbols: 128,
  contentFiles: 87,
  contentLines: 900,
  contentMs: 400,
  contentSkipped: false,
  contentSkipReason: null,
  note: null,
};

vi.mock('@superliora/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@superliora/sdk')>();
  return {
    ...actual,
    getCodemapStatus: vi.fn(() => codemapWarm),
    rebuildRepoIndex: vi.fn(() => rebuildWarm),
  };
});

function makeIndexHost(options: { repoQueryActive?: boolean; workDir?: string } = {}) {
  const transcriptContainer = { addChild: vi.fn() };
  const getTools = vi.fn(async () =>
    options.repoQueryActive === true
      ? [{ name: 'RepoQuery', description: 'Unified repo search', source: 'builtin', active: true }]
      : [{ name: 'Grep', description: 'Search', source: 'builtin', active: true }],
  );
  return {
    state: {
      transcriptContainer,
      appState: { workDir: options.workDir ?? '/workspace/demo' },
      renderer: { invalidateFrame: vi.fn() },
      centerModalStack: [] as readonly unknown[],
    },
    requireSession: vi.fn(() => ({ getTools, workDir: options.workDir ?? '/workspace/demo' })),
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
}

function selectIndexAction(host: SlashCommandHost, value: 'status' | 'rebuild'): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('index settings', () => {
  it('exports warm, FTS, and sqlite engine tips', () => {
    expect(INDEX_WARM_TIP).toContain('default ON');
    expect(INDEX_WARM_TIP).toContain('SUPERLIORA_REPO_INDEX_WARM=0');
    expect(INDEX_FTS_TIP).toContain('SQLite FTS5');
    expect(INDEX_FTS_TIP).toContain('Zoekt');
    expect(INDEX_ENGINE_TIP).toContain('sqlite (default)');
  });

  it('mounts ChoicePicker with status, rebuild, and read-only tip actions', () => {
    const host = makeIndexHost();
    showIndexSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual([
      'status',
      'rebuild',
      'tip-warm',
      'tip-fts',
      'tip-engine',
    ]);
  });

  it('shows warm-on-default tip via showStatus', () => {
    const host = makeIndexHost();
    showIndexSettings(host);
    selectIndexAction(host, 'tip-warm');
    expect(host.showStatus).toHaveBeenCalledWith(INDEX_WARM_TIP, 'info');
  });

  it('mounts read-only index panel with real codemap status when warm', async () => {
    const host = makeIndexHost({ repoQueryActive: true });
    showIndexSettings(host);
    selectIndexAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('Glance: RepoQuery on · codemap warm · engine=sqlite · FTS live');
    expect(lines).toContain('RepoQuery: registered');
    expect(lines).toContain('Symbol codemap: warm · 42 files · 128 symbols');
    expect(lines).toContain('Codemap sqlite: /tmp/codemap.sqlite');
    expect(lines).toContain('RepoIndex engine: enabled');
    expect(lines).toContain('engine=sqlite');
    expect(lines).toContain('RepoIndex wire: live · engine=sqlite');
    expect(lines).toContain('FTS backend: sqlite-fts5 (live');
    expect(lines).toContain('SQLite FTS5 (1차, bundled) vs Zoekt sidecar');
    expect(lines).toContain('── Session (live) ──');
    expect(lines).toContain('Codemap warm: ON');
    expect(lines).toContain('default ON');
    expect(lines).toContain('fire-and-forget ensureReady');
    expect(lines).toContain('── Rebuild ──');
    expect(lines).toContain('Rebuild now');
    expect(lines).not.toContain('No rebuild action here until RepoIndex engine lands.');
  });

  it('reports RepoQuery missing when not active in session', async () => {
    const host = makeIndexHost({ repoQueryActive: false });
    showIndexSettings(host);
    selectIndexAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    expect(panel.snapshotBodyLines(1).join('\n')).toContain('RepoQuery: not active');
  });

  it('shows cold codemap note and RepoQuery symbol tip', async () => {
    const sdk = await import('@superliora/sdk');
    vi.mocked(sdk.getCodemapStatus).mockReturnValueOnce(codemapCold);

    const host = makeIndexHost({ repoQueryActive: true });
    showIndexSettings(host);
    selectIndexAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('Symbol codemap: cold');
    expect(text).toContain('Symbol index via RepoQuery mode=symbol');
  });

  it('runs rebuild and surfaces result line with files/ms/warmth', async () => {
    const sdk = await import('@superliora/sdk');
    const host = makeIndexHost({ repoQueryActive: true, workDir: '/workspace/demo' });
    showIndexSettings(host);
    selectIndexAction(host, 'rebuild');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    expect(vi.mocked(sdk.rebuildRepoIndex)).toHaveBeenCalledWith('/workspace/demo');
    expect(host.showStatus).toHaveBeenCalledWith('Repo index rebuild finished.', 'success');

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('Last rebuild: warm · 42 files · 128 symbols');
    expect(text).toContain('FTS 87 files');
    expect(text).toContain('1200ms');
  });
});
