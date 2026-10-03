import { afterEach, describe, expect, it } from 'vitest';

import { DaemonClient, EnvelopeError, resolveServerUrl } from '../src/index.js';
import { fetchWithReport } from '../src/report.js';
import { createCaseLogger, errorForLog, type CaseLogger } from './log.js';

const BASE_URL = resolveServerUrl();
const PROMPT_TIMEOUT_MS = 120_000;
const SETTLEMENT_TIMEOUT_MS = 30_000;

async function daemonReachable(): Promise<boolean> {
  try {
    const response = await fetchWithReport(`${BASE_URL}/api/v1/meta`, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

const describeLive = await daemonReachable() ? describe : describe.skip;
const sessions: Array<{ client: DaemonClient; sid: string }> = [];

afterEach(async () => {
  for (const { client, sid } of sessions.splice(0)) {
    try {
      await client.abortSession(sid);
      await client.archiveSession(sid);
    } finally {
      await client.close();
    }
  }
});
async function openSession(log: CaseLogger): Promise<{ client: DaemonClient; sid: string }> {
  const client = new DaemonClient({ baseUrl: BASE_URL });
  const session = await client.createSession({ metadata: { cwd: process.cwd(), scenario: 'send-and-cancel' } });
  const state = { client, sid: session.id };
  sessions.push(state);
  log('created session', session);
  await client.connect();
  await client.subscribe(session.id);
  log('subscribed', { session_id: session.id });
  return state;
}

async function startLongBash(client: DaemonClient, sid: string, log: CaseLogger) {
  const active = await client.submitPrompt(sid, {
    permission_mode: 'yolo',
    content: [{ type: 'text', text: 'Use Bash now to execute `sleep 60; printf "finished\\n"` in the foreground. Do not background it. Wait for the command before answering.' }],
  });
  log('submitted foreground Bash prompt', active);
  const call = await client.waitForFrame((frame) => {
    if (frame.type !== 'tool.call') return false;
    const payload = frame.payload;
    return payload !== null && typeof payload === 'object' && 'name' in payload && payload.name === 'Bash';
  }, { timeoutMs: PROMPT_TIMEOUT_MS });
  log('native Bash call', call);
  return active;
}


describeLive('native prompt cancellation settlement', () => {
  it('submits a real prompt and receives completion', async () => {
    const log = createCaseLogger('send: actual completion');
    const { client, sid } = await openSession(log);
    const result = await client.submitAndWait(sid, {
      content: [{ type: 'text', text: 'Reply with the single word "OK".' }],
    }, { waitFor: 'prompt.completed', timeoutMs: PROMPT_TIMEOUT_MS });
    log('completed prompt', result);
    expect(result.finalFrame.type).toBe('prompt.completed');
  }, PROMPT_TIMEOUT_MS);

  it('cancels queued work, settles actual Bash, preserves repeated abort semantics, and accepts new work', async () => {
    const log = createCaseLogger('cancel: real Bash settlement');
    const { client, sid } = await openSession(log);
    const active = await startLongBash(client, sid, log);
    const queued = await client.submitPromptStateful(sid, {
      content: [{ type: 'text', text: 'Reply with "QUEUED".' }],
    });
    log('queued prompt', queued);
    expect(queued.status).toBe('queued');
    const queuedTerminal = client.waitForFrame((frame) => {
      const payload = frame.payload;
      return frame.type === 'prompt.aborted' && payload !== null && typeof payload === 'object' &&
        'promptId' in payload && payload.promptId === queued.prompt_id;
    }, { timeoutMs: SETTLEMENT_TIMEOUT_MS });
    log('queued cancel acknowledgement', await client.abortPrompt(sid, queued.prompt_id));
    log('queued cancellation terminal', await queuedTerminal);
    const before = await client.listPrompts(sid);
    log('prompts after queued cancellation', before);
    expect(before.active?.prompt_id).toBe(active.prompt_id);
    expect(before.queued).toEqual([]);

    const settled = client.waitForFrame((frame) => {
      const payload = frame.payload;
      return frame.type === 'prompt.aborted' && payload !== null && typeof payload === 'object' &&
        'promptId' in payload && payload.promptId === active.prompt_id;
    }, { timeoutMs: SETTLEMENT_TIMEOUT_MS });
    const acknowledgement = await client.abortSession(sid);
    log('session cancellation acknowledgement', acknowledgement);
    expect(acknowledgement.aborted).toBe(true);
    const terminal = await settled;
    log('actual terminal cancellation', terminal);
    expect(terminal.type).toBe('prompt.aborted');
    const after = await client.listPrompts(sid);
    log('prompts after settlement', after);
    expect(after.active).toBeNull();

    let repeated: unknown;
    try {
      await client.abortPrompt(sid, active.prompt_id);
    } catch (error) {
      repeated = error;
    }
    log('repeated cancellation result', errorForLog(repeated));
    expect(repeated).toBeInstanceOf(EnvelopeError);
    if (!(repeated instanceof EnvelopeError)) throw new Error('Expected a cancellation error envelope');
    expect(repeated.code).toBe(40903);
    expect(repeated.data).toEqual({ aborted: false });

    const recovered = await client.submitAndWaitStateful(sid, {
      content: [{ type: 'text', text: 'Reply with the single word "RECOVERED".' }],
    }, { waitFor: 'prompt.completed', timeoutMs: PROMPT_TIMEOUT_MS });
    log('new prompt after settlement', recovered);
    expect(recovered.finalFrame.type).toBe('prompt.completed');
  }, PROMPT_TIMEOUT_MS * 2 + SETTLEMENT_TIMEOUT_MS);
});
