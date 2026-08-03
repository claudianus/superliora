import { describe, expect, it, vi } from 'vitest';

import {
  CONDUCTOR_DIRECT_WORK_REJECTION_PHRASE,
  CONDUCTOR_GUARD_CODES,
  CONDUCTOR_TURN_STOP_PHRASE,
  CONDUCTOR_TURN_STOP_VIOLATIONS,
  CONDUCTOR_WORKER_WAIT_REJECTION_PHRASE,
  ConductorDirectWorkGuard,
} from '../../src/agent/conductor-guard';
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

    it.each(['Agent', 'TaskOutput', 'UltraSwarm', 'SpawnWorker'])(
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
      for (const toolName of ['Read', 'Grep', 'Glob', 'RepoQuery', 'Bash', 'JobCreate', 'JobInbox']) {
        expect(guard.evaluateToolCall({ toolName, turnId: 'turn-1' }).allowed, toolName).toBe(true);
      }
      expect(guard.events()).toHaveLength(0);
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

  describe('orchestratorMode tripwire', () => {
    it('records blocked orchestratorMode entry attempts', () => {
      const onEvent = vi.fn();
      const guard = new ConductorDirectWorkGuard({ onEvent });
      guard.recordOrchestratorModeBlocked('setOrchestratorMode');

      const events = guard.events();
      expect(events).toHaveLength(1);
      expect(events[0]?.code).toBe(CONDUCTOR_GUARD_CODES.orchestratorModeBlocked);
      expect(events[0]?.detail).toContain('source=setOrchestratorMode');
      expect(onEvent).toHaveBeenCalledTimes(1);
    });
  });
});
