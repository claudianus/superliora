import type { Session } from '@superliora/sdk';
import { describe, expect, it, vi } from 'vitest';

import { MessageDispatchController, type MessageDispatchHost } from '#/tui/controllers/transcript/message-dispatch';
import { fakeDispatchHost } from './control-tower-fakes';

function controller(host: ReturnType<typeof fakeDispatchHost>) {
  return new MessageDispatchController(host as unknown as MessageDispatchHost);
}

const neverSettles = (_input: unknown) => new Promise<void>(() => {});

describe('interactive conductor user priority', () => {
  it.each(['running', 'waiting'] as const)('submits immediately while %s without waiting for outstanding admission or worker work', (streamingPhase) => {
    const host = fakeDispatchHost({ sessionRole: 'interactive-conductor', streamingPhase });
    // The prior admission/turn never acknowledges. A follow-up must still
    // reach prompt synchronously, not a steer buffer or the idle queue drain.
    host.session.prompt = vi.fn(neverSettles);
    const dispatch = controller(host);
    dispatch.sendMessageInternal(host.session as unknown as Session, 'start independent work');
    dispatch.sendNormalUserInput('answer me now');
    dispatch.sendNormalUserInput('and this follow-up');

    expect(host.session.prompt.mock.calls.map(([text]) => text)).toEqual([
      'start independent work', 'answer me now', 'and this follow-up',
    ]);
    expect(host.session.steer).not.toHaveBeenCalled();
    expect(host.session.cancel).not.toHaveBeenCalled();
    expect(host.state.queuedMessages).toHaveLength(0);
    expect(host.lastUserInput).toBe('and this follow-up');
    expect(host.appendTranscriptEntry).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'user', content: 'and this follow-up', turnId: undefined,
    }));
  });

  it('routes an explicit queued follow-up through prompt, retaining structured media', () => {
    const host = fakeDispatchHost({ sessionRole: 'interactive-conductor', streamingPhase: 'running' });
    const parts = [{ type: 'text' as const, text: 'inspect this' }, {
      type: 'image_url' as const, imageUrl: { url: 'data:image/png;base64,AQ==' },
    }];
    controller(host).steerMessage(host.session as unknown as Session, ['inspect this'], {
      parts, imageAttachmentIds: [1],
    });
    expect(host.session.prompt).toHaveBeenCalledWith(parts);
    expect(host.session.steer).not.toHaveBeenCalled();
    expect(host.session.cancel).not.toHaveBeenCalled();
    expect(host.appendTranscriptEntry).toHaveBeenCalledWith(expect.objectContaining({
      content: 'inspect this', imageAttachmentIds: [1], turnId: undefined,
    }));
  });

  it('retains rejected input for retry without cancelling accepted work', async () => {
    const host = fakeDispatchHost({ sessionRole: 'interactive-conductor', streamingPhase: 'running' });
    host.session.prompt.mockRejectedValueOnce(new Error('admission unavailable'));
    controller(host).sendNormalUserInput('retain this');
    await Promise.resolve();
    expect(host.state.queuedMessages).toEqual([expect.objectContaining({ text: 'retain this' })]);
    expect(host.failSessionRequest).toHaveBeenCalledWith('Failed to send: admission unavailable');
    expect(host.session.cancel).not.toHaveBeenCalled();
  });

  it('does not let an older rejection reset the live state of a newer prompt', async () => {
    const host = fakeDispatchHost({ sessionRole: 'interactive-conductor', streamingPhase: 'running' });
    let rejectOlder: (error: Error) => void = () => {};
    host.session.prompt
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOlder = reject; }))
      .mockImplementationOnce(neverSettles);
    const dispatch = controller(host);
    dispatch.sendNormalUserInput('older');
    dispatch.sendNormalUserInput('newer');
    rejectOlder(new Error('admission unavailable'));
    await Promise.resolve();
    await Promise.resolve();
    expect(host.failSessionRequest).not.toHaveBeenCalled();
    expect(host.showError).toHaveBeenCalledWith('Failed to send: admission unavailable');
    expect(host.state.queuedMessages.map((item) => item.text)).toEqual(['older']);
  });

  it.each([
    { deferUserMessages: true, streamingPhase: 'running' as const },
    { streamingPhase: 'shell' as const },
  ])('preserves explicit deferral and foreground shell ownership (%j)', (options) => {
    const host = fakeDispatchHost({ sessionRole: 'interactive-conductor', ...options });
    controller(host).sendNormalUserInput('hold this');
    expect(host.session.prompt).not.toHaveBeenCalled();
    expect(host.state.queuedMessages.map((item) => item.text)).toEqual(['hold this']);
  });

  it('preserves the compaction hold', () => {
    const host = fakeDispatchHost({ sessionRole: 'interactive-conductor', streamingPhase: 'running' });
    host.state.appState.isCompacting = true;
    controller(host).sendNormalUserInput('after compaction');
    expect(host.session.prompt).not.toHaveBeenCalled();
    expect(host.state.queuedMessages.map((item) => item.text)).toEqual(['after compaction']);
  });

  it.each([
    {},
    { sessionRole: 'worker' as const },
    { sessionRole: 'interactive-conductor' as const, interactiveAgentId: 'agent-2' },
  ])('keeps worker/default foreground behavior (%j)', (options) => {
    const host = fakeDispatchHost({ streamingPhase: 'running', ...options });
    const dispatch = controller(host);
    dispatch.sendNormalUserInput('worker follow-up');
    expect(host.session.prompt).not.toHaveBeenCalled();
    expect(host.state.queuedMessages.map((item) => item.text)).toEqual(['worker follow-up']);
    dispatch.steerMessage(host.session as unknown as Session, ['worker steer']);
    expect(host.session.steer).toHaveBeenCalledWith('worker steer');
    expect(host.session.cancel).not.toHaveBeenCalled();
  });
});
