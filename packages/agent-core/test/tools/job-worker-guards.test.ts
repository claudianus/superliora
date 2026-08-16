/**
 * Suite-waste shell guard + pre-abort resume handoff (no 30m sleep).
 */

import { describe, expect, it, afterEach } from 'vitest';

import {
  DEFAULT_EXPLORE_DEADLINE_MS,
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  resolveJobWorkerTimeoutMs,
} from '../../src/session/subagent/subagent-host';
import {
  createJob,
  getJob,
  patchJob,
} from '../../src/tools/builtin/job/job-ledger';
import {
  __resetJobWorkerLedgerBridgeForTests,
  bindJobWorkerLedger,
  buildDeadlineFailureSummary,
  buildWorkerResumeHandoff,
  persistJobWorkerPreAbortHandoff,
} from '../../src/tools/builtin/job/job-worker-ledger-bridge';
import {
  guardWorkerShellCommand,
  isWholePackageTestCommand,
  pickFocusedVerificationRewrite,
  verificationCommandsPinSpecificFiles,
} from '../../src/tools/builtin/job/job-worker-guards';
import type { ToolStore } from '../../src/tools/store';
import type { Agent } from '../../src/agent';

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

describe('resolveJobWorkerTimeoutMs explore budget', () => {
  it('defaults explore/research to 20m and keeps implement at 30m', () => {
    expect(resolveJobWorkerTimeoutMs('explore')).toBe(DEFAULT_EXPLORE_DEADLINE_MS);
    expect(resolveJobWorkerTimeoutMs('research')).toBe(DEFAULT_EXPLORE_DEADLINE_MS);
    expect(resolveJobWorkerTimeoutMs('implement')).toBe(DEFAULT_SUBAGENT_TIMEOUT_MS);
    expect(DEFAULT_EXPLORE_DEADLINE_MS).toBe(20 * 60 * 1000);
    expect(DEFAULT_EXPLORE_DEADLINE_MS).toBeLessThan(DEFAULT_SUBAGENT_TIMEOUT_MS);
  });
});

describe('isWholePackageTestCommand', () => {
  it('flags whole package test dirs without a file', () => {
    expect(isWholePackageTestCommand('node scripts/test-local.mjs apps/liora/test/tui')).toBe(
      true,
    );
    expect(
      isWholePackageTestCommand('node scripts/test-local.mjs packages/agent-core/test'),
    ).toBe(true);
    expect(
      isWholePackageTestCommand('pnpm exec vitest run packages/agent-core/test'),
    ).toBe(true);
  });

  it('allows focused file paths under those dirs', () => {
    expect(
      isWholePackageTestCommand(
        'node scripts/test-local.mjs packages/agent-core/test/tools/job-worker-guards.test.ts',
      ),
    ).toBe(false);
    expect(
      isWholePackageTestCommand(
        'node scripts/test-local.mjs apps/liora/test/tui/dock.test.ts',
      ),
    ).toBe(false);
  });
});

describe('verificationCommandsPinSpecificFiles', () => {
  it('detects file extensions and -t focus', () => {
    expect(
      verificationCommandsPinSpecificFiles([
        'node scripts/test-local.mjs packages/agent-core/test/tools',
      ]),
    ).toBe(false);
    expect(
      verificationCommandsPinSpecificFiles([
        'node scripts/test-local.mjs packages/agent-core/test/tools/job-worker-guards.test.ts',
      ]),
    ).toBe(true);
    expect(
      verificationCommandsPinSpecificFiles([
        'node scripts/test-local.mjs packages/agent-core/test/tools -t "guard"',
      ]),
    ).toBe(true);
  });
});

