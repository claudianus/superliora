import type {
  KnowledgePromotion,
  TeamPlan,
  UltraResearchRun,
  UltraworkRun,
  UltraworkRunStatus,
  UltraworkStage,
  VerificationResult,
  WorkGraph,
} from '@superliora/protocol';

export const ULTRAWORK_STAGE_ORDER: readonly UltraworkStage[] = [
  'intake',
  'plan',
  'research',
  'goal',
  'staff',
  'swarm',
  'integrate',
  'verify',
  'learn',
  'done',
];

const STAGE_INDEX = new Map<UltraworkStage, number>(
  ULTRAWORK_STAGE_ORDER.map((stage, index) => [stage, index]),
);

export interface CreateUltraworkStateMachineInput {
  readonly id: string;
  readonly objective: string;
  readonly now?: string;
}

export interface UltraworkRunUpdate {
  readonly researchRun?: UltraResearchRun;
  readonly teamPlan?: TeamPlan;
  readonly workGraph?: WorkGraph;
  readonly verification?: VerificationResult;
  readonly knowledgePromotions?: readonly KnowledgePromotion[];
}

export type UltraworkSwarmGateDecision = 'ENGAGE' | 'DEFER';
export type UltraworkSwarmGateVerdict = 'PASS' | 'BLOCKED' | 'FAIL';

export interface UltraworkCoverageLane {
  readonly id: string;
  readonly label?: string;
  readonly kind?: 'visual' | 'domain' | 'security' | 'performance' | 'review' | 'implementation' | 'qa' | 'research' | 'other';
  readonly material?: boolean;
}

export interface UltraworkSwarmLaneVerdict {
  readonly laneId: string;
  readonly verdict: UltraworkSwarmGateVerdict;
  readonly evidenceIds?: readonly string[];
}

export interface EvaluateUltraworkSwarmGateInput {
  readonly lanes: readonly UltraworkCoverageLane[];
  readonly decision?: UltraworkSwarmGateDecision;
  readonly deferWaiver?: string;
  readonly verdicts?: readonly UltraworkSwarmLaneVerdict[];
}

export interface UltraworkSwarmGateResult {
  readonly decision: UltraworkSwarmGateDecision;
  readonly requiredForCompletion: boolean;
  readonly requiredLaneIds: readonly string[];
  readonly canEnterVerify: boolean;
  readonly missingLaneIds: readonly string[];
  readonly failedLaneIds: readonly string[];
  readonly waiverRequired: boolean;
}

export class UltraworkRunStateMachine {
  private run: UltraworkRun;

  constructor(run: UltraworkRun) {
    assertValidStage(run.stage);
    this.run = run;
  }

  static create(input: CreateUltraworkStateMachineInput): UltraworkRunStateMachine {
    const now = input.now ?? new Date().toISOString();
    return new UltraworkRunStateMachine({
      id: input.id,
      objective: input.objective,
      status: 'running',
      stage: 'intake',
      createdAt: now,
      updatedAt: now,
      stageHistory: [{ stage: 'intake', enteredAt: now }],
    });
  }

  snapshot(): UltraworkRun {
    return this.run;
  }

  advance(to: UltraworkStage, reason?: string, now = new Date().toISOString()): UltraworkRun {
    assertValidStage(to);
    if (this.run.status === 'done' || this.run.status === 'failed') {
      throw new Error(`Cannot advance Ultrawork run after ${this.run.status}.`);
    }
    const fromIndex = stageIndex(this.run.stage);
    const toIndex = stageIndex(to);
    if (toIndex < fromIndex) {
      throw new Error(`Cannot move Ultrawork run backward from ${this.run.stage} to ${to}.`);
    }
    if (toIndex > fromIndex + 1) {
      throw new Error(`Cannot skip Ultrawork stages from ${this.run.stage} to ${to}.`);
    }

    const stageHistory = [...(this.run.stageHistory ?? [])];
    if (to !== this.run.stage) {
      stageHistory.push({ stage: to, enteredAt: now, reason });
    }

    this.run = {
      ...this.run,
      status: to === 'done' ? 'done' : 'running',
      stage: to,
      updatedAt: now,
      stageHistory,
    };
    return this.run;
  }

  update(update: UltraworkRunUpdate, now = new Date().toISOString()): UltraworkRun {
    this.run = {
      ...this.run,
      ...update,
      updatedAt: now,
    };
    return this.run;
  }

  markBlocked(reason: string, now = new Date().toISOString()): UltraworkRun {
    return this.markTerminalish('blocked', reason, now);
  }

  markFailed(reason: string, now = new Date().toISOString()): UltraworkRun {
    return this.markTerminalish('failed', reason, now);
  }

