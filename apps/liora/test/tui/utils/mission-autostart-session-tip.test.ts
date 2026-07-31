import { describe, expect, it, vi } from 'vitest';

import { MISSION_AUTOSTART_SESSION_TIP } from '#/tui/utils/mission/mission-glance';
import { showMissionAutoStartSessionTipIfNeeded } from '#/tui/utils/mission/mission-autostart-session-tip';

describe('showMissionAutoStartSessionTipIfNeeded', () => {
  it('shows status tip when opt-in ON and no active Mission run', async () => {
    const session = {
      id: 'ses-1',
      getUltraworkRun: vi.fn().mockResolvedValue(null),
    };
    const showStatus = vi.fn();
    const host = {
      harness: {
        getConfig: vi.fn().mockResolvedValue({ mission: { autoStart: true } }),
      },
      session,
      showStatus,
    };

    await showMissionAutoStartSessionTipIfNeeded(host, session);

    expect(showStatus).toHaveBeenCalledWith(MISSION_AUTOSTART_SESSION_TIP, 'textMuted');
  });

  it('skips tip when opt-in OFF or Mission run is already active', async () => {
    const showStatus = vi.fn();
    const offSession = {
      id: 'ses-off',
      getUltraworkRun: vi.fn(),
    };
    await showMissionAutoStartSessionTipIfNeeded(
      {
        harness: {
          getConfig: vi.fn().mockResolvedValue({ mission: { autoStart: false } }),
        },
        session: offSession,
        showStatus,
      },
      offSession,
    );
    expect(showStatus).not.toHaveBeenCalled();
    expect(offSession.getUltraworkRun).not.toHaveBeenCalled();

    showStatus.mockClear();
    const activeSession = {
      id: 'ses-active',
      getUltraworkRun: vi.fn().mockResolvedValue({ status: 'running', stage: 'plan' }),
    };
    await showMissionAutoStartSessionTipIfNeeded(
      {
        harness: {
          getConfig: vi.fn().mockResolvedValue({ mission: { autoStart: true } }),
        },
        session: activeSession,
        showStatus,
      },
      activeSession,
    );
    expect(showStatus).not.toHaveBeenCalled();
  });

  it('does not show tip after session switched away', async () => {
    const session = {
      id: 'ses-stale',
      getUltraworkRun: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(null), 10);
          }),
      ),
    };
    const showStatus = vi.fn();
    const host = {
      harness: {
        getConfig: vi.fn().mockResolvedValue({ mission: { autoStart: true } }),
      },
      session: undefined,
      showStatus,
    };

    await showMissionAutoStartSessionTipIfNeeded(host, session);

    expect(showStatus).not.toHaveBeenCalled();
  });
});
