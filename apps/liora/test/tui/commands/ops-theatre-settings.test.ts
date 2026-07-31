import { describe, expect, it, vi } from 'vitest';

import {
  OPS_THEATRE_OPEN_TIP,
  OPS_THEATRE_TRAY_TIP,
  showOpsTheatreSettings,
} from '#/tui/commands/config/ops/ops-theatre-settings';
import {
  buildOpsTheatreSettingsLines,
} from '#/tui/utils/ops/ops-theatre-glance';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import { currentTheme } from '#/tui/theme';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

function selectOpsAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('buildOpsTheatreSettingsLines', () => {
  it('mentions /ops, tray, and git tips', () => {
    const lines = buildOpsTheatreSettingsLines({
      pendingInterventions: 0,
      permissionMode: 'auto',
    }).join('\n');
    expect(lines).toContain(OPS_THEATRE_OPEN_TIP);
    expect(lines).toContain(OPS_THEATRE_TRAY_TIP);
    expect(lines).toContain('/ops');
    expect(lines).toContain('Visual Quality');
    expect(lines).toContain('Permission mode: auto');
    expect(lines).toContain('Live queue: (clear)');
  });
});

describe('showOpsTheatreSettings', () => {
  it('mounts ChoicePicker then status panel with live queue', async () => {
    const addChild = vi.fn();
    const host = {
      state: {
        theme: currentTheme,
        transcriptContainer: { addChild },
        ui: { requestRender: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
        centerModalStack: [] as readonly unknown[],
        appState: {
          permissionMode: 'ask',
          interventionCount: 0,
          oldestInterventionAgeMs: undefined,
        },
      },
      requireSession: vi.fn(() => ({
        getStatus: vi.fn(async () => ({
          pendingInterventions: 2,
          oldestInterventionAgeMs: 45_000,
          staleInterventions: 1,
        })),
      })),
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;

    showOpsTheatreSettings(host);
    selectOpsAction(host, 'status');
    await vi.waitFor(() => {
      expect(addChild.mock.calls.length).toBeGreaterThan(0);
    });

    const panel = addChild.mock.calls.at(-1)?.[0] as UsagePanelComponent;
    const text = panel.render(100).join('\n');
    expect(text).toContain('Ops Theatre');
    expect(text).toContain('/ops');
    expect(text).toContain('2 pending');
    expect(text).toContain('Permission mode: ask');
  });

  it('shows open tip via showStatus', () => {
    const host = {
      state: {
        theme: currentTheme,
        transcriptContainer: { addChild: vi.fn() },
        ui: { requestRender: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
        centerModalStack: [] as readonly unknown[],
        appState: { permissionMode: 'auto', interventionCount: 0 },
      },
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;

    showOpsTheatreSettings(host);
    selectOpsAction(host, 'tip-open');
    expect(host.showStatus).toHaveBeenCalledWith(OPS_THEATRE_OPEN_TIP, 'info');
  });
});
