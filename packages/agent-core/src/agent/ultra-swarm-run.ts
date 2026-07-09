import type { TeamPlan } from '@superliora/protocol';

export interface UltraSwarmSteerRequest {
  readonly input: string;
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
  pausedForSteer: boolean;
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
    pausedForSteer: false,
  };
}

export function requestUltraSwarmSteer(
  run: UltraSwarmRunContext | undefined,
  input: string,
): boolean {
  if (run === undefined) return false;
  const trimmed = input.trim();
  if (trimmed.length === 0) return false;
  run.steerRequests.push({ input: trimmed, requestedAtMs: Date.now() });
  run.pausedForSteer = true;
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
