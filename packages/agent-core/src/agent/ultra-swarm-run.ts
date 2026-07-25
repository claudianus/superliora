import type { TeamPlan } from '@superliora/protocol';

export interface UltraSwarmSteerRequest {
  readonly input: string;
  readonly requestedAtMs: number;
}

export interface UltraSwarmRestaffRequest {
  readonly reason: string;
  readonly requestedAtMs: number;
}

export interface UltraSwarmRunContext {
  readonly runId: string;
  readonly parentToolCallId: string;
  readonly team: TeamPlan;
  readonly busEnabled: boolean;
  readonly expertAgentIds: Map<string, string>;
  /** Mid-run user steering requests (Pause-Redirect-Resume). */
  readonly steerRequests: UltraSwarmSteerRequest[];
  /** War-room / user restaff requests (force adaptive restaff wave). */
  readonly restaffRequests: UltraSwarmRestaffRequest[];
  pausedForSteer: boolean;
  /** True when a restaff was requested and not yet consumed. */
  restaffRequested: boolean;
}

export function createUltraSwarmRunContext(input: {
  readonly runId: string;
  readonly parentToolCallId: string;
  readonly team: TeamPlan;
  readonly busEnabled: boolean;
}): UltraSwarmRunContext {
  return {
    runId: input.runId,
    parentToolCallId: input.parentToolCallId,
    team: input.team,
    busEnabled: input.busEnabled,
    expertAgentIds: new Map(),
    steerRequests: [],
    restaffRequests: [],
    pausedForSteer: false,
    restaffRequested: false,
  };
}

export function requestUltraSwarmSteer(
  run: UltraSwarmRunContext | undefined,
  input: string,
): boolean {
  if (run === undefined) return false;
  const trimmed = input.trim();
  if (trimmed.length === 0) return false;

  // War-room restaff steers set the restaff flag without pausing the phase loop
  // as a pure pause — restaff is handled after the current phase finishes.
  if (isRestaffSteerText(trimmed)) {
    return requestUltraSwarmRestaff(run, extractRestaffReason(trimmed));
  }

  run.steerRequests.push({ input: trimmed, requestedAtMs: Date.now() });
  run.pausedForSteer = true;
  return true;
}

/**
 * Queue an explicit restaff request from the war-room dock or /swarm restaff.
 * Does not set pausedForSteer so adaptive restaff is not skipped by the pause gate.
 */
export function requestUltraSwarmRestaff(
  run: UltraSwarmRunContext | undefined,
  reason = 'User requested restaff',
): boolean {
  if (run === undefined) return false;
  const trimmed = reason.trim().length > 0 ? reason.trim() : 'User requested restaff';
  run.restaffRequests.push({ reason: trimmed, requestedAtMs: Date.now() });
  run.restaffRequested = true;
  // Do not push into steerRequests — that would break the phase loop as a pause.
  return true;
}

export function consumeUltraSwarmSteerRequests(
  run: UltraSwarmRunContext | undefined,
): string[] {
  if (run === undefined || run.steerRequests.length === 0) return [];
  const texts = run.steerRequests.map((request) => request.input);
  run.steerRequests.length = 0;
  return texts;
}

/** Consume restaff requests; clears restaffRequested. Returns reasons (may be empty). */
export function consumeUltraSwarmRestaffRequests(
  run: UltraSwarmRunContext | undefined,
): string[] {
  if (run === undefined) return [];
  const reasons = run.restaffRequests.map((request) => request.reason);
  run.restaffRequests.length = 0;
  run.restaffRequested = false;
  return reasons;
}

/** True when a restaff is pending (not yet consumed). */
export function hasPendingUltraSwarmRestaff(
  run: UltraSwarmRunContext | undefined,
): boolean {
  return run?.restaffRequested === true || (run?.restaffRequests.length ?? 0) > 0;
}

export function isRestaffSteerText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized.length === 0) return false;
  // War-room restaff directive from subagent-event-handler / /swarm restaff.
  if (normalized.includes('ultraswarm restaff requested')) return true;
  if (normalized.includes('restaff requested from war room')) return true;
  if (normalized.startsWith('restaff:') || normalized.startsWith('/swarm restaff')) return true;
  // Explicit restaff token near the start (avoid matching random prose).
  if (/^\s*restaff\b/i.test(text) || /\brequest(?:ed)?\s+restaff\b/i.test(text)) return true;
  return false;
}

function extractRestaffReason(text: string): string {
  const trimmed = text.trim();
  // Prefer the line after the canned war-room prefix when present.
  const withoutPrefix = trimmed
    .replace(/^UltraSwarm restaff requested from war room\.?\s*/i, '')
    .trim();
  if (withoutPrefix.length > 0) return withoutPrefix;
  return trimmed;
}
