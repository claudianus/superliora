import { describe, expect, it, vi } from 'vitest';

import type { SubagentSwarmHost } from '../../../src/tui/controllers/subagent-event/swarm';

/**
 * Loop39a contract: when Maker≠Checker soft warn becomes a new non-empty string,
 * the host should surface a named notice (Ops badge alone is quiet).
 * Mirrors SubagentSwarmCoordinator onGovernanceSoftWarn closure.
 */
function surfaceMakerCheckerSoftWarn(
  host: SubagentSwarmHost,
  warn: string | undefined,
): void {
  const previous = host.state.appState.makerCheckerSoftWarn ?? null;
  host.setAppState({ makerCheckerSoftWarn: warn ?? null });
  if (
    warn !== undefined &&
    warn.length > 0 &&
    warn !== previous &&
    host.showNotice !== undefined
  ) {
    host.showNotice('Maker≠Checker soft collision', warn, {
      coalesceKey: 'maker-checker-soft-warn',
    });
    host.showStatus?.(
      'Maker≠Checker: same path edit + verify in one swarm — split roles',
      'warning',
    );
  }
}

function makeHost(initialWarn: string | null = null): {
  host: SubagentSwarmHost;
  notices: Array<{ title: string; detail?: string; coalesceKey?: string }>;
  statuses: Array<{ msg: string; color?: string }>;
  getWarn: () => string | null;
} {
  const notices: Array<{ title: string; detail?: string; coalesceKey?: string }> = [];
  const statuses: Array<{ msg: string; color?: string }> = [];
  let makerCheckerSoftWarn: string | null = initialWarn;
  const host: SubagentSwarmHost = {
    state: {
      appState: {
        get makerCheckerSoftWarn() {
          return makerCheckerSoftWarn;
        },
      },
    } as any,
    setAppState: (patch) => {
      if ('makerCheckerSoftWarn' in patch) {
        makerCheckerSoftWarn = (patch.makerCheckerSoftWarn as string | null) ?? null;
      }
    },
    session: undefined,
    streamingUI: {} as any,
    showError: vi.fn(),
    showNotice: (title, detail, options) => {
      notices.push({ title, detail, coalesceKey: options?.coalesceKey });
    },
    showStatus: (msg, color) => {
      statuses.push({ msg, color });
    },
    updateActivityPane: vi.fn(),
  };
  return { host, notices, statuses, getWarn: () => makerCheckerSoftWarn };
}

describe('Maker≠Checker soft warn notice contract (Loop39a)', () => {
  it('shows a notice when soft warn becomes set', () => {
    const { host, notices, statuses, getWarn } = makeHost(null);
    const warn =
      'Maker≠Checker soft collision: path "src/a.ts" was edited and verified by the same agent.';

    surfaceMakerCheckerSoftWarn(host, warn);

    expect(notices).toHaveLength(1);
    expect(notices[0]?.title).toContain('Maker≠Checker');
    expect(notices[0]?.coalesceKey).toBe('maker-checker-soft-warn');
    expect(statuses[0]?.color).toBe('warning');
    expect(getWarn()).toContain('Maker≠Checker');
  });

  it('does not re-notice the same warn string', () => {
    const same =
      'Maker≠Checker soft collision: path "src/a.ts" was edited and verified by the same agent.';
    const { host, notices } = makeHost(same);

    surfaceMakerCheckerSoftWarn(host, same);

    expect(notices).toHaveLength(0);
  });
});
