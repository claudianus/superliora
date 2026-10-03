import assert from 'node:assert/strict';

import { DaemonClient, resolveServerUrl } from '../src/index';
import { fetchWithReport } from '../src/report';

const SERVER_URL = resolveServerUrl();
const PROMPT_TIMEOUT_MS = 60_000;

interface Envelope<T> {
  code: number;
  msg?: string;
  data: T | null;
}

interface DebugState {
  model?: string;
  thinking?: string;
  permissionMode?: string;
}

interface DispatchEntry {
  kind: string;
  source: string;
  promptId: string;
}

async function readDebug<T>(sid: string, resource: string): Promise<T | null> {
  const url = `${SERVER_URL}/api/v1/debug/prompts/${encodeURIComponent(sid)}/${resource}`;
  const response = await fetchWithReport(url);
  if (response.status === 404) {
    throw new Error(`GET ${url} -> 404; launch the server with --debug-endpoints`);
  }
  const envelope = await response.json() as Envelope<T>;
  if (envelope.code !== 0) {
    throw new Error(`GET ${url} -> code=${envelope.code} msg=${envelope.msg ?? ''}`);
  }
  process.stdout.write(`${resource}: ${JSON.stringify(envelope.data)}\n`);
  return envelope.data;
}

async function readLog(sid: string): Promise<DispatchEntry[]> {
  const result = await readDebug<{ entries: DispatchEntry[] }>(sid, 'dispatch-log');
  assert.ok(result);
  return result.entries;
}

async function main(): Promise<void> {
  const client = new DaemonClient({ baseUrl: SERVER_URL });
  let sid: string | undefined;
  try {
    const session = await client.createSession({ metadata: { cwd: process.cwd() } });
    sid = session.id;
    await client.connect();
    await client.subscribe(sid);
    const content = [{ type: 'text' as const, text: 'Reply with the single word "OK".' }];
    const wait = { waitFor: 'prompt.completed' as const, timeoutMs: PROMPT_TIMEOUT_MS };

    await client.submitAndWait(sid, { content, permission_mode: 'manual' }, wait);
    assert.equal((await readDebug<DebugState>(sid, 'state'))?.permissionMode, 'manual');
    const baseline = await readLog(sid);

    await client.submitAndWait(sid, { content, permission_mode: 'yolo' }, wait);
    assert.equal((await readDebug<DebugState>(sid, 'state'))?.permissionMode, 'yolo');
    const changed = await readLog(sid);
    assert.deepEqual(changed.slice(baseline.length).map(({ kind, source }) => ({ kind, source })), [
      { kind: 'setPermission', source: 'prompt' },
    ]);

    await client.submitAndWait(sid, { content, permission_mode: 'yolo' }, wait);
    assert.equal((await readLog(sid)).length, changed.length);
    assert.equal((await readDebug<DebugState>(sid, 'state'))?.permissionMode, 'yolo');

    await client.updateSession(sid, { agent_config: { permission_mode: 'manual' } });
    assert.equal((await readDebug<DebugState>(sid, 'state'))?.permissionMode, 'manual');
    const updated = await readLog(sid);
    assert.deepEqual(updated.slice(changed.length).map(({ kind, source, promptId }) => ({ kind, source, promptId })), [
      { kind: 'setPermission', source: 'meta', promptId: '' },
    ]);

    await client.submitAndWaitStateful(sid, { content }, wait);
    assert.equal((await readLog(sid)).length, updated.length);
    assert.equal((await readDebug<DebugState>(sid, 'state'))?.permissionMode, 'manual');
    process.stdout.write('Native controls: changed prompt dispatch, redundant suppression, profile dispatch, stateful inheritance observed\n');
  } finally {
    try {
      if (sid !== undefined) await client.archiveSession(sid);
    } finally {
      await client.close();
    }
  }
}

main().catch((error: unknown) => {
  console.error('04-stateless-controls failed:', error);
  process.exitCode = 1;
});
