/**
 * UX-sweep regression coverage for the message dispatch + queue surfaces:
 * - `/retry` while streaming explains itself instead of a silent no-op
 * - steer failure restores the queue items it drained
 * - `clearQueuedMessages` empties the durable queue (previously dead code
 *   with no caller — now wired to `/queue clear`)
 */

import { describe, expect, it, vi } from 'vitest';

import { MessageDispatchController, type MessageDispatchHost } from '#/tui/controllers/transcript/message-dispatch';
import { handleQueueCommand } from '#/tui/commands/session/queue';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import type { Session } from '@superliora/sdk';
import { fakeDispatchHost } from './control-tower-fakes';

const asDispatchHost = (host: ReturnType<typeof fakeDispatchHost>) =>
  host as unknown as MessageDispatchHost;

describe('UX sweep: retry busy feedback', () => {
  it('shows a busy error when /retry fires mid-turn instead of a silent no-op', async () => {
    const host = fakeDispatchHost({ streamingPhase: 'running' });
    host.lastUserInput = 'do the thing';
    const controller = new MessageDispatchController(asDispatchHost(host));

    await controller.retryLastTurn();

    expect(host.showError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(host.showError).mock.calls[0]?.[0]).toContain('/retry');
    expect(host.session.prompt).not.toHaveBeenCalled();
  });
});

describe('UX sweep: steer failure restores drained queue text', () => {
  it('re-queues items when session.steer rejects', () => {
    const host = fakeDispatchHost({ streamingPhase: 'running' });
    host.session.steer = vi.fn(async () => {
      throw new Error('connection dropped');
    });
    host.state.queuedMessages = [];
    const controller = new MessageDispatchController(asDispatchHost(host));

    // The queue-drain path pulls items out before steer runs; simulate that
    // by starting with an already-drained queue and steering directly.
    host.state.queuedMessages = [];
    controller.steerMessage(host.session as unknown as Session, ['steer text']);

    // The catch handler runs on a microtask chain; flush it.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(host.showError).toHaveBeenCalled();
        expect(host.state.queuedMessages.some((m) => m.text === 'steer text')).toBe(true);
        resolve();
      }, 20);
    });
  });
});

describe('UX sweep: /queue clear', () => {
  function queueHost(queued: number) {
    const host = fakeDispatchHost({});
    for (let i = 0; i < queued; i++) {
      host.state.queuedMessages.push({ text: `message ${String(i)}` });
    }
    const controller = new MessageDispatchController(asDispatchHost(host));
    const slash = {
      ...host,
      clearQueuedMessages: () => {
        controller.clearQueuedMessages();
      },
    };
    return { slash: slash as unknown as SlashCommandHost, host };
  }

  it('clears every queued message and reports the count', () => {
    const { slash, host } = queueHost(3);
    handleQueueCommand(slash, 'clear');
    expect(host.state.queuedMessages).toHaveLength(0);
    const status = vi.mocked(host.showStatus).mock.calls.find((c) =>
      String(c[0]).includes('3'),
    );
    expect(status).toBeDefined();
  });

  it('reports an already-empty queue without an error', () => {
    const { slash, host } = queueHost(0);
    handleQueueCommand(slash, 'clear');
    expect(host.showError).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalled();
  });

  it('rejects unknown subcommands with usage guidance', () => {
    const { slash, host } = queueHost(1);
    handleQueueCommand(slash, 'explode');
    expect(host.showError).toHaveBeenCalled();
    expect(host.state.queuedMessages).toHaveLength(1);
  });
});
