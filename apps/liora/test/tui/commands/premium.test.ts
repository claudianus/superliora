import { describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands/dispatch';
import { applyPremiumQuality, handlePremiumQualityCommand } from '#/tui/commands/premium';

function makePremiumHost(options: {
  premiumQualityMode?: boolean;
  session?: Record<string, unknown> | undefined;
} = {}) {
  const session =
    options.session === undefined
      ? {
          setPremiumQuality: vi.fn(async () => undefined),
        }
      : options.session;
  return {
    session: options.session === null ? undefined : session,
    state: {
      appState: {
        premiumQualityMode: options.premiumQualityMode === true,
      },
    },
    setAppState: vi.fn(),
    showError: vi.fn(),
    showNotice: vi.fn(),
  } as unknown as SlashCommandHost & {
    session?: { setPremiumQuality: ReturnType<typeof vi.fn> } | undefined;
    setAppState: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
    showNotice: ReturnType<typeof vi.fn>;
  };
}

describe('handlePremiumQualityCommand', () => {
  it('reports missing session', async () => {
    const host = makePremiumHost({ session: null as unknown as undefined });
    // force undefined session
    (host as { session?: undefined }).session = undefined;
    await handlePremiumQualityCommand(host, '');
    expect(host.showError).toHaveBeenCalled();
  });

  it('shows status when args are empty', async () => {
    const host = makePremiumHost({ premiumQualityMode: false });
    await handlePremiumQualityCommand(host, '');
    expect(host.showNotice).toHaveBeenCalled();
    expect(host.session?.setPremiumQuality).not.toHaveBeenCalled();
  });

  it('enables premium with on', async () => {
    const host = makePremiumHost({ premiumQualityMode: false });
    await handlePremiumQualityCommand(host, 'on');
    expect(host.session?.setPremiumQuality).toHaveBeenCalledWith(true);
    expect(host.setAppState).toHaveBeenCalledWith({ premiumQualityMode: true });
    expect(host.showNotice).toHaveBeenCalled();
  });

  it('notices when already on', async () => {
    const host = makePremiumHost({ premiumQualityMode: true });
    await handlePremiumQualityCommand(host, 'on');
    expect(host.session?.setPremiumQuality).not.toHaveBeenCalled();
    expect(host.showNotice).toHaveBeenCalled();
  });

  it('disables premium with off', async () => {
    const host = makePremiumHost({ premiumQualityMode: true });
    await handlePremiumQualityCommand(host, 'off');
    expect(host.session?.setPremiumQuality).toHaveBeenCalledWith(false);
    expect(host.setAppState).toHaveBeenCalledWith({ premiumQualityMode: false });
  });

  it('rejects unknown args', async () => {
    const host = makePremiumHost();
    await handlePremiumQualityCommand(host, 'turbo');
    expect(host.showError).toHaveBeenCalled();
    expect(host.session?.setPremiumQuality).not.toHaveBeenCalled();
  });

  it('surfaces setPremiumQuality failures', async () => {
    const host = makePremiumHost({
      session: {
        setPremiumQuality: vi.fn(async () => {
          throw new Error('rpc down');
        }),
      },
    });
    await applyPremiumQuality(host, true);
    expect(host.showError).toHaveBeenCalled();
    expect(String(host.showError.mock.calls[0]?.[0] ?? '')).toMatch(/rpc down|failed|premium/i);
  });
});
