import { describe, expect, it, vi } from 'vitest';

import {
  AttentionController,
  ATTENTION_LATENCY_MAX_MS,
} from '#/tui/controllers/attention-controller';

function makeController(nowValue = 1000) {
  let currentTime = nowValue;
  const writeRaw = vi.fn();
  const requestRender = vi.fn();
  const ctrl = new AttentionController({
    writeRaw,
    requestRender,
    now: () => currentTime,
  });
  return { ctrl, writeRaw, requestRender, advanceTime: (ms: number) => { currentTime += ms; } };
}

describe('attention routing latency (AC-2)', () => {
  it('waiting-approval triggers pulse + bell within 0ms (synchronous)', () => {
    const { ctrl, writeRaw, requestRender } = makeController(5000);

    ctrl.onQuestStateChanged('q1', 'waiting-approval');

    expect(ctrl.isPulsing('q1')).toBe(true);
    expect(writeRaw).toHaveBeenCalledWith('\x07');
    expect(requestRender).toHaveBeenCalled();
  });

  it('failed triggers pulse + bell', () => {
    const { ctrl, writeRaw } = makeController(5000);

    ctrl.onQuestStateChanged('q1', 'failed');

    expect(ctrl.isPulsing('q1')).toBe(true);
    expect(writeRaw).toHaveBeenCalledWith('\x07');
  });

  it('running state does NOT trigger pulse', () => {
    const { ctrl, writeRaw } = makeController(5000);

    ctrl.onQuestStateChanged('q1', 'running');

    expect(ctrl.isPulsing('q1')).toBe(false);
    expect(writeRaw).not.toHaveBeenCalled();
  });

  it('idle state does NOT trigger pulse', () => {
    const { ctrl } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'idle');
    expect(ctrl.isPulsing('q1')).toBe(false);
  });

  it('done state does NOT trigger pulse', () => {
    const { ctrl } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'done');
    expect(ctrl.isPulsing('q1')).toBe(false);
  });

  it('blocked state does NOT trigger pulse', () => {
    const { ctrl } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'blocked');
    expect(ctrl.isPulsing('q1')).toBe(false);
  });

  it('transitioning away from attention state stops pulsing', () => {
    const { ctrl } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    expect(ctrl.isPulsing('q1')).toBe(true);

    ctrl.onQuestStateChanged('q1', 'running');
    expect(ctrl.isPulsing('q1')).toBe(false);
  });

  it('validateAttentionLatency passes for synchronous events', () => {
    const { ctrl } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    ctrl.onQuestStateChanged('q2', 'failed');

    expect(ctrl.validateAttentionLatency()).toBe(true);
    expect(ctrl.getMaxLatency()).toBeLessThanOrEqual(ATTENTION_LATENCY_MAX_MS);
  });

  it('event log records correct timestamps', () => {
    const { ctrl } = makeController(9000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');

    const log = ctrl.getEventLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.questId).toBe('q1');
    expect(log[0]!.state).toBe('waiting-approval');
    expect(log[0]!.receivedAt).toBe(9000);
    expect(log[0]!.pulseRenderedAt).toBe(9000);
  });

  it('strip blink activates when >12 quests with attention', () => {
    const { ctrl, requestRender } = makeController(5000);

    ctrl.updateStripBlink(13, 1);
    expect(ctrl.isStripBlinkActive()).toBe(true);
    expect(requestRender).toHaveBeenCalled();
  });

  it('strip blink does NOT activate with <=12 quests', () => {
    const { ctrl } = makeController(5000);
    ctrl.updateStripBlink(12, 1);
    expect(ctrl.isStripBlinkActive()).toBe(false);
  });

  it('strip blink does NOT activate without attention quests', () => {
    const { ctrl } = makeController(5000);
    ctrl.updateStripBlink(15, 0);
    expect(ctrl.isStripBlinkActive()).toBe(false);
  });

  it('clearAll resets all pulsing and strip blink', () => {
    const { ctrl } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    ctrl.updateStripBlink(15, 1);

    ctrl.clearAll();
    expect(ctrl.isPulsing('q1')).toBe(false);
    expect(ctrl.isStripBlinkActive()).toBe(false);
  });

  it('multiple quests can pulse simultaneously', () => {
    const { ctrl } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    ctrl.onQuestStateChanged('q2', 'failed');

    expect(ctrl.isPulsing('q1')).toBe(true);
    expect(ctrl.isPulsing('q2')).toBe(true);
    expect(ctrl.getPulsingQuestIds().size).toBe(2);
  });
});
