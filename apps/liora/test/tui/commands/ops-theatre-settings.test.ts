import { describe, expect, it, vi } from 'vitest';

import { showOpsTheatreSettings } from '#/tui/commands/config/ops/ops-theatre-settings';
import {
  buildOpsTheatreSettingsLines,
  OPS_THEATRE_OPEN_TIP,
  OPS_THEATRE_TRAY_TIP,
} from '#/tui/utils/ops/ops-theatre-glance';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import { currentTheme } from '#/tui/theme';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

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
  it('mounts a panel with live queue from getStatus', async () => {
    const addChild = vi.fn();
    const host = {
      state: {
        theme: currentTheme,
        transcriptContainer: { addChild },
        ui: { requestRender: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
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
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;

    showOpsTheatreSettings(host);
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
});
