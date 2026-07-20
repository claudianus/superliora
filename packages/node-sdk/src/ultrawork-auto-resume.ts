import type { ResumeUltraworkPayloadResult, SessionStatus, UltraworkRun } from '#/types';
import type { SwarmModeTrigger } from '@superliora/agent-core';
import { shouldKeepPlanModeForUltraworkRun } from '@superliora/agent-core';

export interface UltraworkAutoResumeSession {
  getUltraworkRun(): Promise<UltraworkRun | null>;
  resumeUltrawork(): Promise<ResumeUltraworkPayloadResult | null>;
  getStatus(): Promise<SessionStatus>;
  setSwarmMode(enabled: boolean, trigger: SwarmModeTrigger): Promise<void>;
  setPlanMode(enabled: boolean, ultra?: boolean, objective?: string): Promise<void>;
  setPremiumQuality?(enabled: boolean): Promise<void>;
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

  const setupChanged = await ensureUltraworkResumeSetup(session, run);
  const resumed = await session.resumeUltrawork();
  if (resumed === null) return null;
  return { resumed, setupChanged };
}

export async function ensureUltraworkResumeSetup(
  session: UltraworkAutoResumeSession,
  run: UltraworkRun,
): Promise<boolean> {
  const status = await session.getStatus();
  let changed = false;
  if (!status.swarmMode) {
    await session.setSwarmMode(true, 'task');
    changed = true;
  }
  if (status.planMode && !shouldKeepPlanModeForUltraworkRun(run)) {
    await session.setPlanMode(false);
    changed = true;
  } else if (!status.planMode && shouldKeepPlanModeForUltraworkRun(run)) {
    await session.setPlanMode(true, true, run.objective);
    changed = true;
  }
  if (session.setPremiumQuality !== undefined && status.premiumQualityMode !== true) {
    try {
      await session.setPremiumQuality(true);
      changed = true;
    } catch {
      // Premium quality is best-effort on auto-resume; do not block resume.
    }
  }
  return changed;
}
