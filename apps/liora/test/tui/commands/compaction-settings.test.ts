import { describe, expect, it, vi } from 'vitest';

import {
  COMPACTION_KEEP_TOKENS_TIP,
  COMPACTION_MICRO_TIP,
  COMPACTION_THRESHOLD_TIP,
  showCompactionSettings,
} from '#/tui/commands/config/context/compaction-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

function makeHost(options: {
  getStatus?: () => Promise<Record<string, unknown>>;
  getContext?: () => Promise<Record<string, unknown>>;
  transcriptEntries?: Array<Record<string, unknown>>;
  hasSession?: boolean;
} = {}) {
  const session = {
    getStatus:
      options.getStatus ??
      vi.fn(async () => ({
        contextUsage: 0.55,
        contextTokens: 140_000,
        maxContextTokens: 256_000,
        microCompaction: {
          total: 2,
          lastTrigger: 'cache_miss',
          lastContextUsageRatio: 0.71,
          byTrigger: { cache_miss: 2 },
        },
      })),
    getContext:
      options.getContext ??
      vi.fn(async () => ({
        contextArchive: { entryCount: 4, maxEntries: 512 },
      })),
  };
  return {
    state: {
      appState: { microCompaction: null },
      transcriptEntries: options.transcriptEntries ?? [],
      transcriptContainer: { addChild: vi.fn() },
      centerModalStack: [] as readonly unknown[],
      renderer: { invalidateFrame: vi.fn() },
    },
    harness: {
      getConfig: vi.fn(async () => ({
        loopControl: {
          maxWorkingSetTokens: 256_000,
          asyncWorkingSetTokens: 128_000,
          compactionTriggerRatio: 0.7,
        },
      })),
    },
    requireSession:
      options.hasSession === false
        ? vi.fn(() => {
            throw new Error('no session');
          })
        : vi.fn(() => session),
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
}

function selectCompactionAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('compaction settings tips', () => {
  it('exports threshold, keep-tokens, and micro-compaction tips', () => {
    expect(COMPACTION_THRESHOLD_TIP).toContain('compactionTriggerRatio');
    expect(COMPACTION_KEEP_TOKENS_TIP).toContain('compactionMaxRecentMessages');
    expect(COMPACTION_MICRO_TIP).toContain('Expand(id=');
  });
});

describe('showCompactionSettings', () => {
  it('mounts ChoicePicker with status and read-only tip actions', () => {
    const host = makeHost();
    showCompactionSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual([
      'status',
      'tip-threshold',
      'tip-keep-tokens',
      'tip-micro',
    ]);
  });

  it('shows threshold tip via showStatus', () => {
    const host = makeHost();
    showCompactionSettings(host);
    selectCompactionAction(host, 'tip-threshold');
    expect(host.showStatus).toHaveBeenCalledWith(COMPACTION_THRESHOLD_TIP, 'info');
  });

  it('shows live archive count and last compact tip when session is wired', async () => {
    const host = makeHost({
      transcriptEntries: [
        {
          kind: 'status',
          text: 'Compaction complete',
          compactionData: { tokensBefore: 200_000, tokensAfter: 80_000 },
        },
      ],
    });
    showCompactionSettings(host);
    selectCompactionAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('Context archive: 4 entries');
    expect(text).toContain('Last compact: 200k → 80k');
    expect(text).toContain('Context usage: 55.0%');
    expect(text).toContain('Micro-compaction: 2 clears · last cache_miss @ 71% ctx');
  });

  it('falls back when session is unavailable', async () => {
    const host = makeHost({ hasSession: false });
    showCompactionSettings(host);
    selectCompactionAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('Context archive: (no session)');
    expect(text).toContain('Micro-compaction: (no session data)');
  });
});
