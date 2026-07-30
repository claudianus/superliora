import { describe, expect, it } from 'vitest';

import {
  MAX_MULTI_WAIT_TASKS,
  MultiWaitLimitError,
} from '../../src/agent/background';
import {
  createConversationLoop,
  MIN_LOOP_INTERVAL_MS,
} from '../../src/agent/conversation-loop';
import {
  getToolCallPatternCount,
  resetToolFailureTracker,
  trackToolCallPattern,
} from '../../src/loop/tool-call-guards';
import { ToolCallDeduplicator, __testing } from '../../src/agent/turn/tool-dedup';
import { TaskOutputInputSchema } from '../../src/tools/background/task-output';

describe('ops harness (unit-ops-harness)', () => {
  describe('wait multi limits', () => {
    it('exports a hard cap of 20 task ids', () => {
      expect(MAX_MULTI_WAIT_TASKS).toBe(20);
    });

    it('TaskOutput schema rejects more than 20 task_ids', () => {
      const ids = Array.from({ length: 21 }, (_, i) => `t${String(i)}`);
      const parsed = TaskOutputInputSchema.safeParse({
        task_ids: ids,
        wait_mode: 'all',
        block: true,
      });
      expect(parsed.success).toBe(false);
    });

    it('TaskOutput schema accepts wait_mode all/any with multiple ids', () => {
      const parsed = TaskOutputInputSchema.safeParse({
        task_ids: ['a', 'b'],
        wait_mode: 'any',
        block: true,
        timeout: 5,
      });
      expect(parsed.success).toBe(true);
    });

    it('MultiWaitLimitError carries stable code', () => {
      const err = new MultiWaitLimitError(25);
      expect(err.code).toBe('MULTI_WAIT_LIMIT');
      expect(err.message).toContain('20');
    });
  });

  describe('conversation /loop', () => {
    it('clamps interval to ≥ 60s', () => {
      let t = 1_000_000;
      const loop = createConversationLoop('L1', {
        prompt: 'continue',
        intervalMs: 1_000,
        maxIterations: 3,
        now: () => t,
      });
      expect(loop.getState().config.intervalMs).toBe(MIN_LOOP_INTERVAL_MS);
    });

    it('fires then respects interval and max iterations', () => {
      let t = 0;
      const loop = createConversationLoop('L2', {
        prompt: 'ping',
        intervalMs: 60_000,
        maxIterations: 2,
        now: () => t,
      });

      const first = loop.tick();
      expect(first.shouldFire).toBe(true);
      expect(first.state.iterations).toBe(1);

      t += 10_000;
      const tooSoon = loop.tick();
      expect(tooSoon.shouldFire).toBe(false);
      expect(tooSoon.reason).toBe('interval');

      t += 60_000;
      const second = loop.tick();
      expect(second.shouldFire).toBe(true);
      expect(second.state.iterations).toBe(2);

      t += 60_000;
      const done = loop.tick();
      expect(done.shouldFire).toBe(false);
      expect(done.state.status).toBe('completed');
    });

    it('expires at expiresAt', () => {
      let t = 100;
      const loop = createConversationLoop('L3', {
        prompt: 'x',
        intervalMs: 60_000,
        maxIterations: 10,
        expiresAt: 150,
        now: () => t,
      });
      t = 200;
      const tick = loop.tick();
      expect(tick.shouldFire).toBe(false);
      expect(tick.state.status).toBe('expired');
    });
  });

  describe('doom_loop hard stop', () => {
    it('trackToolCallPattern hard-stops after threshold', () => {
      resetToolFailureTracker();
      const args = { path: '/same' };
      let last = trackToolCallPattern('Read', args);
      for (let i = 0; i < 10; i += 1) {
        last = trackToolCallPattern('Read', args);
      }
      expect(last.action).toBe('hard_stop');
      if (last.action === 'hard_stop') {
        expect(last.code).toBe('DOOM_LOOP_HARD_STOP');
      }
      expect(getToolCallPatternCount('Read', args)).toBeGreaterThanOrEqual(8);
      resetToolFailureTracker();
    });

    it('ToolCallDeduplicator force-stops with DOOM_LOOP_HARD_STOP text', async () => {
      const dedup = new ToolCallDeduplicator();
      let last;
      for (let i = 0; i < __testing.REPEAT_FORCE_STOP_STREAK; i += 1) {
        dedup.beginStep();
        expect(dedup.checkSameStep(`c${String(i)}`, 'Read', { p: 1 })).toBeNull();
        last = await dedup.finalizeResult(`c${String(i)}`, 'Read', { p: 1 }, { output: 'ok' });
        dedup.endStep();
      }
      expect(last!.stopTurn).toBe(true);
      expect(String(last!.output)).toContain('DOOM_LOOP_HARD_STOP');
      expect(String(last!.output)).toContain('강제 종료');
    });
  });
});