  resumeFromBlocked(now = new Date().toISOString()): UltraworkRun {
    if (this.run.status !== 'blocked') {
      throw new Error(`Cannot resume Ultrawork run from status ${this.run.status}.`);
    }
    this.run = {
      ...this.run,
      status: 'running',
      updatedAt: now,
    };
    return this.run;
  }

  syncStageForward(to: UltraworkStage, reason?: string, now = new Date().toISOString()): UltraworkRun {
    assertValidStage(to);
    if (this.run.status === 'done' || this.run.status === 'failed') {
      return this.run;
    }
    const fromIndex = stageIndex(this.run.stage);
    const toIndex = stageIndex(to);
    if (toIndex <= fromIndex) return this.run;

    const stageHistory = [...(this.run.stageHistory ?? [])];
    stageHistory.push({ stage: to, enteredAt: now, reason });
    this.run = {
      ...this.run,
      stage: to,
      updatedAt: now,
      stageHistory,
    };
    return this.run;
  }

  private markTerminalish(
    status: Exclude<UltraworkRunStatus, 'running' | 'done'>,
    reason: string,
    now: string,
  ): UltraworkRun {
    const stageHistory = [
      ...(this.run.stageHistory ?? []),
      { stage: this.run.stage, enteredAt: now, reason },
    ];
    this.run = {
      ...this.run,
      status,
      updatedAt: now,
      stageHistory,
    };
    return this.run;
  }
}

function assertValidStage(stage: UltraworkStage): void {
  if (!STAGE_INDEX.has(stage)) {
    throw new Error(`Unknown Ultrawork stage: ${stage}`);
  }
}

function stageIndex(stage: UltraworkStage): number {
  const index = STAGE_INDEX.get(stage);
  if (index === undefined) throw new Error(`Unknown Ultrawork stage: ${stage}`);
  return index;
}

export function evaluateUltraworkSwarmGate(
  input: EvaluateUltraworkSwarmGateInput,
): UltraworkSwarmGateResult {
  const requiredLaneIds = requiredSwarmLaneIds(input.lanes);
  const defaultDecision: UltraworkSwarmGateDecision =
    requiredLaneIds.length > 0 ? 'ENGAGE' : 'DEFER';
  const decision = input.decision ?? defaultDecision;
  const waiverRequired =
    decision === 'DEFER' &&
    requiredLaneIds.length > 0 &&
    normalizeWaiver(input.deferWaiver) === undefined;

  if (decision === 'DEFER') {
    return {
      decision,
      requiredForCompletion: false,
      requiredLaneIds,
      canEnterVerify: !waiverRequired,
      missingLaneIds: [],
      failedLaneIds: [],
      waiverRequired,
    };
  }

  const verdictByLane = new Map<string, UltraworkSwarmGateVerdict>();
  for (const verdict of input.verdicts ?? []) {
    verdictByLane.set(verdict.laneId, verdict.verdict);
  }
  const missingLaneIds: string[] = [];
  const failedLaneIds: string[] = [];
  for (const laneId of requiredLaneIds) {
    const verdict = verdictByLane.get(laneId);
    if (verdict === undefined) {
      missingLaneIds.push(laneId);
    } else if (verdict === 'FAIL') {
      failedLaneIds.push(laneId);
    }
  }

  return {
    decision,
    requiredForCompletion: requiredLaneIds.length > 0,
    requiredLaneIds,
    canEnterVerify: missingLaneIds.length === 0 && failedLaneIds.length === 0,
    missingLaneIds,
    failedLaneIds,
    waiverRequired: false,
  };
}

function requiredSwarmLaneIds(lanes: readonly UltraworkCoverageLane[]): string[] {
  const materialLanes = lanes.filter(isMaterialLane);
  const forcedKinds = new Set(['visual', 'domain', 'security', 'performance', 'review']);
  const forcedLanes = lanes.filter((lane) => lane.kind !== undefined && forcedKinds.has(lane.kind));
  if (materialLanes.length >= 2) return uniqueLaneIds([...materialLanes, ...forcedLanes]);
  if (forcedLanes.length > 0) return uniqueLaneIds(forcedLanes);
  return [];
}

function isMaterialLane(lane: UltraworkCoverageLane): boolean {
  if (lane.material !== undefined) return lane.material;
  return lane.kind !== undefined && lane.kind !== 'other';
}

function uniqueLaneIds(lanes: readonly UltraworkCoverageLane[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const lane of lanes) {
    const id = lane.id.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function normalizeWaiver(waiver: string | undefined): string | undefined {
  if (waiver === undefined) return undefined;
  const trimmed = waiver.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
