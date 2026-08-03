import { describe, expect, it, vi } from 'vitest';

import {
  EYES_DOCTOR_TIP,
  EYES_SLASH_TIP,
  EYES_TEXT_ONLY_TIP,
  EYES_TOOLS_TIP,
  showEyesSettings,
} from '#/tui/commands/config/eyes/eyes-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

function makeEyesHost() {
  const transcriptContainer = { addChild: vi.fn() };
  return {
    state: {
      transcriptContainer,
      centerModalStack: [] as readonly unknown[],
      renderer: { invalidateFrame: vi.fn() },
    },
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
}

function selectEyesAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('eyes settings tips', () => {
  it('exports /eyes, doctor, tools, and text-only tips (glance copy, not menu rows)', () => {
    expect(EYES_SLASH_TIP).toContain('/eyes');
    expect(EYES_DOCTOR_TIP).toContain('browser-use doctor');
    expect(EYES_TOOLS_TIP).toContain('BrowserStatus');
    expect(EYES_TEXT_ONLY_TIP).toContain('text-only');
  });
});

describe('showEyesSettings', () => {
  it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
    const host = makeEyesHost();
    showEyesSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual([
      'status',
      'probe',
      'doctor-browser',
      'doctor-computer',
    ]);
    expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
  });

  it('shows eyes readiness status panel', async () => {
    const host = makeEyesHost();
    showEyesSettings(host);
    selectEyesAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('Eyes readiness (read-only)');
    expect(lines).toContain('/eyes');
    expect(lines).toContain('browser-use doctor');
    expect(lines).toContain('BrowserStatus');
    expect(lines).toContain('Missing runtimes do not block text-only agent work');
  });
});
