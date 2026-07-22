import { describe, expect, it, vi } from 'vitest';

import {
  AttentionController,
  ATTENTION_LATENCY_MAX_MS,
  ATTENTION_ESCALATION_MS,
  ATTENTION_CRITICAL_MS,
  classifyAttentionLoad,
  ATTENTION_LOAD_ELEVATED_COUNT,
  ATTENTION_LOAD_OVERLOADED_COUNT,
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

describe('attention dwell time (Gen 32)', () => {
  it('tracks how long a quest has been in an attention state', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');

    expect(ctrl.getDwellTime('q1')).toBe(0);
    advanceTime(3000);
    expect(ctrl.getDwellTime('q1')).toBe(3000);
  });

  it('returns null for a quest not in an attention state', () => {
    const { ctrl } = makeController(5000);
    expect(ctrl.getDwellTime('q1')).toBeNull();

    ctrl.onQuestStateChanged('q1', 'running');
    expect(ctrl.getDwellTime('q1')).toBeNull();
  });

  it('does not reset the clock on repeated same-state events', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(4000);
    // Re-asserting the same attention state must not restart the dwell timer.
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    expect(ctrl.getDwellTime('q1')).toBe(4000);
  });

  it('clears dwell time when the quest leaves the attention state', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(2000);
    expect(ctrl.getDwellTime('q1')).toBe(2000);

    ctrl.onQuestStateChanged('q1', 'running');
    expect(ctrl.getDwellTime('q1')).toBeNull();
  });

  it('identifies the most-neglected quest', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(1000);
    ctrl.onQuestStateChanged('q2', 'failed');
    advanceTime(1000);
    ctrl.onQuestStateChanged('q3', 'waiting-approval');

    // q1 entered first, so it has been neglected the longest.
    expect(ctrl.getMostNeglectedQuestId()).toBe('q1');
  });

  it('returns null most-neglected quest when nothing needs attention', () => {
    const { ctrl } = makeController(5000);
    expect(ctrl.getMostNeglectedQuestId()).toBeNull();
  });

  it('clearAll resets dwell tracking', () => {
    const { ctrl } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    ctrl.clearAll();
    expect(ctrl.getDwellTime('q1')).toBeNull();
    expect(ctrl.getMostNeglectedQuestId()).toBeNull();
  });
});

describe('attention escalation (Gen 51)', () => {
  it('is not escalated before the threshold', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_ESCALATION_MS - 1);
    expect(ctrl.isEscalated('q1')).toBe(false);
  });

  it('is escalated once dwell reaches the threshold', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_ESCALATION_MS);
    expect(ctrl.isEscalated('q1')).toBe(true);
  });

  it('is not escalated for a quest not in an attention state', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_ESCALATION_MS + 1000);
    ctrl.onQuestStateChanged('q1', 'running');
    expect(ctrl.isEscalated('q1')).toBe(false);
  });

  it('getEscalatedQuestIds returns only escalated quests, most neglected first', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_ESCALATION_MS + 1000);
    ctrl.onQuestStateChanged('q2', 'failed');
    advanceTime(ATTENTION_ESCALATION_MS + 1000);
    ctrl.onQuestStateChanged('q3', 'waiting-approval'); // fresh, not escalated

    expect(ctrl.getEscalatedQuestIds()).toEqual(['q1', 'q2']);
  });

  it('getEscalatedQuestIds is empty when nothing is escalated', () => {
    const { ctrl } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    expect(ctrl.getEscalatedQuestIds()).toEqual([]);
  });
});

