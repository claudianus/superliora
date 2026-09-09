import { describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { openPlanBrowserForUser } from '#/tui/features/surfaces/plan-browser-controller';

interface FakePlan {
  path?: string;
  content?: string;
}

function makeHost(options: {
  planMode?: boolean;
  plan?: FakePlan | null;
  delegated?: boolean;
}) {
  const children: unknown[] = [];
  const mounted: unknown[] = [];
  const notices: Array<{ title: string; detail?: string }> = [];
  const statuses: Array<{ msg: string; color?: string }> = [];
  let planMode = options.planMode ?? false;
  const delegated = options.delegated ?? false;
  const appState = { planMode, activityTip: null as string | null };
  const session = {
    setPlanMode: vi.fn(async (enabled: boolean) => {
      // delegated: RPC succeeds but status stays off.
      planMode = delegated ? false : enabled;
    }),
    getPlan: vi.fn(async () => (options.plan === undefined ? null : options.plan)),
    getStatus: vi.fn(async () => ({ planMode: delegated ? false : planMode })),
  };
  const host = {
    session,
    state: {
      appState,
      editorContainer: { children },
      transcriptContainer: { isBatchMounting: false },
      renderer: { invalidateFrame: vi.fn() },
    },
    setAppState: vi.fn((patch: Partial<{ planMode: boolean; activityTip: string | null }>) =>
      Object.assign(appState, patch),
    ),
    mountEditorReplacement: vi.fn((panel: unknown) => {
      children.length = 0;
      children.push(panel);
      mounted.push(panel);
    }),
    restoreEditor: vi.fn(() => {
      children.length = 0;
    }),
    showStatus: vi.fn((msg: string, color?: string) => {
      statuses.push({ msg, color });
    }),
    showNotice: vi.fn((title: string, detail?: string) => {
      notices.push({ title, detail });
    }),
    showError: vi.fn(),
  } as unknown as SlashCommandHost & { mounted: unknown[]; notices: typeof notices };
  return { host, session, appState, mounted, notices, statuses };
}

describe('openPlanBrowserForUser', () => {
  it('mounts the browser with the plan when plan mode is already on', async () => {
    const { host, mounted } = makeHost({
      planMode: true,
      plan: { path: '/tmp/plan.md', content: '# Do the thing' },
    });
    await openPlanBrowserForUser(host);
    expect(mounted).toHaveLength(1);
    expect(host.state.appState.planMode).toBe(true);
  });

  it('shows a gentle status when plan mode is on but no plan has been drafted', async () => {
    const { host, mounted } = makeHost({ planMode: true, plan: null });
    await openPlanBrowserForUser(host);
    expect(mounted).toHaveLength(0);
    expect(host.showStatus).toHaveBeenCalled();
  });

  it('switches plan mode on and then mounts the browser when a plan exists', async () => {
    const { host, session, mounted } = makeHost({
      planMode: false,
      plan: { path: '/tmp/plan.md', content: '# Plan' },
    });
    await openPlanBrowserForUser(host);
    expect(session.setPlanMode).toHaveBeenCalledWith(true, false);
    expect(host.state.appState.planMode).toBe(true);
    expect(mounted).toHaveLength(1);
  });

  it('enables plan mode and only shows a status (no browser) when no plan exists yet', async () => {
    const { host, session, mounted } = makeHost({ planMode: false, plan: null });
    await openPlanBrowserForUser(host);
    expect(session.setPlanMode).toHaveBeenCalledWith(true, false);
    expect(host.state.appState.planMode).toBe(true);
    expect(mounted).toHaveLength(0);
    expect(host.showStatus).toHaveBeenCalled();
  });
});
