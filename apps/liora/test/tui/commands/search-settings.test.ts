import { describe, expect, it, vi } from 'vitest';

import { showSearchSettings } from '#/tui/commands/config/search-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import { currentTheme } from '#/tui/theme';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

function makeHost(options: {
  getStatus?: () => Promise<Record<string, unknown>>;
  getConfig?: () => Promise<Record<string, unknown>>;
  hasSession?: boolean;
} = {}) {
  const session = {
    getStatus:
      options.getStatus ??
      vi.fn(async () => ({
        usage: {
          searchNeverEmpty: { hardFailCount: 0, softDegradeCount: 1 },
          localResearchCache: { hitRate: 0.8, hits: 4, misses: 1 },
        },
      })),
  };
  const addChild = vi.fn();
  return {
    state: {
      theme: currentTheme,
      transcriptContainer: { addChild },
      ui: { requestRender: vi.fn() },
      renderer: { invalidateFrame: vi.fn() },
      centerModalStack: [] as readonly unknown[],
    },
    harness: {
      getConfig:
        options.getConfig ??
        vi.fn(async () => ({
          research: { localSearch: { enabled: true }, search: { freeFallback: true } },
        })),
      setConfig: vi.fn(),
    },
    requireSession:
      options.hasSession === false
        ? vi.fn(() => {
            throw new Error('no session');
          })
        : vi.fn(() => session),
    showStatus: vi.fn(),
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
  } as unknown as SlashCommandHost;
}

describe('showSearchSettings status panel', () => {
  it('wires live never-empty and LocalResearchCache hit from getStatus', async () => {
    const host = makeHost();
    showSearchSettings(host);

    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (value: string) => void } }).opts.onSelect('status');
    await vi.waitFor(() => {
      expect((host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls.length)
        .toBeGreaterThan(0);
    });

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls.at(-1)?.[0] as UsagePanelComponent;
    const text = panel.render(100).join('\n');
    expect(text).toContain('Never-empty: hard-fail 0 · soft-degrade 1');
    expect(text).toContain('Free-only KPI: soft 100% · hard-fail 0 · target ≥99%');
    expect(text).toContain('LocalResearchCache: hit 80% · 4/5 lookups');
  });
});