describe('escalation polling (Gen 52)', () => {
  it('reports a quest once when it crosses the threshold', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_ESCALATION_MS);

    expect(ctrl.pollNewlyEscalated()).toEqual(['q1']);
    // A second poll must not report the same quest again.
    expect(ctrl.pollNewlyEscalated()).toEqual([]);
  });

  it('reports nothing before the threshold', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_ESCALATION_MS - 1);
    expect(ctrl.pollNewlyEscalated()).toEqual([]);
  });

  it('reports multiple quests most-neglected first', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_ESCALATION_MS + 1000);
    ctrl.onQuestStateChanged('q2', 'failed');
    advanceTime(ATTENTION_ESCALATION_MS + 1000);

    expect(ctrl.pollNewlyEscalated()).toEqual(['q1', 'q2']);
  });

  it('can re-report a quest after it leaves and re-enters attention', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_ESCALATION_MS);
    expect(ctrl.pollNewlyEscalated()).toEqual(['q1']);

    // Quest is handled, then needs attention again later.
    ctrl.onQuestStateChanged('q1', 'running');
    advanceTime(1000);
    ctrl.onQuestStateChanged('q1', 'failed');
    advanceTime(ATTENTION_ESCALATION_MS);
    expect(ctrl.pollNewlyEscalated()).toEqual(['q1']);
  });

  it('clearAll resets escalation reporting', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_ESCALATION_MS);
    ctrl.pollNewlyEscalated();
    ctrl.clearAll();

    // Re-entering attention after clearAll can escalate and be reported again.
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_ESCALATION_MS);
    expect(ctrl.pollNewlyEscalated()).toEqual(['q1']);
  });
});

describe('escalation levels (Gen 53)', () => {
  it('is level 0 before the escalation threshold', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_ESCALATION_MS - 1);
    expect(ctrl.getEscalationLevel('q1')).toBe(0);
  });

  it('is level 1 (warning) between the escalation and critical thresholds', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_ESCALATION_MS);
    expect(ctrl.getEscalationLevel('q1')).toBe(1);

    advanceTime(ATTENTION_CRITICAL_MS - ATTENTION_ESCALATION_MS - 1);
    expect(ctrl.getEscalationLevel('q1')).toBe(1);
  });

  it('is level 2 (critical) once the critical threshold is reached', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_CRITICAL_MS);
    expect(ctrl.getEscalationLevel('q1')).toBe(2);
  });

  it('is level 0 for a quest not in an attention state', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_CRITICAL_MS);
    ctrl.onQuestStateChanged('q1', 'running');
    expect(ctrl.getEscalationLevel('q1')).toBe(0);
  });

  it('is level 0 for an unknown quest', () => {
    const { ctrl } = makeController(5000);
    expect(ctrl.getEscalationLevel('missing')).toBe(0);
  });
});

describe('fleet-wide max escalation level (Gen 60)', () => {
  it('is 0 when nothing is escalated', () => {
    const { ctrl } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    expect(ctrl.getMaxEscalationLevel()).toBe(0);
  });

  it('reflects the highest escalation level across quests', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_ESCALATION_MS);
    expect(ctrl.getMaxEscalationLevel()).toBe(1);

    ctrl.onQuestStateChanged('q2', 'failed');
    advanceTime(ATTENTION_CRITICAL_MS - ATTENTION_ESCALATION_MS);
    expect(ctrl.getMaxEscalationLevel()).toBe(2);
  });

  it('drops back when the most-escalated quest leaves attention', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_CRITICAL_MS);
    expect(ctrl.getMaxEscalationLevel()).toBe(2);

    ctrl.onQuestStateChanged('q1', 'running');
    expect(ctrl.getMaxEscalationLevel()).toBe(0);
  });

  it('is 0 after clearAll', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(ATTENTION_CRITICAL_MS);
    ctrl.clearAll();
    expect(ctrl.getMaxEscalationLevel()).toBe(0);
  });
});

describe('attention event idempotency (Gen 45)', () => {
  it('does not re-ring the bell on repeated same-state events', () => {
    const { ctrl, writeRaw } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    ctrl.onQuestStateChanged('q1', 'waiting-approval');

    // The bell rings exactly once, on first entry into the attention state.
    expect(writeRaw).toHaveBeenCalledTimes(1);
    expect(writeRaw).toHaveBeenCalledWith('\x07');
  });

  it('does not append duplicate event-log entries', () => {
    const { ctrl } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    ctrl.onQuestStateChanged('q1', 'waiting-approval');

    // Only one latency event is recorded, keeping the metrics clean.
    expect(ctrl.getEventLog()).toHaveLength(1);
  });

  it('rings the bell again after leaving and re-entering attention', () => {
    const { ctrl, writeRaw } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    ctrl.onQuestStateChanged('q1', 'running');
    ctrl.onQuestStateChanged('q1', 'failed');

    // Two genuine transitions into attention → two bells.
    expect(writeRaw).toHaveBeenCalledTimes(2);
    expect(ctrl.getEventLog()).toHaveLength(2);
  });

  it('keeps pulsing while the repeated event is suppressed', () => {
    const { ctrl } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    expect(ctrl.isPulsing('q1')).toBe(true);
  });
});

