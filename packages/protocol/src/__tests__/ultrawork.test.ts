import { describe, expect, it } from 'vitest';

import {
  researchBackendSchema,
  researchEvidencePackSchema,
  researchEvidenceSchema,
  researchIntensitySchema,
  swarmBusChannelSchema,
  swarmBusMessageKindSchema,
  teamExpertAssignmentSchema,
  teamPlanSchema,
  ultraResearchRunSchema,
  ultraworkRunStatusSchema,
  ultraworkStageSchema,
  workGraphNodeSchema,
  workGraphSchema,
} from '../ultrawork';

describe('protocol/ultrawork — enum schemas', () => {
  it('ultraworkStageSchema accepts the lifecycle set', () => {
    for (const v of [
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
    ]) {
      expect(ultraworkStageSchema.parse(v)).toBe(v);
    }
    expect(() => ultraworkStageSchema.parse('unknown')).toThrow();
  });

  it('ultraworkRunStatusSchema accepts the status set', () => {
    for (const v of ['running', 'blocked', 'failed', 'done']) {
      expect(ultraworkRunStatusSchema.parse(v)).toBe(v);
    }
  });

  it('researchIntensitySchema accepts balanced/premium/max', () => {
    for (const v of ['balanced', 'premium', 'max']) {
      expect(researchIntensitySchema.parse(v)).toBe(v);
    }
    expect(() => researchIntensitySchema.parse('turbo')).toThrow();
  });

  it('swarmBusChannelSchema accepts standup/lane/direct/blocker/council', () => {
    for (const v of ['standup', 'lane', 'direct', 'blocker', 'council']) {
      expect(swarmBusChannelSchema.parse(v)).toBe(v);
    }
  });

  it('swarmBusMessageKindSchema accepts the message kinds', () => {
    for (const v of [
      'status',
      'question',
      'answer',
      'artifact_ref',
      'verdict',
      'mention',
    ]) {
      expect(swarmBusMessageKindSchema.parse(v)).toBe(v);
    }
  });
});

describe('protocol/ultrawork — object schemas', () => {
  it('researchBackendSchema accepts a minimal backend', () => {
    const b = researchBackendSchema.parse({
      id: 'b-1',
      kind: 'kimi_web_search',
      role: 'primary',
      status: 'available',
    });
    expect(b.id).toBe('b-1');
  });

  it('researchEvidenceSchema accepts a minimal evidence row', () => {
    const e = researchEvidenceSchema.parse({
      id: 'e-1',
      title: 'title',
      sourceType: 'official_docs',
      backendId: 'b-1',
      retrievedAt: '2026-01-01T00:00:00Z',
      verificationStatus: 'candidate',
    });
    expect(e.id).toBe('e-1');
  });

  it('researchEvidencePackSchema wraps a list of evidence', () => {
    const pack = researchEvidencePackSchema.parse({
      id: 'p-1',
      runId: 'r-1',
      topic: 'topic',
      generatedAt: '2026-01-01T00:00:00Z',
      evidence: [],
      verifiedFindingIds: [],
    });
    expect(pack.evidence).toEqual([]);
  });

  it('ultraResearchRunSchema accepts a run with backends', () => {
    const run = ultraResearchRunSchema.parse({
      id: 'r-1',
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
      intensity: 'balanced',
      backends: [],
    });
    expect(run.intensity).toBe('balanced');
  });

  it('teamExpertAssignmentSchema accepts a minimal assignment', () => {
    const t = teamExpertAssignmentSchema.parse({
      id: 't-1',
      name: 'expert',
      role: 'planner',
      focus: 'plan',
      status: 'queued',
    });
    expect(t.focus).toBe('plan');
  });

  it('teamPlanSchema enforces maxExperts range', () => {
    const base = {
      id: 'p-1',
      runId: 'r-1',
      intensity: 'balanced',
      maxExperts: 4,
      experts: [],
    } as const;
    const plan = teamPlanSchema.parse(base);
    expect(plan.maxExperts).toBe(4);
    expect(() => teamPlanSchema.parse({ ...base, maxExperts: 0 })).toThrow();
    expect(() => teamPlanSchema.parse({ ...base, maxExperts: 999 })).toThrow();
  });

  it('workGraphNodeSchema requires id, title, stage, and status', () => {
    const n = workGraphNodeSchema.parse({
      id: 'n-1',
      title: 't',
      stage: 'plan',
      status: 'queued',
    });
    expect(n.id).toBe('n-1');
  });

  it('workGraphSchema wraps nodes', () => {
    const g = workGraphSchema.parse({
      id: 'g-1',
      runId: 'r-1',
      nodes: [
        {
          id: 'n-1',
          title: 't',
          stage: 'plan',
          status: 'queued',
        },
      ],
    });
    expect(g.nodes).toHaveLength(1);
  });
});
