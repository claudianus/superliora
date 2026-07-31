import { describe, expect, it, vi } from 'vitest';

import { showEyesSettings } from '#/tui/commands/config/eyes-settings';
import {
  browserEyeFromSetupResult,
  computerEyeFromCuaStatus,
} from '#/tui/utils/harness-eyes-readiness';
import { buildEyesSettingsLines, loadEyesSettingsGlance } from '#/tui/utils/eyes/eyes-glance';

describe('eyes glance', () => {
  it('builds tip-heavy panel from readiness report', () => {
    const text = buildEyesSettingsLines(
      loadEyesSettingsGlance({
        report: {
          generatedAt: '2026-07-31T00:00:00.000Z',
          lines: [
            browserEyeFromSetupResult({
              ok: true,
              code: 0,
              stdout: 'ready',
              stderr: '',
              command: [],
            }),
            computerEyeFromCuaStatus({ installed: false, error: 'missing' }),
          ],
        },
      }),
    ).join('\n');
    expect(text).toContain('Browser-use: OK');
    expect(text).toContain('Computer-use: MISSING');
    expect(text).toContain('liora browser-use doctor');
    expect(text).toContain('/eyes');
  });

  it('surfaces load errors without throwing', () => {
    const text = buildEyesSettingsLines(
      loadEyesSettingsGlance({ loadError: 'probe failed' }),
    ).join('\n');
    expect(text).toContain('Load error: probe failed');
  });
});

describe('showEyesSettings', () => {
  it('mounts UsagePanel instead of showNotice', async () => {
    const host = {
      state: {
        transcriptContainer: { addChild: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
      },
      showNotice: vi.fn(),
      showError: vi.fn(),
    } as never;

    showEyesSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    expect(host.showNotice).not.toHaveBeenCalled();
  });
});
