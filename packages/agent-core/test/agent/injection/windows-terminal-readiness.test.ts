import { describe, expect, it } from 'vitest';

import {
  renderWindowsTerminalReadiness,
  windowsTerminalReadinessFromEnv,
} from '../../../src/agent/injection/windows-terminal-readiness';

describe('windows terminal readiness injection', () => {
  it('skips non-Windows hosts', () => {
    const snap = windowsTerminalReadinessFromEnv({}, 'linux');
    expect(snap.applicable).toBe(false);
    expect(renderWindowsTerminalReadiness(snap)).toBeUndefined();
  });

  it('marks WT_SESSION as ok', () => {
    const snap = windowsTerminalReadinessFromEnv({ WT_SESSION: 'abc' }, 'win32');
    expect(snap.host).toBe('windowsterminal');
    expect(snap.status).toBe('ok');
    expect(renderWindowsTerminalReadiness(snap)).toBeUndefined();
  });

  it('marks missing WT_SESSION as degraded conhost with apply guidance', () => {
    const snap = windowsTerminalReadinessFromEnv({}, 'win32');
    expect(snap.host).toBe('conhost');
    expect(snap.status).toBe('degraded');
    const text = renderWindowsTerminalReadiness(snap);
    expect(text).toContain('host=conhost status=degraded');
    expect(text).toContain('/host-setup');
    expect(text).toContain('/windows-setup apply');
    expect(text).toContain('task_track=general');
    expect(text).toContain('windows-vibe');
    expect(text).toContain('Do not install packages on the Conductor lane');
  });
});
