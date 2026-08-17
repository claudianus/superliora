/**
 * Idle progress pulse: pure guards + host timer fires a JobList-only wake
 * separate from job_desk_wake.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import {
  CONDUCTOR_IDLE_PULSE_ORIGIN,
  CONDUCTOR_IDLE_PULSE_PROMPT,
  ConductorIdlePulse,
  DEFAULT_IDLE_PULSE_MINUTES,
  evaluateIdlePulse,
  isIdleProgressPulseOrigin,
  lastVisibleChatKind,
  resolveIdlePulseIntervalMs,
} from '../../src/session/job/conductor-idle-pulse';
import { CONDUCTOR_WAKE_ORIGIN } from '../../src/session/job/conductor-wake';
import { pushJobInboxEvent } from '../../src/tools/builtin/job/job-inbox';
import { createJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
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

interface RecordedPrompt {
  readonly input: readonly { type: string; text?: string }[];
  readonly origin: unknown;
}

function fakeAgent(type: 'main' | 'sub', store: ToolStore) {
  const prompts: RecordedPrompt[] = [];
  let busy = false;
  let history: { role: string; origin?: unknown }[] = [];
  let historyRevision = 0;
  const agent = {
    type,
    tools: {
      getStore() {
        return store;
      },
    },
    context: {
      get history() {
        return history;
      },
      get historyRevision() {
        return historyRevision;
      },
      setHistory(next: typeof history) {
        history = next;
        historyRevision += 1;
      },
    },
    turn: {
      get hasActiveTurn() {
        return busy;
      },
      prompt(input: RecordedPrompt['input'], origin: unknown): number | null {
        prompts.push({ input, origin });
        history = [...history, { role: 'user', origin }];
        historyRevision += 1;
        busy = true;
        return 1;
      },
    },
  } as unknown as Agent & {
    context: {
      history: typeof history;
      historyRevision: number;
      setHistory: (next: typeof history) => void;
    };
  };
  return {
    agent,
    prompts,
    setBusy(value: boolean) {
      busy = value;
    },
    setHistory(next: typeof history) {
      (agent.context as { setHistory: (n: typeof history) => void }).setHistory(next);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveIdlePulseIntervalMs', () => {
  it('defaults to 4 minutes and honors off / numeric env', () => {
    expect(resolveIdlePulseIntervalMs({})).toBe(DEFAULT_IDLE_PULSE_MINUTES * 60_000);
    expect(resolveIdlePulseIntervalMs({ SUPERLIORA_CONDUCTOR_IDLE_PULSE_MINUTES: 'off' })).toBeNull();
    expect(resolveIdlePulseIntervalMs({ SUPERLIORA_CONDUCTOR_IDLE_PULSE_MINUTES: '0' })).toBeNull();
    expect(resolveIdlePulseIntervalMs({ SUPERLIORA_CONDUCTOR_IDLE_PULSE_MINUTES: '2' })).toBe(
      2 * 60_000,
    );
  });
});

describe('evaluateIdlePulse', () => {
  const base = {
    nowMs: 10 * 60_000,
    idleIntervalMs: 4 * 60_000,
    hasActiveTurn: false,
    running: 1,
    unreadInbox: 0,
    lastVisible: 'assistant' as const,
    lastActivityAt: 0,
    lastPulseAt: null as number | null,
  };

  it('fires when idle with running workers', () => {
    expect(evaluateIdlePulse(base)).toEqual({ fire: true });
  });

  it('skips active turn, no running, unread inbox, consecutive pulse, min interval', () => {
    expect(evaluateIdlePulse({ ...base, hasActiveTurn: true }).fire).toBe(false);
    expect(evaluateIdlePulse({ ...base, running: 0 }).fire).toBe(false);
    expect(evaluateIdlePulse({ ...base, unreadInbox: 1 }).fire).toBe(false);
    expect(evaluateIdlePulse({ ...base, lastVisible: 'assistant_pulse' }).fire).toBe(false);
    expect(
      evaluateIdlePulse({
        ...base,
        lastPulseAt: 8 * 60_000,
        nowMs: 10 * 60_000,
      }).fire,
    ).toBe(false);
    expect(
      evaluateIdlePulse({
        ...base,
        lastActivityAt: 9 * 60_000,
        nowMs: 10 * 60_000,
      }).fire,
    ).toBe(false);
  });
});

describe('lastVisibleChatKind', () => {
  it('detects real user, pulse pair, and desk wake as non-pulse assistant work', () => {
    expect(
      lastVisibleChatKind([{ role: 'user', origin: { kind: 'user' } }]),
    ).toBe('user');
    expect(
      lastVisibleChatKind([
        { role: 'user', origin: CONDUCTOR_IDLE_PULSE_ORIGIN },
        { role: 'assistant' },
      ]),
    ).toBe('assistant_pulse');
    expect(
      lastVisibleChatKind([
        { role: 'user', origin: CONDUCTOR_WAKE_ORIGIN },
        { role: 'assistant' },
      ]),
    ).toBe('assistant');
    expect(isIdleProgressPulseOrigin(CONDUCTOR_IDLE_PULSE_ORIGIN)).toBe(true);
    expect(isIdleProgressPulseOrigin(CONDUCTOR_WAKE_ORIGIN)).toBe(false);
  });
});

describe('ConductorIdlePulse host', () => {
  it('fires once after idle window with a running job and JobList-only prompt', () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'worker', kind: 'implement' });
    patchJob(store, job.id, { status: 'running', worktreePath: '/tmp/pulse' });

    let now = 0;
    const { agent, prompts, setBusy } = fakeAgent('main', store);
    const pulse = new ConductorIdlePulse(agent, {
      now: () => now,
      idleIntervalMs: 4 * 60_000,
      pollIntervalMs: 60_000,
      setIntervalFn: (() => 1) as unknown as typeof setInterval,
      clearIntervalFn: (() => undefined) as unknown as typeof clearInterval,
    });

    // Recent assistant activity — must not fire yet.
    (agent.context as { setHistory: (h: { role: string; origin?: unknown }[]) => void }).setHistory([
      { role: 'user', origin: { kind: 'user' } },
      { role: 'assistant' },
    ]);
    now = 1 * 60_000;
    pulse.tick();
    expect(prompts).toHaveLength(0);

    // Idle past threshold with running job.
    now = 5 * 60_000;
    pulse.tick();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.origin).toEqual(CONDUCTOR_IDLE_PULSE_ORIGIN);
    expect(prompts[0]?.input[0]?.text).toBe(CONDUCTOR_IDLE_PULSE_PROMPT);
    expect(CONDUCTOR_IDLE_PULSE_PROMPT).toMatch(/JobList/);
    expect(CONDUCTOR_IDLE_PULSE_PROMPT).toMatch(/JobCreate/);
    expect(CONDUCTOR_IDLE_PULSE_PROMPT).toMatch(/한국어|Korean/i);

    // Consecutive pulse while last visible is still the pulse prompt.
    setBusy(false);
    now = 20 * 60_000;
    pulse.tick();
    expect(prompts).toHaveLength(1);

    pulse.stop();
  });

  it('does not fire with zero running jobs or when unread desk inbox exists', () => {
    const store = memoryStore();
    let now = 10 * 60_000;
    const { agent, prompts } = fakeAgent('main', store);
    const pulse = new ConductorIdlePulse(agent, {
      now: () => now,
      idleIntervalMs: 4 * 60_000,
      setIntervalFn: (() => 1) as unknown as typeof setInterval,
      clearIntervalFn: (() => undefined) as unknown as typeof clearInterval,
    });

    (agent.context as { setHistory: (h: { role: string; origin?: unknown }[]) => void }).setHistory([
      { role: 'assistant' },
    ]);
    pulse.tick();
    expect(prompts).toHaveLength(0);

    const job = createJob(store, { title: 'worker', kind: 'implement' });
    patchJob(store, job.id, { status: 'running', worktreePath: '/tmp/pulse2' });
    pushJobInboxEvent(store, {
      kind: 'job.completed',
      jobId: job.id,
      status: 'done',
      title: 'done job',
    });
    now = 20 * 60_000;
    pulse.tick();
    // Unread inbox → desk wake owns the path.
    expect(prompts).toHaveLength(0);

    pulse.stop();
  });

  it('never starts on sub agents', () => {
    const store = memoryStore();
    const { agent, prompts } = fakeAgent('sub', store);
    const pulse = new ConductorIdlePulse(agent, {
      idleIntervalMs: 4 * 60_000,
      setIntervalFn: (() => {
        throw new Error('should not arm timer on sub');
      }) as unknown as typeof setInterval,
      clearIntervalFn: (() => undefined) as unknown as typeof clearInterval,
    });
    pulse.tick();
    expect(prompts).toHaveLength(0);
    pulse.stop();
  });
});
