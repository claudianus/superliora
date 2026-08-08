/**
 * Host-path scroll hang probe.
 *
 * Renderer unit tests wrap cheap-paint in isolation; freezes still happen on
 * the full native callback (settle + deferred format + streaming coalesce).
 * This ring buffer + dump surface is the evidence path for those hangs.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { wasRecentTranscriptScroll } from '#/tui/utils/render/transcript-paint-mode';

/** Callback wall time that counts as a hang-class frame. */
export const SCROLL_HANG_CALLBACK_MS = 80;
/** Recent samples retained for dump context. */
export const SCROLL_HANG_RING_SIZE = 64;
/**
 * Match deferred-format scroll hold (220ms). Keep the literal here — importing
 * `DEFERRED_FORMAT_SCROLL_HOLD_MS` from deferred-format-queue creates a cycle
 * through `#/tui/renderer` → native-layout → this module and leaves exports
 * undefined at test import time.
 */
const SCROLL_HOLD_PROBE_MS = 220;

export interface ScrollHangSample {
  readonly t: number;
  readonly causes: readonly string[];
  readonly pureScroll: boolean;
  readonly storm: boolean;
  readonly childPaints: number;
  readonly materializeContinue: boolean;
  readonly renderCbMs: number;
  readonly deferredQueueSize: number;
  readonly scrollHold: boolean;
  readonly settleArmed: boolean;
  readonly streamingPhase: string;
}

export interface ScrollHangDump {
  readonly reason: 'callback-budget' | 'trace';
  readonly trigger: ScrollHangSample;
  readonly recent: readonly ScrollHangSample[];
  readonly writtenPath?: string;
}

export interface NoteScrollHangSampleInput {
  readonly causes: readonly string[];
  readonly pureScroll: boolean;
  readonly storm: boolean;
  readonly childPaints: number;
  readonly materializeContinue: boolean;
  readonly renderCbMs: number;
  readonly deferredQueueSize: number;
  readonly settleArmed: boolean;
  readonly streamingPhase: string;
  /** Override hold probe (tests). Default: real wasRecentTranscriptScroll. */
  readonly scrollHold?: boolean;
  readonly t?: number;
  readonly workDir?: string;
}

let ring: ScrollHangSample[] = [];
let lastSample: ScrollHangSample | undefined;
let lastDump: ScrollHangDump | undefined;
let sink: ((dump: ScrollHangDump) => void) | undefined;
let forceTrace: boolean | undefined;

function paintClockNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function truthyEnv(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
}

/** Live: SUPERLIORA_TUI_SCROLL_TRACE=1 dumps hang frames to stderr + workDir JSON. */
export function scrollHangTraceEnabled(): boolean {
  if (forceTrace !== undefined) return forceTrace;
  return truthyEnv(process.env['SUPERLIORA_TUI_SCROLL_TRACE']);
}

/** Whether deferred-format / chrome hold should be active right now. */
export function probeScrollHoldActive(
  nowMs: number = paintClockNowMs(),
): boolean {
  return wasRecentTranscriptScroll(nowMs, SCROLL_HOLD_PROBE_MS);
}

/** Record one host-frame sample; dumps when over budget or TRACE is on. */
export function recordScrollHangSample(input: NoteScrollHangSampleInput): ScrollHangSample {
  const sample: ScrollHangSample = {
    t: input.t ?? paintClockNowMs(),
    causes: input.causes,
    pureScroll: input.pureScroll,
    storm: input.storm,
    childPaints: input.childPaints,
    materializeContinue: input.materializeContinue,
    renderCbMs: input.renderCbMs,
    deferredQueueSize: input.deferredQueueSize,
    scrollHold: input.scrollHold ?? probeScrollHoldActive(),
    settleArmed: input.settleArmed,
    streamingPhase: input.streamingPhase,
  };
  ring.push(sample);
  if (ring.length > SCROLL_HANG_RING_SIZE) {
    ring = ring.slice(ring.length - SCROLL_HANG_RING_SIZE);
  }
  lastSample = sample;

  const overBudget = sample.renderCbMs >= SCROLL_HANG_CALLBACK_MS;
  if (overBudget || (scrollHangTraceEnabled() && sample.causes.includes('transcript-scroll'))) {
    emitDump(sample, overBudget ? 'callback-budget' : 'trace', input.workDir);
  }
  return sample;
}

function emitDump(
  trigger: ScrollHangSample,
  reason: ScrollHangDump['reason'],
  workDir: string | undefined,
): void {
  let writtenPath: string | undefined;
  if (scrollHangTraceEnabled() && workDir !== undefined && workDir.length > 0) {
    writtenPath = join(workDir, `scroll-hang-${String(Date.now())}.json`);
    try {
      writeFileSync(
        writtenPath,
        `${JSON.stringify({ reason, trigger, recent: ring }, null, 2)}\n`,
      );
    } catch {
      writtenPath = undefined;
    }
  }

  const dump: ScrollHangDump = {
    reason,
    trigger,
    recent: ring.slice(),
    ...(writtenPath === undefined ? {} : { writtenPath }),
  };
  lastDump = dump;
  sink?.(dump);

  if (scrollHangTraceEnabled()) {
    const line = formatScrollHangHudLine(trigger);
    try {
      process.stderr.write(`[scroll-hang] ${reason} ${line}\n`);
    } catch {
      // stderr may be closed in tests
    }
  }
}

/** One-line HUD / status summary from the latest sample. */
export function formatScrollHangHudLine(
  sample: ScrollHangSample | undefined = lastSample,
): string {
  if (sample === undefined) {
    return 'scroll idle childPaints=? defer=? hold=? settle=? cb=?ms';
  }
  const mode = sample.storm ? 'storm' : sample.pureScroll ? 'scroll' : 'idle';
  return [
    `scroll ${mode}`,
    `childPaints=${String(sample.childPaints)}`,
    `defer=${String(sample.deferredQueueSize)}`,
    `hold=${sample.scrollHold ? 'Y' : 'N'}`,
    `settle=${sample.settleArmed ? 'Y' : 'N'}`,
    `cb=${sample.renderCbMs.toFixed(1)}ms`,
  ].join(' ');
}

export function lastScrollHangSample(): ScrollHangSample | undefined {
  return lastSample;
}

export function lastScrollHangDumpForTest(): ScrollHangDump | undefined {
  return lastDump;
}

export function scrollHangRingForTest(): readonly ScrollHangSample[] {
  return ring;
}

export function setScrollHangProbeSinkForTest(
  next: ((dump: ScrollHangDump) => void) | undefined,
): void {
  sink = next;
}

export function setScrollHangTraceEnabledForTest(enabled: boolean | undefined): void {
  forceTrace = enabled;
}

export function resetScrollHangProbeForTest(): void {
  ring = [];
  lastSample = undefined;
  lastDump = undefined;
  sink = undefined;
  forceTrace = undefined;
}
