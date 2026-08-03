/**
 * Conductor input path guarantees.
 *
 * V3-3 — loading never drops submitted input. The editor clears its buffer
 * before the (IME double-deferred) submit lands in
 * `MessageDispatchController.handleUserInput`, so the old "loading busy"
 * rejection silently destroyed whatever the operator typed while the session
 * loading overlay was mounting. The rejection path is gone: while loading,
 * submitted text is handed back to the editor (draft persist picks it up),
 * and Enter re-submits once loading finishes. Pure replay viewing keeps the
 * busy error — there is no live session to submit to.
 *
 * V3-2 — queueing path characterization. Pins the current enqueue / drain /
 * steer behavior as a safety net before any queueing rework: busy prompts
 * queue (FIFO), bash commands queue with their mode, drains re-send through
 * the interactive agent, and steers either inject mid-turn or queue under
 * defer.
 */

import { describe, expect, it } from 'vitest';

import type { Session } from '@superliora/sdk';

import {
  MessageDispatchController,
  type MessageDispatchHost,
} from '#/tui/controllers/transcript/message-dispatch';
import { ttui } from '#/tui/utils/tui-i18n';

import { fakeDispatchHost, type FakeDispatchHost } from './control-tower-fakes';

function controllerFor(host: FakeDispatchHost): MessageDispatchController {
  return new MessageDispatchController(host as unknown as MessageDispatchHost);
}

describe('V3-3 — submitted input survives the session loading overlay', () => {
  it('hands the submitted text back to the editor instead of rejecting it', () => {
    const host = fakeDispatchHost({ loading: true });
    const dispatch = controllerFor(host);

    dispatch.handleUserInput('ship the release notes');

    // No rejection path: no busy error, nothing dropped, nothing sent yet.
    expect(host.showError).not.toHaveBeenCalled();
    expect(host.session.prompt).not.toHaveBeenCalled();
    expect(host.dispatchSlashInput).not.toHaveBeenCalled();
    // Input is preserved exactly where the operator will look for it.
    expect(host.editorText()).toBe('ship the release notes');
    expect(host.updateEditorBorderHighlight).toHaveBeenCalledWith('ship the release notes');
    expect(host.showStatus).toHaveBeenCalledWith(ttui('tui.sessionLoading.inputHeld'), 'info');
  });

  it('preserves bash mode for a `!` command submitted mid-load', () => {
    const host = fakeDispatchHost({ loading: true, inputMode: 'bash' });
    const dispatch = controllerFor(host);

    dispatch.handleUserInput('pnpm -C apps/liora run test');

    expect(host.showError).not.toHaveBeenCalled();
    expect(host.editorText()).toBe('pnpm -C apps/liora run test');
    // handleUserInput exits bash mode first; the hold path must restore it so
    // the re-submit after loading still runs as a shell command.
    expect(host.state.editor.inputMode).toBe('bash');
    expect(host.handleInputModeChange).toHaveBeenLastCalledWith('bash');
  });

  it('re-submits the preserved text normally once loading finishes', () => {
    const host = fakeDispatchHost({ loading: true });
    const dispatch = controllerFor(host);

    dispatch.handleUserInput('continue the migration');
    expect(host.dispatchSlashInput).not.toHaveBeenCalled();

    host.setLoading(false);
    dispatch.handleUserInput(host.editorText());

    expect(host.dispatchSlashInput).toHaveBeenCalledTimes(1);
    expect(host.dispatchSlashInput).toHaveBeenCalledWith('continue the migration');
  });

  it('keeps the busy rejection for pure replay viewing (no live session)', () => {
    const host = fakeDispatchHost({ replaying: true });
    const dispatch = controllerFor(host);

    dispatch.handleUserInput('should not land');

    expect(host.showError).toHaveBeenCalledWith(ttui('tui.sessionLoading.busy'));
    expect(host.dispatchSlashInput).not.toHaveBeenCalled();
    expect(host.editorText()).toBe('');
  });

  it('does not hold blank submissions', () => {
    const host = fakeDispatchHost({ loading: true });
    const dispatch = controllerFor(host);

    dispatch.handleUserInput('   ');

    expect(host.showStatus).not.toHaveBeenCalled();
    expect(host.showError).not.toHaveBeenCalled();
    expect(host.editorText()).toBe('');
  });
});

