import assert from 'node:assert/strict';

import { DaemonClient, EnvelopeError, resolveServerUrl } from '../src/index';

const client = new DaemonClient({ baseUrl: resolveServerUrl() });
const PROMPT_TIMEOUT_MS = 120_000;
let sid: string | undefined;

async function main(): Promise<void> {
  try {
    const session = await client.createSession({ metadata: { cwd: process.cwd(), scenario: 'send-and-cancel' } });
    sid = session.id;
    process.stdout.write(`created session: ${JSON.stringify(session)}\n`);
    await client.connect();
    await client.subscribe(sid);
    const active = await client.submitPrompt(sid, {
      permission_mode: 'yolo',
      content: [{ type: 'text', text: 'Use Bash now to execute `sleep 60; printf "finished\\n"` in the foreground. Do not background it. Wait for the command before answering.' }],
    });
    process.stdout.write(`submitted: ${JSON.stringify(active)}\n`);
    const call = await client.waitForFrame((frame) => {
      if (frame.type !== 'tool.call') return false;
      const payload = frame.payload;
      return payload !== null && typeof payload === 'object' && 'name' in payload && payload.name === 'Bash';
    }, { timeoutMs: PROMPT_TIMEOUT_MS });
    process.stdout.write(`native Bash call: ${JSON.stringify(call)}\n`);

    const queued = await client.submitPromptStateful(sid, {
      content: [{ type: 'text', text: 'Reply with "QUEUED".' }],
    });
    process.stdout.write(`queued: ${JSON.stringify(queued)}\n`);
    assert.equal(queued.status, 'queued');
    const queuedTerminal = client.waitForFrame((frame) => {
      const payload = frame.payload;
      return frame.type === 'prompt.aborted' && payload !== null && typeof payload === 'object' &&
        'promptId' in payload && payload.promptId === queued.prompt_id;
    }, { timeoutMs: 30_000 });
    process.stdout.write(`queued cancel ack: ${JSON.stringify(await client.abortPrompt(sid, queued.prompt_id))}\n`);
    process.stdout.write(`queued terminal: ${JSON.stringify(await queuedTerminal)}\n`);
    assert.equal((await client.listPrompts(sid)).active?.prompt_id, active.prompt_id);

    const settled = client.waitForFrame((frame) => {
      const payload = frame.payload;
      return frame.type === 'prompt.aborted' && payload !== null && typeof payload === 'object' &&
        'promptId' in payload && payload.promptId === active.prompt_id;
    }, { timeoutMs: 30_000 });
    const acknowledgement = await client.abortSession(sid);
    process.stdout.write(`session cancel ack: ${JSON.stringify(acknowledgement)}\n`);
    assert.equal(acknowledgement.aborted, true);
    process.stdout.write(`native settlement: ${JSON.stringify(await settled)}\n`);
    const after = await client.listPrompts(sid);
    process.stdout.write(`prompts after settlement: ${JSON.stringify(after)}\n`);
    assert.equal(after.active, null);
    assert.deepEqual(after.queued, []);

    let repeated: unknown;
    try {
      await client.abortPrompt(sid, active.prompt_id);
    } catch (error) {
      repeated = error;
    }
    assert.ok(repeated instanceof EnvelopeError);
    assert.equal(repeated.code, 40903);
    assert.deepEqual(repeated.data, { aborted: false });
    process.stdout.write(`repeated cancel: ${JSON.stringify({ code: repeated.code, data: repeated.data })}\n`);

    const result = await client.submitAndWaitStateful(sid, {
      content: [{ type: 'text', text: 'Reply with the single word "RECOVERED".' }],
    }, { waitFor: 'prompt.completed', timeoutMs: PROMPT_TIMEOUT_MS });
    process.stdout.write(`new prompt completed: ${JSON.stringify(result)}\n`);
    assert.equal(result.finalFrame.type, 'prompt.completed');
  } finally {
    try {
      if (sid !== undefined) {
        await client.abortSession(sid);
        await client.archiveSession(sid);
      }
    } finally {
      await client.close();
    }
  }
}

main().catch((error: unknown) => {
  console.error('12-send-and-cancel failed:', error);
  process.exitCode = 1;
});
