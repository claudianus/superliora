import { describe, expect, it, vi } from 'vitest';

import { showIndexSettings } from '#/tui/commands/config/index-settings';
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

vi.mock('@superliora/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@superliora/sdk')>();
  return {
    ...actual,
    getCodemapStatus: vi.fn(() => codemapWarm),
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
    },
    requireSession: vi.fn(() => ({ getTools, workDir: options.workDir ?? '/workspace/demo' })),
  } as unknown as SlashCommandHost;
}

describe('index settings', () => {
  it('mounts read-only index panel with real codemap status when warm', async () => {
    const host = makeIndexHost({ repoQueryActive: true });
    showIndexSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
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
    expect(lines).toContain('No rebuild action here until RepoIndex engine lands.');
  });

  it('reports RepoQuery missing when not active in session', async () => {
    const host = makeIndexHost({ repoQueryActive: false });
    showIndexSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    expect(panel.snapshotBodyLines(1).join('\n')).toContain('RepoQuery: not active');
  });

  it('shows cold codemap note and RepoQuery symbol tip', async () => {
    const sdk = await import('@superliora/sdk');
    vi.mocked(sdk.getCodemapStatus).mockReturnValueOnce(codemapCold);

    const host = makeIndexHost({ repoQueryActive: true });
    showIndexSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('Symbol codemap: cold');
    expect(text).toContain('Symbol index via RepoQuery mode=symbol');
  });
});
