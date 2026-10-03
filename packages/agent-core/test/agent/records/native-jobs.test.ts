import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

import { LocalKaos } from '@superliora/kaos';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Agent } from '../../../src/agent';
import {
  AGENT_WIRE_PROTOCOL_VERSION,
  FileSystemAgentRecordPersistence,
  type AgentRecord,
} from '../../../src/agent/records';
import { getJob, readJobLedger } from '../../../src/tools/builtin/job/job-ledger';
import { listUnreadJobInbox, readJobInbox } from '../../../src/tools/builtin/job/job-inbox';
import { resolveConductorProjectMode } from '../../../src/tools/builtin/job/job-project-mode';
import type { JobLedger } from '../../../src/tools/builtin/job/job-store-key';
import type { JobInbox } from '../../../src/tools/builtin/job/job-inbox';

const tempDirs: string[] = [];
const agents: Agent[] = [];
afterEach(async () => {
  for (const agent of agents.splice(0)) {
    await agent.background.stopAll('test teardown');
    await agent.records.close();
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const ledger: JobLedger = {
  schemaVersion: 1,
  jobs: [{
    id: 'job_native', title: 'Preserve requested work', status: 'running', kind: 'task', priority: 7,
    createdAt: '2026-10-03T01:00:00.000Z', updatedAt: '2026-10-03T02:00:00.000Z',
    prompt: 'Keep the human-requested verification commands and success criteria.',
    successCriteria: ['Native inbox remains unread after resume'],
    verificationCommands: ['git diff --check'],
    notes: 'Operator requested a review before integration.',
    workerAgentId: 'worker_native', worktreeBranch: 'liora/native-fixture',
    worktreePath: '/example/worktrees/native', repoRoot: '/example/repo',
  }],
};
const inbox: JobInbox = {
  schemaVersion: 1,
  events: [{
    id: 'jinbox_native', kind: 'job.needs_user', jobId: 'job_native', status: 'needs_user',
    title: 'Choose integration destination', summary: 'Human approval is still pending.',
    createdAt: '2026-10-03T03:00:00.000Z', read: false,
  }],
};
const pool = { mode: 'review' } as const;
const userPrompt = {
  type: 'turn.prompt', time: 21,
  input: [{ type: 'text', text: 'Please retain my plan, notes, and explicit verification commands as data.' }],
  origin: { kind: 'user' },
} satisfies AgentRecord;
const humanMessage = {
  type: 'context.append_message', time: 22,
  message: { role: 'user', content: [{ type: 'text', text: 'My requested plan is ordinary historical conversation.' }], origin: { kind: 'user' } },
} satisfies AgentRecord;

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'liora-native-journal-'));
  tempDirs.push(dir);
  const kaos = await LocalKaos.create();
  const wire = join(dir, 'wire.jsonl');
  const createAgent = () => {
    const persistence = new FileSystemAgentRecordPersistence(wire);
    const agent = new Agent({ kaos, persistence });
    agents.push(agent);
    return agent;
  };
  return { dir, wire, kaos, createAgent };
}

async function readJournal(wire: string): Promise<AgentRecord[]> {
  const raw = await readFile(wire, 'utf8');
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as AgentRecord);
}

