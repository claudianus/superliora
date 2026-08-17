/**
 * Idle progress pulse — when workers are running and the chat lane has been
 * quiet for N minutes, wake the main Conductor for a short JobList-only status
 * report. Separate from terminal `job_desk_wake` (inbox routing).
 *
 * Spam guards (all must pass before fire):
 * - running === 0 → skip
 * - active turn → skip (and reset idle clock)
 * - unread job inbox → skip (desk wake owns that path; no same-turn double)
 * - min interval since last pulse (same N as idle threshold)
 * - last assistant message was already a pulse → skip consecutive
 * - real user / assistant visible activity within N → skip
 *
 * Default ON; one env knob: SUPERLIORA_CONDUCTOR_IDLE_PULSE_MINUTES (default 4).
 * Set to 0 / off / false to disable.
 */

import type { Agent } from '../../agent';
import type { PromptOrigin } from '../../agent/context';
import { isRealUserPrompt } from '../../agent/context/message-helpers';
import { listUnreadJobInbox } from '../../tools/builtin/job/job-inbox';
import { listJobs } from '../../tools/builtin/job/job-ledger';
import { summarizeJobStrip } from '../../tools/builtin/job/job-runtime';
import type { ToolStore } from '../../tools/store';

export const CONDUCTOR_IDLE_PULSE_ORIGIN: PromptOrigin = {
  kind: 'system_trigger',
  name: 'idle_progress_pulse',
};

export const IDLE_PULSE_MINUTES_ENV = 'SUPERLIORA_CONDUCTOR_IDLE_PULSE_MINUTES';
export const DEFAULT_IDLE_PULSE_MINUTES = 4;

/** Internal poll cadence — not a user-facing knob. */
export const IDLE_PULSE_POLL_MS = 30_000;

export const CONDUCTOR_IDLE_PULSE_PROMPT = [
  '[idle progress pulse] 채팅이 조용한 동안 워커가 실행 중입니다. 짧은 현황 보고만 하세요.',
  'Exactly one JobList call (facts only). Then write 3–6 Korean lines covering:',
  '- 실행/대기/막힘(needs_user·blocked·failed) 카운트',
  '- running 잡의 heartbeat / 마지막 도구(있으면)',
  '- 다음에 풀릴 대기 잡(있으면 id·title)',
  'Rules: no guesswork, no re-implementation, do not paste the same heartbeat text verbatim, do NOT call JobCreate.',
  'Route only when JobList shows blocked / failed / needs_user that still needs Conductor action; otherwise end the turn after the report.',
].join('\n');

export function resolveIdlePulseIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env[IDLE_PULSE_MINUTES_ENV];
  if (raw === undefined || raw === '') {
    return DEFAULT_IDLE_PULSE_MINUTES * 60_000;
  }
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === '0' || trimmed === 'off' || trimmed === 'false' || trimmed === 'no') {
    return null;
  }
  const minutes = Number(trimmed);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.floor(minutes * 60_000);
}

export function isIdleProgressPulseOrigin(origin: PromptOrigin | undefined): boolean {
  return origin?.kind === 'system_trigger' && origin.name === 'idle_progress_pulse';
}

export function isIdleProgressPulsePromptText(text: string | undefined): boolean {
  if (text === undefined) return false;
  return text.includes('[idle progress pulse]');
}

/**
 * Classify the latest visible chat activity from history.
 * Pulse turns store origin on the synthetic user prompt; the assistant reply
 * usually has no origin — so we pair the last assistant with the nearest
 * preceding user message to detect consecutive pulses.
 */
export function lastVisibleChatKind(
  history: readonly { role: string; origin?: PromptOrigin; content?: unknown }[],
): 'user' | 'assistant_pulse' | 'assistant' | 'none' {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message === undefined) continue;

    if (message.role === 'assistant') {
      // Pair with the user prompt that started this exchange.
      for (let j = i - 1; j >= 0; j -= 1) {
        const prior = history[j];
        if (prior === undefined) continue;
        if (prior.role === 'user') {
          if (isIdleProgressPulseOrigin(prior.origin)) return 'assistant_pulse';
          if (isRealUserPrompt(prior as never)) return 'assistant';
          if (prior.origin?.kind === 'system_trigger') {
            // Desk wake / other system triggers still count as visible assistant work.
            return 'assistant';
          }
          return 'assistant';
        }
        if (prior.role === 'assistant') break;
      }
      return 'assistant';
    }

    if (isRealUserPrompt(message as never)) return 'user';

    if (message.role === 'user' && message.origin?.kind === 'system_trigger') {
      // Synthetic wake still in-flight (no assistant reply yet).
      if (isIdleProgressPulseOrigin(message.origin)) return 'assistant_pulse';
      return 'assistant';
    }
  }
  return 'none';
}

export function countRunningJobs(store: ToolStore): number {
  return summarizeJobStrip(store).running;
}

export interface IdlePulseEvalInput {
  readonly nowMs: number;
  readonly idleIntervalMs: number;
  readonly hasActiveTurn: boolean;
  readonly running: number;
  readonly unreadInbox: number;
  readonly lastVisible: ReturnType<typeof lastVisibleChatKind>;
  readonly lastActivityAt: number;
  readonly lastPulseAt: number | null;
  /** When true, a desk-wake recheck is already armed for this agent. */
  readonly deskWakePending?: boolean;
}

