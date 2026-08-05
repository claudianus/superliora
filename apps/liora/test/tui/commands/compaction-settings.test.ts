import { describe, expect, it, vi } from 'vitest';

import {
  COMPACTION_KEEP_TOKENS_TIP,
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
      })),
    getContext:
      options.getContext ??
      vi.fn(async () => ({
        contextArchive: { entryCount: 4, maxEntries: 512 },
      })),
  };
  return {
    state: {
      appState: {},
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

describe('showCompactionSettings', () => {
  it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
    const host = makeHost();
    showCompactionSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual([
      'presets',
      'status',
      'run-compact',
      'working-set',
    ]);
    expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
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
  });
});