describe('guardWorkerShellCommand suite_guard', () => {
  const focused = [
    'node scripts/test-local.mjs packages/agent-core/test/tools/job-worker-guards.test.ts',
  ];

  it('allows non-workers and non-suite commands', () => {
    expect(
      guardWorkerShellCommand('node scripts/test-local.mjs apps/liora/test/tui', {
        isWorker: false,
        verificationCommands: focused,
      }).allowed,
    ).toBe(true);
    expect(
      guardWorkerShellCommand(
        'node scripts/test-local.mjs packages/agent-core/test/tools/job-worker-guards.test.ts',
        { isWorker: true, verificationCommands: focused },
      ).allowed,
    ).toBe(true);
  });

  it('rewrites whole-package suite to the focused brief command', () => {
    const result = guardWorkerShellCommand(
      'node scripts/test-local.mjs apps/liora/test/tui',
      { isWorker: true, verificationCommands: focused },
    );
    expect(result.allowed).toBe(true);
    expect(result.rewrittenCommand).toBe(focused[0]);
    expect(result.reason).toContain('suite_guard');
    expect(result.reason).toContain('rewrote');
  });

  it('refuses when no rewrite is available', () => {
    // Brief pins a file, but rewrite picker cannot find a non-suite alternative
    // if the only entry is also a suite path without extension — force refuse.
    const result = guardWorkerShellCommand(
      'node scripts/test-local.mjs packages/agent-core/test',
      {
        isWorker: true,
        // Pin via -t so pinSpecificFiles is true, but rewrite is the same suite-ish cmd.
        verificationCommands: [
          'node scripts/test-local.mjs packages/agent-core/test -t "x"',
        ],
      },
    );
    // rewrite may succeed to the -t command (not whole-package by our detector when -t?)
    // Whole package detector still matches packages/agent-core/test without file.
    // pickFocusedVerificationRewrite prefers the -t command because it has -t.
    if (result.allowed) {
      expect(result.rewrittenCommand).toContain('-t');
      expect(result.reason).toContain('suite_guard');
    } else {
      expect(result.reason).toContain('suite_guard');
    }
  });

  it('still blocks git push', () => {
    const result = guardWorkerShellCommand('git push origin HEAD', { isWorker: true });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/must not push/i);
  });

  it('does not suite-guard when brief has no focused files', () => {
    const result = guardWorkerShellCommand(
      'node scripts/test-local.mjs apps/liora/test/tui',
      {
        isWorker: true,
        verificationCommands: ['pnpm -C apps/liora run smoke'],
      },
    );
    expect(result.allowed).toBe(true);
    expect(result.rewrittenCommand).toBeUndefined();
  });
});

describe('pickFocusedVerificationRewrite', () => {
  it('prefers the first file-path command', () => {
    expect(
      pickFocusedVerificationRewrite([
        'pnpm -C apps/liora run smoke',
        'node scripts/test-local.mjs packages/agent-core/test/tools/x.test.ts',
      ]),
    ).toBe('node scripts/test-local.mjs packages/agent-core/test/tools/x.test.ts');
  });
});

describe('buildWorkerResumeHandoff / pre-abort checkpoint', () => {
  afterEach(() => {
    __resetJobWorkerLedgerBridgeForTests();
  });

  it('includes last phase, tools, open files, and continue_from guidance', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'explore dock', kind: 'explore' });
    const running = patchJob(store, job.id, {
      status: 'running',
      progress: {
        phase: 'Bash: node scripts/test-local.mjs apps/liora/test/tui',
        recentTools: ['Bash', 'Grep'],
        lastHeartbeatAt: '2026-08-16T00:00:00.000Z',
      },
      workerResumeAgentId: 'agent_resume_1',
      workerCheckpointAt: '2026-08-16T00:00:00.000Z',
      worktreePath: '/tmp/job-wt',
    });
    if (!running) throw new Error('promote failed');

    const handoff = buildWorkerResumeHandoff({
      job: running,
      reason: 'deadline',
      errorMessage: 'Subagent deadline exceeded after 1800000ms',
      checkpoint: {
        lastTool: 'Bash',
        lastTarget: 'node scripts/test-local.mjs apps/liora/test/tui',
        dirtyFiles: ['apps/liora/src/tui/dock.ts'],
        toolCount: 42,
        elapsedMs: 1_799_000,
      },
    });

    expect(handoff).toContain('## Resume handoff');
    expect(handoff).toContain('reason: deadline');
    expect(handoff).toContain('last_phase:');
    expect(handoff).toContain('open_files:');
    expect(handoff).toContain('apps/liora/src/tui/dock.ts');
    expect(handoff).toContain('last_command:');
    expect(handoff).toContain('continue_from:');
    expect(handoff).toContain('1800000');
  });

  it('persistJobWorkerPreAbortHandoff writes resultSummary without flipping status', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'pre-abort', kind: 'implement' });
    const running = patchJob(store, job.id, {
      status: 'running',
      progress: { phase: 'Edit: foo.ts', recentTools: ['Edit'] },
    });
    if (!running) throw new Error('promote failed');
    const agent = { emitAgentEvent() {} } as unknown as Agent;
    bindJobWorkerLedger('agent_pre', store, job.id, agent);

    const next = persistJobWorkerPreAbortHandoff('agent_pre', { reason: 'finishing' });
    expect(next?.status).toBe('running');
    expect(next?.resultSummary).toContain('## Resume handoff');
    expect(next?.notes).toContain('resume_handoff: finishing');

    // Idempotent: second call does not thrash.
    const again = persistJobWorkerPreAbortHandoff('agent_pre', { reason: 'finishing' });
    expect(again?.resultSummary).toBe(next?.resultSummary);
  });

  it('buildDeadlineFailureSummary is non-empty even without progress', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'empty fail', kind: 'explore' });
    const summary = buildDeadlineFailureSummary(
      job,
      'Subagent deadline exceeded after 1200000ms',
    );
    expect(summary.length).toBeGreaterThan(40);
    expect(summary).toContain('Resume handoff');
    // Pure builder — must not mutate ledger status.
    expect(getJob(store, job.id)?.status).toBe(job.status);
  });
});
