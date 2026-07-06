import type { ResumeUltraworkPayloadResult, SessionStatus, UltraworkRun } from '#/types';
import type { SwarmModeTrigger } from '@superliora/agent-core';

export interface UltraworkAutoResumeSession {
  getUltraworkRun(): Promise<UltraworkRun | null>;
  resumeUltrawork(): Promise<ResumeUltraworkPayloadResult | null>;
  getStatus(): Promise<SessionStatus>;
  setSwarmMode(enabled: boolean, trigger: SwarmModeTrigger): Promise<void>;
  setPlanMode(enabled: boolean, ultra: boolean, objective?: string): Promise<void>;
}

export interface AutoResumeUltraworkResult {
  readonly resumed: ResumeUltraworkPayloadResult;
  readonly setupChanged: boolean;
}

export async function tryAutoResumeUltrawork(
  session: UltraworkAutoResumeSession,
): Promise<AutoResumeUltraworkResult | null> {
  const run = await session.getUltraworkRun();
  if (run === null || run.status === 'done' || run.status === 'failed') {
    return null;
  }

  const setupChanged = await ensureUltraworkResumeSetup(session, run.objective);
  const resumed = await session.resumeUltrawork();
  if (resumed === null) return null;
  return { resumed, setupChanged };
}

export async function ensureUltraworkResumeSetup(
  session: UltraworkAutoResumeSession,
  objective = '',
): Promise<boolean> {
  const status = await session.getStatus();
  let changed = false;
  if (!status.swarmMode) {
    await session.setSwarmMode(true, 'task');
    changed = true;
  }
  if (!status.planMode) {
    await session.setPlanMode(true, true, objective);
    changed = true;
  }
  return changed;
}
