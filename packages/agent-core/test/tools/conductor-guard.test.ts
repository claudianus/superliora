import { describe, expect, it } from 'vitest';

import {
  CONDUCTOR_BUDGET_TRIP_TURN_STOP,
  CONDUCTOR_DIRECT_WORK_REJECTION_PHRASE,
  CONDUCTOR_EXPLORE_HARD_REJECTION_PHRASE,
  CONDUCTOR_EXPLORE_SOFT_REJECTION_PHRASE,
  CONDUCTOR_GUARD_CODES,
  CONDUCTOR_INTERACTIVE_EXPLORE_HARD,
  CONDUCTOR_INTERACTIVE_EXPLORE_SOFT,
  CONDUCTOR_TURN_STOP_PHRASE,
  CONDUCTOR_TURN_STOP_VIOLATIONS,
  CONDUCTOR_WORKER_WAIT_REJECTION_PHRASE,
  ConductorDirectWorkGuard,
  formatConductorJobDraftRecordedAck,
} from '../../src/agent/conductor-guard';
import type { ConductorJobDraftRecord } from '../../src/agent/conductor-guard';
import { ToolAccesses } from '../../src/loop/tool-access';

/**
 * Conductor delegation guard — contract tests (meta-orchestrator v2,
 * §2.2 b-2 rejection + §3.2 G3 tripwire, V1 gate).
 */