describe('attention summary (Gen 47)', () => {
  it('reports zero count and null oldest when nothing needs attention', () => {
    const { ctrl } = makeController(5000);
    const summary = ctrl.getAttentionSummary();
    expect(summary.count).toBe(0);
    expect(summary.oldestQuestId).toBeNull();
    expect(summary.oldestDwellMs).toBeNull();
  });

  it('counts quests needing attention', () => {
    const { ctrl } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    ctrl.onQuestStateChanged('q2', 'failed');
    ctrl.onQuestStateChanged('q3', 'running');

    expect(ctrl.getAttentionSummary().count).toBe(2);
  });

  it('reports the oldest quest and its dwell time', () => {
    const { ctrl, advanceTime } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    advanceTime(2000);
    ctrl.onQuestStateChanged('q2', 'failed');
    advanceTime(1000);

    const summary = ctrl.getAttentionSummary();
    expect(summary.oldestQuestId).toBe('q1');
    expect(summary.oldestDwellMs).toBe(3000);
  });

  it('updates after a quest leaves the attention state', () => {
    const { ctrl } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    ctrl.onQuestStateChanged('q2', 'failed');
    ctrl.onQuestStateChanged('q1', 'running');

    const summary = ctrl.getAttentionSummary();
    expect(summary.count).toBe(1);
    expect(summary.oldestQuestId).toBe('q2');
  });
});

describe('classifyAttentionLoad (Gen 78)', () => {
  it('classifies 0–3 quests as normal', () => {
    expect(classifyAttentionLoad(0)).toBe('normal');
    expect(classifyAttentionLoad(1)).toBe('normal');
    expect(classifyAttentionLoad(ATTENTION_LOAD_ELEVATED_COUNT - 1)).toBe('normal');
  });

  it('classifies 4–7 quests as elevated', () => {
    expect(classifyAttentionLoad(ATTENTION_LOAD_ELEVATED_COUNT)).toBe('elevated');
    expect(classifyAttentionLoad(ATTENTION_LOAD_OVERLOADED_COUNT - 1)).toBe('elevated');
  });

  it('classifies 8+ quests as overloaded', () => {
    expect(classifyAttentionLoad(ATTENTION_LOAD_OVERLOADED_COUNT)).toBe('overloaded');
    expect(classifyAttentionLoad(ATTENTION_LOAD_OVERLOADED_COUNT + 5)).toBe('overloaded');
  });
});

describe('getAttentionLoadLevel (Gen 78)', () => {
  it('is normal when nothing needs attention', () => {
    const { ctrl } = makeController(5000);
    expect(ctrl.getAttentionLoadLevel()).toBe('normal');
  });

  it('tracks the number of quests currently needing attention', () => {
    const { ctrl } = makeController(5000);
    ctrl.onQuestStateChanged('q1', 'waiting-approval');
    ctrl.onQuestStateChanged('q2', 'failed');
    expect(ctrl.getAttentionLoadLevel()).toBe('normal');

    ctrl.onQuestStateChanged('q3', 'waiting-approval');
    ctrl.onQuestStateChanged('q4', 'waiting-approval');
    expect(ctrl.getAttentionLoadLevel()).toBe('elevated');
  });

  it('drops back when quests leave the attention state', () => {
    const { ctrl } = makeController(5000);
    for (let i = 1; i <= 8; i += 1) {
      ctrl.onQuestStateChanged(`q${String(i)}`, 'waiting-approval');
    }
    expect(ctrl.getAttentionLoadLevel()).toBe('overloaded');

    // Resolve enough quests to fall back to normal.
    for (let i = 1; i <= 6; i += 1) {
      ctrl.onQuestStateChanged(`q${String(i)}`, 'running');
    }
    expect(ctrl.getAttentionLoadLevel()).toBe('normal');
  });

  it('is normal after clearAll', () => {
    const { ctrl } = makeController(5000);
    for (let i = 1; i <= 8; i += 1) {
      ctrl.onQuestStateChanged(`q${String(i)}`, 'waiting-approval');
    }
    ctrl.clearAll();
    expect(ctrl.getAttentionLoadLevel()).toBe('normal');
  });
});
