import { describe, expect, it } from 'vitest';

import { SETTINGS_OPTIONS } from '#/tui/components/dialogs/picker/settings-selector';
import { showSettingsInventory } from '#/tui/commands/config/settings-inventory';
import { vi } from 'vitest';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

/** Every SettingsSelection value must appear exactly once in SETTINGS_OPTIONS. */
describe('settings inventory SSOT', () => {
  it('has no duplicate or orphan picker values', () => {
    const values = SETTINGS_OPTIONS.map((option) => option.value);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
    expect(values.length).toBeGreaterThan(30);
  });

  it('lists every entry without harness-only orphan footnotes', () => {
    const host = {
      state: {
        transcriptContainer: { addChild: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
      },
    } as unknown as SlashCommandHost;

    showSettingsInventory(host);
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain(`${String(SETTINGS_OPTIONS.length)} entries`);
    expect(text).not.toContain('Harness sub-panel also lists');
    for (const option of SETTINGS_OPTIONS) {
      expect(text).toContain(option.value);
    }
  });
});