describe('V3-2 — queueing path characterization (pre-rework safety net)', () => {
  it('queues a prompt submitted while a turn is running', () => {
    const host = fakeDispatchHost({ streamingPhase: 'running' });
    const dispatch = controllerFor(host);

    dispatch.sendNormalUserInput('check the deploy logs');

    expect(host.session.prompt).not.toHaveBeenCalled();
    expect(host.state.queuedMessages).toHaveLength(1);
    expect(host.state.queuedMessages[0]).toMatchObject({
      text: 'check the deploy logs',
      agentId: 'main',
    });
    expect(host.track).toHaveBeenCalledWith('input_queue');
    expect(host.updateQueueDisplay).toHaveBeenCalledTimes(1);
  });

  it('sends an idle prompt straight to the session and records it for retry', () => {
    const host = fakeDispatchHost();
    const dispatch = controllerFor(host);

    dispatch.sendNormalUserInput('start the migration');

    expect(host.state.queuedMessages).toHaveLength(0);
    expect(host.beginSessionRequest).toHaveBeenCalledTimes(1);
    expect(host.session.prompt).toHaveBeenCalledWith('start the migration');
    expect(host.appendTranscriptEntry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'user', content: 'start the migration' }),
    );
    expect(host.lastUserInput).toBe('start the migration');
  });

  it('defers prompts into the queue even while idle when deferUserMessages is set', () => {
    const host = fakeDispatchHost({ deferUserMessages: true });
    const dispatch = controllerFor(host);

    dispatch.sendNormalUserInput('hold this for later');

    expect(host.session.prompt).not.toHaveBeenCalled();
    expect(host.state.queuedMessages.map((m) => m.text)).toEqual(['hold this for later']);
  });

  it('drains the queue FIFO via shift and pops the tail on recall', () => {
    const host = fakeDispatchHost({ streamingPhase: 'running' });
    const dispatch = controllerFor(host);

    dispatch.sendNormalUserInput('first');
    dispatch.sendNormalUserInput('second');
    dispatch.sendNormalUserInput('third');
    expect(host.state.queuedMessages).toHaveLength(3);

    expect(dispatch.shiftQueuedMessage()?.text).toBe('first');
    expect(dispatch.shiftQueuedMessage()?.text).toBe('second');
    expect(dispatch.recallLastQueued()?.text).toBe('third');
    expect(dispatch.shiftQueuedMessage()).toBeUndefined();
    expect(host.state.queuedMessages).toHaveLength(0);
  });

  it('queues bash commands while busy and runs them directly when idle', () => {
    const busy = fakeDispatchHost({ streamingPhase: 'running', inputMode: 'bash' });
    controllerFor(busy).handleUserInput('pnpm build');

    expect(busy.runShellCommandFromInput).not.toHaveBeenCalled();
    expect(busy.state.queuedMessages[0]).toMatchObject({ text: 'pnpm build', mode: 'bash' });
    // History stores the `!` prefix so ↑ recall restores bash mode.
    expect(busy.persistInputHistory).toHaveBeenCalledWith('!pnpm build');
    expect(busy.updateQueueDisplay).toHaveBeenCalled();

    const idle = fakeDispatchHost({ inputMode: 'bash' });
    controllerFor(idle).handleUserInput('ls -la');
    expect(idle.runShellCommandFromInput).toHaveBeenCalledWith('ls -la');
    expect(idle.state.queuedMessages).toHaveLength(0);
  });

  it('re-sends queued prompts through the interactive agent and shell items as commands', () => {
    const host = fakeDispatchHost();
    const dispatch = controllerFor(host);
    const session = host.session as unknown as Session;

    dispatch.sendQueuedMessage(session, { text: 'queued work' });
    expect(host.session.prompt).toHaveBeenCalledWith('queued work');

    dispatch.sendQueuedMessage(session, { text: 'pnpm test', mode: 'bash' });
    expect(host.runShellCommandFromInput).toHaveBeenCalledWith('pnpm test');
    expect(host.session.prompt).toHaveBeenCalledTimes(1);
  });

  it('steers mid-turn by appending to the transcript and calling session.steer once', () => {
    const host = fakeDispatchHost({ streamingPhase: 'running' });
    const dispatch = controllerFor(host);
    const session = host.session as unknown as Session;

    dispatch.steerMessage(session, ['slow down', 'skip the flaky suite']);

    expect(host.appendTranscriptEntry).toHaveBeenCalledTimes(2);
    expect(host.appendTranscriptEntry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'user', content: 'slow down' }),
    );
    expect(host.session.steer).toHaveBeenCalledWith('slow down\n\nskip the flaky suite');
    expect(host.state.queuedMessages).toHaveLength(0);
  });

  it('queues steers under defer and sends them as prompts when idle', () => {
    const deferred = fakeDispatchHost({ deferUserMessages: true, streamingPhase: 'running' });
    controllerFor(deferred).steerMessage(
      deferred.session as unknown as Session,
      ['hold this'],
    );
    expect(deferred.session.steer).not.toHaveBeenCalled();
    expect(deferred.state.queuedMessages.map((m) => m.text)).toEqual(['hold this']);

    const idle = fakeDispatchHost();
    controllerFor(idle).steerMessage(
      idle.session as unknown as Session,
      ['fresh start'],
    );
    expect(idle.session.prompt).toHaveBeenCalledWith('fresh start');
    expect(idle.session.steer).not.toHaveBeenCalled();
  });
});