export type IdlePulseSkipReason =
  | 'disabled'
  | 'active_turn'
  | 'no_running'
  | 'unread_inbox'
  | 'desk_wake_pending'
  | 'idle_window'
  | 'min_interval'
  | 'consecutive_pulse';

export type IdlePulseDecision =
  | { readonly fire: true }
  | { readonly fire: false; readonly reason: IdlePulseSkipReason };

/**
 * Pure guard evaluation — unit-tested without timers.
 */
export function evaluateIdlePulse(input: IdlePulseEvalInput): IdlePulseDecision {
  if (input.idleIntervalMs <= 0) return { fire: false, reason: 'disabled' };
  if (input.hasActiveTurn) return { fire: false, reason: 'active_turn' };
  if (input.running <= 0) return { fire: false, reason: 'no_running' };
  if (input.unreadInbox > 0) return { fire: false, reason: 'unread_inbox' };
  if (input.deskWakePending === true) return { fire: false, reason: 'desk_wake_pending' };
  if (input.lastVisible === 'assistant_pulse') {
    return { fire: false, reason: 'consecutive_pulse' };
  }
  if (input.nowMs - input.lastActivityAt < input.idleIntervalMs) {
    return { fire: false, reason: 'idle_window' };
  }
  if (
    input.lastPulseAt !== null &&
    input.nowMs - input.lastPulseAt < input.idleIntervalMs
  ) {
    return { fire: false, reason: 'min_interval' };
  }
  return { fire: true };
}

export interface ConductorIdlePulseOptions {
  readonly now?: () => number;
  readonly pollIntervalMs?: number;
  /** Override env resolution for tests. */
  readonly idleIntervalMs?: number | null;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
}

/**
 * Host-side timer that wakes an idle main lane for a short progress report.
 * Best-effort: never throws into the session lifecycle.
 */
export class ConductorIdlePulse {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastActivityAt: number;
  private lastPulseAt: number | null = null;
  private lastHistoryRevision = -1;
  private readonly now: () => number;
  private readonly pollIntervalMs: number;
  private readonly idleIntervalMs: number | null;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private started = false;

  constructor(
    private readonly agent: Agent,
    opts: ConductorIdlePulseOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.pollIntervalMs = opts.pollIntervalMs ?? IDLE_PULSE_POLL_MS;
    this.idleIntervalMs =
      opts.idleIntervalMs !== undefined
        ? opts.idleIntervalMs
        : resolveIdlePulseIntervalMs();
    this.setIntervalFn = opts.setIntervalFn ?? setInterval;
    this.clearIntervalFn = opts.clearIntervalFn ?? clearInterval;
    this.lastActivityAt = this.now();
    if (this.agent.type === 'main' && this.idleIntervalMs !== null) {
      this.start();
    }
  }

  start(): void {
    if (this.started || this.idleIntervalMs === null) return;
    if (this.agent.type !== 'main') return;
    this.started = true;
    this.timer = this.setIntervalFn(() => {
      this.tick();
    }, this.pollIntervalMs);
    // Unref so the pulse timer alone cannot keep a Node process alive.
    const handle = this.timer as { unref?: () => void };
    handle.unref?.();
  }

  stop(): void {
    this.started = false;
    if (this.timer !== null) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
  }

  /** Test / manual drive. */
  tick(): void {
    try {
      this.tickInner();
    } catch {
      // Best-effort — never break the host.
    }
  }

  private tickInner(): void {
    if (this.idleIntervalMs === null) return;
    if (this.agent.type !== 'main') return;

    const nowMs = this.now();
    this.noteActivityFromContext(nowMs);

    if (this.agent.turn.hasActiveTurn) {
      this.lastActivityAt = nowMs;
      return;
    }

    let store: ToolStore;
    try {
      store = this.agent.tools.getStore();
    } catch {
      return;
    }

    const strip = summarizeJobStrip(store);
    const unread = listUnreadJobInbox(store).length;
    const lastVisible = lastVisibleChatKind(this.agent.context.history);

    const decision = evaluateIdlePulse({
      nowMs,
      idleIntervalMs: this.idleIntervalMs,
      hasActiveTurn: false,
      running: strip.running,
      unreadInbox: unread,
      lastVisible,
      lastActivityAt: this.lastActivityAt,
      lastPulseAt: this.lastPulseAt,
    });

    if (!decision.fire) return;

    // Re-check running from live ledger (strip can lag tests that patch status).
    if (listJobs(store).filter((j) => j.status === 'running').length === 0) return;

    this.lastPulseAt = nowMs;
    this.lastActivityAt = nowMs;
    this.agent.turn.prompt(
      [{ type: 'text', text: CONDUCTOR_IDLE_PULSE_PROMPT }],
      CONDUCTOR_IDLE_PULSE_ORIGIN,
    );
  }

  private noteActivityFromContext(nowMs: number): void {
    const revision = this.agent.context.historyRevision;
    if (revision === this.lastHistoryRevision) return;
    this.lastHistoryRevision = revision;
    const kind = lastVisibleChatKind(this.agent.context.history);
    if (kind === 'user' || kind === 'assistant') {
      this.lastActivityAt = nowMs;
    }
    // assistant_pulse: do not treat as fresh chat activity for idle reset
    // beyond lastPulseAt; consecutive guard handles re-fire.
    if (kind === 'assistant_pulse' && this.lastPulseAt === null) {
      // History restored with a prior pulse — seed min-interval.
      this.lastPulseAt = nowMs;
    }
  }
}