describe('ConductorDirectWorkGuard', () => {
  describe('stage 1 — direct-work rejection (V1)', () => {
    it.each(['Write', 'Edit', 'ApplyPatch'])(
      'rejects %s with the routing phrase and a Job draft',
      (toolName) => {
        const guard = new ConductorDirectWorkGuard();
        const verdict = guard.evaluateToolCall({
          toolName,
          args: { file_path: '/repo/src/auth.ts' },
          turnId: 'turn-1',
          stepNumber: 2,
        });

        expect(verdict.allowed).toBe(false);
        if (verdict.allowed) return;
        expect(verdict.code).toBe(CONDUCTOR_GUARD_CODES.directWorkBlocked);
        expect(verdict.output).toContain(CONDUCTOR_DIRECT_WORK_REJECTION_PHRASE);
        expect(verdict.output).toContain('Suggested Job draft');
        expect(verdict.output).toContain('/repo/src/auth.ts');
        expect(verdict.output).toContain('JobCreate');
        expect(verdict.jobDraft?.title).toContain(toolName);
        expect(verdict.stopTurn).toBeUndefined();

        const events = guard.events();
        expect(events).toHaveLength(1);
        expect(events[0]?.code).toBe(CONDUCTOR_GUARD_CODES.directWorkBlocked);
        expect(events[0]?.toolName).toBe(toolName);
        expect(events[0]?.turnId).toBe('turn-1');
      },
    );

    it.each(['Agent', 'TaskOutput'])(
      'rejects worker-lifecycle waiting tool %s',
      (toolName) => {
        const guard = new ConductorDirectWorkGuard();
        const verdict = guard.evaluateToolCall({ toolName, turnId: 'turn-1' });

        expect(verdict.allowed).toBe(false);
        if (verdict.allowed) return;
        expect(verdict.code).toBe(CONDUCTOR_GUARD_CODES.workerWaitBlocked);
        expect(verdict.output).toContain(CONDUCTOR_WORKER_WAIT_REJECTION_PHRASE);
        expect(guard.events()[0]?.code).toBe(CONDUCTOR_GUARD_CODES.workerWaitBlocked);
      },
    );

    it('allows the read-only and delegation surface', () => {
      const guard = new ConductorDirectWorkGuard();
      // Within soft triage budget: a couple of exploration tools still pass.
      for (const toolName of ['Read', 'Grep']) {
        expect(guard.evaluateToolCall({ toolName, turnId: 'turn-1' }).allowed, toolName).toBe(true);
      }
      // Job desk is never capped by the explore budget.
      for (const toolName of ['JobCreate', 'JobInbox', 'MergeJob', 'PushJob']) {
        expect(guard.evaluateToolCall({ toolName, turnId: 'turn-1' }).allowed, toolName).toBe(true);
      }
      // Bash passes only with a read-only command (V1-5 classification).
      expect(
        guard.evaluateToolCall({
          toolName: 'Bash',
          args: { command: 'git status' },
          turnId: 'turn-1',
        }).allowed,
      ).toBe(true);
      expect(guard.events()).toHaveLength(0);
    });
  });

  describe('Bash read-only contract (V1-5)', () => {
    const WRITE_COMMANDS = [
      'pnpm install',
      'npm install express',
      'pnpm run build',
      'make test',
      'node scripts/migrate.mjs',
      'git commit -m "fix"',
      'git push origin main',
      'git rebase main',
      'git checkout -b feature',
      'rm -rf dist',
      'mkdir out',
      'echo done > status.txt',
      'git status && rm -rf /tmp/x',
      'pnpm --version; pnpm install',
      'find . -name "*.log" -delete',
      'git branch -D stale',
      'git tag v1.0.0',
      'git config user.name "bot"',
      'git stash push',
      'sudo systemctl restart app',
    ] as const;

    const READ_ONLY_COMMANDS = [
      'git status',
      'git log --oneline -5',
      'git diff HEAD~1',
      'git show HEAD',
      'git branch -a',
      'git tag --list',
      'git config --get user.email',
      'git worktree list',
      'ls -la',
      'pwd',
      'rg "RunProjectChecks" packages',
      'git -C /repo log -1',
    ] as const;

    it.each(WRITE_COMMANDS)('hard-denies write command: %s', (command) => {
      const guard = new ConductorDirectWorkGuard();
      const verdict = guard.evaluateToolCall({
        toolName: 'Bash',
        args: { command },
        turnId: 'turn-1',
        stepNumber: 1,
      });

      expect(verdict.allowed, command).toBe(false);
      if (verdict.allowed) return;
      expect(verdict.code).toBe(CONDUCTOR_GUARD_CODES.bashWriteBlocked);
      expect(verdict.output).toContain(CONDUCTOR_DIRECT_WORK_REJECTION_PHRASE);
      expect(verdict.output).toContain('Suggested Job draft');
      expect(verdict.output).toContain('JobCreate');
      expect(guard.events()[0]?.code).toBe(CONDUCTOR_GUARD_CODES.bashWriteBlocked);
    });

    it.each(READ_ONLY_COMMANDS)('allows read-only command: %s', (command) => {
      const guard = new ConductorDirectWorkGuard();
      const verdict = guard.evaluateToolCall({
        toolName: 'Bash',
        args: { command },
        turnId: 'turn-1',
      });
      expect(verdict.allowed, command).toBe(true);
      expect(guard.events()).toHaveLength(0);
    });

    it('denies Bash without a command (conservative default)', () => {
      const guard = new ConductorDirectWorkGuard();
      expect(guard.evaluateToolCall({ toolName: 'Bash', turnId: 'turn-1' }).allowed).toBe(false);
      expect(
        guard.evaluateToolCall({ toolName: 'Bash', args: {}, turnId: 'turn-1' }).allowed,
      ).toBe(false);
    });

    it('counts a blocked write command toward turn-violation escalation', () => {
      const guard = new ConductorDirectWorkGuard();
      guard.evaluateToolCall({ toolName: 'Bash', args: { command: 'pnpm install' }, turnId: 't' });
      guard.evaluateToolCall({ toolName: 'Write', turnId: 't' });
      const third = guard.evaluateToolCall({
        toolName: 'Bash',
        args: { command: 'git push' },
        turnId: 't',
      });
      expect(third.allowed).toBe(false);
      if (third.allowed) return;
      expect(third.stopTurn).toBe(true);
    });
  });

  describe('interactive exploration soft/hard cap', () => {
    it('allows up to the soft triage budget of exploration tools', () => {
      const guard = new ConductorDirectWorkGuard();
      for (let index = 0; index < CONDUCTOR_INTERACTIVE_EXPLORE_SOFT; index += 1) {
        const toolName = (['RepoQuery', 'Grep', 'Read'] as const)[index % 3]!;
        const verdict = guard.evaluateToolCall({
          toolName,
          args: { pattern: 'auth', path: '/repo' },
          turnId: 'turn-explore',
        });
        expect(verdict.allowed, `${toolName} #${String(index + 1)}`).toBe(true);
      }
      expect(guard.exploreCallsInTurn('turn-explore')).toBe(CONDUCTOR_INTERACTIVE_EXPLORE_SOFT);
      expect(guard.events()).toHaveLength(0);
      expect(guard.violationsInTurn('turn-explore')).toBe(0);
    });

    it('soft-rejects the next exploration call with an explore Job draft', () => {
      const guard = new ConductorDirectWorkGuard();
      for (let index = 0; index < CONDUCTOR_INTERACTIVE_EXPLORE_SOFT; index += 1) {
        expect(
          guard.evaluateToolCall({
            toolName: 'Grep',
            args: { pattern: 'x' },
            turnId: 'turn-soft',
          }).allowed,
        ).toBe(true);
      }

      const soft = guard.evaluateToolCall({
        toolName: 'RepoQuery',
        args: { query: 'conductor guard', mode: 'content' },
        turnId: 'turn-soft',
        stepNumber: 4,
      });
      expect(soft.allowed).toBe(false);
      if (soft.allowed) return;
      expect(soft.code).toBe(CONDUCTOR_GUARD_CODES.exploreSoft);
      expect(soft.output).toContain(CONDUCTOR_EXPLORE_SOFT_REJECTION_PHRASE);
      expect(soft.output).toContain('JobCreate(kind=explore)');
      expect(soft.output).toContain('kind: explore');
      expect(soft.jobDraft?.title).toMatch(/Explore:/i);
      expect(soft.stopTurn).toBeUndefined();
      // Explore soft rejects must not escalate the direct-work violation counter.
      expect(guard.violationsInTurn('turn-soft')).toBe(0);
      expect(guard.events()[0]?.code).toBe(CONDUCTOR_GUARD_CODES.exploreSoft);
    });

    it('hard-rejects once the hard exploration budget is reached', () => {
      const guard = new ConductorDirectWorkGuard();
      // Burn soft allowance + soft-reject slots until HARD-1, then assert hard.
      for (let index = 0; index < CONDUCTOR_INTERACTIVE_EXPLORE_HARD - 1; index += 1) {
        guard.evaluateToolCall({
          toolName: 'Read',
          args: { path: `/repo/file-${String(index)}.ts` },
          turnId: 'turn-hard',
        });
      }
      expect(guard.exploreCallsInTurn('turn-hard')).toBe(CONDUCTOR_INTERACTIVE_EXPLORE_HARD - 1);

      const hard = guard.evaluateToolCall({
        toolName: 'Glob',
        args: { pattern: '**/*.ts' },
        turnId: 'turn-hard',
      });
      expect(hard.allowed).toBe(false);
      if (hard.allowed) return;
      expect(hard.code).toBe(CONDUCTOR_GUARD_CODES.exploreHard);
      expect(hard.output).toContain(CONDUCTOR_EXPLORE_HARD_REJECTION_PHRASE);
      expect(hard.output).toContain('JobCreate(kind=explore)');
      expect(hard.output).toContain('EnterPlanMode');
      expect(hard.jobDraft?.prompt).toContain('kind=explore');
      expect(guard.exploreCallsInTurn('turn-hard')).toBe(CONDUCTOR_INTERACTIVE_EXPLORE_HARD);
      expect(guard.violationsInTurn('turn-hard')).toBe(0);
    });

    it('keeps Job desk and plan tools unrestricted under the explore cap', () => {
      const guard = new ConductorDirectWorkGuard();
      // Trip the hard explore cap first.
      for (let index = 0; index < CONDUCTOR_INTERACTIVE_EXPLORE_HARD + 1; index += 1) {
        guard.evaluateToolCall({
          toolName: 'Grep',
          args: { pattern: 'spam' },
          turnId: 'turn-desk',
        });
      }
      expect(
        guard.evaluateToolCall({
          toolName: 'Grep',
          args: { pattern: 'more' },
          turnId: 'turn-desk',
        }).allowed,
      ).toBe(false);

      for (const toolName of [
        'JobCreate',
        'JobInspect',
        'JobList',
        'JobInbox',
        'EnterPlanMode',
        'AskUserQuestion',
      ]) {
        expect(
          guard.evaluateToolCall({ toolName, turnId: 'turn-desk' }).allowed,
          toolName,
        ).toBe(true);
      }
    });

    it('counts search-shaped Bash toward the explore cap but not plain status Bash', () => {
      const guard = new ConductorDirectWorkGuard();
      for (let index = 0; index < CONDUCTOR_INTERACTIVE_EXPLORE_SOFT; index += 1) {
        expect(
          guard.evaluateToolCall({
            toolName: 'Bash',
            args: { command: 'rg "auth" packages' },
            turnId: 'turn-bash',
          }).allowed,
        ).toBe(true);
      }
      const soft = guard.evaluateToolCall({
        toolName: 'Bash',
        args: { command: 'git grep conductor-guard' },
        turnId: 'turn-bash',
      });
      expect(soft.allowed).toBe(false);
      if (!soft.allowed) {
        expect(soft.code).toBe(CONDUCTOR_GUARD_CODES.exploreSoft);
      }

      // Non-search read-only Bash is not an exploration tool.
      const status = guard.evaluateToolCall({
        toolName: 'Bash',
        args: { command: 'git status' },
        turnId: 'turn-bash',
      });
      expect(status.allowed).toBe(true);
    });

    it('tracks explore calls per turn and clears them on resetTurnState', () => {
      const guard = new ConductorDirectWorkGuard();
      guard.evaluateToolCall({ toolName: 'Read', args: { path: '/a' }, turnId: 't1' });
      guard.evaluateToolCall({ toolName: 'Read', args: { path: '/b' }, turnId: 't2' });
      expect(guard.exploreCallsInTurn('t1')).toBe(1);
      expect(guard.exploreCallsInTurn('t2')).toBe(1);
      guard.resetTurnState();
      expect(guard.exploreCallsInTurn('t1')).toBe(0);
      expect(guard.exploreCallsInTurn('t2')).toBe(0);
    });

    it('does not weaken write delegation-only under explore pressure', () => {
      const guard = new ConductorDirectWorkGuard();
      for (let index = 0; index < CONDUCTOR_INTERACTIVE_EXPLORE_HARD; index += 1) {
        guard.evaluateToolCall({
          toolName: 'Grep',
          args: { pattern: 'x' },
          turnId: 'turn-write',
        });
      }
      const write = guard.evaluateToolCall({
        toolName: 'Write',
        args: { file_path: '/repo/x.ts' },
        turnId: 'turn-write',
      });
      expect(write.allowed).toBe(false);
      if (write.allowed) return;
      expect(write.code).toBe(CONDUCTOR_GUARD_CODES.directWorkBlocked);
      expect(write.output).toContain(CONDUCTOR_DIRECT_WORK_REJECTION_PHRASE);
      expect(guard.violationsInTurn('turn-write')).toBe(1);
    });
  });

  describe('stage 2 — access-based judgment (bypass defense)', () => {
    it('rejects unknown tools declaring file write access', () => {
      const guard = new ConductorDirectWorkGuard();
      const verdict = guard.authorizeExecution({
        toolName: 'mcp__cms__update_page',
        execution: { accesses: ToolAccesses.writeFile('/repo/page.md') },
        turnId: 'turn-1',
      });
      expect(verdict.allowed).toBe(false);
      if (verdict.allowed) return;
      expect(verdict.code).toBe(CONDUCTOR_GUARD_CODES.accessBlocked);
      expect(verdict.output).toContain(CONDUCTOR_DIRECT_WORK_REJECTION_PHRASE);
      expect(guard.events()[0]?.code).toBe(CONDUCTOR_GUARD_CODES.accessBlocked);
    });

    it('rejects unknown tools declaring unrestricted (execute-large) access', () => {
      const guard = new ConductorDirectWorkGuard();
      const verdict = guard.authorizeExecution({
        toolName: 'PluginRunner',
        execution: { accesses: ToolAccesses.all() },
      });
      expect(verdict.allowed).toBe(false);
      if (verdict.allowed) return;
      expect(verdict.code).toBe(CONDUCTOR_GUARD_CODES.accessBlocked);
    });

    it('treats third-party tools with no declared accesses as write (conservative)', () => {
      const guard = new ConductorDirectWorkGuard();
      const verdict = guard.authorizeExecution({
        toolName: 'mcp__legacy__do_thing',
        execution: { accesses: undefined },
      });
      expect(verdict.allowed).toBe(false);
    });

    it('allows declared read-only executions and pure read accesses', () => {
      const guard = new ConductorDirectWorkGuard();
      expect(
        guard.authorizeExecution({
          toolName: 'mcp__docs__search',
          execution: { accesses: undefined, readOnly: true },
        }).allowed,
      ).toBe(true);
      expect(
        guard.authorizeExecution({
          toolName: 'mcp__docs__fetch',
          execution: { accesses: ToolAccesses.readFile('/repo/README.md') },
        }).allowed,
      ).toBe(true);
      expect(guard.events()).toHaveLength(0);
    });

    it('keeps Job ledger tools allowed even with unrestricted accesses', () => {
      const guard = new ConductorDirectWorkGuard();
      for (const toolName of ['JobCreate', 'JobSteer', 'MergeJob', 'Bash']) {
        expect(
          guard.authorizeExecution({
            toolName,
            execution: { accesses: ToolAccesses.all(), readOnly: false },
          }).allowed,
          toolName,
        ).toBe(true);
      }
    });

    it('allows conductor harness self-improvement tools (SkillCreate / Refine)', () => {
      const guard = new ConductorDirectWorkGuard();
      expect(
        guard.authorizeExecution({
          toolName: 'SkillCreate',
          execution: {
            accesses: ToolAccesses.writeFile('/repo/.agents/skills/auto/foo/SKILL.md'),
            readOnly: false,
          },
        }).allowed,
      ).toBe(true);
      expect(
        guard.authorizeExecution({
          toolName: 'Refine',
          execution: { accesses: ToolAccesses.all(), readOnly: false },
        }).allowed,
      ).toBe(true);
      expect(guard.events()).toHaveLength(0);
    });
  });

  describe('violation escalation', () => {
    it('forces a turn stop on the third violation in one turn', () => {
      const guard = new ConductorDirectWorkGuard();
      const call = { toolName: 'Write', turnId: 'turn-9' } as const;

      const first = guard.evaluateToolCall(call);
      const second = guard.evaluateToolCall(call);
      const third = guard.evaluateToolCall(call);

      expect(first.allowed).toBe(false);
      expect(second.allowed).toBe(false);
      expect(third.allowed).toBe(false);
      if (third.allowed) return;
      expect(third.stopTurn).toBe(true);
      expect(third.output).toContain(CONDUCTOR_TURN_STOP_PHRASE);
      expect(guard.violationsInTurn('turn-9')).toBe(CONDUCTOR_TURN_STOP_VIOLATIONS);
    });

    it('counts violations per turn', () => {
      const guard = new ConductorDirectWorkGuard();
      guard.evaluateToolCall({ toolName: 'Edit', turnId: 'turn-a' });
      guard.evaluateToolCall({ toolName: 'Edit', turnId: 'turn-b' });
      expect(guard.violationsInTurn('turn-a')).toBe(1);
      expect(guard.violationsInTurn('turn-b')).toBe(1);
    });
  });

  describe('wall-clock tripwire (G3-lite)', () => {
    it('records soft and hard budget events for an overrunning tool', async () => {
      const guard = new ConductorDirectWorkGuard({ softBudgetMs: 5, hardBudgetMs: 12 });
      guard.beginToolBudget('call-1', 'Bash', 'turn-1');
      await new Promise((resolve) => setTimeout(resolve, 40));
      const durationMs = guard.endToolBudget('call-1');

      expect(durationMs).toBeGreaterThanOrEqual(30);
      const codes = guard.events().map((event) => event.code);
      expect(codes).toContain(CONDUCTOR_GUARD_CODES.toolBudgetHard);
      expect(codes).toContain(CONDUCTOR_GUARD_CODES.toolBudgetSoft);
      const soft = guard.events().find((e) => e.code === CONDUCTOR_GUARD_CODES.toolBudgetSoft);
      expect(soft?.toolName).toBe('Bash');
      expect(soft?.durationMs).toBeGreaterThan(5);
    });

    it('records nothing when the tool finishes within budget', async () => {
      const guard = new ConductorDirectWorkGuard({ softBudgetMs: 500, hardBudgetMs: 1000 });
      guard.beginToolBudget('call-2', 'Read', 'turn-1');
      const durationMs = guard.endToolBudget('call-2');
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(durationMs).toBeDefined();
      expect(guard.events()).toHaveLength(0);
    });

    it('returns undefined when no budget was armed', () => {
      const guard = new ConductorDirectWorkGuard();
      expect(guard.endToolBudget('missing')).toBeUndefined();
    });
  });

  describe('hard-budget trip stop (V1-4)', () => {
    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms));

    it('returns a per-call signal that the hard budget aborts with a reason', async () => {
      const guard = new ConductorDirectWorkGuard({ softBudgetMs: 5, hardBudgetMs: 12 });
      const signal = guard.beginToolBudget('call-1', 'Bash', 'turn-1');
      expect(signal.aborted).toBe(false);
      await sleep(40);
      expect(signal.aborted).toBe(true);
      expect(String(signal.reason)).toContain('hard budget');
      guard.endToolBudget('call-1');
    });

    it('does not time out while waiting for an operator question', async () => {
      const guard = new ConductorDirectWorkGuard({ softBudgetMs: 5, hardBudgetMs: 12 });
      const signal = guard.beginToolBudget('question-1', 'AskUserQuestion', 'turn-1');

      expect(signal.aborted).toBe(false);
      await sleep(40);

      expect(guard.endToolBudget('question-1')).toBeUndefined();
      expect(guard.events()).toHaveLength(0);
    });

    it('re-arming an already armed call returns the same signal', () => {
      const guard = new ConductorDirectWorkGuard();
      const first = guard.beginToolBudget('call-1', 'Bash', 'turn-1');
      const second = guard.beginToolBudget('call-1', 'Bash', 'turn-1');
      expect(second).toBe(first);
      guard.endToolBudget('call-1');
    });

    it('queues a turn stop with a diagnostic after three consecutive hard trips', async () => {
      const guard = new ConductorDirectWorkGuard({ softBudgetMs: 5, hardBudgetMs: 12 });
      for (let index = 0; index < CONDUCTOR_BUDGET_TRIP_TURN_STOP; index += 1) {
        guard.beginToolBudget(`call-${String(index)}`, 'Bash', 'turn-1');
        await sleep(40);
        guard.endToolBudget(`call-${String(index)}`);
        // Below the threshold nothing is queued yet.
        if (index < CONDUCTOR_BUDGET_TRIP_TURN_STOP - 1) {
          expect(guard.consumeBudgetTurnStop('turn-1')).toBeUndefined();
        }
      }
      expect(guard.hardTripsInTurn('turn-1')).toBe(CONDUCTOR_BUDGET_TRIP_TURN_STOP);
      const report = guard.consumeBudgetTurnStop('turn-1');
      expect(report).toBeDefined();
      expect(report).toContain('consecutive hard-budget');
      expect(report).toContain('JobCreate');
      // The report is consumed exactly once.
      expect(guard.consumeBudgetTurnStop('turn-1')).toBeUndefined();
      const codes = guard.events().map((event) => event.code);
      expect(
        codes.filter((code) => code === CONDUCTOR_GUARD_CODES.toolBudgetHard),
      ).toHaveLength(CONDUCTOR_BUDGET_TRIP_TURN_STOP);
      expect(codes).toContain(CONDUCTOR_GUARD_CODES.toolBudgetTripStop);
    });

    it('resets the trip streak when a call settles within the hard budget', async () => {
      const guard = new ConductorDirectWorkGuard({ softBudgetMs: 200, hardBudgetMs: 12 });
      for (let index = 0; index < 2; index += 1) {
        guard.beginToolBudget(`slow-${String(index)}`, 'Bash', 'turn-1');
        await sleep(40);
        guard.endToolBudget(`slow-${String(index)}`);
      }
      expect(guard.hardTripsInTurn('turn-1')).toBe(2);
      // A call that settles within budget breaks the consecutive streak.
      guard.beginToolBudget('fast-1', 'Read', 'turn-1');
      guard.endToolBudget('fast-1');
      expect(guard.hardTripsInTurn('turn-1')).toBe(0);
      expect(guard.consumeBudgetTurnStop('turn-1')).toBeUndefined();
    });

    it('resetTurnState clears trip streaks and pending turn stops', async () => {
      const guard = new ConductorDirectWorkGuard({ softBudgetMs: 5, hardBudgetMs: 12 });
      for (let index = 0; index < CONDUCTOR_BUDGET_TRIP_TURN_STOP; index += 1) {
        guard.beginToolBudget(`call-${String(index)}`, 'Bash', 'turn-1');
        await sleep(40);
        guard.endToolBudget(`call-${String(index)}`);
      }
      guard.resetTurnState();
      expect(guard.hardTripsInTurn('turn-1')).toBe(0);
      expect(guard.consumeBudgetTurnStop('turn-1')).toBeUndefined();
    });
  });

  describe('ledger escalation — second violation records a queued Job (V1-3)', () => {
    it('records the draft into the ledger on the second violation and ACKs it', () => {
      const recorded: ConductorJobDraftRecord[] = [];
      const guard = new ConductorDirectWorkGuard({
        recordJobDraft: (record) => {
          recorded.push(record);
          return { jobId: 'job_test_123' };
        },
      });

      const first = guard.evaluateToolCall({
        toolName: 'Write',
        args: { file_path: '/repo/src/auth.ts' },
        turnId: 'turn-1',
        stepNumber: 2,
      });
      expect(first.allowed).toBe(false);
      expect(recorded).toHaveLength(0);
      if (!first.allowed) {
        // First violation keeps the plain "call JobCreate" routing hint.
        expect(first.output).toContain('Call JobCreate with this draft');
        expect(first.output).not.toContain('Recorded the blocked work');
      }

      const second = guard.evaluateToolCall({
        toolName: 'Write',
        args: { file_path: '/repo/src/auth.ts' },
        turnId: 'turn-1',
        stepNumber: 3,
      });
      expect(second.allowed).toBe(false);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        code: CONDUCTOR_GUARD_CODES.directWorkBlocked,
        toolName: 'Write',
        turnId: 'turn-1',
        stepNumber: 3,
        violationCount: 2,
      });
      expect(recorded[0]?.draft.title).toContain('Write');
      expect(recorded[0]?.draft.title).toContain('/repo/src/auth.ts');
      expect(recorded[0]?.draft.ownership).toBe('/repo/src/auth.ts');
      if (!second.allowed) {
        expect(second.output).toContain(formatConductorJobDraftRecordedAck('job_test_123'));
        // The draft is already queued — re-calling JobCreate would duplicate it.
        expect(second.output).not.toContain('Call JobCreate with this draft');
        expect(second.output).toContain('Second violation this turn');
        expect(second.jobDraft).toEqual(recorded[0]?.draft);
      }
    });

    it('records a draft even for worker-wait rejections without an explicit draft', () => {
      const recorded: ConductorJobDraftRecord[] = [];
      const guard = new ConductorDirectWorkGuard({
        recordJobDraft: (record) => {
          recorded.push(record);
          return { jobId: 'job_wait_1' };
        },
      });

      guard.evaluateToolCall({ toolName: 'Agent', turnId: 'turn-1' });
      const second = guard.evaluateToolCall({ toolName: 'Agent', turnId: 'turn-1' });

      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.code).toBe(CONDUCTOR_GUARD_CODES.workerWaitBlocked);
      expect(recorded[0]?.draft.title).toContain('Agent');
      if (!second.allowed) {
        expect(second.output).toContain(formatConductorJobDraftRecordedAck('job_wait_1'));
        expect(second.jobDraft).toEqual(recorded[0]?.draft);
      }
    });

    it('does not record beyond the second violation — the third only stops the turn', () => {
      const recorded: ConductorJobDraftRecord[] = [];
      const guard = new ConductorDirectWorkGuard({
        recordJobDraft: (record) => {
          recorded.push(record);
          return { jobId: 'job_once' };
        },
      });
      const call = { toolName: 'Write', turnId: 'turn-1' } as const;

      guard.evaluateToolCall(call);
      guard.evaluateToolCall(call);
      const third = guard.evaluateToolCall(call);

      expect(recorded).toHaveLength(1);
      expect(third.allowed).toBe(false);
      if (!third.allowed) {
        expect(third.stopTurn).toBe(true);
        expect(third.output).toContain(CONDUCTOR_TURN_STOP_PHRASE);
      }
    });

    it('keeps rejecting without an ACK when the recorder throws', () => {
      const guard = new ConductorDirectWorkGuard({
        recordJobDraft: () => {
          throw new Error('ledger unavailable');
        },
      });
      const call = { toolName: 'Write', turnId: 'turn-1' } as const;

      guard.evaluateToolCall(call);
      const second = guard.evaluateToolCall(call);

      expect(second.allowed).toBe(false);
      if (!second.allowed) {
        expect(second.output).not.toContain('Recorded the blocked work');
        expect(second.output).toContain('Call JobCreate with this draft');
        expect(second.stopTurn).toBeUndefined();
      }
    });

    it('accepts a late-wired recorder via setJobDraftRecorder', () => {
      const guard = new ConductorDirectWorkGuard();
      guard.setJobDraftRecorder(() => ({ jobId: 'job_late' }));
      const call = { toolName: 'Edit', turnId: 'turn-1' } as const;

      guard.evaluateToolCall(call);
      const second = guard.evaluateToolCall(call);

      expect(second.allowed).toBe(false);
      if (!second.allowed) {
        expect(second.output).toContain(formatConductorJobDraftRecordedAck('job_late'));
      }
    });
  });

});