describe('native job journals', () => {
  it('roundtrips ledger, inbox, and pool independently through their actual consumers', async () => {
    const { wire, createAgent } = await fixture();
    const writer = createAgent();
    writer.tools.updateStore('job_ledger', ledger);
    writer.tools.updateStore('job_inbox', inbox);
    writer.tools.updateStore('job_project_mode', pool);
    await writer.records.close();

    const saved = await readJournal(wire);
    expect(saved.filter((record) => record.type === 'job.ledger')).toEqual([
      expect.objectContaining({ type: 'job.ledger', ledger }),
    ]);
    expect(saved.filter((record) => record.type === 'job.inbox')).toEqual([
      expect.objectContaining({ type: 'job.inbox', inbox }),
    ]);
    expect(saved.filter((record) => record.type === 'job.pool')).toEqual([
      expect.objectContaining({ type: 'job.pool', pool }),
    ]);
    const reader = createAgent();
    await reader.records.replay();
    const store = reader.tools.getStore();
    expect(readJobLedger(store)).toEqual(ledger);
    expect(getJob(store, 'job_native')).toEqual(ledger.jobs[0]);
    expect(readJobInbox(store)).toEqual(inbox);
    expect(listUnreadJobInbox(store)).toEqual(inbox.events);
    expect(resolveConductorProjectMode(store)).toBe('review');
    expect(await readJournal(wire)).toEqual(saved);
  });

  it('flushes the latest coalesced ledger before graceful journal close', async () => {
    const { wire, createAgent } = await fixture();
    const writer = createAgent();
    writer.tools.updateStore('job_ledger', { ...ledger, jobs: [] });
    writer.tools.updateStore('job_ledger', ledger);
    const latest = { ...ledger, jobs: ledger.jobs.map((job) => ({ ...job, status: 'needs_user' as const, notes: 'Latest operator request.' })) };
    writer.tools.updateStore('job_ledger', latest);
    // Close immediately, without advancing the coalescing timer or flushing
    // the tool manager manually: a graceful close owns that responsibility.
    await writer.records.close();
    const saved = await readJournal(wire);
    expect(saved.filter((record) => record.type === 'job.ledger')).toEqual([
      expect.objectContaining({ type: 'job.ledger', ledger: latest }),
    ]);
    const resumed = createAgent();
    await resumed.records.replay();
    expect(getJob(resumed.tools.getStore(), 'job_native')).toEqual(latest.jobs[0]);
  });

  it('restores persisted native work and historical Bash calls without executing external work', async () => {
    const { wire, kaos } = await fixture();
    const historicalBash: AgentRecord = {
      type: 'context.append_message', time: 23,
      message: { role: 'assistant', content: [], toolCalls: [{ type: 'function', id: 'historical_bash', name: 'Bash', arguments: '{"command":"touch replay-must-not-run"}' }] },
    };
    const saved: AgentRecord[] = [
      { type: 'metadata', protocol_version: AGENT_WIRE_PROTOCOL_VERSION, created_at: 1 },
      userPrompt, humanMessage, historicalBash,
      { type: 'job.ledger', time: 30, ledger },
      { type: 'job.inbox', time: 31, inbox },
      { type: 'job.pool', time: 32, pool },
    ];
    const bytes = saved.map((record) => JSON.stringify(record)).join('\n') + '\n';
    await writeFile(wire, bytes);
    const exec = vi.spyOn(kaos, 'exec');
    const execWithEnv = vi.spyOn(kaos, 'execWithEnv');
    const writeText = vi.spyOn(kaos, 'writeText');
    const generate = vi.fn(async () => { throw new Error('Replay must not invoke the model.'); });
    const emitEvent = vi.fn(async () => {});
    const agent = new Agent({ kaos, persistence: new FileSystemAgentRecordPersistence(wire), generate, rpc: { emitEvent } });
    agents.push(agent);
    await agent.records.replay();
    expect(exec).not.toHaveBeenCalled();
    expect(execWithEnv).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
    expect(agent.background.list(true)).toEqual([]);
    expect(getJob(agent.tools.getStore(), 'job_native')?.status).toBe('running');
    expect(listUnreadJobInbox(agent.tools.getStore())).toEqual(inbox.events);
    expect(resolveConductorProjectMode(agent.tools.getStore())).toBe('review');
    expect(agent.context.history).toContainEqual(humanMessage.message);
    expect(agent.context.history).toContainEqual(historicalBash.message);
    expect(await readFile(wire, 'utf8')).toBe(bytes);
  });

  it.each(['plain', 'gzip'] as const)('migrates native legacy keys while archiving the complete original %s journal', async (encoding) => {
    const { dir, wire, createAgent } = await fixture();
    const legacyLedger = {
      ...ledger,
      jobs: ledger.jobs.map((job) => ({ ...job, gateChecklist: { ready: false }, verifyVerdict: 'blocked', debugFixer: { count: 1 }, deliveryPhase: 'gate', track: 'premium', premium: true })),
    };
    const legacy = [
      { type: 'metadata', protocol_version: '1.3', created_at: 1 },
      userPrompt, humanMessage,
      { type: 'tools.update_store', time: 30, key: 'job_ledger', value: legacyLedger },
      { type: 'tools.update_store', time: 31, key: 'job_inbox', value: inbox },
      { type: 'tools.update_store', time: 32, key: 'job_project_mode', value: pool },
      { type: 'tools.update_store', time: 33, key: 'plan', value: { text: 'retired cognitive state' } },
      { type: 'tools.update_store', time: 34, key: 'mental_model', value: { text: 'retired private reasoning' } },
      { type: 'plan.update', time: 35, plan: 'retired automatic planner state' },
      { type: 'turn.prompt', time: 36, input: [{ type: 'text', text: 'retired automatic reminder' }], origin: { kind: 'injection' } },
      { type: 'turn.prompt', time: 37, input: [{ type: 'text', text: 'Explicitly requested historical slash input.' }], origin: { kind: 'skill_activation', trigger: 'user-slash' } },
    ];
    const plain = Buffer.from(legacy.map((record) => JSON.stringify(record)).join('\n') + '\n');
    const source = encoding === 'gzip' ? gzipSync(plain) : plain;
    await writeFile(encoding === 'gzip' ? `${wire}.gz` : wire, source);
    const agent = createAgent();
    await agent.records.replay();
    expect(readJobLedger(agent.tools.getStore())).toEqual(ledger);
    expect(readJobInbox(agent.tools.getStore())).toEqual(inbox);
    expect(resolveConductorProjectMode(agent.tools.getStore())).toBe('review');
    const saved = await readJournal(wire);
    expect(saved).toEqual([
      { type: 'metadata', protocol_version: AGENT_WIRE_PROTOCOL_VERSION, created_at: 1 },
      userPrompt, humanMessage,
      { type: 'job.ledger', time: 30, ledger },
      { type: 'job.inbox', time: 31, inbox },
      { type: 'job.pool', time: 32, pool },
      { type: 'turn.prompt', time: 37, input: [{ type: 'text', text: 'Explicitly requested historical slash input.' }], origin: { kind: 'user' } },
    ]);
    expect(agent.context.history).toContainEqual(humanMessage.message);
    const entries = await readdir(dir);
    const archives = entries.filter((entry) => entry.startsWith('wire.jsonl.pre-native.'));
    expect(archives).toHaveLength(1);
    const archived = await readFile(join(dir, archives[0]!));
    expect(archived).toEqual(source);
    expect(encoding === 'gzip' ? gunzipSync(archived) : archived).toEqual(plain);
    expect(entries).not.toContain('wire.jsonl.gz');
    const resumed = createAgent();
    await resumed.records.replay();
    expect(readJobLedger(resumed.tools.getStore())).toEqual(ledger);
    expect(listUnreadJobInbox(resumed.tools.getStore())).toEqual(inbox.events);
    expect(resolveConductorProjectMode(resumed.tools.getStore())).toBe('review');
    expect(await readdir(dir)).toEqual(entries);
  });
});
