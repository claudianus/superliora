/**
 * P2-8 — `notes` is append-only from a dozen call sites with no reader ever
 * pruning it, and JobInspect used to dump the whole record as JSON. The cap
 * lives at the single ledger write point, and inspect renders a diagnosis
 * view instead of the raw object.
 */

import { describe, expect, it } from 'vitest';

import { buildSubagentResultContract } from '../../src/session/subagent/subagent-result-contract';
import {
  createJob,
  getJob,
  patchJob,
  JOB_NOTES_MAX_CHARS,
  JOB_NOTES_MAX_LINES,
} from '../../src/tools/builtin/job/job-ledger';
import { renderJobInspect } from '../../src/tools/builtin/job/job-tools';
import type { ToolStore } from '../../src/tools/store';

function memoryStore(): ToolStore {
  const data: Record<string, unknown> = {};
  return {
    get(key) {
      return data[key] as never;
    },
    set(key, value) {
      data[key] = value;
    },
  };
}

/** The real growth pattern: read the current notes, append one line, write back. */
function appendNote(store: ToolStore, id: string, note: string): void {
  const current = getJob(store, id)?.notes;
  patchJob(store, id, { notes: [current, note].filter(Boolean).join('\n') });
}

describe('job notes cap', () => {
  it('keeps the newest lines and says how many it dropped', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'long-running' });
    for (let i = 0; i < 40; i += 1) appendNote(store, job.id, `worker: step ${i}`);

    const notes = getJob(store, job.id)?.notes ?? '';
    expect(notes).toContain('worker: step 39');
    expect(notes).not.toContain('worker: step 0\n');
    expect(notes).toMatch(/earlier note\(s\) trimmed/);
    expect(notes.split('\n')).toHaveLength(JOB_NOTES_MAX_LINES + 1);
  });

  it('caps a single oversized note by characters too', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'noisy worker' });
    patchJob(store, job.id, { notes: 'x'.repeat(JOB_NOTES_MAX_CHARS * 3) });
    expect((getJob(store, job.id)?.notes ?? '').length).toBeLessThanOrEqual(
      JOB_NOTES_MAX_CHARS,
    );
  });

  it('leaves short notes untouched', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'quick' });
    patchJob(store, job.id, { notes: 'worker: completed' });
    expect(getJob(store, job.id)?.notes).toBe('worker: completed');
  });

  it('pins implement_handoff, success criteria, SHA, and failure stderr across overflow', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'overflow pin' });
    const pinned = [
      'implement_handoff: success_criteria=["tests pass"] ownership_paths=["src/fix.ts"]',
      'success_criteria: tests=green typecheck=green',
      'sha=abcdef0123456789deadbeefcafebabe01234567',
      'stderr: fatal: Authentication failed for https://github.com/acme/repo.git',
    ];
    patchJob(store, job.id, {
      notes: [...pinned, ...Array.from({ length: 40 }, (_, i) => `worker: heartbeat ${i}`)].join('\n'),
    });

    const notes = getJob(store, job.id)?.notes ?? '';
    expect(notes).toContain('implement_handoff');
    expect(notes).toContain('success_criteria');
    expect(notes).toContain('sha=abcdef0123456789deadbeefcafebabe01234567');
    expect(notes).toMatch(/stderr:.*Authentication failed/);
    expect(notes).toContain('worker: heartbeat 39');
    expect(notes).toMatch(/earlier note\(s\) trimmed/);
  });
});

describe('renderJobInspect', () => {
  it('leads with the diagnosis facts instead of the raw record', () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'ship the fix',
      kind: 'implement',
      prompt: 'b'.repeat(5_000),
      ownershipPaths: ['src/fix.ts'],
    });
    const patched = patchJob(store, job.id, {
      status: 'blocked',
      worktreePath: '/tmp/wt/1',
      workerAgentId: 'agent_7',
      resultSummary: 'held on a trust gap',
      notes: 'worker: worktree_failed',
      resultContract: buildSubagentResultContract({
        agentId: 'agent_7',
        profile: 'coder',
        summary: 'held',
        filesChanged: ['src/fix.ts'],
        verification: { tests: 'passed', typecheck: 'not_run', lint: 'not_run' },
      }),
    });
    if (!patched) throw new Error('failed to patch job');

    const text = renderJobInspect(patched);
    expect(text).toContain('[blocked]');
    expect(text).toContain('worktree: /tmp/wt/1');
    expect(text).toContain('verification: tests=passed typecheck=not_run lint=not_run');
    expect(text).toContain('files_changed: src/fix.ts');
    expect(text).toContain('notes: \nworker: worktree_failed');
    expect(text).toContain('[truncated]');
    // The old JSON dump paid for the whole record on every diagnosis.
    expect(text.length).toBeLessThan(JSON.stringify(patched, null, 2).length / 2);
  });
});
